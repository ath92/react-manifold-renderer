// ─── Loro-backed Global State ────────────────────────────────────────────────
// Singleton LoroDoc holding selectedId, shapes[], and drawToolActive.
// React hooks via useSyncExternalStore.

import { useSyncExternalStore, useCallback } from "react";
import { LoroDoc, LoroList } from "loro-crdt";
import type { CsgTreeNode } from "./types/CsgTree";

// ─── Singleton Doc ──────────────────────────────────────────────────────────

const doc = new LoroDoc();

// Initialize top-level containers
const state = doc.getMap("state");
state.set("selectedId", null);
state.set("drawToolActive", false);
const shapesList = state.setContainer("shapes", new LoroList());
doc.commit();

// ─── Subscription plumbing ──────────────────────────────────────────────────

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

let cachedSelectedId: string | null = null;
let cachedShapes: CsgTreeNode[] = [];
let cachedDrawToolActive = false;

function refreshCache() {
  cachedSelectedId = (state.get("selectedId") as string | null) ?? null;

  const len = shapesList.length;
  const arr: CsgTreeNode[] = [];
  for (let i = 0; i < len; i++) {
    arr.push(shapesList.get(i) as CsgTreeNode);
  }
  cachedShapes = arr;

  cachedDrawToolActive = (state.get("drawToolActive") as boolean) ?? false;
}

// Build initial cache
refreshCache();

function getSelectedId(): string | null {
  return cachedSelectedId;
}

function getShapes(): CsgTreeNode[] {
  return cachedShapes;
}

function getDrawToolActive(): boolean {
  return cachedDrawToolActive;
}

// ─── React Hooks ────────────────────────────────────────────────────────────

export function useSelectedId(): string | null {
  return useSyncExternalStore(subscribe, getSelectedId);
}

export function useSetSelectedId(): (id: string | null) => void {
  return useCallback((id: string | null) => {
    state.set("selectedId", id);
    doc.commit();
  }, []);
}

export function useShapes(): CsgTreeNode[] {
  return useSyncExternalStore(subscribe, getShapes);
}

export function useAddShape(): (node: CsgTreeNode) => void {
  return useCallback((node: CsgTreeNode) => {
    shapesList.push(node as unknown as Record<string, unknown>);
    doc.commit();
  }, []);
}

export function useDrawToolActive(): boolean {
  return useSyncExternalStore(subscribe, getDrawToolActive);
}

export function useSetDrawToolActive(): (active: boolean) => void {
  return useCallback((active: boolean) => {
    state.set("drawToolActive", active);
    doc.commit();
  }, []);
}
