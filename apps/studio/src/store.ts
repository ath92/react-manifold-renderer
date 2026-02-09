// ─── Global State ────────────────────────────────────────────────────────────
// Synced state (shapes) lives in a Loro CRDT doc, exposed via useSyncExternalStore.
// Local-only state (selection, draw tool) lives in a zustand store.
// Sync connection to the Cloudflare Workers backend via WebSocket.

import { useSyncExternalStore, useCallback } from "react";
import { create } from "zustand";
import { LoroDoc } from "loro-crdt";
import type { CsgTreeNode } from "./types/CsgTree";

// ─── Local store (zustand, not synced) ──────────────────────────────────────

export type TransformMode = "translate" | "rotate" | "scale";

interface LocalState {
  selectedId: string | null;
  drawToolActive: boolean;
  transformMode: TransformMode;
  isDraggingGizmo: boolean;
  setSelectedId: (id: string | null) => void;
  setDrawToolActive: (active: boolean) => void;
  setTransformMode: (mode: TransformMode) => void;
  setIsDraggingGizmo: (dragging: boolean) => void;
}

export const useLocalStore = create<LocalState>((set) => ({
  selectedId: null,
  drawToolActive: false,
  transformMode: "translate",
  isDraggingGizmo: false,
  setSelectedId: (selectedId) => set({ selectedId }),
  setDrawToolActive: (drawToolActive) => set({ drawToolActive }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),
}));

export const useSelectedId = () => useLocalStore((s) => s.selectedId);
export const useSetSelectedId = () => useLocalStore((s) => s.setSelectedId);
export const useDrawToolActive = () => useLocalStore((s) => s.drawToolActive);
export const useSetDrawToolActive = () =>
  useLocalStore((s) => s.setDrawToolActive);
export const useTransformMode = () => useLocalStore((s) => s.transformMode);
export const useSetTransformMode = () =>
  useLocalStore((s) => s.setTransformMode);
export const useIsDraggingGizmo = () => useLocalStore((s) => s.isDraggingGizmo);
export const useSetIsDraggingGizmo = () =>
  useLocalStore((s) => s.setIsDraggingGizmo);

// ─── Loro doc (synced state) ────────────────────────────────────────────────

const doc = new LoroDoc();

// Root-level containers — these have stable identity across all peers.
// Do NOT write initial values here; defaults are handled in the getters
// via ?? operators. Writing here would overwrite state imported from sync.
const shapesList = doc.getList("shapes");

// ─── Subscription plumbing for Loro → React ─────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
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
  const len = shapesList.length;
  const arr: CsgTreeNode[] = [];
  for (let i = 0; i < len; i++) {
    arr.push(shapesList.get(i) as CsgTreeNode);
  }
  cachedShapes = arr;
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
    shapesList.push(node as unknown as Record<string, unknown>);
    doc.commit();
  }, []);
}

export function useUpdateShape(): (index: number, node: CsgTreeNode) => void {
  return useCallback((index: number, node: CsgTreeNode) => {
    shapesList.delete(index, 1);
    shapesList.insert(index, node as unknown as Record<string, unknown>);
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
