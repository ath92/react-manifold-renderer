// ─── Floor Builder ───────────────────────────────────────────────────────────
// Extrudes the footprint polygon to the given thickness.

import type { Polygon } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";
import { genId } from "../types/CsgTree";

export function buildFloor({
  polygon,
  thickness,
}: {
  polygon: Polygon;
  thickness: number;
}): CsgTreeNode {
  return { id: genId(), type: 'extrude', polygon, height: thickness };
}
