// ─── Geometry Helpers ────────────────────────────────────────────────────────

import { useMemo } from "react";
import type { WindowConfig } from "../types/BuildingTypes";
import { Cube, Difference, Translate } from "@manifold-studio/react-manifold";

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

export function Wall({
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
