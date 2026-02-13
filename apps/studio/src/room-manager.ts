// ─── Remote Room Manager ─────────────────────────────────────────────────────
// Manages read-only sync connections to remote rooms for live transclusion.
// Each room is ref-counted: connects on first subscribe, disconnects when the
// last subscriber leaves.

import { useSyncExternalStore } from "react";
import { LoroDoc } from "loro-crdt";
import type { LoroTreeNode } from "loro-crdt";
import type { CsgTreeNode } from "./types/CsgTree";

// ─── Protocol tags (mirrors sync-worker/src/protocol.ts) ────────────────────

const TAG_C_VERSION_VECTOR = 0x03;

const TAG_S_UPDATE = 0x81;
const TAG_S_CATCHUP = 0x83;
const TAG_S_PEER_ID = 0x84;

// ─── Types ──────────────────────────────────────────────────────────────────

const EMPTY_ROOT: CsgTreeNode = { id: "", type: "group", children: [] };

interface RemoteRoom {
  doc: LoroDoc;
  ws: WebSocket | null;
  cachedTree: CsgTreeNode;
  listeners: Set<() => void>;
  refCount: number;
  unsubDoc: (() => void) | null;
}

const remoteRooms = new Map<string, RemoteRoom>();

// ─── Loro → CsgTreeNode (read-only, no id mapping) ─────────────────────────

function loroTreeNodeToCsg(treeNode: LoroTreeNode): CsgTreeNode {
  const data = treeNode.data.toJSON() as Record<string, unknown>;
  const children = treeNode.children();
  if (children && children.length > 0) {
    data.children = children.map(loroTreeNodeToCsg);
  }
  return data as unknown as CsgTreeNode;
}

function refreshRoomCache(room: RemoteRoom): void {
  const tree = room.doc.getTree("shapes");
  const roots = tree.roots();
  room.cachedTree = roots.length > 0 ? loroTreeNodeToCsg(roots[0]) : EMPTY_ROOT;
}

function notifyListeners(room: RemoteRoom): void {
  for (const l of room.listeners) l();
}

// ─── Sync connection ────────────────────────────────────────────────────────

function getSyncBaseUrl(): string | undefined {
  return import.meta.env.VITE_SYNC_URL as string | undefined;
}

async function connectRoom(roomId: string, room: RemoteRoom): Promise<void> {
  const baseUrl = getSyncBaseUrl();
  if (!baseUrl) return;

  // 1. Fetch snapshot
  try {
    const res = await fetch(`${baseUrl}/rooms/${roomId}/snapshot`);
    if (res.ok) {
      const snapshot = new Uint8Array(await res.arrayBuffer());
      if (snapshot.length > 0) room.doc.import(snapshot);
    }
  } catch {
    // Continue without snapshot
  }

  // Notify after snapshot import
  refreshRoomCache(room);
  notifyListeners(room);

  // 2. Open WebSocket
  const wsUrl = baseUrl.replace(/^http/, "ws") + `/rooms/${roomId}/ws`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";
  room.ws = ws;

  ws.onopen = () => {
    // Send version vector for catchup
    const vv = room.doc.version();
    const vvBytes = vv.encode();
    const msg = new Uint8Array(1 + vvBytes.length);
    msg[0] = TAG_C_VERSION_VECTOR;
    msg.set(vvBytes, 1);
    ws.send(msg);
  };

  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (data.length === 0) return;
    const tag = data[0];
    const payload = data.subarray(1);

    switch (tag) {
      case TAG_S_UPDATE:
      case TAG_S_CATCHUP:
        if (payload.length > 0) room.doc.import(payload);
        break;
      case TAG_S_PEER_ID: {
        const view = new DataView(
          payload.buffer,
          payload.byteOffset,
          payload.byteLength,
        );
        const peerId = view.getBigUint64(0);
        room.doc.setPeerId(peerId);
        break;
      }
    }
  };

  ws.onclose = () => {
    // Only reconnect if room still exists (not unsubscribed)
    if (remoteRooms.has(roomId)) {
      room.ws = null;
      setTimeout(() => {
        if (remoteRooms.has(roomId)) connectRoom(roomId, room);
      }, 3000);
    }
  };

  ws.onerror = () => {
    // onclose will handle reconnect
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Subscribe to a remote room's live tree. Ref-counted: first call creates the
 * connection, subsequent calls reuse it.
 */
export function subscribeRoom(roomId: string): RemoteRoom {
  const existing = remoteRooms.get(roomId);
  if (existing) {
    existing.refCount++;
    return existing;
  }

  const doc = new LoroDoc();
  const room: RemoteRoom = {
    doc,
    ws: null,
    cachedTree: EMPTY_ROOT,
    listeners: new Set(),
    refCount: 1,
    unsubDoc: null,
  };

  // Subscribe to doc changes
  room.unsubDoc = doc.subscribe(() => {
    queueMicrotask(() => {
      refreshRoomCache(room);
      notifyListeners(room);
    });
  });

  remoteRooms.set(roomId, room);
  connectRoom(roomId, room);

  return room;
}

/**
 * Decrement ref count. Disconnects and cleans up when it hits 0.
 */
export function unsubscribeRoom(roomId: string): void {
  const room = remoteRooms.get(roomId);
  if (!room) return;

  room.refCount--;
  if (room.refCount <= 0) {
    room.unsubDoc?.();
    room.ws?.close();
    room.ws = null;
    remoteRooms.delete(roomId);
  }
}

/**
 * Get the current cached tree for a remote room. Returns EMPTY_ROOT if not
 * connected yet.
 */
export function getRemoteTree(roomId: string): CsgTreeNode {
  return remoteRooms.get(roomId)?.cachedTree ?? EMPTY_ROOT;
}

/**
 * Subscribe to changes on a remote room's tree.
 */
export function subscribeRemoteRoom(
  roomId: string,
  listener: () => void,
): () => void {
  const room = remoteRooms.get(roomId);
  if (!room) return () => {};
  room.listeners.add(listener);
  return () => room.listeners.delete(listener);
}

/**
 * React hook: returns live CsgTreeNode for a remote room.
 * Caller must ensure subscribeRoom has been called before using this.
 */
export function useRemoteTree(roomId: string): CsgTreeNode {
  return useSyncExternalStore(
    (listener) => subscribeRemoteRoom(roomId, listener),
    () => getRemoteTree(roomId),
  );
}
