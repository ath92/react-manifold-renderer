// ─── Synced State ────────────────────────────────────────────────────────────
// Shapes live in a Loro CRDT doc, exposed via useSyncExternalStore.
// Sync connection to the Cloudflare Workers backend via WebSocket.
//
// Each CsgTreeNode maps to a LoroTreeNode whose .data (LoroMap) holds the
// node's properties. Children are represented by LoroTree's native
// parent-child structure. Array props (matrix, size, polygon) are stored as
// plain JSON values (atomic replacement) — not LoroLists — because partial
// merges of e.g. a transform matrix would produce nonsensical results.

import { useSyncExternalStore, useCallback } from "react";
import { LoroDoc, LoroMap, LoroTreeNode } from "loro-crdt";
import type { TreeID } from "loro-crdt";
import type { CsgTreeNode } from "./types/CsgTree";
import { hasChildren } from "./types/CsgTree";

// ─── Loro doc (synced state) ────────────────────────────────────────────────

const doc = new LoroDoc();

// Root-level container — a LoroTree (forest) where each root is a shape.
// Do NOT write initial values here; defaults are handled in the getters
// via ?? operators. Writing here would overwrite state imported from sync.
const shapesTree = doc.getTree("shapes");
shapesTree.enableFractionalIndex(0);

// ─── CsgTreeNode.id ↔ TreeID mapping ────────────────────────────────────────

const csgIdToTreeId = new Map<string, TreeID>();

// ─── Write helpers ──────────────────────────────────────────────────────────

/** Keys that are handled structurally by the tree, not stored in .data */
const STRUCTURAL_KEYS = new Set(["children"]);

/**
 * Write all properties of a CsgTreeNode into a LoroTreeNode's data map.
 * For parent nodes, recursively creates child LoroTreeNodes.
 */
function writeNodeToTree(treeNode: LoroTreeNode, csgNode: CsgTreeNode): void {
  const data = treeNode.data;
  for (const [key, value] of Object.entries(csgNode)) {
    if (STRUCTURAL_KEYS.has(key)) continue;
    data.set(key, value);
  }
  csgIdToTreeId.set(csgNode.id, treeNode.id);

  if (hasChildren(csgNode)) {
    for (const child of csgNode.children) {
      const childTreeNode = treeNode.createNode();
      writeNodeToTree(childTreeNode, child);
    }
  }
}

/**
 * Create a new root shape in the tree from a CsgTreeNode.
 */
function createShapeInTree(csgNode: CsgTreeNode): TreeID {
  const treeNode = shapesTree.createNode();
  writeNodeToTree(treeNode, csgNode);
  return treeNode.id;
}

// ─── Diff / Patch ───────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (
        !deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      )
        return false;
    }
    return true;
  }
  return false;
}

/**
 * Patch a LoroTreeNode to reflect changes from oldNode → newNode.
 * Only produces CRDT operations for properties that actually changed.
 */
function patchNode(
  treeNode: LoroTreeNode,
  oldNode: CsgTreeNode,
  newNode: CsgTreeNode,
): void {
  const data = treeNode.data;

  // If the type changed, clear everything and rewrite
  if (oldNode.type !== newNode.type) {
    for (const key of data.keys()) {
      data.delete(key);
    }
    // Delete all existing children
    const existingChildren = treeNode.children();
    if (existingChildren) {
      for (const child of existingChildren) {
        shapesTree.delete(child.id);
      }
    }
    writeNodeToTree(treeNode, newNode);
    return;
  }

  // Diff data properties (everything except "children")
  const oldEntries = Object.entries(oldNode).filter(
    ([k]) => !STRUCTURAL_KEYS.has(k),
  );
  const newEntries = Object.entries(newNode).filter(
    ([k]) => !STRUCTURAL_KEYS.has(k),
  );
  const oldKeys = new Set(oldEntries.map(([k]) => k));
  const newMap = new Map(newEntries);

  // Update changed / added properties
  for (const [key, newValue] of newMap) {
    const oldValue = (oldNode as unknown as Record<string, unknown>)[key];
    if (!deepEqual(oldValue, newValue)) {
      data.set(key, newValue as Parameters<LoroMap["set"]>[1]);
    }
  }

  // Remove deleted properties
  for (const key of oldKeys) {
    if (!newMap.has(key)) {
      data.delete(key);
    }
  }

  // Diff children
  const oldChildren = hasChildren(oldNode) ? oldNode.children : [];
  const newChildren = hasChildren(newNode) ? newNode.children : [];
  const existingTreeChildren = treeNode.children() ?? [];

  // Build a map of old CsgTreeNode.id → index in existingTreeChildren
  const oldChildIdToIdx = new Map<string, number>();
  for (let i = 0; i < oldChildren.length; i++) {
    oldChildIdToIdx.set(oldChildren[i].id, i);
  }

  // Track which old children are still present
  const usedOldIndices = new Set<number>();
  // Collect operations: we process new children in order
  const newTreeChildren: LoroTreeNode[] = [];

  for (const newChild of newChildren) {
    const oldIdx = oldChildIdToIdx.get(newChild.id);
    if (oldIdx !== undefined) {
      // Matched — recursively patch
      usedOldIndices.add(oldIdx);
      const childTreeNode = existingTreeChildren[oldIdx];
      patchNode(childTreeNode, oldChildren[oldIdx], newChild);
      newTreeChildren.push(childTreeNode);
    } else {
      // Added — create new child
      const childTreeNode = treeNode.createNode();
      writeNodeToTree(childTreeNode, newChild);
      newTreeChildren.push(childTreeNode);
    }
  }

  // Delete removed children
  for (let i = 0; i < oldChildren.length; i++) {
    if (!usedOldIndices.has(i)) {
      // Remove from csgIdToTreeId recursively
      removeCsgIds(oldChildren[i]);
      shapesTree.delete(existingTreeChildren[i].id);
    }
  }

  // Fix ordering: move children to match newChildren order
  for (let i = 0; i < newTreeChildren.length; i++) {
    if (i === 0) {
      // First child — should be at index 0
      const currentChildren = treeNode.children() ?? [];
      if (
        currentChildren.length > 0 &&
        currentChildren[0].id !== newTreeChildren[i].id
      ) {
        newTreeChildren[i].moveBefore(currentChildren[0]);
      }
    } else {
      // Should be right after the previous one
      const currentChildren = treeNode.children() ?? [];
      const prevIdx = currentChildren.findIndex(
        (c) => c.id === newTreeChildren[i - 1].id,
      );
      const curIdx = currentChildren.findIndex(
        (c) => c.id === newTreeChildren[i].id,
      );
      if (curIdx !== prevIdx + 1) {
        newTreeChildren[i].moveAfter(newTreeChildren[i - 1]);
      }
    }
  }
}

/** Recursively remove CsgTreeNode ids from the mapping */
function removeCsgIds(node: CsgTreeNode): void {
  csgIdToTreeId.delete(node.id);
  if (hasChildren(node)) {
    for (const child of node.children) {
      removeCsgIds(child);
    }
  }
}

// ─── Read helpers ───────────────────────────────────────────────────────────

/**
 * Convert a LoroTreeNode back to a CsgTreeNode, updating the id mapping.
 */
function loroTreeNodeToCsg(treeNode: LoroTreeNode): CsgTreeNode {
  const data = treeNode.data.toJSON() as Record<string, unknown>;
  const children = treeNode.children();
  if (children && children.length > 0) {
    data.children = children.map(loroTreeNodeToCsg);
  }
  // Update mapping
  csgIdToTreeId.set(data.id as string, treeNode.id);
  return data as unknown as CsgTreeNode;
}

// ─── Subscription plumbing for Loro → React ─────────────────────────────────

type ReactListener = () => void;
const listeners = new Set<ReactListener>();

function subscribe(listener: ReactListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChange() {
  refreshCache();
  for (const l of listeners) l();
}

// Subscribe to any doc change and notify React
doc.subscribe(() => {
  // Defer to next microtask so Loro's internal state is settled
  queueMicrotask(emitChange);
});

// ─── Cached snapshots ───────────────────────────────────────────────────────
// useSyncExternalStore requires getSnapshot to return a referentially stable
// value when the underlying data hasn't changed, otherwise React re-renders
// infinitely.

let cachedShapes: CsgTreeNode[] = [];

function refreshCache() {
  const roots = shapesTree.roots();
  cachedShapes = roots.map(loroTreeNodeToCsg);
}

// Build initial cache
refreshCache();

function getShapes(): CsgTreeNode[] {
  return cachedShapes;
}

// ─── Synced React Hooks ─────────────────────────────────────────────────────

export function useShapes(): CsgTreeNode[] {
  return useSyncExternalStore(subscribe, getShapes);
}

export function useAddShape(): (node: CsgTreeNode) => void {
  return useCallback((node: CsgTreeNode) => {
    createShapeInTree(node);
    doc.commit();
  }, []);
}

export function useUpdateShape(): (rootId: string, node: CsgTreeNode) => void {
  return useCallback((rootId: string, node: CsgTreeNode) => {
    const treeId = csgIdToTreeId.get(rootId);
    if (!treeId) return;
    const treeNode = shapesTree.getNodeByID(treeId);
    if (!treeNode) return;
    // Find the old cached version of this shape for diffing
    const oldNode = cachedShapes.find((s) => s.id === rootId);
    if (!oldNode) return;
    patchNode(treeNode, oldNode, node);
    doc.commit();
  }, []);
}

// ─── Sync Protocol Tags ─────────────────────────────────────────────────────
// Mirrors services/sync-worker/src/protocol.ts

const TAG_C_UPDATE = 0x01;
const TAG_C_VERSION_VECTOR = 0x03;

const TAG_S_UPDATE = 0x81;
const TAG_S_CATCHUP = 0x83;
const TAG_S_PEER_ID = 0x84;

// ─── Sync Connection ────────────────────────────────────────────────────────

const SYNC_BASE_URL = import.meta.env.VITE_SYNC_URL as string | undefined;

function getRoomId(): string {
  // Use ?room=<id> query param, or fall back to "default"
  const params = new URLSearchParams(window.location.search);
  return params.get("room") ?? "default";
}

async function connectSync(baseUrl: string, roomId: string): Promise<void> {
  // 1. Fetch snapshot over HTTP
  console.log("[sync] fetching snapshot via HTTP");
  try {
    const res = await fetch(`${baseUrl}/rooms/${roomId}/snapshot`);
    if (res.ok) {
      const snapshot = new Uint8Array(await res.arrayBuffer());
      if (snapshot.length > 0) {
        doc.import(snapshot);
        console.log(
          `[sync] imported snapshot (${(snapshot.length / 1024).toFixed(1)} kB)`,
        );
      } else {
        console.log("[sync] empty snapshot (new document)");
      }
    } else {
      console.warn(`[sync] snapshot fetch failed: ${res.status}`);
    }
  } catch (e) {
    console.warn("[sync] snapshot fetch error:", e);
  }

  // 2. Open WebSocket for incremental sync
  const wsUrl = baseUrl.replace(/^http/, "ws") + `/rooms/${roomId}/ws`;
  console.log(`[sync] opening WebSocket to ${wsUrl}`);
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  let unsubLocalUpdates: (() => void) | null = null;

  ws.onopen = () => {
    console.log("[sync] WebSocket connected");

    // Send our version vector so server can send catch-up
    const vv = doc.version();
    const vvBytes = vv.encode();
    const msg = new Uint8Array(1 + vvBytes.length);
    msg[0] = TAG_C_VERSION_VECTOR;
    msg.set(vvBytes, 1);
    ws.send(msg);
    console.log("[sync] sent version vector for catch-up");

    // Pipe local updates to server
    unsubLocalUpdates = doc.subscribeLocalUpdates((bytes: Uint8Array) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const msg = new Uint8Array(1 + bytes.length);
      msg[0] = TAG_C_UPDATE;
      msg.set(bytes, 1);
      ws.send(msg);
      console.log(`[sync] sent local update (${bytes.length} B)`);
    });
  };

  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (data.length === 0) return;
    const tag = data[0];
    const payload = data.subarray(1);

    switch (tag) {
      case TAG_S_UPDATE:
        console.log(
          `[sync] received remote update (${payload.length} B) from server`,
        );
        if (payload.length > 0) doc.import(payload);
        break;

      case TAG_S_CATCHUP:
        console.log(`[sync] received catch-up (${payload.length} B)`);
        if (payload.length > 0) doc.import(payload);
        break;

      case TAG_S_PEER_ID: {
        const view = new DataView(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        );
        const peerId = view.getBigUint64(0);
        doc.setPeerId(peerId);
        console.log(`[sync] assigned peer ID: ${peerId}`);
        break;
      }
    }
  };

  ws.onclose = (e) => {
    console.log(`[sync] WebSocket closed (code=${e.code})`);
    unsubLocalUpdates?.();
    // Reconnect after a delay
    setTimeout(() => {
      console.log("[sync] reconnecting...");
      connectSync(baseUrl, roomId);
    }, 3000);
  };

  ws.onerror = () => {
    console.warn("[sync] WebSocket error");
  };
}

// ─── Auto-connect ───────────────────────────────────────────────────────────

if (SYNC_BASE_URL) {
  const roomId = getRoomId();
  console.log(`[sync] sync enabled — room="${roomId}", url="${SYNC_BASE_URL}"`);
  connectSync(SYNC_BASE_URL, roomId);
} else {
  console.log("[sync] no VITE_SYNC_URL set, running offline");
}
