# Hybrid Transclusion Plan

Cross-document CSG tree embedding with both pinned-version and live modes.

## Overview

A `transclude` node in one room's CSG tree references another room's tree. Two modes:

- **Pinned**: fetches a specific version once, caches forever (immutable)
- **Live**: maintains a real-time sync connection, rebuilds on remote changes

The mode is determined by whether `frontiers` is present on the node.

```ts
interface CsgTranscludeNode extends CsgNodeBase {
  type: "transclude";
  roomId: string;
  frontiers?: { peer: string; counter: number }[]; // omit for live
}
```

---

## Phase 1: Server — `/tree` endpoint

**File: `services/sync-worker/src/document-room.ts`**

Add `GET /rooms/:roomId/tree/:frontiers` alongside the existing `/snapshot` endpoint. The frontiers segment uses the same comma-separated `peer:counter` format as the snapshot endpoint's `?at=` param:

```
GET /rooms/my-room/tree/12345:42,67890:17
```

This reads as "the tree of `my-room` at version `12345:42,67890:17`". Each path identifies a unique, immutable resource — a natural fit for the URL path rather than a query param.

Returns the materialized CSG tree as JSON instead of a binary Loro snapshot. The server forks the doc at the given frontiers, reads the `shapes` LoroTree, converts to JSON, and returns it.

```
Response: { "id": "...", "type": "group", "children": [...] }
Content-Type: application/json
Cache-Control: public, immutable, max-age=31536000
```

The frontiers path segment is required — without it the route doesn't match. There's no use case for fetching the live tree over HTTP when WebSocket exists for that.

**Why not reuse `/snapshot`?** Snapshots contain the full oplog and are meant for bootstrapping a LoroDoc. The `/tree` endpoint returns only the materialized tree (much smaller, no CRDT overhead, directly usable as `CsgTreeNode`).

**Route in `index.ts`:** Add a `/rooms/:roomId/tree/:frontiers` pattern that forwards to the DO, same as `/snapshot`.

---

## Phase 2: Data model — `CsgTranscludeNode`

**File: `apps/studio/src/types/CsgTree.ts`**

Add to the discriminated union:

```ts
export interface CsgTranscludeNode extends CsgNodeBase {
  type: "transclude";
  roomId: string;
  frontiers?: { peer: string; counter: number }[];
}

export type CsgTreeNode =
  | CsgPrimitiveNode
  | CsgBooleanNode
  | CsgGroupNode
  | CsgTranscludeNode;
```

`CsgTranscludeNode` is a leaf (no `children`). It carries a `matrix` for positioning (inherited from `CsgNodeBase`). `hasChildren()` returns false for it.

**File: `apps/studio/src/sync-store.ts`**

The Loro write/read helpers already handle arbitrary data keys via `data.set(key, value)` and `data.toJSON()`. No changes needed — `roomId` and `frontiers` will round-trip through the LoroMap automatically.

---

## Phase 3: Multi-room connection manager

**File: `apps/studio/src/room-manager.ts`** (new)

The current `sync-store.ts` has a single global `LoroDoc`. For live transclusion the client needs to connect to multiple rooms simultaneously. Rather than refactoring the existing store (which handles the primary editable doc), create a separate read-only connection manager for transcluded rooms.

### Data structure

```ts
interface RemoteRoom {
  doc: LoroDoc;
  ws: WebSocket | null;
  cachedTree: CsgTreeNode;
  listeners: Set<() => void>;
  refCount: number;              // how many transclude nodes reference this room
  unsubLocalUpdates: (() => void) | null;
}

const remoteRooms = new Map<string, RemoteRoom>();
```

### API

```ts
/** Subscribe to a remote room's live tree. Manages connection lifecycle. */
function subscribeRoom(roomId: string): RemoteRoom

/** Decrement refcount. Disconnects + cleans up when refcount hits 0. */
function unsubscribeRoom(roomId: string): void

/** React hook: returns live CsgTreeNode for a remote room. */
function useRemoteTree(roomId: string): CsgTreeNode
```

### Connection lifecycle

`subscribeRoom`:
1. If room already in `remoteRooms`, increment `refCount`, return it
2. Otherwise create a new `LoroDoc`, fetch snapshot from `GET /rooms/:roomId/snapshot`, open WebSocket to `/rooms/:roomId/ws`
3. Wire up the same message handling as `connectSync` (import updates, handle catchup/peer ID)
4. On any doc change, rebuild `cachedTree` from roots and notify listeners
5. Store in `remoteRooms` with `refCount: 1`

`unsubscribeRoom`:
1. Decrement `refCount`
2. If 0, close WebSocket, clear doc, remove from map

This is read-only — no `subscribeLocalUpdates`, no `doc.commit()`. Remote rooms are never written to from this client.

### Reconnection

Same 3-second reconnect loop as the primary connection. On reconnect, send version vector for incremental catchup.

---

## Phase 4: Resolution layer

**File: `apps/studio/src/resolve-transclusions.ts`** (new)

A function that walks a `CsgTreeNode` tree, finds all `transclude` nodes, and replaces them with the resolved remote trees.

```ts
async function resolveTransclusions(
  tree: CsgTreeNode,
  syncBaseUrl: string,
): Promise<CsgTreeNode>
```

### Pinned resolution

For nodes with `frontiers`:
1. Check in-memory cache (`Map<string, CsgTreeNode>` keyed by `${roomId}:${JSON.stringify(frontiers)}`)
2. Cache miss: `fetch(GET /rooms/{roomId}/tree/{peer1:counter1,...})`, parse JSON, cache result
3. Replace the transclude node with the fetched tree (applying the node's `matrix`)

Cache is session-lifetime (pinned versions are immutable).

### Live resolution

For nodes without `frontiers`:
1. Call `subscribeRoom(roomId)` from room-manager
2. Read `remoteRoom.cachedTree`
3. Replace the transclude node with the live tree (applying the node's `matrix`)

The caller must also `unsubscribeRoom` when the transclude node is removed from the tree.

### Recursion and cycle detection

Resolved trees may themselves contain `transclude` nodes. Recurse with a visited set of `roomId` values. If a roomId appears twice in the resolution stack, replace with a placeholder group node and log a warning.

Depth limit of 8 levels as a safety net.

### Integration point

Resolution runs between "Loro tree changes" and "CsgScene receives tree". Two approaches:

**Option A — resolve in CsgScene.** `CsgScene` receives the raw tree (may contain transclude nodes), runs resolution, and passes the resolved tree to `CsgRoot`. Resolution is async (fetch for pinned), so CsgScene needs a state for the resolved tree that updates when either the local tree or any remote tree changes.

**Option B — resolve in a wrapper hook.** A `useResolvedTree(tree)` hook that returns the resolved tree. Internally uses `useEffect` for async pinned fetches and `useRemoteTree` for live subscriptions. Returns the last successfully resolved tree while a new resolution is in flight.

Option B is cleaner — keeps CsgScene pure.

```ts
function useResolvedTree(tree: CsgTreeNode): CsgTreeNode {
  // 1. Collect all transclude nodes from tree
  // 2. For pinned: fetch if not cached (async, update state on completion)
  // 3. For live: useRemoteTree(roomId) for each (reactive)
  // 4. Replace transclude nodes with resolved trees
  // 5. Return resolved tree (or tree-with-placeholders while loading)
}
```

The tricky part: `useRemoteTree` is a hook, and the number of live transclusions is dynamic. Use a single `useSyncExternalStore` that subscribes to all active remote rooms, or manage subscriptions imperatively in an effect.

---

## Phase 5: Reconciler support — `transclude` as passthrough

**File: `packages/react-manifold/src/reconciler/geometry-builder.ts`**

After resolution, the tree passed to `CsgRoot` will never contain `transclude` nodes (they've been replaced). So the reconciler doesn't need to know about transclusion at all.

However, for the **live** case, we want to avoid rebuilding the entire CSG when only a remote subtree changes. The current reconciler already has dirty tracking per `CsgNode`. If we structure the resolved tree so that the remote subtree is a stable child node (same `id` across updates, only its children change), the dirty tracking will limit the rebuild to just that subtree.

### Future optimization: pre-built Manifold injection

For large transcluded trees, building their Manifold from scratch every time is wasteful. A future optimization:

1. Add a new node type `"manifold-ref"` to the reconciler that accepts a pre-built `Manifold` WASM handle
2. Each remote room builds its own Manifold independently (in a dedicated `CsgRoot`)
3. The main tree references the pre-built handle instead of re-traversing the subtree

This requires careful WASM handle ownership (the handle must come from the same Manifold module instance). Defer this to a later phase — the naive approach (inline the full resolved tree) works first.

---

## Phase 6: UI — creating and managing transclusions

**File: `apps/studio/src/App.tsx`** (scene panel additions)

### Creating a transclusion

Add a "Transclude" button to the Tools fieldset. Clicking it opens a small dialog:
1. Text input for room ID
2. Toggle: "Live" (default) / "Pinned"
3. If pinned: fetch remote room's history (merge points), show a version picker
4. "Add" button creates a `CsgTranscludeNode` and calls `addShape()`

### Tree panel display

**File: `apps/studio/src/components/CsgTreePanel.tsx`**

Show transclude nodes with a distinct icon/label:
- Live: `"roomId (live)"` with a connected indicator
- Pinned: `"roomId @v3"` (version number = merge point index)

### Updating a pinned transclusion

Right-click / context action on a pinned transclude node → "Update version" → shows the remote room's merge points → user picks new version → updates `frontiers` on the node.

---

## Phase 7: Sync-store changes for transclude write support

**File: `apps/studio/src/sync-store.ts`**

The existing `writeNodeToTree` / `patchNode` / `loroTreeNodeToCsg` functions handle arbitrary node types via `data.set(key, value)` / `data.toJSON()`. The `roomId` and `frontiers` fields are plain JSON values, so they serialize through the LoroMap without changes.

The only addition needed: when `loroTreeNodeToCsg` encounters a node with `type: "transclude"`, it should NOT attempt to read `children` (there are none). The current code already handles this — `treeNode.children()` returns an empty array for leaf nodes.

No changes required.

---

## Ordering and dependencies

```
Phase 1 ─── Server /tree endpoint
              │
Phase 2 ─── CsgTranscludeNode type
              │
        ┌─────┴─────┐
        │            │
Phase 3 │    Phase 4 │
Room    │    Resolution
Manager │    Layer
(live)  │    (pinned + live)
        │            │
        └─────┬─────┘
              │
Phase 5 ─── Reconciler (no-op, verify passthrough)
              │
Phase 6 ─── UI
```

**Phase 1 + 2** can ship independently — they're useful even without the client resolution layer (e.g., external tools can fetch versioned trees via HTTP).

**Phase 3** is only needed for live mode. Pinned-only transclusion works with just Phase 1 + 2 + 4 (the resolution layer fetches from `/tree?at=` and doesn't need WebSocket).

**Recommended implementation order:**
1. Phase 2 (type) — trivial
2. Phase 1 (server endpoint) — small, self-contained
3. Phase 4 pinned-only (resolution layer, no live) — usable milestone
4. Phase 6 basic UI (add transclude node) — usable milestone
5. Phase 3 (room manager) — needed for live
6. Phase 4 live (extend resolution layer)
7. Phase 6 full UI (live/pinned toggle, version picker)

---

## Cycle and error handling

| Scenario | Behavior |
|----------|----------|
| A transcludes B, B transcludes A | Cycle detected in resolution stack → replace with empty group, console warning |
| Remote room doesn't exist | `/tree` returns 404 → render placeholder cube, show error in tree panel |
| Remote room connection drops (live) | Keep last-known tree, show stale indicator in tree panel |
| WASM module mismatch | Not possible — all Manifold ops use the same module instance in one browser tab |
| Deeply nested transclusions (>8) | Depth limit hit → stop resolving, render as-is |

---

## Decisions

1. **Transclusions are read-only.** The client never writes to a transcluded room's doc. Editable transclusions (opening a read-write connection to the remote room) may be revisited later.

2. **Resolution is client-side only.** No server-side recursive resolution for now. The server serves individual room trees; the client composes them.

3. **Always transclude the full room root.** No sub-tree selection — a transclude node references the entire root of the target room. Sub-tree transclusion (`nodeId` field) may be added later.
