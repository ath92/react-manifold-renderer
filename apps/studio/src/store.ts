// ─── Local State ─────────────────────────────────────────────────────────────
// Local-only state (selection, draw tool) lives in a zustand store.

import { create } from "zustand";
import type { CsgTreeNode } from "./types/CsgTree";

// ─── Local store (zustand, not synced) ──────────────────────────────────────

export type TransformMode = "translate" | "rotate" | "scale";
export type PanelMode = "scene" | "history";

interface LocalState {
  selectedId: string | null;
  cursorParentId: string | null;
  drawToolActive: boolean;
  transformMode: TransformMode;
  isDraggingGizmo: boolean;
  panelMode: PanelMode;
  previewTree: CsgTreeNode | null;
  setSelectedId: (id: string | null) => void;
  setCursorParentId: (id: string | null) => void;
  setDrawToolActive: (active: boolean) => void;
  setTransformMode: (mode: TransformMode) => void;
  setIsDraggingGizmo: (dragging: boolean) => void;
  setPanelMode: (mode: PanelMode) => void;
  setPreviewTree: (tree: CsgTreeNode | null) => void;
}

export const useLocalStore = create<LocalState>((set) => ({
  selectedId: null,
  cursorParentId: null,
  drawToolActive: false,
  transformMode: "translate",
  isDraggingGizmo: false,
  panelMode: "scene",
  previewTree: null,
  setSelectedId: (selectedId) => set({ selectedId }),
  setCursorParentId: (cursorParentId) =>
    set({ cursorParentId, selectedId: null }),
  setDrawToolActive: (drawToolActive) => set({ drawToolActive }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setIsDraggingGizmo: (isDraggingGizmo) => set({ isDraggingGizmo }),
  setPanelMode: (panelMode) => set({ panelMode }),
  setPreviewTree: (previewTree) => set({ previewTree }),
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
export const usePanelMode = () => useLocalStore((s) => s.panelMode);
export const useSetPanelMode = () => useLocalStore((s) => s.setPanelMode);
export const usePreviewTree = () => useLocalStore((s) => s.previewTree);
export const useSetPreviewTree = () => useLocalStore((s) => s.setPreviewTree);
