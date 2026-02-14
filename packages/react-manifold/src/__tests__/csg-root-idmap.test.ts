/**
 * Integration test using actual CsgRoot + reconciler to verify idMap behavior.
 * Uses a minimal React render loop to drive the reconciler.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import React from "react";
import { initManifold, setWasmPath } from "../manifold-module";
import { CsgRoot } from "../components";
import { buildTriNodeIdMap } from "../three";
import type { OriginalIdMap } from "../reconciler/geometry-builder";
import type { Mesh } from "manifold-3d";
import { reconciler } from "../reconciler";

beforeAll(async () => {
  setWasmPath(
    resolve(
      __dirname,
      "../../../../node_modules/.pnpm/manifold-3d@3.3.2/node_modules/manifold-3d/manifold.wasm",
    ),
  );
  await initManifold();
});

// prettier-ignore
function translateMatrix(x: number, y: number, z: number): number[] {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

/**
 * Render CsgRoot with given children using the reconciler directly,
 * bypassing React DOM. Returns a promise that resolves when onMesh fires.
 */
function renderCsg(
  children: React.ReactNode,
  existingFiber?: any,
  existingContainer?: any,
): {
  meshPromise: Promise<{ mesh: Mesh; idMap: OriginalIdMap }>;
  fiber: any;
  container: any;
} {
  let resolveMesh: (val: { mesh: Mesh; idMap: OriginalIdMap }) => void;
  const meshPromise = new Promise<{ mesh: Mesh; idMap: OriginalIdMap }>(
    (resolve) => {
      resolveMesh = resolve;
    },
  );

  const container = existingContainer ?? {
    root: null,
    onMesh: (mesh: Mesh, idMap: OriginalIdMap) => resolveMesh({ mesh, idMap }),
    onError: (err: Error) => {
      throw err;
    },
    idMap: new Map(),
  };

  // Update onMesh to resolve the NEW promise
  if (existingContainer) {
    container.onMesh = (mesh: Mesh, idMap: OriginalIdMap) =>
      resolveMesh({ mesh, idMap });
  }

  const fiber =
    existingFiber ??
    reconciler.createContainer(
      container,
      0,
      null,
      false,
      null,
      "test",
      (e: Error) => {
        throw e;
      },
      (e: Error) => {
        throw e;
      },
      (e: Error) => {
        throw e;
      },
      () => {},
    );

  reconciler.updateContainer(children, fiber, null, () => {});

  return { meshPromise, fiber, container };
}

describe("CsgRoot idMap via real reconciler", () => {
  it("initial: union of two separated cubes — all tris mapped", async () => {
    const children = React.createElement(
      "union" as any,
      null,
      React.createElement("transform" as any, {
        matrix: translateMatrix(-5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "A",
        }),
      }),
      React.createElement("transform" as any, {
        matrix: translateMatrix(5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "B",
        }),
      }),
    );

    const { meshPromise } = renderCsg(children);
    const { mesh, idMap } = await meshPromise;

    console.log("=== Initial build ===");
    console.log("idMap:", Object.fromEntries(idMap));
    console.log("runOriginalID:", Array.from(mesh.runOriginalID ?? []));

    const triMap = buildTriNodeIdMap(mesh, idMap);
    const undefinedCount = triMap.filter((id) => id === undefined).length;
    expect(undefinedCount).toBe(0);
    expect(triMap.some((id) => id === "A")).toBe(true);
    expect(triMap.some((id) => id === "B")).toBe(true);
  });

  it("commitUpdate: change transform matrix — all tris still mapped", async () => {
    // Initial render
    const children1 = React.createElement(
      "union" as any,
      null,
      React.createElement("transform" as any, {
        key: "tA",
        matrix: translateMatrix(-5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "A",
        }),
      }),
      React.createElement("transform" as any, {
        key: "tB",
        matrix: translateMatrix(5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "B",
        }),
      }),
    );

    const { meshPromise: mp1, fiber, container } = renderCsg(children1);
    const { mesh: mesh1, idMap: idMap1 } = await mp1;

    console.log("=== After initial build ===");
    console.log("idMap:", Object.fromEntries(idMap1));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Second render: change tA's matrix
    const children2 = React.createElement(
      "union" as any,
      null,
      React.createElement("transform" as any, {
        key: "tA",
        matrix: translateMatrix(-10, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "A",
        }),
      }),
      React.createElement("transform" as any, {
        key: "tB",
        matrix: translateMatrix(5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "B",
        }),
      }),
    );

    const { meshPromise: mp2 } = renderCsg(children2, fiber, container);
    const { mesh: mesh2, idMap: idMap2 } = await mp2;

    console.log("\n=== After second build (matrix change) ===");
    console.log("idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undefinedCount = triMap2.filter((id) => id === undefined).length;
    console.log("triMap undefined:", undefinedCount);
    console.log("triMap total:", triMap2.length);

    expect(undefinedCount).toBe(0);
  });

  it("type change: bare cube becomes transform(cube)", async () => {
    // Initial: union( cube(A), transform(cube(B)) )
    const children1 = React.createElement(
      "union" as any,
      null,
      React.createElement("cube" as any, {
        key: "childA",
        size: [1, 1, 1],
        center: true,
        nodeId: "A",
      }),
      React.createElement("transform" as any, {
        key: "childB",
        matrix: translateMatrix(5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "B",
        }),
      }),
    );

    const { meshPromise: mp1, fiber, container } = renderCsg(children1);
    const { mesh: mesh1, idMap: idMap1 } = await mp1;

    console.log("=== After initial build (bare cubeA) ===");
    console.log("idMap:", Object.fromEntries(idMap1));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Second render: A is now wrapped in transform — element TYPE changed
    // at key="childA" from "cube" to "transform"
    const children2 = React.createElement(
      "union" as any,
      null,
      React.createElement("transform" as any, {
        key: "childA",
        matrix: translateMatrix(-3, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "A",
        }),
      }),
      React.createElement("transform" as any, {
        key: "childB",
        matrix: translateMatrix(5, 0, 0),
        children: React.createElement("cube" as any, {
          size: [1, 1, 1],
          center: true,
          nodeId: "B",
        }),
      }),
    );

    const { meshPromise: mp2 } = renderCsg(children2, fiber, container);
    const { mesh: mesh2, idMap: idMap2 } = await mp2;

    console.log("\n=== After second build (wrapped cubeA) ===");
    console.log("idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undefinedCount = triMap2.filter((id) => id === undefined).length;
    console.log("triMap undefined:", undefinedCount);

    expect(undefinedCount).toBe(0);
  });
});
