/**
 * Tests that simulate the actual reconciler flow more faithfully.
 *
 * Key reconciler methods:
 *   createInstance(type, props) → CsgNode (dirty=true, manifold=null)
 *   appendChild(parent, child)  → push child, markDirty(parent)
 *   removeChild(parent, child)  → splice child, markDirty(parent), disposeNode(child)
 *   commitUpdate(instance, ...)  → delete manifold, set new props, markDirty(instance)
 *   resetAfterCommit(container) → buildGeometry(root, idMap), onMesh(mesh, idMap)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import { initManifold, setWasmPath } from "../manifold-module";
import {
  buildGeometry,
  type OriginalIdMap,
} from "../reconciler/geometry-builder";
import { createNode, markDirty, disposeNode } from "../reconciler/nodes";
import { buildTriNodeIdMap } from "../three";
import type { CsgNode } from "../types";

beforeAll(async () => {
  setWasmPath(
    resolve(
      __dirname,
      "../../../../node_modules/.pnpm/manifold-3d@3.3.2/node_modules/manifold-3d/manifold.wasm",
    ),
  );
  await initManifold();
});

// ── Reconciler-like helpers ──────────────────────────────────────────────────

function createInstance(
  type: string,
  props: Record<string, unknown>,
): CsgNode {
  return createNode(type as any, props);
}

function appendChild(parent: CsgNode, child: CsgNode): void {
  child.parent = parent;
  parent.children.push(child);
  markDirty(parent);
}

function removeChild(parent: CsgNode, child: CsgNode): void {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
  child.parent = null;
  markDirty(parent);
  disposeNode(child);
}

function insertBefore(
  parent: CsgNode,
  child: CsgNode,
  before: CsgNode,
): void {
  child.parent = parent;
  const index = parent.children.indexOf(before);
  if (index !== -1) parent.children.splice(index, 0, child);
  else parent.children.push(child);
  markDirty(parent);
}

function commitUpdate(
  instance: CsgNode,
  newProps: Record<string, unknown>,
): void {
  if (instance.manifold) {
    instance.manifold.delete();
    instance.manifold = null;
  }
  instance.props = newProps;
  markDirty(instance);
}

function resetAfterCommit(
  root: CsgNode,
  idMap: OriginalIdMap,
): ReturnType<typeof buildTriNodeIdMap> | null {
  if (root.dirty) {
    buildGeometry(root, idMap);
    if (root.manifold) {
      const mesh = root.manifold.getMesh();
      return buildTriNodeIdMap(mesh, idMap);
    }
  }
  return null;
}

function translateMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

function assertAllMapped(triMap: (string | undefined)[]): void {
  const numTri = triMap.length;
  expect(numTri).toBeGreaterThan(0);
  const undefinedCount = triMap.filter((id) => id === undefined).length;
  expect(undefinedCount).toBe(0);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("reconciler-like flow", () => {
  it("initial build: union of two separated cubes has all tris mapped", () => {
    // Build tree: union( transform(cubeA), transform(cubeB) )
    const idMap: OriginalIdMap = new Map();

    const union = createInstance("union", {});
    const tA = createInstance("transform", {
      matrix: translateMatrix(-5, 0, 0),
    });
    const cubeA = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });
    const tB = createInstance("transform", {
      matrix: translateMatrix(5, 0, 0),
    });
    const cubeB = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "B",
    });

    // appendInitialChild (no markDirty — they're already dirty from creation)
    cubeA.parent = tA;
    tA.children.push(cubeA);
    cubeB.parent = tB;
    tB.children.push(cubeB);
    tA.parent = union;
    union.children.push(tA);
    tB.parent = union;
    union.children.push(tB);

    const triMap = resetAfterCommit(union, idMap);
    expect(triMap).not.toBeNull();
    assertAllMapped(triMap!);
    expect(triMap!.some((id) => id === "A")).toBe(true);
    expect(triMap!.some((id) => id === "B")).toBe(true);
  });

  it("commitUpdate on transform matrix — second edit keeps all tris mapped", () => {
    const idMap: OriginalIdMap = new Map();

    // Initial tree: union( transform(cubeA), transform(cubeB) )
    const union = createInstance("union", {});
    const tA = createInstance("transform", {
      matrix: translateMatrix(-5, 0, 0),
    });
    const cubeA = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });
    const tB = createInstance("transform", {
      matrix: translateMatrix(5, 0, 0),
    });
    const cubeB = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "B",
    });

    cubeA.parent = tA;
    tA.children.push(cubeA);
    cubeB.parent = tB;
    tB.children.push(cubeB);
    tA.parent = union;
    union.children.push(tA);
    tB.parent = union;
    union.children.push(tB);

    // Initial commit
    const triMap1 = resetAfterCommit(union, idMap);
    expect(triMap1).not.toBeNull();
    assertAllMapped(triMap1!);

    console.log("=== After initial build ===");
    console.log("idMap:", Object.fromEntries(idMap));

    // Now: commitUpdate on tA (matrix changes)
    commitUpdate(tA, { matrix: translateMatrix(-10, 0, 0) });

    console.log("\n=== After commitUpdate on tA ===");
    console.log("union dirty:", union.dirty);
    console.log("tA dirty:", tA.dirty);
    console.log("cubeA dirty:", cubeA.dirty);
    console.log("tB dirty:", tB.dirty);
    console.log("cubeB dirty:", cubeB.dirty);
    console.log("cubeA.manifold:", cubeA.manifold != null);
    console.log("cubeB.manifold:", cubeB.manifold != null);

    const triMap2 = resetAfterCommit(union, idMap);
    expect(triMap2).not.toBeNull();

    console.log("\n=== After second build ===");
    console.log("idMap:", Object.fromEntries(idMap));
    const mesh = union.manifold!.getMesh();
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));

    const undefinedCount = triMap2!.filter((id) => id === undefined).length;
    console.log("triMap undefined count:", undefinedCount);
    console.log("triMap total:", triMap2!.length);

    assertAllMapped(triMap2!);
  });

  it("type change: bare cube → transform(cube) — first edit wrapping", () => {
    const idMap: OriginalIdMap = new Map();

    // Initial tree: union( cubeA, transform(cubeB) )
    // cubeA has NO transform wrapper initially
    const union = createInstance("union", {});
    const cubeA = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });
    const tB = createInstance("transform", {
      matrix: translateMatrix(5, 0, 0),
    });
    const cubeB = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "B",
    });

    cubeA.parent = union;
    union.children.push(cubeA);
    cubeB.parent = tB;
    tB.children.push(cubeB);
    tB.parent = union;
    union.children.push(tB);

    // Initial commit
    const triMap1 = resetAfterCommit(union, idMap);
    expect(triMap1).not.toBeNull();
    assertAllMapped(triMap1!);

    console.log("=== After initial build (bare cubeA) ===");
    console.log("idMap:", Object.fromEntries(idMap));

    // Now simulate: type changed from "cube" to "transform" at position 0
    // Reconciler does: removeChild(union, cubeA) then appendChild(union, tA)
    // where tA is a new transform wrapping a new cubeA
    const firstChild = union.children[0]; // cubeA
    removeChild(union, firstChild);

    const tA = createInstance("transform", {
      matrix: translateMatrix(-3, 0, 0),
    });
    const cubeA2 = createInstance("cube", {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });
    cubeA2.parent = tA;
    tA.children.push(cubeA2);

    // insertBefore so it goes in position 0
    insertBefore(union, tA, union.children[0]);

    console.log("\n=== After reconciler mutations ===");
    console.log("union dirty:", union.dirty);
    console.log("idMap before rebuild:", Object.fromEntries(idMap));

    const triMap2 = resetAfterCommit(union, idMap);
    expect(triMap2).not.toBeNull();

    console.log("\n=== After second build (wrapped cubeA) ===");
    console.log("idMap:", Object.fromEntries(idMap));
    const mesh = union.manifold!.getMesh();
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));
    const undefinedCount = triMap2!.filter((id) => id === undefined).length;
    console.log("triMap undefined count:", undefinedCount);
    console.log("triMap total:", triMap2!.length);

    assertAllMapped(triMap2!);
  });
});
