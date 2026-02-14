/**
 * Test simulating the dual-CsgRoot scenario from the real app:
 * - Main CsgRoot renders the full tree
 * - SelectionOverlay CsgRoot renders a subtree (selected node)
 *
 * Both use the same reconciler but have separate containers/idMaps.
 * The question is: can they interfere with each other?
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import React from "react";
import { initManifold, setWasmPath } from "../manifold-module";
import { buildTriNodeIdMap } from "../three";
import type { OriginalIdMap } from "../reconciler/geometry-builder";
import type { Mesh } from "manifold-3d";
import { reconciler } from "../reconciler";
import type { Container } from "../reconciler/host-config";

beforeAll(async () => {
  setWasmPath(
    resolve(
      __dirname,
      "../../../../node_modules/.pnpm/manifold-3d@3.3.2/node_modules/manifold-3d/manifold.wasm",
    ),
  );
  await initManifold();
});

function translateMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

function createFiber(): {
  container: Container;
  fiber: any;
  waitForMesh: () => Promise<{ mesh: Mesh; idMap: OriginalIdMap }>;
} {
  let resolveMesh: (val: { mesh: Mesh; idMap: OriginalIdMap }) => void;
  let meshPromise: Promise<{ mesh: Mesh; idMap: OriginalIdMap }>;

  function resetPromise() {
    meshPromise = new Promise((resolve) => {
      resolveMesh = resolve;
    });
  }
  resetPromise();

  const container: Container = {
    root: null,
    onMesh: (mesh: Mesh, idMap: OriginalIdMap) => {
      resolveMesh({ mesh, idMap });
      resetPromise();
    },
    onError: (err: Error) => {
      throw err;
    },
    idMap: new Map(),
  };

  const fiber = reconciler.createContainer(
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

  return {
    container,
    fiber,
    waitForMesh: () => meshPromise!,
  };
}

describe("dual CsgRoot interference", () => {
  it("two containers processing same tree — main idMap stays correct", async () => {
    const main = createFiber();
    const selection = createFiber();

    // Full tree: union( transform(cubeA), transform(cubeB) )
    const fullTree = React.createElement(
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

    // Selection subtree: just cubeA (no transform — stripped by SelectionOverlay)
    const selTree = React.createElement("cube" as any, {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });

    // === Initial build: render both containers ===
    reconciler.updateContainer(fullTree, main.fiber, null, () => {});
    reconciler.updateContainer(selTree, selection.fiber, null, () => {});

    const { mesh: mesh1, idMap: idMap1 } = await main.waitForMesh();

    console.log("=== Initial build (main) ===");
    console.log("main idMap:", Object.fromEntries(idMap1));
    console.log("runOriginalID:", Array.from(mesh1.runOriginalID ?? []));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // === Second build: change tA's matrix (simulating gizmo drag) ===
    // Both containers re-render simultaneously
    const fullTree2 = React.createElement(
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

    // Selection still renders cubeA
    const selTree2 = React.createElement("cube" as any, {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });

    // Update both containers (simulates React commit for both CsgRoots)
    reconciler.updateContainer(fullTree2, main.fiber, null, () => {});
    reconciler.updateContainer(selTree2, selection.fiber, null, () => {});

    const { mesh: mesh2, idMap: idMap2 } = await main.waitForMesh();

    console.log("\n=== Second build (main, after matrix change) ===");
    console.log("main idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undefinedCount = triMap2.filter((id) => id === undefined).length;
    console.log("triMap undefined:", undefinedCount);

    expect(undefinedCount).toBe(0);
  });

  it("type change with simultaneous selection rebuild", async () => {
    const main = createFiber();
    const selection = createFiber();

    // Initial: main has union(cubeA, transform(cubeB)), selection renders cubeA
    const fullTree1 = React.createElement(
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

    const selTree1 = React.createElement("cube" as any, {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });

    reconciler.updateContainer(fullTree1, main.fiber, null, () => {});
    reconciler.updateContainer(selTree1, selection.fiber, null, () => {});

    const { mesh: mesh1, idMap: idMap1 } = await main.waitForMesh();
    console.log("=== Initial build (main) ===");
    console.log("main idMap:", Object.fromEntries(idMap1));
    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Second render: childA changes type from cube to transform(cube)
    const fullTree2 = React.createElement(
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

    // Selection also rebuilds (maybe the selected subtree changed)
    const selTree2 = React.createElement("cube" as any, {
      size: [1, 1, 1],
      center: true,
      nodeId: "A",
    });

    reconciler.updateContainer(fullTree2, main.fiber, null, () => {});
    reconciler.updateContainer(selTree2, selection.fiber, null, () => {});

    const { mesh: mesh2, idMap: idMap2 } = await main.waitForMesh();

    console.log("\n=== Second build (main, type change) ===");
    console.log("main idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undefinedCount = triMap2.filter((id) => id === undefined).length;
    console.log("triMap undefined:", undefinedCount);

    expect(undefinedCount).toBe(0);
  });
});
