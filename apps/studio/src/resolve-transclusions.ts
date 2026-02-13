// ─── Transclusion Resolution ─────────────────────────────────────────────────
// Walks a CsgTreeNode tree, replaces `transclude` nodes with the resolved
// remote trees. Supports both pinned (fetch once) and live (room-manager) modes.

import { useState, useEffect, useRef, useCallback } from "react";
import type { CsgTreeNode, CsgTranscludeNode } from "./types/CsgTree";
import { hasChildren } from "./types/CsgTree";
import {
  subscribeRoom,
  unsubscribeRoom,
  getRemoteTree,
  subscribeRemoteRoom,
} from "./room-manager";

const MAX_DEPTH = 8;

// ─── Pinned tree cache (session-lifetime, immutable) ────────────────────────

const pinnedCache = new Map<string, CsgTreeNode>();

function pinnedCacheKey(
  roomId: string,
  frontiers: { peer: string; counter: number }[],
): string {
  return `${roomId}:${JSON.stringify(frontiers)}`;
}

const SYNC_BASE_URL = import.meta.env.VITE_SYNC_URL as string | undefined;

async function fetchPinnedTree(
  roomId: string,
  frontiers: { peer: string; counter: number }[],
): Promise<CsgTreeNode> {
  const key = pinnedCacheKey(roomId, frontiers);
  const cached = pinnedCache.get(key);
  if (cached) return cached;

  if (!SYNC_BASE_URL) {
    return { id: "", type: "group", children: [] };
  }

  const frontiersPath = frontiers
    .map((f) => `${f.peer}:${f.counter}`)
    .join(",");
  const res = await fetch(
    `${SYNC_BASE_URL}/rooms/${roomId}/tree/${frontiersPath}`,
  );
  if (!res.ok) {
    console.warn(
      `[transclude] failed to fetch pinned tree for ${roomId}: ${res.status}`,
    );
    return { id: "", type: "group", children: [] };
  }

  const tree = (await res.json()) as CsgTreeNode;
  pinnedCache.set(key, tree);
  return tree;
}

// ─── Tree collection helpers ────────────────────────────────────────────────

function collectTranscludes(
  tree: CsgTreeNode,
  result: CsgTranscludeNode[],
): void {
  if (tree.type === "transclude") {
    result.push(tree);
    return;
  }
  if (hasChildren(tree)) {
    for (const child of tree.children) {
      collectTranscludes(child, result);
    }
  }
}

/**
 * Apply a transclude node's matrix to the resolved tree.
 */
function applyTranscludeMatrix(
  transcludeNode: CsgTranscludeNode,
  resolvedTree: CsgTreeNode,
): CsgTreeNode {
  if (!transcludeNode.matrix) return resolvedTree;
  return { ...resolvedTree, matrix: transcludeNode.matrix };
}

// ─── Synchronous resolution (for current snapshot) ──────────────────────────

/**
 * Resolve all transclude nodes synchronously using current cached/fetched data.
 * Returns the tree with transclude nodes replaced where data is available.
 * Pinned nodes without cached data are left as-is (async fetch fills them in).
 */
function resolveSync(
  tree: CsgTreeNode,
  visited: Set<string>,
  depth: number,
): CsgTreeNode {
  if (depth > MAX_DEPTH) return tree;

  if (tree.type === "transclude") {
    if (visited.has(tree.roomId)) {
      console.warn(
        `[transclude] cycle detected: ${tree.roomId}, rendering empty`,
      );
      return { id: tree.id, type: "group", children: [] };
    }

    let resolved: CsgTreeNode | null = null;

    if (tree.frontiers) {
      // Pinned — check cache
      const key = pinnedCacheKey(tree.roomId, tree.frontiers);
      resolved = pinnedCache.get(key) ?? null;
    } else {
      // Live — read from room manager
      resolved = getRemoteTree(tree.roomId);
      if (resolved.id === "" && resolved.type === "group") {
        resolved = null; // EMPTY_ROOT means not loaded yet
      }
    }

    if (resolved) {
      const withMatrix = applyTranscludeMatrix(tree, resolved);
      const nextVisited = new Set(visited);
      nextVisited.add(tree.roomId);
      return resolveSync(withMatrix, nextVisited, depth + 1);
    }

    return tree; // Not resolved yet, keep as-is
  }

  if (hasChildren(tree)) {
    let changed = false;
    const newChildren = tree.children.map((child) => {
      const resolved = resolveSync(child, visited, depth);
      if (resolved !== child) changed = true;
      return resolved;
    });
    if (changed) {
      return { ...tree, children: newChildren } as CsgTreeNode;
    }
  }

  return tree;
}

// ─── React hook ─────────────────────────────────────────────────────────────

/**
 * React hook that resolves all transclude nodes in a tree.
 *
 * - Pinned transclusions: fetched async, cached forever
 * - Live transclusions: subscribed via room-manager, update reactively
 * - Cycle detection and depth limiting built in
 *
 * Returns the resolved tree (or partially resolved while loading).
 */
export function useResolvedTree(tree: CsgTreeNode): CsgTreeNode {
  const [resolvedTree, setResolvedTree] = useState<CsgTreeNode>(() =>
    resolveSync(tree, new Set(), 0),
  );
  const liveRoomsRef = useRef<Set<string>>(new Set());
  const unsubsRef = useRef<Map<string, () => void>>(new Map());

  // Collect all transclude nodes
  const transcludes: CsgTranscludeNode[] = [];
  collectTranscludes(tree, transcludes);

  const pinnedNodes = transcludes.filter((t) => t.frontiers);
  const liveNodes = transcludes.filter((t) => !t.frontiers);

  // Stable callback for re-resolution
  const resolve = useCallback(() => {
    setResolvedTree(resolveSync(tree, new Set(), 0));
  }, [tree]);

  // Manage live room subscriptions
  useEffect(() => {
    const neededRooms = new Set(liveNodes.map((t) => t.roomId));
    const currentRooms = liveRoomsRef.current;

    // Subscribe to new rooms
    for (const roomId of neededRooms) {
      if (!currentRooms.has(roomId)) {
        subscribeRoom(roomId);
        const unsub = subscribeRemoteRoom(roomId, resolve);
        unsubsRef.current.set(roomId, unsub);
      }
    }

    // Unsubscribe from removed rooms
    for (const roomId of currentRooms) {
      if (!neededRooms.has(roomId)) {
        unsubsRef.current.get(roomId)?.();
        unsubsRef.current.delete(roomId);
        unsubscribeRoom(roomId);
      }
    }

    liveRoomsRef.current = neededRooms;

    return () => {
      // Cleanup all on unmount
      for (const roomId of liveRoomsRef.current) {
        unsubsRef.current.get(roomId)?.();
        unsubscribeRoom(roomId);
      }
      liveRoomsRef.current = new Set();
      unsubsRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveNodes.map((t) => t.roomId).join(","), resolve]);

  // Fetch pinned trees async
  useEffect(() => {
    let cancelled = false;

    const unfetched = pinnedNodes.filter(
      (t) => !pinnedCache.has(pinnedCacheKey(t.roomId, t.frontiers!)),
    );

    if (unfetched.length === 0) {
      // All pinned are cached, just resolve
      resolve();
      return;
    }

    Promise.all(
      unfetched.map((t) => fetchPinnedTree(t.roomId, t.frontiers!)),
    ).then(() => {
      if (!cancelled) resolve();
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pinnedNodes
      .map((t) => pinnedCacheKey(t.roomId, t.frontiers!))
      .join(","),
    resolve,
  ]);

  // Re-resolve when tree changes (local edits)
  useEffect(() => {
    resolve();
  }, [resolve]);

  return resolvedTree;
}
