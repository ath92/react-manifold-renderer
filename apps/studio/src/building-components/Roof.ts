// ─── Roof Builder ────────────────────────────────────────────────────────────
// A flat slab roof with an overhang.

import type { Polygon } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";

function expandPolygon(polygon: Polygon, overhang: number): Polygon {
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
}

export function buildRoof({
  polygon,
  thickness,
  overhang,
}: {
  polygon: Polygon;
  thickness: number;
  overhang: number;
}): CsgTreeNode {
  const expanded = expandPolygon(polygon, overhang);
  return { type: 'extrude', polygon: expanded, height: thickness };
}
