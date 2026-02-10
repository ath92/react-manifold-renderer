// ─── Local State ─────────────────────────────────────────────────────────────
// Local-only state (selection, draw tool) lives in a zustand store.

import { create } from "zustand";

// ─── Local store (zustand, not synced) ──────────────────────────────────────

export type TransformMode = "translate" | "rotate" | "scale";

interface LocalState {
  selectedId: string | null;
  cursorParentId: string | null;
  drawToolActive: boolean;
  transformMode: TransformMode;
  isDraggingGizmo: boolean;
  setSelectedId: (id: string | null) => void;
  setCursorParentId: (id: string | null) => void;
  setDrawToolActive: (active: boolean) => void;
  setTransformMode: (mode: TransformMode) => void;
  setIsDraggingGizmo: (dragging: boolean) => void;
}

export const useLocalStore = create<LocalState>((set) => ({
  selectedId: null,
  cursorParentId: null,
  drawToolActive: false,
  transformMode: "translate",
  isDraggingGizmo: false,
  setSelectedId: (selectedId) => set({ selectedId }),
  setCursorParentId: (cursorParentId) =>
    set({ cursorParentId, selectedId: null }),
  setDrawToolActive: (drawToolActive) => set({ drawToolActive }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),
}));

export const useSelectedId = () => useLocalStore((s) => s.selectedId);
export const useSetSelectedId = () => useLocalStore((s) => s.setSelectedId);
export const useCursorParentId = () => useLocalStore((s) => s.cursorParentId);
export const useSetCursorParentId = () =>
  useLocalStore((s) => s.setCursorParentId);
export const useDrawToolActive = () => useLocalStore((s) => s.drawToolActive);
export const useSetDrawToolActive = () =>
  useLocalStore((s) => s.setDrawToolActive);
export const useTransformMode = () => useLocalStore((s) => s.transformMode);
export const useSetTransformMode = () =>
  useLocalStore((s) => s.setTransformMode);
export const useIsDraggingGizmo = () => useLocalStore((s) => s.isDraggingGizmo);
export const useSetIsDraggingGizmo = () =>
  useLocalStore((s) => s.setIsDraggingGizmo);
