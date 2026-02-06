import { useMemo } from "react";
import type { Polygon } from "../types/BuildingTypes";
import { Extrude } from "@manifold-studio/react-manifold";

// ─── Roof Component ──────────────────────────────────────────────────────────
// A flat slab roof with an overhang.

export function Roof({
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
