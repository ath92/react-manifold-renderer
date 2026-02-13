import { describe, it, expect, beforeAll } from "vitest";
import { buildGeometry, type OriginalIdMap } from "./geometry-builder";
import { createNode, markDirty } from "./nodes";
import { initManifold } from "../manifold-module";

beforeAll(async () => {
  await initManifold();
});

describe("buildGeometry idMap population", () => {
  it("populates idMap for all primitives on first build", () => {
    const union = createNode("union", {});
    const cubeA = createNode("cube", { nodeId: "cube-a", size: [1, 1, 1] });
    const cubeB = createNode("cube", { nodeId: "cube-b", size: [2, 2, 2] });

    union.children = [cubeA, cubeB];
    cubeA.parent = union;
    cubeB.parent = union;

    const idMap: OriginalIdMap = new Map();
    const result = buildGeometry(union, idMap);

    expect(result).not.toBeNull();
    // Both primitives should be in the idMap
    const values = [...idMap.values()];
    expect(values).toContain("cube-a");
    expect(values).toContain("cube-b");
    expect(idMap.size).toBe(2);
  });

  it("loses cached primitive mappings when rebuilding with a fresh idMap", () => {
    // --- Build 1: two cubes, everything dirty ---
    const union = createNode("union", {});
    const cubeA = createNode("cube", { nodeId: "cube-a", size: [1, 1, 1] });
    const cubeB = createNode("cube", { nodeId: "cube-b", size: [2, 2, 2] });

    union.children = [cubeA, cubeB];
    cubeA.parent = union;
    cubeB.parent = union;

    const idMap1: OriginalIdMap = new Map();
    buildGeometry(union, idMap1);

    // Sanity: both mapped after first build
    expect([...idMap1.values()]).toContain("cube-a");
    expect([...idMap1.values()]).toContain("cube-b");

    // --- Build 2: add a new cube, only mark parent dirty ---
    // This simulates what the reconciler does: appendChild marks parent dirty,
    // but existing siblings (cubeA, cubeB) stay non-dirty with cached manifolds.
    const cubeC = createNode("cube", { nodeId: "cube-c", size: [3, 3, 3] });
    union.children.push(cubeC);
    cubeC.parent = union;
    markDirty(union); // only union + cubeC are dirty; cubeA/cubeB are cached

    const idMap2: OriginalIdMap = new Map();
    buildGeometry(union, idMap2);

    const values2 = [...idMap2.values()];

    // cubeC should always be present (it was dirty and rebuilt)
    expect(values2).toContain("cube-c");

    // BUG: cubeA and cubeB are NOT in idMap2 because they were cached (not dirty)
    // and buildGeometry returned early without re-registering their originalID.
    // This causes `buildTriNodeIdMap` to produce `undefined` for their triangles,
    // breaking face-click selection for those shapes.
    //
    // When this bug is fixed, this test should pass. Until then, this documents
    // the failure: the idMap is incomplete after a partial rebuild.
    expect(values2).toContain("cube-a");
    expect(values2).toContain("cube-b");
    expect(idMap2.size).toBe(3);
  });
});
