import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import { initManifold, setWasmPath } from "../manifold-module";
import { buildGeometry, type OriginalIdMap } from "../reconciler/geometry-builder";
import { createNode, markDirty } from "../reconciler/nodes";
import { buildTriNodeIdMap } from "../three";
import type { CsgNode } from "../types";

// Point to the WASM binary so Node can load it
beforeAll(async () => {
  setWasmPath(
    resolve(
      __dirname,
      "../../../../node_modules/.pnpm/manifold-3d@3.3.2/node_modules/manifold-3d/manifold.wasm",
    ),
  );
  await initManifold();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCube(nodeId: string): CsgNode {
  return createNode("cube", { size: [1, 1, 1], center: true, nodeId });
}

function makeUnion(children: CsgNode[]): CsgNode {
  const node = createNode("union", {});
  for (const child of children) {
    child.parent = node;
    node.children.push(child);
  }
  return node;
}

function makeTransform(matrix: number[], child: CsgNode): CsgNode {
  const node = createNode("transform", { matrix });
  child.parent = node;
  node.children.push(child);
  return node;
}

// prettier-ignore
const IDENTITY: number[] = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function translateMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("buildGeometry + idMap", () => {
  it("maps every triangle in a single cube", () => {
    const cube = makeCube("cubeA");
    const idMap: OriginalIdMap = new Map();

    buildGeometry(cube, idMap);
    expect(cube.manifold).not.toBeNull();

    const mesh = cube.manifold!.getMesh();
    const triMap = buildTriNodeIdMap(mesh, idMap);
    const numTri = mesh.triVerts.length / 3;

    expect(numTri).toBeGreaterThan(0);
    expect(triMap.length).toBe(numTri);
    for (let i = 0; i < numTri; i++) {
      expect(triMap[i]).toBe("cubeA");
    }
  });

  it("maps every triangle in a union of two cubes", () => {
    const cubeA = makeCube("cubeA");
    const cubeB = makeCube("cubeB");
    const union = makeUnion([cubeA, cubeB]);
    const idMap: OriginalIdMap = new Map();

    buildGeometry(union, idMap);
    expect(union.manifold).not.toBeNull();

    const mesh = union.manifold!.getMesh();
    const triMap = buildTriNodeIdMap(mesh, idMap);
    const numTri = mesh.triVerts.length / 3;

    expect(numTri).toBeGreaterThan(0);
    expect(triMap.length).toBe(numTri);

    const allMapped = triMap.every((id) => id === "cubeA" || id === "cubeB");
    expect(allMapped).toBe(true);

    // Both cubes should be represented
    expect(triMap.some((id) => id === "cubeA")).toBe(true);
    expect(triMap.some((id) => id === "cubeB")).toBe(true);
  });

  it("maps every triangle after a transform is added to one child", () => {
    // Initial build: union(cubeA, cubeB)
    const cubeA = makeCube("cubeA");
    const cubeB = makeCube("cubeB");
    const union = makeUnion([cubeA, cubeB]);
    const idMap: OriginalIdMap = new Map();

    buildGeometry(union, idMap);
    expect(union.manifold).not.toBeNull();

    // Simulate what the reconciler does when CsgTreeRenderer wraps cubeA in
    // <Transform>: remove cubeA from union, create a transform node wrapping a
    // NEW cubeA, and add the transform to the union.
    //
    // 1. Remove old cubeA
    union.children.splice(0, 1);
    if (cubeA.manifold) {
      cubeA.manifold.delete();
      cubeA.manifold = null;
    }

    // 2. Create fresh transform(cubeA_new)
    const cubeA2 = makeCube("cubeA");
    const transform = makeTransform(translateMatrix(5, 0, 0), cubeA2);
    transform.parent = union;
    union.children.unshift(transform);

    // 3. Mark dirty up from the new transform
    markDirty(transform);

    // Clear idMap as host-config now does
    idMap.clear();

    // 4. Rebuild
    buildGeometry(union, idMap);
    expect(union.manifold).not.toBeNull();

    const mesh = union.manifold!.getMesh();
    const triMap = buildTriNodeIdMap(mesh, idMap);
    const numTri = mesh.triVerts.length / 3;

    expect(numTri).toBeGreaterThan(0);
    expect(triMap.length).toBe(numTri);

    const undefinedCount = triMap.filter((id) => id === undefined).length;
    expect(undefinedCount).toBe(0);

    const allMapped = triMap.every((id) => id === "cubeA" || id === "cubeB");
    expect(allMapped).toBe(true);
  });

  it("maps every triangle when only the transform matrix changes (second edit)", () => {
    // Build: union(transform(cubeA), cubeB)
    const cubeA = makeCube("cubeA");
    const transform = makeTransform(translateMatrix(5, 0, 0), cubeA);
    const cubeB = makeCube("cubeB");
    const union = makeUnion([transform, cubeB]);
    const idMap: OriginalIdMap = new Map();

    buildGeometry(union, idMap);
    expect(union.manifold).not.toBeNull();

    // Verify initial build
    {
      const mesh = union.manifold!.getMesh();
      const triMap = buildTriNodeIdMap(mesh, idMap);
      const undefinedCount = triMap.filter((id) => id === undefined).length;
      expect(undefinedCount).toBe(0);
    }

    // Simulate commitUpdate on the transform node: new matrix, manifold deleted
    if (transform.manifold) {
      transform.manifold.delete();
      transform.manifold = null;
    }
    transform.props = { matrix: translateMatrix(10, 0, 0) };
    markDirty(transform);

    // Clear idMap as host-config now does
    idMap.clear();

    // Rebuild
    buildGeometry(union, idMap);
    expect(union.manifold).not.toBeNull();

    const mesh = union.manifold!.getMesh();
    const triMap = buildTriNodeIdMap(mesh, idMap);
    const numTri = mesh.triVerts.length / 3;

    expect(numTri).toBeGreaterThan(0);
    const undefinedCount = triMap.filter((id) => id === undefined).length;
    expect(undefinedCount).toBe(0);

    const allMapped = triMap.every((id) => id === "cubeA" || id === "cubeB");
    expect(allMapped).toBe(true);
  });

  it("cached primitive re-registers its originalID in a fresh idMap", () => {
    const cube = makeCube("cubeA");
    const idMap: OriginalIdMap = new Map();

    buildGeometry(cube, idMap);
    const origId = cube.manifold!.originalID();
    expect(idMap.get(origId)).toBe("cubeA");

    // Clear the map (simulating what resetAfterCommit does)
    idMap.clear();
    expect(idMap.size).toBe(0);

    // Re-run buildGeometry — cube is NOT dirty, should hit cache
    expect(cube.dirty).toBe(false);
    buildGeometry(cube, idMap);

    // Should be re-registered
    expect(idMap.get(origId)).toBe("cubeA");
  });
});
