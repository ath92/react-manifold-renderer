# Loro Sync Service — Cloudflare Workers + Durable Objects

## Overview

A real-time collaboration backend for Manifold Studio. Each Loro document (a studio project) lives in a Durable Object. Clients connect over WebSocket, send binary Loro updates, and receive broadcasts of other peers' changes. The DO persists the merged document to durable storage so new joiners get a full snapshot on connect.

---

## Architecture

```
                         ┌─────────────────────────────┐
    Client A ──ws──►     │    Cloudflare Worker         │
    Client B ──ws──►     │  (stateless routing layer)   │
    Client C ──ws──►     │                              │
                         │  Routes by docId to ──►      │
                         └──────────┬──────────────────┘
                                    │
                         ┌──────────▼──────────────────┐
                         │   Durable Object             │
                         │   "DocumentRoom"             │
                         │                              │
                         │  • LoroDoc (in-memory)       │
                         │  • Connected WebSockets set  │
                         │  • Persisted to DO storage   │
                         │  • Ephemeral awareness state │
                         └─────────────────────────────┘
```

### Why Durable Objects

- Single-threaded guarantee per document — no merge races, no distributed locks.
- WebSocket Hibernation API keeps idle connections cheap (billed only on messages, not wall-clock time).
- Built-in durable storage (key/value) for persisting snapshots without an external database.
- Auto-scales: each document gets its own isolate, Cloudflare places it near the first user.

---

## Data Model

Each Durable Object stores:

| Key                        | Value                        | Purpose                                          |
|----------------------------|------------------------------|--------------------------------------------------|
| `doc:snapshot`             | `Uint8Array` (Loro snapshot) | Full document state including complete oplog      |
| `update:<seq>`             | `Uint8Array` (Loro update)   | Append-only log of every update received          |
| `update:seq`               | `number`                     | Next sequence number for the update log           |

**Full snapshots** — Loro's `export({ mode: "snapshot" })` includes the entire operation history (all ops from all peers, with causal ordering). This means the snapshot alone is sufficient for full time-travel via `doc.checkout(frontiers)`. No shallow snapshots — history is never discarded.

**Append-only update log (WAL)** — Every update received from a client is **durably written** (`await storage.put(...)`) as `update:<seq>` (zero-padded, e.g. `update:00000042`) *before* the update is imported into the in-memory doc or broadcast to other peers. This guarantees zero data loss: if the DO crashes at any point, uncompacted WAL entries are replayed on the next hydration.

**Snapshot compaction** — Triggered via `storage.setAlarm()` (not `setTimeout`, which doesn't survive DO eviction). After 5 seconds of inactivity, the alarm fires, writes a full snapshot, and deletes all `update:*` WAL keys. The alarm is re-armed on each incoming update, so compaction only runs when the document is idle.

**Durability invariant** — An update is only broadcast to peers *after* its WAL entry is confirmed durable. This means every update that any client receives has already been persisted. The ~1-5ms latency of a DO storage write is negligible compared to network RTT.

---

## Wire Protocol

All messages are binary (ArrayBuffer) with a 1-byte tag prefix.

### Client → Server

| Tag  | Name              | Payload                         | Description                          |
|------|-------------------|---------------------------------|--------------------------------------|
| 0x01 | `Update`          | Loro update bytes               | Local changes to broadcast + merge   |
| 0x02 | `AwarenessUpdate`  | Encoded ephemeral store bytes   | Cursor position, selection, username |
| 0x03 | `VersionVector`     | Encoded VV bytes                | Client's current version (sent after HTTP snapshot import) |

### Server → Client

| Tag  | Name              | Payload                         | Description                          |
|------|-------------------|---------------------------------|--------------------------------------|
| 0x81 | `Update`          | Loro update bytes               | Broadcast of another peer's changes  |
| 0x82 | `AwarenessUpdate`  | Encoded ephemeral store bytes   | Other peers' presence data           |
| 0x83 | `CatchUp`         | Loro update bytes               | Missed updates between snapshot and now (if any) |
| 0x84 | `PeerId`          | 8-byte peer ID (BigUint64)      | Assigned peer ID for the session     |

### Connection Lifecycle

```
Client                          Server (DO)
  │                                │
  ├── GET /docs/:id/snapshot ─────►│
  │◄──── 200 body: Uint8Array ─────┤  (full snapshot over HTTP)
  │  doc.import(snapshot)          │
  │                                │
  ├── WebSocket connect ──────────►│
  │                                ├── Assign unique peer ID
  │◄──────────── PeerId (0x84) ────┤
  │                                │
  ├── VersionVector (0x03) ───────►│  (client's version after snapshot)
  │                                ├── diff = updates since that version
  │◄──────────── CatchUp (0x83) ───┤  (missed updates, if any)
  │◄──────── AwarenessUpdate (0x82)┤  (who else is here)
  │                                │
  ├── Update (0x01) ──────────────►│
  │                                ├── await storage.put (WAL)
  │                                ├── doc.import(bytes)
  │                                ├── broadcast to other peers
  │◄──────────── Update (0x81) ────┤  (from other peer)
  │                                │
  ├── AwarenessUpdate (0x02) ─────►│
  │                                ├── broadcast to other peers
  │                                │
  │         (disconnect)           │
  │                                ├── remove from peers set
  │                                ├── broadcast awareness removal
  │                                ├── if 0 peers: compact now (snapshot + clear WAL)
```

---

## Durable Object: `DocumentRoom`

### State

```ts
interface RoomState {
  doc: LoroDoc;                          // In-memory merged document
  peers: Map<WebSocket, PeerInfo>;       // Connected clients
  nextSeq: number;                       // Next WAL sequence number
  dirty: boolean;                        // Unsaved changes since last snapshot
}

interface PeerInfo {
  peerId: bigint;
  joinedAt: number;
}
```

### Key Methods

**`fetch(request)`** — Routes by path:
- `/snapshot` (GET) → Hydrate if cold. If `?at=<frontiers>` query param is present, fork the doc, checkout to the requested frontiers, and export that fork. Otherwise return `doc.export({ mode: "snapshot" })`. Response is `application/octet-stream`.
- `/history` (GET) → Hydrate if cold. Return `doc.getAllChanges()` as JSON — array of `{ peer, counter, timestamp, message, lamport, deps }` entries.
- `/ws` (GET, Upgrade) → Hydrate if cold, accept WebSocket via hibernation API, assign peer ID, send `0x84 PeerId`.

**`webSocketMessage(ws, message)`** — Dispatches on tag byte:
- `0x01` (Update):
  ```ts
  // 1. Persist to WAL — MUST complete before broadcast
  const seq = this.nextSeq++;
  await this.ctx.storage.put(`update:${String(seq).padStart(8, "0")}`, payload);
  await this.ctx.storage.put("update:seq", this.nextSeq);

  // 2. Now safe to import + broadcast
  this.doc.import(payload);
  this.broadcast(ws, 0x81, payload);

  // 3. Arm compaction alarm (resets on each update)
  this.dirty = true;
  await this.ctx.storage.setAlarm(Date.now() + 5000);
  ```
- `0x02` → Broadcast `0x82` to all other sockets (server doesn't store ephemeral state).
- `0x03` → Client sent its version vector. Compute `doc.export({ mode: "update", from: clientVV })` and send as `0x83 CatchUp`. If the diff is empty, send a zero-length `0x83`.

**`webSocketClose(ws)` / `webSocketError(ws)`** — Remove from peers map, broadcast awareness removal. If no peers remain, run compaction immediately (write snapshot, clear WAL).

**`alarm()`** — Snapshot compaction. Runs when the `setAlarm` timer fires (5s after the last update):
```ts
async alarm() {
  if (!this.dirty) return;
  const snapshot = this.doc.export({ mode: "snapshot" });
  await this.ctx.storage.put("doc:snapshot", snapshot);

  // Delete all WAL entries
  const walKeys = await this.ctx.storage.list({ prefix: "update:" });
  if (walKeys.size > 0) {
    await this.ctx.storage.delete([...walKeys.keys()]);
  }
  await this.ctx.storage.put("update:seq", 0);
  this.nextSeq = 0;
  this.dirty = false;
}
```

### Hydration

On first `fetch` after cold start:
1. Read `doc:snapshot` from storage.
2. If exists: `doc.import(snapshot)`.
3. If not: start with empty `LoroDoc`.
4. Read `update:seq` to restore `nextSeq` counter.
5. List all `update:*` keys (excluding `update:seq`), sorted by key. `doc.importBatch(updates)` to replay the WAL. These are updates that were durably written but not yet compacted into a snapshot (e.g. the DO was evicted before the alarm fired).
6. If WAL entries were replayed, immediately compact (write snapshot, clear WAL, reset seq).

---

## Worker (Router)

The stateless Worker sits in front and routes requests to the correct DO.

```ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Routes: /docs/:docId/(ws|snapshot|history)
    const match = url.pathname.match(/^\/docs\/([a-zA-Z0-9_-]+)\/(ws|snapshot|history)$/);
    if (!match) {
      return new Response("Not found", { status: 404 });
    }

    const docId = match[1];
    const id = env.DOCUMENT_ROOM.idFromName(docId);
    const stub = env.DOCUMENT_ROOM.get(id);
    return stub.fetch(request);
  },
};
```

### Endpoints

| Method | Path                          | Purpose                        |
|--------|-------------------------------|--------------------------------|
| GET    | `/docs/:id/ws`                | WebSocket upgrade              |
| GET    | `/docs/:id/snapshot`          | Download full snapshot (binary, `application/octet-stream`). Contains complete oplog for client-side time-travel |
| GET    | `/docs/:id/history`           | JSON array of change metadata (peer, counter, timestamp, message, lamport) |
| GET    | `/docs/:id/snapshot?at=<frontiers>` | Snapshot checked out at a specific version (for point-in-time retrieval) |
| POST   | `/docs/:id/snapshot`          | Upload/overwrite snapshot (future) |
| GET    | `/docs`                       | List user's documents (future, needs auth) |

---

## Client Integration (`apps/studio`)

Changes to the existing `store.ts`. A new `connectSync(docId)` function handles the full lifecycle: HTTP snapshot fetch, WebSocket for incremental sync, and optional BroadcastChannel for multi-tab.

```ts
const BASE_URL = "https://sync.manifold.studio";

async function connectSync(docId: string) {
  // 1. Fetch snapshot over HTTP
  console.log("[sync] fetching snapshot via HTTP");
  const res = await fetch(`${BASE_URL}/docs/${docId}/snapshot`);
  if (res.ok) {
    const snapshot = new Uint8Array(await res.arrayBuffer());
    doc.import(snapshot);
    console.log(`[sync] imported snapshot (${(snapshot.length / 1024).toFixed(1)} kB)`);
  }

  // 2. Set up BroadcastChannel for multi-tab
  const channelName = `manifold:${docId}`;
  const bc = new BroadcastChannel(channelName);
  console.log(`[sync] BroadcastChannel "${channelName}" opened`);

  let isLeader = false;
  let ws: WebSocket | null = null;

  // Leader election: ping, wait 500ms for pong
  bc.postMessage({ type: "leader-ping" });
  const pongPromise = new Promise<boolean>((resolve) => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "leader-pong") {
        bc.removeEventListener("message", onMsg);
        resolve(false);
      }
    };
    bc.addEventListener("message", onMsg);
    setTimeout(() => {
      bc.removeEventListener("message", onMsg);
      resolve(true); // no pong → we are leader
    }, 500);
  });

  isLeader = await pongPromise;

  if (isLeader) {
    console.log("[sync] this tab is leader, opening WebSocket");
    ws = new WebSocket(`${BASE_URL.replace("https", "wss")}/docs/${docId}/ws`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      console.log("[sync] WebSocket connected");

      // Send our version vector so server can send catch-up
      const vv = doc.version();  // encoded version vector
      const msg = new Uint8Array(1 + vv.length);
      msg[0] = 0x03;
      msg.set(vv, 1);
      ws!.send(msg);

      // Pipe local updates → server + broadcast channel
      doc.subscribeLocalUpdates((bytes) => {
        const msg = new Uint8Array(1 + bytes.length);
        msg[0] = 0x01;
        msg.set(bytes, 1);
        ws!.send(msg);
        bc.postMessage({ type: "loro-update", data: bytes });
        console.log(`[sync] broadcasting local update (${bytes.length} B)`);
      });
    };

    ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      const tag = data[0];
      const payload = data.subarray(1);

      switch (tag) {
        case 0x81: // Remote update
          console.log(`[sync] received remote update (${payload.length} B) from server`);
          doc.import(payload);
          bc.postMessage({ type: "loro-update", data: payload });
          break;
        case 0x83: // Catch-up
          console.log(`[sync] received catch-up (${payload.length} B)`);
          doc.import(payload);
          bc.postMessage({ type: "loro-update", data: payload });
          break;
        case 0x84: { // PeerId
          const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          doc.setPeerId(view.getBigUint64(0));
          break;
        }
      }
    };

    ws.onclose = () => console.log("[sync] WebSocket closed");
  } else {
    console.log("[sync] another tab is leader, using BroadcastChannel");

    // Follower: send local updates through broadcast channel
    doc.subscribeLocalUpdates((bytes) => {
      bc.postMessage({ type: "loro-update", data: bytes });
      console.log(`[sync] sent local update (${bytes.length} B) via BroadcastChannel`);
    });
  }

  // All tabs: apply updates from broadcast channel
  bc.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg?.type === "loro-update") {
      doc.import(new Uint8Array(msg.data));
    } else if (msg?.type === "leader-ping" && isLeader) {
      bc.postMessage({ type: "leader-pong" });
    } else if (msg?.type === "leader-leaving" && !isLeader) {
      // Promote to leader
      console.log("[sync] leader left, promoting to leader");
      isLeader = true;
      // Re-open WebSocket (omitted for brevity — same as above)
    }
  });

  // Leader cleanup on unload
  window.addEventListener("beforeunload", () => {
    if (isLeader) {
      bc.postMessage({ type: "leader-leaving" });
      ws?.close();
      console.log("[sync] leader unloading, notified other tabs");
    }
    bc.close();
    console.log(`[sync] BroadcastChannel "${channelName}" closed`);
  });
}
```

---

## File Structure

```
services/
└── sync-worker/
    ├── wrangler.toml            # Cloudflare config + DO bindings
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts             # Worker entrypoint (router)
    │   ├── document-room.ts     # Durable Object class
    │   ├── protocol.ts          # Tag constants, encode/decode helpers
    │   └── peer-id.ts           # Unique peer ID generation
    └── test/
        └── protocol.test.ts     # Roundtrip encode/decode tests
```

### `wrangler.toml`

```toml
name = "manifold-sync"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[durable_objects]
bindings = [
  { name = "DOCUMENT_ROOM", class_name = "DocumentRoom" }
]

[[migrations]]
tag = "v1"
new_classes = ["DocumentRoom"]
```

---

## Scaling & Limits

| Concern              | Approach                                                        |
|----------------------|-----------------------------------------------------------------|
| Max connections/DO   | CF limit is 32k hibernated sockets per DO — more than enough    |
| Storage size         | DO storage limit is 1 GB per DO. Loro snapshots are compact     |
| Message size         | CF WebSocket max is 1 MB. Initial snapshots served over HTTP GET    |
| Cold start latency   | Hydrate snapshot + WAL replay from DO storage (~5-50ms). Acceptable |
| Per-message latency  | ~1-5ms for awaited WAL write. Negligible vs network RTT         |
| Global latency       | DO is pinned to a region. Acceptable for collaborative editing  |
| Conflict resolution  | Handled entirely by Loro CRDT — no server-side merge logic needed |
| Crash durability     | Zero data loss. WAL write completes before broadcast. `setAlarm` survives eviction |

---

## Authentication (Not in v1, Outline Only)

Future: add a middleware in the Worker that validates a JWT or session cookie before upgrading to WebSocket. The `docId` namespace can encode ownership (e.g., `userId/projectName`). The DO itself doesn't need to know about auth — the Worker gate-keeps access.

---

## Decisions

1. **Snapshot delivery** — Initial snapshots are served via `GET /docs/:id/snapshot` (HTTP), not over the WebSocket. Avoids the 1 MB WS message limit entirely. On connect the server sends only a `PeerId` message; the client fetches the snapshot over HTTP first, imports it, then opens the WebSocket for incremental updates.
2. **Version history** — Server preserves full history. Loro's full snapshots include the complete oplog, so `doc.checkout(frontiers)` works on the server or client. A `/history` endpoint exposes change metadata as JSON, and `/snapshot?at=<frontiers>` returns a point-in-time snapshot.
3. **Durability** — Every update is `await`-written to a WAL in DO storage *before* being broadcast. Snapshot compaction runs via `storage.setAlarm()` (survives eviction, unlike `setTimeout`). Zero data loss on crashes — uncompacted WAL entries are replayed on hydration.
4. **Garbage collection** — None. Full snapshots, never shallow. History is never discarded.
5. **Multi-tab** — Optional `BroadcastChannel`. One tab becomes the "leader" that owns the WebSocket. Other tabs relay local updates through the channel and receive remote updates the same way. All channel open/close events and WebSocket lifecycle events are logged to the console with a `[sync]` prefix so connection topology is visible during development.

---

## Multi-Tab Strategy

```
  Tab A (leader)                    Tab B                     Tab C
  ┌──────────────┐                ┌──────────────┐          ┌──────────────┐
  │ LoroDoc      │                │ LoroDoc      │          │ LoroDoc      │
  │ WebSocket ◄──┼── server ──►  │              │          │              │
  │ BroadcastCh ◄┼───────────────┼► BroadcastCh │◄────────►│ BroadcastCh  │
  └──────────────┘                └──────────────┘          └──────────────┘
```

### Leader Election

- On load, each tab posts a `{ type: "leader-ping" }` on the `BroadcastChannel`.
- If no `{ type: "leader-pong" }` arrives within 500ms, the tab assumes leadership, opens the WebSocket, and logs `[sync] this tab is leader, opening WebSocket`.
- If a pong arrives, the tab stays a follower and logs `[sync] another tab is leader, using BroadcastChannel`.
- When the leader tab unloads (`beforeunload`), it posts `{ type: "leader-leaving" }`. A follower promotes itself and logs `[sync] leader left, promoting to leader`.

### Channel Messages

| Type                | Direction       | Payload                        |
|---------------------|-----------------|--------------------------------|
| `leader-ping`       | any → all       | (empty)                        |
| `leader-pong`       | leader → all    | (empty)                        |
| `leader-leaving`    | leader → all    | (empty)                        |
| `loro-update`       | any → all       | `Uint8Array` (Loro update)     |
| `awareness-update`  | any → all       | `Uint8Array` (ephemeral state) |

### Logging

All sync-related events logged with `[sync]` prefix:

```
[sync] BroadcastChannel "manifold:abc123" opened
[sync] this tab is leader, opening WebSocket to wss://...
[sync] WebSocket connected
[sync] fetched snapshot (42.1 kB) via HTTP
[sync] imported snapshot, version: {peer0: 147, peer1: 83}
[sync] broadcasting local update (312 B) to 2 tabs
[sync] received remote update (198 B) from server
[sync] leader left, promoting to leader
[sync] WebSocket closed (code=1000)
[sync] BroadcastChannel "manifold:abc123" closed
```
