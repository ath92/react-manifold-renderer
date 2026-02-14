import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import { initManifold, setWasmPath, getManifold } from "../manifold-module";
import {
  buildGeometry,
  type OriginalIdMap,
} from "../reconciler/geometry-builder";
import { createNode, markDirty } from "../reconciler/nodes";
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

function makeCube(nodeId: string, size?: [number, number, number]): CsgNode {
  return createNode("cube", { size: size ?? [1, 1, 1], center: true, nodeId });
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

function translateMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

describe("debug: raw mesh run data", () => {
  it("single cube — inspect runOriginalID", () => {
    const cube = makeCube("cubeA");
    const idMap: OriginalIdMap = new Map();
    buildGeometry(cube, idMap);

    const mesh = cube.manifold!.getMesh();
    console.log("=== Single cube ===");
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("numTri:", mesh.triVerts.length / 3);
    console.log("runIndex:", Array.from(mesh.runIndex ?? []));
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));
    console.log("originalID():", cube.manifold!.originalID());
  });

  it("union of two identical cubes — inspect runOriginalID", () => {
    const cubeA = makeCube("cubeA");
    const cubeB = makeCube("cubeB");
    const union = makeUnion([cubeA, cubeB]);
    const idMap: OriginalIdMap = new Map();
    buildGeometry(union, idMap);

    console.log("=== Union of two identical cubes ===");
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("cubeA originalID:", cubeA.manifold!.originalID());
    console.log("cubeB originalID:", cubeB.manifold!.originalID());

    const mesh = union.manifold!.getMesh();
    console.log("numTri:", mesh.triVerts.length / 3);
    console.log("runIndex:", Array.from(mesh.runIndex ?? []));
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));

    const triMap = buildTriNodeIdMap(mesh, idMap);
    const counts: Record<string, number> = {};
    let undefinedCount = 0;
    for (const id of triMap) {
      if (id === undefined) undefinedCount++;
      else counts[id] = (counts[id] ?? 0) + 1;
    }
    console.log("triMap counts:", counts);
    console.log("triMap undefined:", undefinedCount);
  });

  it("union of two SEPARATED cubes — inspect runOriginalID", () => {
    // Put cubes far apart so the boolean op can't merge any faces
    const cubeA = makeCube("cubeA", [1, 1, 1]);
    const cubeB = makeCube("cubeB", [1, 1, 1]);
    const transformB = makeTransform(translateMatrix(10, 0, 0), cubeB);
    const union = makeUnion([cubeA, transformB]);
    const idMap: OriginalIdMap = new Map();
    buildGeometry(union, idMap);

    console.log("=== Union of two SEPARATED cubes ===");
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("cubeA originalID:", cubeA.manifold!.originalID());
    console.log("cubeB originalID:", cubeB.manifold!.originalID());

    const mesh = union.manifold!.getMesh();
    console.log("numTri:", mesh.triVerts.length / 3);
    console.log("runIndex:", Array.from(mesh.runIndex ?? []));
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));

    const triMap = buildTriNodeIdMap(mesh, idMap);
    const counts: Record<string, number> = {};
    let undefinedCount = 0;
    for (const id of triMap) {
      if (id === undefined) undefinedCount++;
      else counts[id] = (counts[id] ?? 0) + 1;
    }
    console.log("triMap counts:", counts);
    console.log("triMap undefined:", undefinedCount);
  });

  it("transform-add scenario — inspect what is missing", () => {
    // Initial build: union(cubeA, cubeB) — separated
    const cubeA = makeCube("cubeA");
    const cubeB = makeCube("cubeB");
    const transformB = makeTransform(translateMatrix(10, 0, 0), cubeB);
    const union = makeUnion([cubeA, transformB]);
    const idMap: OriginalIdMap = new Map();

    buildGeometry(union, idMap);
    console.log("=== After initial build ===");
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("cubeA originalID:", cubeA.manifold!.originalID());
    console.log("cubeB originalID:", cubeB.manifold!.originalID());

    // Now simulate: remove cubeA, add transform(cubeA2) in its place
    union.children.splice(0, 1);
    if (cubeA.manifold) {
      cubeA.manifold.delete();
      cubeA.manifold = null;
    }

    const cubeA2 = makeCube("cubeA");
    const transformA = makeTransform(translateMatrix(5, 0, 0), cubeA2);
    transformA.parent = union;
    union.children.unshift(transformA);
    // The reconciler calls markDirty(parent) from appendChild/removeChild
    markDirty(union);

    // Clear idMap
    idMap.clear();

    console.log("\n=== Before transform-add rebuild ===");
    console.log("union dirty:", union.dirty);
    console.log(
      "union children:",
      union.children.map((c) => c.type),
    );
    console.log("transformA dirty:", transformA.dirty);
    console.log("cubeA2 dirty:", cubeA2.dirty);
    console.log("transformB dirty:", transformB.dirty);
    console.log("cubeB dirty:", cubeB.dirty);
    console.log("cubeB.manifold exists:", cubeB.manifold != null);
    console.log("transformB.manifold exists:", transformB.manifold != null);

    const result = buildGeometry(union, idMap);
    console.log("\n=== After transform-add rebuild ===");
    console.log("buildGeometry result:", result != null);
    console.log("union.manifold:", union.manifold != null);
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("cubeA2.manifold:", cubeA2.manifold != null);
    console.log("cubeB.manifold:", cubeB.manifold != null);
    console.log("transformA.manifold:", transformA.manifold != null);
    console.log("transformB.manifold:", transformB.manifold != null);

    const mesh = union.manifold!.getMesh();
    console.log("numTri:", mesh.triVerts.length / 3);
    console.log("runIndex:", Array.from(mesh.runIndex ?? []));
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));

    const triMap = buildTriNodeIdMap(mesh, idMap);
    const counts: Record<string, number> = {};
    let undefinedCount = 0;
    for (const id of triMap) {
      if (id === undefined) undefinedCount++;
      else counts[id] = (counts[id] ?? 0) + 1;
    }
    console.log("triMap counts:", counts);
    console.log("triMap undefined:", undefinedCount);

    // Also check: which runOriginalIDs are NOT in the idMap?
    const missingIds = new Set<number>();
    for (const id of mesh.runOriginalID ?? []) {
      if (!idMap.has(id)) missingIds.add(id);
    }
    console.log("runOriginalIDs missing from idMap:", Array.from(missingIds));
  });
});
