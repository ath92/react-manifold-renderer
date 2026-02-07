// ─── Level Component ─────────────────────────────────────────────────────────
// A level = floor + walls around the polygon edges.
// The polygon defines the footprint in the XY plane.
// The Extrude primitive extrudes along Z, so we model everything in XZ-up
// coordinate space and the final building rotates as needed.
//
// Walls are placed along each polygon edge. Each wall is generated flat
// (along the X axis), then rotated and translated to match the edge.

import { useMemo } from "react";
import type { Polygon, WindowConfig } from "../types/BuildingTypes";
import { Rotate, Translate, Union } from "@manifold-studio/react-manifold";
import { Floor } from "./Floor";
import { Wall } from "./Wall";

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

export function Level({
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
