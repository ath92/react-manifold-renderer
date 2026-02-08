// ─── Building Builder ────────────────────────────────────────────────────────

import type { Polygon, WindowConfig } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";
import { genId } from "../types/CsgTree";
import { buildLevel } from "./Level";
import { buildRoof } from "./Roof";

export function buildBuilding({
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
}): CsgTreeNode {
  const levelHeight = floorThickness + wallHeight;

  const levelNodes: CsgTreeNode[] = [];
  for (let i = 0; i < levels; i++) {
    levelNodes.push({
      id: genId(),
      type: "translate",
      z: i * levelHeight,
      children: [
        buildLevel({
          polygon,
          floorThickness,
          wallHeight,
          wallThickness,
          windows: windowConfig,
        }),
      ],
    });
  }

  return {
    id: genId(),
    type: "union",
    name: "building",
    children: [
      ...levelNodes,
      {
        id: genId(),
        type: "translate",
        z: levels * levelHeight,
        children: [
          buildRoof({
            polygon,
            thickness: roofThickness,
            overhang: roofOverhang,
          }),
        ],
      },
    ],
  };
}
