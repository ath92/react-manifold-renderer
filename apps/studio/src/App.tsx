import { useState, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  Rotate,
  meshToGeometry,
} from "@manifold-studio/react-manifold";
import type { CsgTreeNode } from "./types/CsgTree";
import { CsgTreeRenderer } from "./components/CsgTreeRenderer";
import { CsgTreePanel } from "./components/CsgTreePanel";
import { DrawTool } from "./draw-tool/ExtrudePolygonTool";

// ─── CSG Scene ───────────────────────────────────────────────────────────────

function CsgScene({ tree }: { tree: CsgTreeNode }) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
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

  return (
    <>
      <CsgRoot onMesh={handleMesh} onError={handleError}>
        {/* Rotate so Z-up (extrude direction) becomes Y-up for Three.js */}
        <Rotate x={-90}>
          <CsgTreeRenderer node={tree} />
        </Rotate>
      </CsgRoot>
      {error && (
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}
      {geometry && (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <mesh geometry={geometry as any}>
          <meshStandardMaterial color="#e8d4b8" flatShading />
        </mesh>
      )}
    </>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [drawToolActive, setDrawToolActive] = useState(false);
  const [drawnShapes, setDrawnShapes] = useState<CsgTreeNode[]>([]);

  const tree = useMemo<CsgTreeNode | null>(() => {
    if (drawnShapes.length === 0) return null;
    if (drawnShapes.length === 1) return drawnShapes[0];
    return { type: "union", children: drawnShapes };
  }, [drawnShapes]);

  const handleDrawComplete = useCallback((node: CsgTreeNode) => {
    setDrawnShapes((prev) => [...prev, node]);
  }, []);

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
            onClick={() => setDrawToolActive((v) => !v)}
            style={{
              width: "100%",
              padding: "8px",
              background: drawToolActive ? "#4fc3f7" : "#333",
              color: drawToolActive ? "#000" : "#fff",
              border: "1px solid #555",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            {drawToolActive ? "Drawing (Esc to cancel)" : "Draw Building"}
          </button>
        </fieldset>

        {tree && <CsgTreePanel tree={tree} />}

        <div style={{ marginTop: "auto", fontSize: "12px", color: "#666" }}>
          <p>Drag to rotate</p>
          <p>Scroll to zoom</p>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <Canvas camera={{ position: [8, 6, 8], fov: 50 }}>
          <color attach="background" args={["#242424"]} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 10]} intensity={1} />
          <directionalLight position={[-10, -10, -10]} intensity={0.3} />

          {tree && <CsgScene tree={tree} />}

          <DrawTool active={drawToolActive} onComplete={handleDrawComplete} />

          <gridHelper args={[20, 20, "#444", "#333"]} />
          <OrbitControls makeDefault enabled={!drawToolActive} />
        </Canvas>
      </div>
    </div>
  );
}

export default App;
