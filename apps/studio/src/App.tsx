import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  meshToGeometry,
  buildTriNodeIdMap,
  nodeIdForFace,
} from "@manifold-studio/react-manifold";
import type {
  OriginalIdMap,
  TriNodeIdMap,
} from "@manifold-studio/react-manifold";
import type { CsgTreeNode } from "./types/CsgTree";
import {
  genId,
  findNodeById,
  findDirectChildAncestor,
  findParentNode,
  hasChildren,
} from "./types/CsgTree";
import { CsgTreeRenderer } from "./components/CsgTreeRenderer";
import { CsgTreePanel } from "./components/CsgTreePanel";
import { SelectionOverlay } from "./components/SelectionOverlay";
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
  type TransformMode,
} from "./store";
import { useShapes, useAddShape } from "./sync-store";

// ─── CSG Scene ───────────────────────────────────────────────────────────────

function CsgScene({ tree }: { tree: CsgTreeNode }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedId = useSelectedId();
  const setSelectedId = useSetSelectedId();
  const cursorParentId = useCursorParentId();
  const setCursorParentId = useSetCursorParentId();
  const triNodeIdMapRef = useRef<TriNodeIdMap>([]);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMesh = useCallback((mesh: Mesh, idMap: OriginalIdMap) => {
    console.log(mesh, idMap);
    const newGeometry = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
    triNodeIdMapRef.current = buildTriNodeIdMap(mesh, idMap);
    setGeometry((prev) => {
      prev?.dispose();
      return newGeometry;
    });
    setError(null);
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error("CSG Error:", err);
    setError(err.message);
  }, []);

  // Resolve a face click to the correct node at the current cursor level
  const resolveClickTarget = useCallback(
    (faceIndex: number): string | undefined => {
      const leafId = nodeIdForFace(triNodeIdMapRef.current, faceIndex);
      if (!leafId) return undefined;
      // If no cursor parent is set, we're at the top level — select the whole shape
      if (!cursorParentId) return tree.id;
      // If the cursor parent lives within this shape, resolve to its direct child
      if (findNodeById(tree, cursorParentId)) {
        return findDirectChildAncestor(tree, leafId, cursorParentId);
      }
      // Cursor parent is in a different shape — select the whole shape
      return tree.id;
    },
    [tree, cursorParentId],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // Delay single-click to distinguish from double-click
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        if (e.faceIndex != null) {
          const resolvedId = resolveClickTarget(e.faceIndex);
          if (resolvedId) {
            setSelectedId(resolvedId);
            return;
          }
        }
        setSelectedId(tree.id);
      }, 250);
    },
    [tree.id, setSelectedId, resolveClickTarget],
  );

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      // Cancel the pending single-click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (e.faceIndex != null) {
        const resolvedId = resolveClickTarget(e.faceIndex);
        if (resolvedId) {
          let node = findNodeById(tree, resolvedId);
          // Skip through transform nodes — cursor should land on CSG ops or primitives
          while (
            node &&
            node.type === "transform" &&
            node.children.length === 1
          ) {
            node = node.children[0];
          }
          if (node && hasChildren(node)) {
            // Enter this node — make its children selectable
            setCursorParentId(node.id);
            return;
          }
        }
      }
    },
    [tree, resolveClickTarget, setCursorParentId],
  );

  // Check if the selection lives within this shape's tree
  const selectedNode = selectedId ? findNodeById(tree, selectedId) : undefined;

  // Determine if this shape is "active" — contains the cursor or no cursor is set
  const isActive = !cursorParentId || !!findNodeById(tree, cursorParentId);

  console.log(isActive);
  return (
    <>
      <CsgRoot onMesh={handleMesh} onError={handleError}>
        <CsgTreeRenderer node={tree} />
      </CsgRoot>
      {error && (
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}
      {geometry && (
        <mesh
          geometry={geometry as unknown as THREE.BufferGeometry}
          onClick={
            isActive
              ? handleClick
              : (e) => {
                  e.stopPropagation();
                  setCursorParentId(null);
                  setSelectedId(tree.id);
                }
          }
          onDoubleClick={
            isActive
              ? handleDoubleClick
              : (e) => {
                  e.stopPropagation();
                  setCursorParentId(null);
                  setSelectedId(null);
                }
          }
        >
          <meshStandardMaterial
            color="#e8d4b8"
            flatShading
            transparent
            opacity={isActive ? 1 : 0.3}
          />
        </mesh>
      )}
      {selectedNode && (
        <SelectionOverlay tree={tree} selectedId={selectedId!} />
      )}
    </>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

const TRANSFORM_KEYS: Record<string, TransformMode> = {
  t: "translate",
  r: "rotate",
  s: "scale",
};

function App() {
  const drawToolActive = useDrawToolActive();
  const setDrawToolActive = useSetDrawToolActive();
  const shapes = useShapes();
  const addShape = useAddShape();
  const selectedId = useSelectedId();
  const setSelectedId = useSetSelectedId();
  const cursorParentId = useCursorParentId();
  const setCursorParentId = useSetCursorParentId();
  const transformMode = useTransformMode();
  const setTransformMode = useSetTransformMode();
  const isDraggingGizmo = useIsDraggingGizmo();
  const pointerMissedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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

  // Construct a single tree for the whole scene (for CsgTreePanel)
  const sceneTree = useMemo<CsgTreeNode>(() => {
    return {
      id: genId(),
      type: "group",
      children: shapes,
    };
  }, [shapes]);

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
      <div
        style={{
          width: "280px",
          padding: "20px",
          background: "#1a1a1a",
          color: "#fff",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          overflowY: "auto",
        }}
      >
        <h2 style={{ margin: 0 }}>Manifold Studio</h2>
        <p style={{ margin: 0, fontSize: "14px", color: "#888" }}>
          Draw buildings on the ground plane
        </p>

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

        <div style={{ marginTop: "auto", fontSize: "12px", color: "#666" }}>
          <p>T / R / S to switch transform mode</p>
          <p>Drag to rotate, scroll to zoom</p>
          <p>Click to select, double-click to enter</p>
          <p>Escape to go up / deselect</p>
        </div>
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

          {shapes.map((shape) => (
            <CsgScene key={shape.id} tree={shape} />
          ))}

          <DrawBuildingTool
            active={drawToolActive}
            onComplete={handleDrawComplete}
            onDeactivate={() => setDrawToolActive(false)}
          />

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
