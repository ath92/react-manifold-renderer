import { useState, useCallback, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  Difference,
  Union,
  Cube,
  Extrude,
  Translate,
  Rotate,
  meshToGeometry,
} from "react-manifold";

// ─── Types ───────────────────────────────────────────────────────────────────

type Polygon = [number, number][];

interface WindowConfig {
  width: number;
  height: number;
  spacing: number;
  sillHeight: number;
}

// ─── Geometry Helpers ────────────────────────────────────────────────────────

function edgesFromPolygon(polygon: Polygon) {
  const edges: {
    start: [number, number];
    end: [number, number];
    length: number;
    angle: number;
  }[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    edges.push({ start, end, length, angle });
  }
  return edges;
}

// ─── Window Component ────────────────────────────────────────────────────────
// A window is just a cube used as a cutout from a wall.

function Window({
  width,
  height,
  thickness,
  offsetX,
  offsetZ,
}: {
  width: number;
  height: number;
  thickness: number;
  offsetX: number;
  offsetZ: number;
}) {
  // Wall extends along X, thickness along Y, height along Z (up)
  return (
    <Translate x={offsetX} y={0} z={offsetZ}>
      <Cube size={[width, thickness * 3, height]} center={false} />
    </Translate>
  );
}

// ─── Wall Component ──────────────────────────────────────────────────────────
// A wall is a slab of (length × height × thickness) with window cutouts.

function Wall({
  length,
  height,
  thickness,
  windows: windowConfig,
}: {
  length: number;
  height: number;
  thickness: number;
  windows?: WindowConfig;
}) {
  const windowCutouts = useMemo(() => {
    if (!windowConfig) return [];
    const { width, height: winH, spacing, sillHeight } = windowConfig;
    const cutouts: { x: number; y: number; w: number; h: number }[] = [];

    // Compute how many windows fit with spacing on each side
    const availableLength = length - spacing;
    if (availableLength <= 0) return [];
    const windowPitch = width + spacing;
    const count = Math.floor(availableLength / windowPitch);
    if (count <= 0) return [];

    // Center the group of windows along the wall
    const totalWindowsWidth = count * width + (count - 1) * spacing;
    const startX = (length - totalWindowsWidth) / 2;

    for (let i = 0; i < count; i++) {
      cutouts.push({
        x: startX + i * windowPitch,
        y: sillHeight,
        w: width,
        h: winH,
      });
    }
    return cutouts;
  }, [length, windowConfig]);

  if (windowCutouts.length === 0) {
    // Solid wall: X=length, Y=thickness, Z=height (up)
    return <Cube size={[length, thickness, height]} center={false} />;
  }

  return (
    <Difference>
      <Cube size={[length, thickness, height]} center={false} />
      {windowCutouts.map((w, i) => (
        <Window
          key={i}
          width={w.w}
          height={w.h}
          thickness={thickness}
          offsetX={w.x}
          offsetZ={w.y}
        />
      ))}
    </Difference>
  );
}

// ─── Floor Component ─────────────────────────────────────────────────────────
// Extrudes the footprint polygon to the given thickness.

function Floor({
  polygon,
  thickness,
}: {
  polygon: Polygon;
  thickness: number;
}) {
  return <Extrude polygon={polygon} height={thickness} />;
}

// ─── Level Component ─────────────────────────────────────────────────────────
// A level = floor + walls around the polygon edges.
// The polygon defines the footprint in the XY plane.
// The Extrude primitive extrudes along Z, so we model everything in XZ-up
// coordinate space and the final building rotates as needed.
//
// Walls are placed along each polygon edge. Each wall is generated flat
// (along the X axis), then rotated and translated to match the edge.

function Level({
  polygon,
  floorThickness,
  wallHeight,
  wallThickness,
  windows: windowConfig,
}: {
  polygon: Polygon;
  floorThickness: number;
  wallHeight: number;
  wallThickness: number;
  windows?: WindowConfig;
}) {
  const edges = useMemo(() => edgesFromPolygon(polygon), [polygon]);

  return (
    <Union>
      {/* Floor slab */}
      <Floor polygon={polygon} thickness={floorThickness} />

      {/* Walls sitting on top of the floor */}
      <Translate z={floorThickness}>
        <Union>
          {edges.map((edge, i) => {
            // Place each wall: rotate to match edge angle, translate to edge start,
            // offset inward by wall thickness (walls sit inside the footprint).
            const midX = edge.start[0];
            const midY = edge.start[1];
            return (
              <Translate key={i} x={midX} y={midY} z={0}>
                <Rotate z={edge.angle}>
                  <Wall
                    length={edge.length}
                    height={wallHeight}
                    thickness={wallThickness}
                    windows={windowConfig}
                  />
                </Rotate>
              </Translate>
            );
          })}
        </Union>
      </Translate>
    </Union>
  );
}

// ─── Roof Component ──────────────────────────────────────────────────────────
// A flat slab roof with an overhang.

function Roof({
  polygon,
  thickness,
  overhang,
}: {
  polygon: Polygon;
  thickness: number;
  overhang: number;
}) {
  // Expand polygon outward by overhang amount (simple scale from centroid)
  const expanded = useMemo(() => {
    const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
    const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
    return polygon.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) return [x, y] as [number, number];
      const scale = (dist + overhang) / dist;
      return [cx + dx * scale, cy + dy * scale] as [number, number];
    });
  }, [polygon, overhang]);

  return <Extrude polygon={expanded} height={thickness} />;
}

// ─── Building Component ──────────────────────────────────────────────────────

function Building({
  polygon,
  levels,
  floorThickness,
  wallHeight,
  wallThickness,
  roofThickness,
  roofOverhang,
  windows: windowConfig,
}: {
  polygon: Polygon;
  levels: number;
  floorThickness: number;
  wallHeight: number;
  wallThickness: number;
  roofThickness: number;
  roofOverhang: number;
  windows?: WindowConfig;
}) {
  const levelHeight = floorThickness + wallHeight;
  const levelElements = [];
  for (let i = 0; i < levels; i++) {
    levelElements.push(
      <Translate key={i} z={i * levelHeight}>
        <Level
          polygon={polygon}
          floorThickness={floorThickness}
          wallHeight={wallHeight}
          wallThickness={wallThickness}
          windows={windowConfig}
        />
      </Translate>,
    );
  }

  return (
    <Union>
      {levelElements}
      {/* Roof on top of all levels */}
      <Translate z={levels * levelHeight}>
        <Roof
          polygon={polygon}
          thickness={roofThickness}
          overhang={roofOverhang}
        />
      </Translate>
    </Union>
  );
}

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
