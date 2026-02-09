// ─── Level Builder ───────────────────────────────────────────────────────────
// A level = floor + walls around the polygon edges.
// The polygon defines the footprint in the XY plane.
// Walls are placed along each polygon edge: generated flat (along X axis),
// then rotated and translated to match the edge.

import type { Polygon, WindowConfig } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";
import { genId, translateNode, rotateNode } from "../types/CsgTree";
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

  const wallNodes: CsgTreeNode[] = edges.map((edge) =>
    translateNode(edge.start[0], edge.start[1], 0, [
      rotateNode(0, 0, edge.angle, [
        buildWall({
          length: edge.length,
          height: wallHeight,
          thickness: wallThickness,
          windows: windowConfig,
        }),
      ]),
    ]),
  );

  return {
    id: genId(),
    type: "union",
    children: [
      buildFloor({ polygon, thickness: floorThickness }),
      translateNode(0, 0, floorThickness, [
        {
          id: genId(),
          type: "union",
          children: wallNodes,
        },
      ]),
    ],
  };
}
