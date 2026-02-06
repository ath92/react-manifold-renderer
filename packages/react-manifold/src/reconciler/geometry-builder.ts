import type { Manifold } from 'manifold-3d';
import type { CsgNode } from '../types';
import { getManifold } from '../manifold-module';

export function buildGeometry(node: CsgNode): Manifold | null {
  // Cache hit: not dirty and has manifold
  if (!node.dirty && node.manifold) {
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
    const m = buildGeometry(child);
    if (m) childManifolds.push(m);
  }

  let result: Manifold | null = null;

  switch (node.type) {
    // --- Primitives ---
    case 'cube': {
      const size = normalizeVec3(node.props.size, [1, 1, 1]);
      const center = node.props.center ?? true;
      result = M.cube(size, center as boolean);
      break;
    }

    case 'sphere': {
      const radius = (node.props.radius as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      result = M.sphere(radius, segments);
      break;
    }

    case 'cylinder': {
      const radiusLow = (node.props.radius as number) ?? (node.props.radiusLow as number) ?? 1;
      const radiusHigh = (node.props.radiusHigh as number) ?? radiusLow;
      const height = (node.props.height as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      const center = node.props.center ?? true;
      result = M.cylinder(height, radiusLow, radiusHigh, segments, center as boolean);
      break;
    }

    case 'extrude': {
      const polygon = node.props.polygon as [number, number][];
      const height = (node.props.height as number) ?? 1;
      if (polygon && polygon.length >= 3) {
        const crossSection = new CrossSection([polygon], 'Positive');
        result = M.extrude(crossSection, height);
        crossSection.delete();
      }
      break;
    }

    // --- Boolean Operations ---
    // NOTE: Single-child cases use identity transform to create a copy,
    // avoiding shared ownership with child (which would cause double-free)
    case 'union': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        // Create copy via identity transform to avoid shared ownership
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        result = M.union(childManifolds);
      }
      break;
    }

    case 'difference': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        const [first, ...rest] = childManifolds;
        // Create temporary union, use it, then dispose
        const restUnion = M.union(rest);
        result = first.subtract(restUnion);
        restUnion.delete();
      }
      break;
    }

    case 'intersection': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else {
        result = M.intersection(childManifolds);
      }
      break;
    }

    // --- Transforms ---
    case 'translate': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ['x', 'y', 'z']);
        result = childManifolds[0].translate(v);
      }
      break;
    }

    case 'rotate': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ['x', 'y', 'z']);
        result = childManifolds[0].rotate(v);
      }
      break;
    }

    case 'scale': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [1, 1, 1], ['x', 'y', 'z']);
        result = childManifolds[0].scale(v);
      }
      break;
    }

    // --- Group (passthrough) ---
    case 'group': {
      if (childManifolds.length === 1) {
        result = childManifolds[0].translate([0, 0, 0]);
      } else if (childManifolds.length > 1) {
        result = M.union(childManifolds);
      }
      break;
    }
  }

  node.manifold = result;
  node.dirty = false;

  return result;
}

// --- Helpers ---

function normalizeVec3(
  input: unknown,
  defaultValue: [number, number, number],
  keys: [string, string, string] = ['0', '1', '2']
): [number, number, number] {
  if (Array.isArray(input)) {
    return [
      input[0] ?? defaultValue[0],
      input[1] ?? defaultValue[1],
      input[2] ?? defaultValue[2],
    ];
  }

  if (typeof input === 'number') {
    return [input, input, input];
  }

  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    return [
      (obj[keys[0]] as number) ?? defaultValue[0],
      (obj[keys[1]] as number) ?? defaultValue[1],
      (obj[keys[2]] as number) ?? defaultValue[2],
    ];
  }

  return defaultValue;
}
