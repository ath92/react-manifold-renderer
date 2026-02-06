import { Translate, Union } from "@manifold-studio/react-manifold";
import type { Polygon, WindowConfig } from "../types/BuildingTypes";
import { Level } from "./Level";
import { Roof } from "./Roof";

// ─── Building Component ──────────────────────────────────────────────────────

export function Building({
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
}) {
  const levelHeight = floorThickness + wallHeight;
  const levelElements = [];
  for (let i = 0; i < levels; i++) {
    levelElements.push(
      <Translate key={i} z={i * levelHeight}>
        <Level
          polygon={polygon}
          floorThickness={floorThickness}
          wallHeight={wallHeight}
          wallThickness={wallThickness}
          windows={windowConfig}
        />
      </Translate>,
    );
  }

  return (
    <Union>
      {levelElements}
      {/* Roof on top of all levels */}
      <Translate z={levels * levelHeight}>
        <Roof
          polygon={polygon}
          thickness={roofThickness}
          overhang={roofOverhang}
        />
      </Translate>
    </Union>
  );
}
