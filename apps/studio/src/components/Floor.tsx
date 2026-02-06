// ─── Floor Component ─────────────────────────────────────────────────────────
// Extrudes the footprint polygon to the given thickness.

import { Extrude } from "@manifold-studio/react-manifold";
import type { Polygon } from "../types/BuildingTypes";

export function Floor({
  polygon,
  thickness,
}: {
  polygon: Polygon;
  thickness: number;
}) {
  return <Extrude polygon={polygon} height={thickness} />;
}
