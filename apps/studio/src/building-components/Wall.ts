// ─── Wall Builder ────────────────────────────────────────────────────────────
// A wall is a slab of (length x thickness x height) with window cutouts.

import type { WindowConfig } from "../types/BuildingTypes";
import type { CsgTreeNode } from "../types/CsgTree";
import { genId, translateNode } from "../types/CsgTree";

function buildWindowCutout({
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
}): CsgTreeNode {
  return translateNode(offsetX, 0, offsetZ, [
    {
      id: genId(),
      type: "cube",
      size: [width, thickness * 3, height],
      center: false,
    },
  ]);
}

export function buildWall({
  length,
  height,
  thickness,
  windows: windowConfig,
}: {
  length: number;
  height: number;
  thickness: number;
  windows?: WindowConfig;
}): CsgTreeNode {
  const wallCube: CsgTreeNode = {
    id: genId(),
    type: "cube",
    size: [length, thickness, height],
    center: false,
  };

  if (!windowConfig) return wallCube;

  const { width, height: winH, spacing, sillHeight } = windowConfig;

  const availableLength = length - spacing;
  if (availableLength <= 0) return wallCube;

  const windowPitch = width + spacing;
  const count = Math.floor(availableLength / windowPitch);
  if (count <= 0) return wallCube;

  const totalWindowsWidth = count * width + (count - 1) * spacing;
  const startX = (length - totalWindowsWidth) / 2;

  const cutouts: CsgTreeNode[] = [];
  for (let i = 0; i < count; i++) {
    cutouts.push(
      buildWindowCutout({
        width,
        height: winH,
        thickness,
        offsetX: startX + i * windowPitch,
        offsetZ: sillHeight,
      }),
    );
  }

  return {
    id: genId(),
    type: "difference",
    children: [wallCube, ...cutouts],
  };
}
