import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  Rotate,
  meshToGeometry,
} from "@manifold-studio/react-manifold";
import type { CsgTreeNode } from "../types/CsgTree";
import { CsgTreeRenderer } from "../components/CsgTreeRenderer";
import { buildBuilding } from "../building-components/Building";

// ─── Geometry Helpers ────────────────────────────────────────────────────────

type Vec2 = [number, number];

/** Check if segments (p1,p2) and (p3,p4) intersect (excluding shared endpoints). */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return false; // parallel

  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / denom;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / denom;

  // Strict interior intersection (exclude endpoints with epsilon)
  const eps = 1e-6;
  return t > eps && t < 1 - eps && u > eps && u < 1 - eps;
}

/** Would adding `candidate` to the polygon cause a self-intersection? */
function wouldSelfIntersect(vertices: Vec2[], candidate: Vec2): boolean {
  const n = vertices.length;
  if (n < 2) return false;

  // The new edge is from vertices[n-1] to candidate
  const newEdgeStart = vertices[n - 1];
  const newEdgeEnd = candidate;

  // Check against all existing edges except the one sharing vertices[n-1]
  for (let i = 0; i < n - 2; i++) {
    if (
      segmentsIntersect(newEdgeStart, newEdgeEnd, vertices[i], vertices[i + 1])
    ) {
      return true;
    }
  }
  return false;
}

/** Would closing the polygon (connecting last vertex to first) cause self-intersection? */
function wouldClosingIntersect(vertices: Vec2[]): boolean {
  const n = vertices.length;
  if (n < 3) return false;

  const closeStart = vertices[n - 1];
  const closeEnd = vertices[0];

  // Check the closing edge against all edges except the two adjacent ones
  // (edge 0→1 shares vertex 0, edge (n-2)→(n-1) shares vertex n-1)
  for (let i = 1; i < n - 2; i++) {
    if (segmentsIntersect(closeStart, closeEnd, vertices[i], vertices[i + 1])) {
      return true;
    }
  }
  return false;
}

// ─── Ground Plane Raycaster ──────────────────────────────────────────────────

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const CLOSE_THRESHOLD = 0.3; // world units to snap to first vertex

function useGroundPoint() {
  const { camera, gl } = useThree();
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  return useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(GROUND_PLANE, hit)) {
        return [hit.x, hit.z]; // XZ plane → 2D polygon coords
      }
      return null;
    },
    [camera, gl, raycaster],
  );
}

/** Project a screen-space mouse position onto the vertical axis through `origin`. */
function useVerticalProject() {
  const { camera, gl } = useThree();

  return useCallback(
    (clientX: number, clientY: number, origin: Vec2): number => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );

      // Create a ray from the camera
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);

      // The vertical axis line passes through (origin.x, 0, origin.y) going upward
      const lineOrigin = new THREE.Vector3(origin[0], 0, origin[1]);
      const lineDir = new THREE.Vector3(0, 1, 0);

      // Find closest point between the ray and the vertical line
      const w0 = new THREE.Vector3().subVectors(ray.ray.origin, lineOrigin);
      const a = ray.ray.direction.dot(ray.ray.direction);
      const b = ray.ray.direction.dot(lineDir);
      const c = lineDir.dot(lineDir);
      const d = ray.ray.direction.dot(w0);
      const e = lineDir.dot(w0);
      const denom = a * c - b * b;

      if (Math.abs(denom) < 1e-10) return 0;

      const t = (b * e - c * d) / denom;
      const s = (a * e - b * d) / denom;

      // s is the parameter along the vertical line — that's our height
      // Only allow non-negative extrusion: clamp at 0 if needed, but we'll
      // show it even for negative to let the user see feedback
      void t;
      return s;
    },
    [camera, gl],
  );
}

// ─── Vertex Dot ──────────────────────────────────────────────────────────────

function VertexDot({
  position,
  isFirst,
  highlight,
}: {
  position: Vec2;
  isFirst?: boolean;
  highlight?: boolean;
}) {
  return (
    <mesh position={[position[0], 0.01, position[1]]}>
      <circleGeometry args={[isFirst ? 0.12 : 0.08, 16]} />
      <meshBasicMaterial
        color={highlight ? "#4fc3f7" : isFirst ? "#ff9800" : "#ffffff"}
        side={THREE.DoubleSide}
        depthTest={false}
      />
    </mesh>
  );
}

// ─── Polygon Lines ───────────────────────────────────────────────────────────

function PolygonLines({
  vertices,
  closed,
}: {
  vertices: Vec2[];
  closed?: boolean;
}) {
  const geometry = useMemo(() => {
    if (vertices.length < 2) return null;
    const points: THREE.Vector3[] = vertices.map(
      (v) => new THREE.Vector3(v[0], 0.01, v[1]),
    );
    if (closed) {
      points.push(new THREE.Vector3(vertices[0][0], 0.01, vertices[0][1]));
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [vertices, closed]);

  if (!geometry) return null;

  return (
    // @ts-expect-error R3F <line> conflicts with SVG line type
    <line geometry={geometry}>
      <lineBasicMaterial color="#4fc3f7" linewidth={2} depthTest={false} />
    </line>
  );
}

// ─── Default building parameters ─────────────────────────────────────────────

const DEFAULT_FLOOR_THICKNESS = 0.15;
const DEFAULT_WALL_HEIGHT = 1.2;
const DEFAULT_WALL_THICKNESS = 0.12;
const DEFAULT_ROOF_THICKNESS = 0.2;
const DEFAULT_ROOF_OVERHANG = 0.3;
const DEFAULT_WINDOW_CONFIG = {
  width: 0.6,
  height: 0.7,
  spacing: 0.5,
  sillHeight: 0.3,
};
const LEVEL_HEIGHT = DEFAULT_FLOOR_THICKNESS + DEFAULT_WALL_HEIGHT;

// ─── Building Mesh Preview ───────────────────────────────────────────────────

function BuildingPreview({
  polygon,
  height,
}: {
  polygon: Vec2[];
  height: number;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeom = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
    setGeometry((prev) => {
      prev?.dispose();
      return newGeom;
    });
  }, []);

  // Convert height to number of levels (at least 1)
  const levels = Math.max(1, Math.round(Math.abs(height) / LEVEL_HEIGHT));

  // The polygon stores [x, z] in Three.js world space (XZ ground plane).
  // CSG building uses XY polygon, so negate second coord and reverse winding.
  const csgPolygon = useMemo<Vec2[]>(
    () => polygon.map(([x, z]) => [x, -z] as Vec2).reverse(),
    [polygon],
  );

  const buildingTree = useMemo(
    () =>
      buildBuilding({
        polygon: csgPolygon,
        levels,
        floorThickness: DEFAULT_FLOOR_THICKNESS,
        wallHeight: DEFAULT_WALL_HEIGHT,
        wallThickness: DEFAULT_WALL_THICKNESS,
        roofThickness: DEFAULT_ROOF_THICKNESS,
        roofOverhang: DEFAULT_ROOF_OVERHANG,
        windows: DEFAULT_WINDOW_CONFIG,
      }),
    [csgPolygon, levels],
  );

  // Don't render if height is near zero or polygon is degenerate
  if (Math.abs(height) < 0.001 || polygon.length < 3) return null;

  return (
    <>
      <CsgRoot onMesh={handleMesh}>
        <Rotate x={-90}>
          <CsgTreeRenderer node={buildingTree} />
        </Rotate>
      </CsgRoot>
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial
            color="#4fc3f7"
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            flatShading
          />
        </mesh>
      )}
    </>
  );
}

// ─── Main DrawTool Component ─────────────────────────────────────────────────

type Phase = "drawing" | "extruding" | "idle";

/** Convert XZ ground-plane polygon + height into a building CSG tree node. */
function buildBuildingNode(polygon: Vec2[], height: number): CsgTreeNode {
  const csgPolygon = polygon.map(([x, z]) => [x, -z] as Vec2).reverse();
  const levels = Math.max(1, Math.round(Math.abs(height) / LEVEL_HEIGHT));

  return buildBuilding({
    polygon: csgPolygon,
    levels,
    floorThickness: DEFAULT_FLOOR_THICKNESS,
    wallHeight: DEFAULT_WALL_HEIGHT,
    wallThickness: DEFAULT_WALL_THICKNESS,
    roofThickness: DEFAULT_ROOF_THICKNESS,
    roofOverhang: DEFAULT_ROOF_OVERHANG,
    windows: DEFAULT_WINDOW_CONFIG,
  });
}

export function DrawTool({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete?: (node: CsgTreeNode) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [vertices, setVertices] = useState<Vec2[]>([]);
  const [hoverNearFirst, setHoverNearFirst] = useState(false);
  const [extrudeHeight, setExtrudeHeight] = useState(0);
  const getGroundPoint = useGroundPoint();
  const getVerticalHeight = useVerticalProject();
  const { gl } = useThree();

  // Store the first vertex for vertical projection in phase 2
  const firstVertexRef = useRef<Vec2 | null>(null);

  // Reset when tool becomes inactive
  useEffect(() => {
    if (!active) {
      setPhase("idle");
      setVertices([]);
      setHoverNearFirst(false);
      setExtrudeHeight(0);
      firstVertexRef.current = null;
    }
  }, [active]);

  // ── Phase 1: Drawing ──

  const handleCanvasClick = useCallback(
    (e: MouseEvent) => {
      if (!active) return;

      if (phase === "idle" || phase === "drawing") {
        const pt = getGroundPoint(e.clientX, e.clientY);
        if (!pt) return;

        if (phase === "idle") {
          // First vertex
          setVertices([pt]);
          firstVertexRef.current = pt;
          setPhase("drawing");
          return;
        }

        // Check if clicking near first vertex to close
        if (vertices.length >= 3) {
          const first = vertices[0];
          const dx = pt[0] - first[0];
          const dz = pt[1] - first[1];
          if (Math.sqrt(dx * dx + dz * dz) < CLOSE_THRESHOLD) {
            if (!wouldClosingIntersect(vertices)) {
              setPhase("extruding");
              setExtrudeHeight(0);
              return;
            }
          }
        }

        // Check self-intersection before adding
        if (wouldSelfIntersect(vertices, pt)) return;

        setVertices((prev) => [...prev, pt]);
      }
    },
    [active, phase, vertices, getGroundPoint],
  );

  const handleCanvasMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!active) return;

      if (phase === "drawing" && vertices.length >= 3) {
        const pt = getGroundPoint(e.clientX, e.clientY);
        if (pt) {
          const first = vertices[0];
          const dx = pt[0] - first[0];
          const dz = pt[1] - first[1];
          setHoverNearFirst(Math.sqrt(dx * dx + dz * dz) < CLOSE_THRESHOLD);
        }
      }

      if (phase === "extruding" && firstVertexRef.current) {
        const h = getVerticalHeight(
          e.clientX,
          e.clientY,
          firstVertexRef.current,
        );
        setExtrudeHeight(h);
      }
    },
    [active, phase, vertices, getGroundPoint, getVerticalHeight],
  );

  const handleCanvasClickExtrude = useCallback(
    (e: MouseEvent) => {
      if (!active || phase !== "extruding") return;

      // Confirm extrusion on click
      if (Math.abs(extrudeHeight) > 0.001) {
        onComplete?.(buildBuildingNode(vertices, extrudeHeight));
        setPhase("idle");
        setVertices([]);
        setExtrudeHeight(0);
        firstVertexRef.current = null;
      }
      void e;
    },
    [active, phase, extrudeHeight, vertices, onComplete],
  );

  // ── Keyboard: Enter to close polygon ──

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!active) return;

      if (e.key === "Enter" && phase === "drawing" && vertices.length >= 3) {
        if (!wouldClosingIntersect(vertices)) {
          setPhase("extruding");
          setExtrudeHeight(0);
        }
      }

      if (e.key === "Escape") {
        setPhase("idle");
        setVertices([]);
        setExtrudeHeight(0);
        firstVertexRef.current = null;
      }
    },
    [active, phase, vertices],
  );

  // ── Attach DOM listeners ──

  useEffect(() => {
    const canvas = gl.domElement;

    const onClick = (e: MouseEvent) => {
      if (phase === "extruding") {
        handleCanvasClickExtrude(e);
      } else {
        handleCanvasClick(e);
      }
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", handleCanvasMouseMove);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", handleCanvasMouseMove);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    gl,
    phase,
    handleCanvasClick,
    handleCanvasClickExtrude,
    handleCanvasMouseMove,
    handleKeyDown,
  ]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!active && vertices.length === 0) return null;

  return (
    <group>
      {/* Ground plane for raycasting (invisible) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial />
      </mesh>

      {/* Vertex dots */}
      {vertices.map((v, i) => (
        <VertexDot
          key={i}
          position={v}
          isFirst={i === 0}
          highlight={i === 0 && hoverNearFirst && phase === "drawing"}
        />
      ))}

      {/* Polygon edges */}
      {vertices.length >= 2 && (
        <PolygonLines vertices={vertices} closed={phase === "extruding"} />
      )}

      {/* 3D building preview */}
      {phase === "extruding" && (
        <BuildingPreview polygon={vertices} height={extrudeHeight} />
      )}
    </group>
  );
}
