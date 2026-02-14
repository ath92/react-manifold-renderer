/**
 * Test that simulates the exact CsgTreeRenderer output structure.
 * CsgTreeRenderer wraps host elements in <Transform> when node.matrix is set.
 * This test replicates that conditional wrapping pattern.
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

// Minimal CsgTreeNode type matching the app's type
interface TreeNode {
  id: string;
  type: string;
  matrix?: number[];
  size?: [number, number, number];
  center?: boolean;
  children?: TreeNode[];
}

// Replicate CsgTreeRenderer exactly
function CsgTreeRenderer({ node }: { node: TreeNode }): React.ReactElement {
  const children =
    node.children?.map((child, i) =>
      React.createElement(CsgTreeRenderer, { key: i, node: child }),
    ) ?? undefined;

  let element: React.ReactElement;

  switch (node.type) {
    case "cube":
      element = React.createElement("cube" as any, {
        size: node.size,
        center: node.center,
        nodeId: node.id,
      });
      break;
    case "union":
      element = React.createElement("union" as any, null, ...(children ?? []));
      break;
    case "difference":
      element = React.createElement(
        "difference" as any,
        null,
        ...(children ?? []),
      );
      break;
    default:
      element = React.createElement(
        "group" as any,
        null,
        ...(children ?? []),
      );
  }

  // This is the key pattern: wrap with Transform when matrix is set
  if (node.matrix) {
    return React.createElement(
      "transform" as any,
      { matrix: node.matrix },
      element,
    );
  }

  return element;
}

describe("CsgTreeRenderer pattern", () => {
  it("adding matrix to a union child — first edit", async () => {
    const { fiber, container, waitForMesh } = createFiber();

    // Initial tree: difference( cubeA @ origin, cubeB @ (5,0,0) )
    const tree1: TreeNode = {
      id: "root",
      type: "difference",
      children: [
        {
          id: "A",
          type: "cube",
          size: [2, 2, 2],
          center: true,
          // no matrix
        },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree1 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh1, idMap: idMap1 } = await waitForMesh();

    console.log("=== Initial build ===");
    console.log("idMap:", Object.fromEntries(idMap1));
    console.log("runOriginalID:", Array.from(mesh1.runOriginalID ?? []));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    const undef1 = triMap1.filter((id) => id === undefined).length;
    console.log("triMap total:", triMap1.length, "undefined:", undef1);
    expect(undef1).toBe(0);

    // Second render: cubeA now has a matrix (first gizmo edit)
    const tree2: TreeNode = {
      id: "root",
      type: "difference",
      children: [
        {
          id: "A",
          type: "cube",
          size: [2, 2, 2],
          center: true,
          matrix: translateMatrix(-3, 0, 0), // NEW: matrix added
        },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree2 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh2, idMap: idMap2 } = await waitForMesh();

    console.log("\n=== After first edit (matrix added to A) ===");
    console.log("idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap total:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });

  it("changing matrix on a union child — second edit", async () => {
    const { fiber, container, waitForMesh } = createFiber();

    // Both children already have matrices
    const tree1: TreeNode = {
      id: "root",
      type: "difference",
      children: [
        {
          id: "A",
          type: "cube",
          size: [2, 2, 2],
          center: true,
          matrix: translateMatrix(-3, 0, 0),
        },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree1 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh1, idMap: idMap1 } = await waitForMesh();

    console.log("=== Initial build (both have matrices) ===");
    console.log("idMap:", Object.fromEntries(idMap1));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Change A's matrix (second gizmo drag)
    const tree2: TreeNode = {
      id: "root",
      type: "difference",
      children: [
        {
          id: "A",
          type: "cube",
          size: [2, 2, 2],
          center: true,
          matrix: translateMatrix(-10, 0, 0), // changed
        },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree2 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh2, idMap: idMap2 } = await waitForMesh();

    console.log("\n=== After matrix change ===");
    console.log("idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap total:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });

  it("adding matrix to a nested child (bool > bool > cube)", async () => {
    const { fiber, container, waitForMesh } = createFiber();

    // Deeper nesting: union( difference(cubeA, cubeB_translated), cubeC_translated )
    const tree1: TreeNode = {
      id: "root",
      type: "union",
      children: [
        {
          id: "diff",
          type: "difference",
          children: [
            { id: "A", type: "cube", size: [2, 2, 2], center: true },
            {
              id: "B",
              type: "cube",
              size: [1, 1, 1],
              center: true,
              matrix: translateMatrix(0.5, 0, 0),
            },
          ],
        },
        {
          id: "C",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree1 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh1, idMap: idMap1 } = await waitForMesh();

    console.log("=== Initial nested build ===");
    console.log("idMap:", Object.fromEntries(idMap1));

    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Add matrix to cubeA (deep in the tree)
    const tree2: TreeNode = {
      id: "root",
      type: "union",
      children: [
        {
          id: "diff",
          type: "difference",
          children: [
            {
              id: "A",
              type: "cube",
              size: [2, 2, 2],
              center: true,
              matrix: translateMatrix(-1, 0, 0), // NEW
            },
            {
              id: "B",
              type: "cube",
              size: [1, 1, 1],
              center: true,
              matrix: translateMatrix(0.5, 0, 0),
            },
          ],
        },
        {
          id: "C",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree2 }),
      fiber,
      null,
      () => {},
    );
    const { mesh: mesh2, idMap: idMap2 } = await waitForMesh();

    console.log("\n=== After matrix added to nested cubeA ===");
    console.log("idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap total:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });

  it("the full scenario: two CsgRoots using CsgTreeRenderer with matrix addition", async () => {
    const main = createFiber();
    const sel = createFiber();

    const tree1: TreeNode = {
      id: "root",
      type: "union",
      children: [
        { id: "A", type: "cube", size: [2, 2, 2], center: true },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    // Main renders full tree
    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree1 }),
      main.fiber,
      null,
      () => {},
    );
    // Selection renders just cubeA (without matrix, as SelectionOverlay strips it)
    const selNode1 = tree1.children![0];
    const selNodeNoMatrix = { ...selNode1, matrix: undefined };
    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: selNodeNoMatrix }),
      sel.fiber,
      null,
      () => {},
    );

    const { mesh: mesh1, idMap: idMap1 } = await main.waitForMesh();
    console.log("=== Initial ===");
    console.log("main idMap:", Object.fromEntries(idMap1));
    const triMap1 = buildTriNodeIdMap(mesh1, idMap1);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // NOW: add matrix to A (gizmo drag)
    const tree2: TreeNode = {
      id: "root",
      type: "union",
      children: [
        {
          id: "A",
          type: "cube",
          size: [2, 2, 2],
          center: true,
          matrix: translateMatrix(-3, 0, 0),
        },
        {
          id: "B",
          type: "cube",
          size: [1, 1, 1],
          center: true,
          matrix: translateMatrix(5, 0, 0),
        },
      ],
    };

    // Both update simultaneously
    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: tree2 }),
      main.fiber,
      null,
      () => {},
    );
    // Selection: still renders cubeA without matrix
    const selNode2 = tree2.children![0];
    const selNode2NoMatrix = { ...selNode2, matrix: undefined };
    reconciler.updateContainer(
      React.createElement(CsgTreeRenderer, { node: selNode2NoMatrix }),
      sel.fiber,
      null,
      () => {},
    );

    const { mesh: mesh2, idMap: idMap2 } = await main.waitForMesh();
    console.log("\n=== After matrix added ===");
    console.log("main idMap:", Object.fromEntries(idMap2));
    console.log("runOriginalID:", Array.from(mesh2.runOriginalID ?? []));

    const triMap2 = buildTriNodeIdMap(mesh2, idMap2);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap total:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });
});
