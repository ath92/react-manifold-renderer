import type { Manifold } from "manifold-3d";
import type { CsgNode, PrimitiveType } from "../types";
import { getManifold } from "../manifold-module";

/** Maps manifold originalID (int) → user-supplied node ID (string) */
export type OriginalIdMap = Map<number, string>;

const PRIMITIVE_TYPES: Set<string> = new Set<PrimitiveType>([
  "cube",
  "sphere",
  "cylinder",
  "extrude",
]);

export function buildGeometry(
  node: CsgNode,
  idMap?: OriginalIdMap,
): Manifold | null {
  // Cache hit: not dirty and has manifold
  if (!node.dirty && node.manifold) {
    if (idMap) reRegisterIds(node, idMap);
    return node.manifold;
  }

  // Dispose old manifold if exists
  if (node.manifold) {
    node.manifold.delete();
    node.manifold = null;
  }

  const mod = getManifold();
  const { Manifold: M, CrossSection } = mod;

  // Build children first (recursive)
  const childManifolds: Manifold[] = [];
  for (const child of node.children) {
    const m = buildGeometry(child, idMap);
    if (m) childManifolds.push(m);
  }

  let result: Manifold | null = null;

  switch (node.type) {
    // --- Primitives ---
    case "cube": {
      const size = normalizeVec3(node.props.size, [1, 1, 1]);
      const center = node.props.center ?? true;
      result = M.cube(size, center as boolean);
      break;
    }

    case "sphere": {
      const radius = (node.props.radius as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      result = M.sphere(radius, segments);
      break;
    }

    case "cylinder": {
      const radiusLow =
        (node.props.radius as number) ?? (node.props.radiusLow as number) ?? 1;
      const radiusHigh = (node.props.radiusHigh as number) ?? radiusLow;
      const height = (node.props.height as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      const center = node.props.center ?? true;
      result = M.cylinder(
        height,
        radiusLow,
        radiusHigh,
        segments,
        center as boolean,
      );
      break;
    }

    case "extrude": {
      const polygon = node.props.polygon as [number, number][];
      const height = (node.props.height as number) ?? 1;
      if (polygon && polygon.length >= 3) {
        const crossSection = new CrossSection([polygon], "Positive");
        result = M.extrude(crossSection, height);
        crossSection.delete();
      }
      break;
    }

    // --- Boolean Operations ---
    // NOTE: Single-child cases use identity transform to create a copy,
    // avoiding shared ownership with child (which would cause double-free)
    case "union": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        result = M.union(childManifolds);
      }
      break;
    }

    case "difference": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        const [first, ...rest] = childManifolds;
        const restUnion = M.union(rest);
        result = first.subtract(restUnion);
        restUnion.delete();
      }
      break;
    }

    case "intersection": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        result = M.intersection(childManifolds);
      }
      break;
    }

    // --- Transform (single matrix-based type) ---
    case "transform": {
      if (childManifolds.length === 1) {
        const matrix = node.props.matrix as number[];
        if (matrix && matrix.length === 16) {
          result = childManifolds[0].transform(
            matrix as import("manifold-3d").Mat4,
          );
        } else {
          // Identity fallback
          result = childManifolds[0].translate([0, 0, 0]);
        }
      }
      break;
    }

    // --- Group (passthrough) ---
    case "group": {
      if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else if (childManifolds.length > 1) {
        result = M.union(childManifolds);
      }
      break;
    }
  }

  // Tag primitives with an originalID so faces can be traced back to source nodes
  if (result && PRIMITIVE_TYPES.has(node.type)) {
    const tagged = result.asOriginal();
    result.delete();
    result = tagged;
    const nodeId = node.props.nodeId as string | undefined;
    if (idMap && nodeId) {
      idMap.set(result.originalID(), nodeId);
    }
  }

  node.manifold = result;
  node.dirty = false;

  return result;
}

// --- Helpers ---

/** Re-register originalID → nodeId mappings for all primitives in a cached subtree. */
function reRegisterIds(node: CsgNode, idMap: OriginalIdMap): void {
  if (PRIMITIVE_TYPES.has(node.type) && node.manifold) {
    const nodeId = node.props.nodeId as string | undefined;
    if (nodeId) {
      idMap.set(node.manifold.originalID(), nodeId);
    }
  }
  for (const child of node.children) {
    reRegisterIds(child, idMap);
  }
}

function normalizeVec3(
  input: unknown,
  defaultValue: [number, number, number],
  keys: [string, string, string] = ["0", "1", "2"],
): [number, number, number] {
  if (Array.isArray(input)) {
    return [
      input[0] ?? defaultValue[0],
      input[1] ?? defaultValue[1],
      input[2] ?? defaultValue[2],
    ];
  }

  if (typeof input === "number") {
    return [input, input, input];
  }

  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    return [
      (obj[keys[0]] as number) ?? defaultValue[0],
      (obj[keys[1]] as number) ?? defaultValue[1],
      (obj[keys[2]] as number) ?? defaultValue[2],
    ];
  }

  return defaultValue;
}
