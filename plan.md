# Plan: Minimal Diffs for Loro CRDT Shape Store

## Problem

Currently, `useUpdateShape` does a delete-then-insert of the entire shape tree at a given index in the Loro `LoroList`. This means every property change (e.g. moving a gizmo, changing a radius) replaces the whole serialized tree, which:

1. **Generates large CRDT updates** sent over the wire — the full shape JSON blob each time
2. **Causes conflicts** — concurrent edits to different parts of the same shape tree will clobber each other (last-writer-wins on the whole blob)
3. **Loses CRDT merging benefits** — Loro supports nested containers and a tree CRDT, but we're not using them

## Approach: Use LoroTree to Represent the CSG Tree

The CSG data model is inherently a tree (parent nodes with ordered children), which maps directly to Loro's `LoroTree` CRDT. Each `CsgTreeNode` becomes a `LoroTreeNode` whose `.data` (a `LoroMap`) holds the node's properties.

### Data Model Mapping

```
LoroTree "shapes"
  └─ LoroTreeNode (root of shape 1)
       .data LoroMap:
         "id"     → string
         "type"   → "union"
         "name"   → "My Shape"
       children:
         └─ LoroTreeNode (child 1)
              .data LoroMap:
                "id"     → string
                "type"   → "transform"
                "matrix" → number[]  (plain JSON array, stored atomically)
              children:
                └─ LoroTreeNode (leaf)
                     .data LoroMap:
                       "id"     → string
                       "type"   → "cube"
                       "size"   → [1, 2, 3]  (plain JSON array, stored atomically)
```

Key decisions:
- **Primitive props** (string, number, boolean): stored as plain values via `data.set(key, value)`
- **Array props** (matrix, size tuples, polygon): stored as **plain JSON arrays** (not LoroList), so they are written/replaced atomically. A transform matrix update is semantically a single operation — concurrent edits to different matrix elements should not be merged.
- **Children**: represented natively by LoroTree's parent-child structure. No need for a separate "children" key in the data map. LoroTree handles ordering via fractional indices.

### Why LoroTree over nested LoroMap/LoroList

1. **Native tree operations**: `move()`, `createNode()`, `delete()` map directly to CSG tree mutations (reparenting, adding/removing nodes)
2. **Concurrent move safety**: LoroTree has built-in cycle detection and conflict resolution for concurrent moves
3. **No manual children diffing**: the tree structure is the CRDT — no need to diff children arrays ourselves
4. **Efficient subtree operations**: deleting a LoroTreeNode deletes its entire subtree

### Top-Level Shape Roots

Since LoroTree is a forest (multiple roots), each top-level shape is simply a root node in the tree. The current "shapes list" concept maps to `tree.roots()`. The index-based API (`useUpdateShape(index, node)`) will change to an id-based API (`useUpdateShape(treeId, node)`).

## Implementation Steps

### Step 1: Change the Loro container from LoroList to LoroTree

Replace:
```ts
const shapesList = doc.getList("shapes");
```
With:
```ts
const shapesTree = doc.getTree("shapes");
```

### Step 2: Add helper to write a CsgTreeNode into the LoroTree

```ts
function writeNodeToTree(
  treeNode: LoroTreeNode,
  csgNode: CsgTreeNode,
): void
```

Writes all properties of `csgNode` into `treeNode.data` as plain values. For child nodes in `csgNode.children`, recursively calls `treeNode.createNode()` and writes into each child.

```ts
function createShapeInTree(csgNode: CsgTreeNode): TreeID
```

Creates a new root node via `shapesTree.createNode()`, calls `writeNodeToTree`, returns the `TreeID`.

### Step 3: Add a diff/patch function for updating an existing tree node

```ts
function patchNode(
  treeNode: LoroTreeNode,
  oldNode: CsgTreeNode,
  newNode: CsgTreeNode,
): void
```

Core diffing logic:

1. **If `type` changed**: The node schema changed entirely. Clear all data keys and rewrite. (This is rare — usually only the props within a type change.)

2. **For each property on newNode** (excluding "children"):
   - If it's a primitive and unchanged → skip
   - If it's a primitive and changed → `treeNode.data.set(key, newValue)`
   - If it's an array (matrix, size, polygon) and unchanged (deep equal) → skip
   - If it's an array and changed → `treeNode.data.set(key, newValue)` (atomic replace of the whole array)

3. **For properties on oldNode but not newNode**: `treeNode.data.delete(key)`

4. **Children diffing** (for parent node types):
   - Match old vs new children by their `CsgTreeNode.id`
   - **Matched children**: recursively call `patchNode`. We need a mapping from `CsgTreeNode.id` → `TreeID` to look up the corresponding `LoroTreeNode`.
   - **Removed children**: `shapesTree.delete(treeId)` (removes subtree)
   - **Added children**: `treeNode.createNode()` + `writeNodeToTree`
   - **Reordered children**: use `LoroTreeNode.moveBefore()`/`moveAfter()` to fix ordering (only if order actually changed)

### Step 4: Maintain a CsgTreeNode.id → TreeID mapping

Since CsgTreeNodes have their own `id` (UUID) and LoroTreeNodes have a `TreeID` (peer-scoped), we need a bidirectional mapping:

```ts
const csgIdToTreeId = new Map<string, TreeID>();
```

This is populated when:
- Writing new nodes to the tree (Step 2)
- Reading back from the tree on remote updates (Step 6)

### Step 5: Update useAddShape

```ts
export function useAddShape(): (node: CsgTreeNode) => void {
  return useCallback((node: CsgTreeNode) => {
    createShapeInTree(node);
    doc.commit();
  }, []);
}
```

### Step 6: Update useUpdateShape — change from index-based to id-based

The current signature is `(index: number, node: CsgTreeNode)`. Since we're using a tree, the natural key is the CsgTreeNode's `id` (which maps to a `TreeID`).

```ts
export function useUpdateShape(): (rootId: string, node: CsgTreeNode) => void {
  return useCallback((rootId: string, node: CsgTreeNode) => {
    const treeId = csgIdToTreeId.get(rootId);
    if (!treeId) return;
    const treeNode = shapesTree.getNodeByID(treeId);
    if (!treeNode) return;
    const oldNode = cachedShapeMap.get(rootId);
    if (!oldNode) return;
    patchNode(treeNode, oldNode, node);
    doc.commit();
  }, []);
}
```

**Caller update**: `SelectionOverlay.tsx` currently calls `updateShape(shapeIndex, newTree)`. This changes to `updateShape(tree.id, newTree)` — the shape's CSG root id instead of its list index.

### Step 7: Update refreshCache / getShapes

Convert LoroTree roots back to `CsgTreeNode[]`:

```ts
function loroTreeNodeToCsg(treeNode: LoroTreeNode): CsgTreeNode {
  const data = treeNode.data.toJSON();
  const children = treeNode.children();
  if (children && children.length > 0) {
    data.children = children.map(loroTreeNodeToCsg);
  }
  // Update the id→TreeID mapping while reading
  csgIdToTreeId.set(data.id, treeNode.id);
  return data as CsgTreeNode;
}

function refreshCache() {
  const roots = shapesTree.roots();
  cachedShapes = roots.map(loroTreeNodeToCsg);
}
```

### Step 8: Update callers

- **`SelectionOverlay.tsx`**: Change `updateShape(shapeIndex, newTree)` to `updateShape(tree.id, newTree)`. Remove `shapeIndex` from its props.
- **`App.tsx`**: Update any code that passes shape indices to instead pass shape root ids.
- **`useShapes`**: Return type stays `CsgTreeNode[]`, no change needed for consumers that just read.

## Files Changed

- `apps/studio/src/sync-store.ts` — main changes (LoroTree, diff/patch logic, id mapping)
- `apps/studio/src/components/SelectionOverlay.tsx` — update `useUpdateShape` call signature
- `apps/studio/src/App.tsx` — update any index-based shape references

## Risks / Considerations

1. **Breaking change for existing documents**: Switching from `getList("shapes")` to `getTree("shapes")` is incompatible with old data. Acceptable for pre-release.

2. **TreeID management**: The `csgIdToTreeId` map must stay in sync. It's rebuilt on every `refreshCache()` call (triggered by any doc change), so remote updates will populate it correctly.

3. **Fractional index overhead**: LoroTree uses fractional indices for sibling ordering. For CSG trees where child order matters (e.g. `difference` — first child is the base), we should enable fractional indexing to preserve order. Call `shapesTree.enableFractionalIndex(0)` at init.

4. **Matrix arrays are atomic**: As discussed, storing matrices as plain JSON arrays (not LoroList) means concurrent matrix edits are last-writer-wins on the whole array. This is correct — a partial matrix merge would produce nonsensical transforms.

5. **Performance**: CSG trees are small (tens of nodes). The recursive diff in `patchNode` is negligible. The main win is that unchanged subtrees produce zero CRDT operations.
