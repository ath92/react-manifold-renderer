// ─── Level Builder ───────────────────────────────────────────────────────────
// A level = floor + walls around the polygon edges.
// The polygon defines the footprint in the XY plane.
// Walls are placed along each polygon edge: generated flat (along X axis),
// then rotated and translated to match the edge.

import type { Polygon, WindowConfig } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";
import { buildFloor } from "./Floor";
import { buildWall } from "./Wall";

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

export function buildLevel({
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
}): CsgTreeNode {
  const edges = edgesFromPolygon(polygon);

  const wallNodes: CsgTreeNode[] = edges.map((edge) => ({
    type: 'translate' as const,
    x: edge.start[0],
    y: edge.start[1],
    z: 0,
    children: [{
      type: 'rotate' as const,
      z: edge.angle,
      children: [
        buildWall({
          length: edge.length,
          height: wallHeight,
          thickness: wallThickness,
          windows: windowConfig,
        }),
      ],
    }],
  }));

  return {
    type: 'union',
    children: [
      buildFloor({ polygon, thickness: floorThickness }),
      {
        type: 'translate',
        z: floorThickness,
        children: [{
          type: 'union',
          children: wallNodes,
        }],
      },
    ],
  };
}
