import { useState, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  Rotate,
  meshToGeometry,
} from "@manifold-studio/react-manifold";
import type { Polygon, WindowConfig } from "./types/BuildingTypes";
import { Building } from "./components/Building";

// ─── CSG Scene ───────────────────────────────────────────────────────────────

function BuildingScene({
  polygon,
  levels,
  floorThickness,
  wallHeight,
  wallThickness,
  roofThickness,
  roofOverhang,
  windowConfig,
}: {
  polygon: Polygon;
  levels: number;
  floorThickness: number;
  wallHeight: number;
  wallThickness: number;
  roofThickness: number;
  roofOverhang: number;
  windowConfig: WindowConfig;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh);
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
          <Building
            polygon={polygon}
            levels={levels}
            floorThickness={floorThickness}
            wallHeight={wallHeight}
            wallThickness={wallThickness}
            roofThickness={roofThickness}
            roofOverhang={roofOverhang}
            windows={windowConfig}
          />
        </Rotate>
      </CsgRoot>
      {error && (
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#e8d4b8" flatShading />
        </mesh>
      )}
    </>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

const DEFAULT_POLYGON: Polygon = [
  [0, 0],
  [6, 0],
  [6, 4],
  [0, 4],
];

function App() {
  const [levels, setLevels] = useState(4);
  const [floorThickness, setFloorThickness] = useState(0.15);
  const [wallHeight, setWallHeight] = useState(1.2);
  const [wallThickness, setWallThickness] = useState(0.12);
  const [roofThickness, setRoofThickness] = useState(0.2);
  const [roofOverhang, setRoofOverhang] = useState(0.3);
  const [windowWidth, setWindowWidth] = useState(0.6);
  const [windowHeight, setWindowHeight] = useState(0.7);
  const [windowSpacing, setWindowSpacing] = useState(0.5);
  const [windowSillHeight, setWindowSillHeight] = useState(0.3);

  const windowConfig = useMemo<WindowConfig>(
    () => ({
      width: windowWidth,
      height: windowHeight,
      spacing: windowSpacing,
      sillHeight: windowSillHeight,
    }),
    [windowWidth, windowHeight, windowSpacing, windowSillHeight],
  );

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
        <h2 style={{ margin: 0 }}>React Manifold</h2>
        <p style={{ margin: 0, fontSize: "14px", color: "#888" }}>
          Building Generator
        </p>

        <fieldset
          style={{
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "12px",
          }}
        >
          <legend style={{ color: "#aaa", fontSize: "12px" }}>Structure</legend>

          <label
            style={{ display: "block", marginBottom: "8px", fontSize: "13px" }}
          >
            Levels: {levels}
          </label>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={levels}
            onChange={(e) => setLevels(parseInt(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Floor Thickness: {floorThickness.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.05}
            max={0.4}
            step={0.01}
            value={floorThickness}
            onChange={(e) => setFloorThickness(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Wall Height: {wallHeight.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.5}
            max={2.5}
            step={0.05}
            value={wallHeight}
            onChange={(e) => setWallHeight(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Wall Thickness: {wallThickness.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.05}
            max={0.4}
            step={0.01}
            value={wallThickness}
            onChange={(e) => setWallThickness(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </fieldset>

        <fieldset
          style={{
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "12px",
          }}
        >
          <legend style={{ color: "#aaa", fontSize: "12px" }}>Roof</legend>

          <label
            style={{ display: "block", marginBottom: "8px", fontSize: "13px" }}
          >
            Thickness: {roofThickness.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.1}
            max={0.5}
            step={0.01}
            value={roofThickness}
            onChange={(e) => setRoofThickness(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Overhang: {roofOverhang.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={roofOverhang}
            onChange={(e) => setRoofOverhang(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </fieldset>

        <fieldset
          style={{
            border: "1px solid #444",
            borderRadius: "4px",
            padding: "12px",
          }}
        >
          <legend style={{ color: "#aaa", fontSize: "12px" }}>Windows</legend>

          <label
            style={{ display: "block", marginBottom: "8px", fontSize: "13px" }}
          >
            Width: {windowWidth.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.2}
            max={1.5}
            step={0.05}
            value={windowWidth}
            onChange={(e) => setWindowWidth(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Height: {windowHeight.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.2}
            max={1.5}
            step={0.05}
            value={windowHeight}
            onChange={(e) => setWindowHeight(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Spacing: {windowSpacing.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.05}
            value={windowSpacing}
            onChange={(e) => setWindowSpacing(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />

          <label
            style={{
              display: "block",
              marginBottom: "8px",
              marginTop: "12px",
              fontSize: "13px",
            }}
          >
            Sill Height: {windowSillHeight.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.1}
            max={1.0}
            step={0.05}
            value={windowSillHeight}
            onChange={(e) => setWindowSillHeight(parseFloat(e.target.value))}
            style={{ width: "100%" }}
          />
        </fieldset>

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

          <BuildingScene
            polygon={DEFAULT_POLYGON}
            levels={levels}
            floorThickness={floorThickness}
            wallHeight={wallHeight}
            wallThickness={wallThickness}
            roofThickness={roofThickness}
            roofOverhang={roofOverhang}
            windowConfig={windowConfig}
          />

          <gridHelper args={[20, 20, "#444", "#333"]} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
}

export default App;
