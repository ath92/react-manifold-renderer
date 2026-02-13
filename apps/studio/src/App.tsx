import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { CsgTreeNode } from "./types/CsgTree";
import { hasChildren, findParentNode } from "./types/CsgTree";
import { CsgTreePanel } from "./components/CsgTreePanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { DrawBuildingTool } from "./tools/DrawBuildingTool";
import {
  useSelectedId,
  useSetSelectedId,
  useCursorParentId,
  useSetCursorParentId,
  useDrawToolActive,
  useSetDrawToolActive,
  useTransformMode,
  useSetTransformMode,
  useIsDraggingGizmo,
  usePanelMode,
  useSetPanelMode,
  usePreviewTree,
  type TransformMode,
  type PanelMode,
} from "./store";
import { useSceneTree, useAddShape } from "./sync-store";
import { useResolvedTree } from "./resolve-transclusions";
import { CsgScene } from "./CsgScene";
import { genId } from "./types/CsgTree";

// ─── Mode strip icons (simple SVG) ──────────────────────────────────────────

function SceneIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 10h14M10 3v14" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  );
}

const MODE_ITEMS: { mode: PanelMode; label: string; Icon: () => JSX.Element }[] = [
  { mode: "scene", label: "Scene", Icon: SceneIcon },
  { mode: "history", label: "History", Icon: HistoryIcon },
];

// ─── App ─────────────────────────────────────────────────────────────────────

const TRANSFORM_KEYS: Record<string, TransformMode> = {
  t: "translate",
  r: "rotate",
  s: "scale",
};

function App() {
  const drawToolActive = useDrawToolActive();
  const setDrawToolActive = useSetDrawToolActive();
  const sceneTree = useSceneTree();
  const addShape = useAddShape();
  const resolvedTree = useResolvedTree(sceneTree);
  const shapes = useMemo(
    () => (hasChildren(sceneTree) ? sceneTree.children : []),
    [sceneTree],
  );
  const selectedId = useSelectedId();
  const setSelectedId = useSetSelectedId();
  const cursorParentId = useCursorParentId();
  const setCursorParentId = useSetCursorParentId();
  const transformMode = useTransformMode();
  const setTransformMode = useSetTransformMode();
  const isDraggingGizmo = useIsDraggingGizmo();
  const panelMode = usePanelMode();
  const setPanelMode = useSetPanelMode();
  const previewTree = usePreviewTree();
  const [showTranscludeDialog, setShowTranscludeDialog] = useState(false);
  const [transcludeRoomId, setTranscludeRoomId] = useState("");
  const [transcludeLive, setTranscludeLive] = useState(true);
  const pointerMissedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const isPreview = previewTree !== null;
  const displayTree = previewTree ?? resolvedTree;

  const handlePointerMissed = useCallback(() => {
    if (pointerMissedTimerRef.current) {
      // Second click within timeout — double-click on empty space
      clearTimeout(pointerMissedTimerRef.current);
      pointerMissedTimerRef.current = null;
      setCursorParentId(null);
      setSelectedId(null);
    } else {
      pointerMissedTimerRef.current = setTimeout(() => {
        pointerMissedTimerRef.current = null;
        setSelectedId(null);
      }, 250);
    }
  }, [setSelectedId, setCursorParentId]);

  const handleDrawComplete = useCallback(
    (node: CsgTreeNode) => {
      addShape(node);
    },
    [addShape],
  );

  const handleTreeSelect = useCallback(
    (node: CsgTreeNode) => {
      setSelectedId(node.id);
    },
    [setSelectedId],
  );

  const handleAddTransclusion = useCallback(() => {
    if (!transcludeRoomId.trim()) return;
    addShape({
      id: genId(),
      type: "transclude",
      roomId: transcludeRoomId.trim(),
      ...(transcludeLive ? {} : { frontiers: [] }),
    });
    setShowTranscludeDialog(false);
    setTranscludeRoomId("");
  }, [addShape, transcludeRoomId, transcludeLive]);

  // T/R/S keyboard shortcuts for transform mode + Escape for cursor level
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === "Escape") {
        if (cursorParentId) {
          // Go up one level: find the parent of the current cursor parent
          // Search across all shapes to find which tree contains it
          for (const shape of shapes) {
            const parent = findParentNode(shape, cursorParentId);
            if (parent) {
              // If the parent is the shape root, go back to root level
              setCursorParentId(parent.id === shape.id ? null : parent.id);
              return;
            }
            // If cursorParentId IS the shape root, go to null
            if (shape.id === cursorParentId) {
              setCursorParentId(null);
              return;
            }
          }
          // Cursor parent not found in any shape (stale), reset
          setCursorParentId(null);
        } else {
          setSelectedId(null);
        }
        return;
      }

      const mode = TRANSFORM_KEYS[e.key.toLowerCase()];
      if (mode) {
        setTransformMode(mode);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    setTransformMode,
    cursorParentId,
    shapes,
    setCursorParentId,
    setSelectedId,
  ]);

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex" }}>
      {/* Mode strip */}
      <div
        style={{
          width: "40px",
          background: "#111",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "12px",
          gap: "4px",
          borderRight: "1px solid #333",
        }}
      >
        {MODE_ITEMS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            onClick={() => setPanelMode(mode)}
            title={label}
            style={{
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: panelMode === mode ? "#2a2a2a" : "transparent",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              color: panelMode === mode ? "#4fc3f7" : "#888",
            }}
          >
            <Icon />
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div
        style={{
          width: "240px",
          padding: "16px",
          background: "#1a1a1a",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          overflowY: "auto",
        }}
      >
        {panelMode === "scene" ? (
          <>
            <h2 style={{ margin: 0, fontSize: "16px" }}>Manifold Studio</h2>

            {!isPreview && (
              <>
                <fieldset
                  style={{
                    border: "1px solid #444",
                    borderRadius: "4px",
                    padding: "12px",
                  }}
                >
                  <legend style={{ color: "#aaa", fontSize: "12px" }}>Tools</legend>
                  <button
                    onClick={() => setDrawToolActive(!drawToolActive)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: drawToolActive ? "#4fc3f7" : "#333",
                      color: drawToolActive ? "#000" : "#fff",
                      border: "1px solid #555",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                      marginBottom: "8px",
                    }}
                  >
                    {drawToolActive ? "Drawing (Esc to cancel)" : "Draw Building"}
                  </button>
                  <button
                    onClick={() => setShowTranscludeDialog(!showTranscludeDialog)}
                    style={{
                      width: "100%",
                      padding: "8px",
                      background: showTranscludeDialog ? "#89ddff" : "#333",
                      color: showTranscludeDialog ? "#000" : "#fff",
                      border: "1px solid #555",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                      marginBottom: "8px",
                    }}
                  >
                    Transclude Room
                  </button>
                  {showTranscludeDialog && (
                    <div
                      style={{
                        marginBottom: "8px",
                        padding: "8px",
                        background: "#252525",
                        borderRadius: "4px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Room ID"
                        value={transcludeRoomId}
                        onChange={(e) => setTranscludeRoomId(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleAddTransclusion();
                        }}
                        style={{
                          padding: "6px",
                          background: "#1a1a1a",
                          color: "#fff",
                          border: "1px solid #555",
                          borderRadius: "4px",
                          fontSize: "12px",
                          outline: "none",
                        }}
                      />
                      <label
                        style={{
                          fontSize: "11px",
                          color: "#aaa",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={transcludeLive}
                          onChange={(e) => setTranscludeLive(e.target.checked)}
                        />
                        Live (uncheck for pinned)
                      </label>
                      <button
                        onClick={handleAddTransclusion}
                        disabled={!transcludeRoomId.trim()}
                        style={{
                          padding: "6px",
                          background:
                            transcludeRoomId.trim() ? "#89ddff" : "#333",
                          color: transcludeRoomId.trim() ? "#000" : "#666",
                          border: "none",
                          borderRadius: "4px",
                          cursor: transcludeRoomId.trim()
                            ? "pointer"
                            : "default",
                          fontSize: "12px",
                        }}
                      >
                        Add
                      </button>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: "4px" }}>
                    {(["translate", "rotate", "scale"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setTransformMode(mode)}
                        style={{
                          flex: 1,
                          padding: "6px",
                          background: transformMode === mode ? "#4fc3f7" : "#333",
                          color: transformMode === mode ? "#000" : "#fff",
                          border: "1px solid #555",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "11px",
                          textTransform: "capitalize",
                        }}
                      >
                        {mode[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <CsgTreePanel
                  tree={sceneTree}
                  selectedId={selectedId}
                  cursorParentId={cursorParentId}
                  onSelect={handleTreeSelect}
                  onEnter={setCursorParentId}
                />
              </>
            )}

            {isPreview && (
              <p style={{ fontSize: "12px", color: "#888" }}>
                Previewing historical version. Switch to History panel to go back to live.
              </p>
            )}

            <div style={{ marginTop: "auto", fontSize: "12px", color: "#666" }}>
              <p>T / R / S to switch transform mode</p>
              <p>Drag to rotate, scroll to zoom</p>
              <p>Click to select, double-click to enter</p>
              <p>Escape to go up / deselect</p>
            </div>
          </>
        ) : (
          <HistoryPanel />
        )}
      </div>

      <div style={{ flex: 1 }}>
        <Canvas
          camera={{ position: [8, -8, 6], up: [0, 0, 1], fov: 50 }}
          onPointerMissed={handlePointerMissed}
        >
          <color attach="background" args={["#242424"]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, -10, 10]} intensity={1} />
          <directionalLight position={[-10, 10, -10]} intensity={0.3} />

          <CsgScene tree={displayTree} />

          {!isPreview && (
            <DrawBuildingTool
              active={drawToolActive}
              onComplete={handleDrawComplete}
              onDeactivate={() => setDrawToolActive(false)}
            />
          )}

          <gridHelper
            args={[20, 20, "#444", "#333"]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <OrbitControls
            makeDefault
            enabled={!drawToolActive && !isDraggingGizmo}
          />
        </Canvas>
      </div>
    </div>
  );
}

export default App;
