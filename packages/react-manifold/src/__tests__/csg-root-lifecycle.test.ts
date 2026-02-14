/**
 * Test that exercises the FULL CsgRoot lifecycle including queueMicrotask.
 * Uses the actual CsgRoot component rendered via the reconciler, with
 * callbacks that capture the mesh and idMap.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "path";
import React from "react";
import { initManifold, setWasmPath } from "../manifold-module";
import { CsgRoot } from "../components";
import { buildTriNodeIdMap } from "../three";
import type { OriginalIdMap } from "../reconciler/geometry-builder";
import type { Mesh } from "manifold-3d";

// We need a React renderer to render CsgRoot (which uses hooks).
// Use react-test-renderer or a minimal approach.
import ReactReconciler from "react-reconciler";

beforeAll(async () => {
  setWasmPath(
    resolve(
      __dirname,
      "../../../../node_modules/.pnpm/manifold-3d@3.3.2/node_modules/manifold-3d/manifold.wasm",
    ),
  );
  await initManifold();
});

// Minimal "DOM" reconciler to host CsgRoot (which is a React component using hooks)
const noopHostConfig: any = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  createInstance: () => ({}),
  createTextInstance: () => ({}),
  appendInitialChild: () => {},
  appendChild: () => {},
  removeChild: () => {},
  insertBefore: () => {},
  appendChildToContainer: () => {},
  removeChildFromContainer: () => {},
  insertInContainerBefore: () => {},
  clearContainer: () => {},
  prepareUpdate: () => true,
  commitUpdate: () => {},
  prepareForCommit: () => null,
  resetAfterCommit: () => {},
  finalizeInitialChildren: () => false,
  getPublicInstance: (i: any) => i,
  getRootHostContext: () => ({}),
  getChildHostContext: (ctx: any) => ctx,
  shouldSetTextContent: () => false,
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentEventPriority: () => 16,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
};

const hostReconciler = ReactReconciler(noopHostConfig);

function renderInHost(element: React.ReactElement): { fiber: any } {
  const container = {};
  const fiber = hostReconciler.createContainer(
    container,
    0,
    null,
    false,
    null,
    "host",
    () => {},
    () => {},
    () => {},
    () => {},
  );
  hostReconciler.updateContainer(element, fiber, null, () => {});
  return { fiber };
}

function updateInHost(fiber: any, element: React.ReactElement): void {
  hostReconciler.updateContainer(element, fiber, null, () => {});
}

function translateMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1];
}

// Minimal CsgTreeRenderer (matches the app's pattern)
function CsgTreeRenderer({ node }: { node: any }): React.ReactElement {
  const children =
    node.children?.map((child: any, i: number) =>
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
      element = React.createElement(
        "union" as any,
        null,
        ...(children ?? []),
      );
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

  if (node.matrix) {
    return React.createElement(
      "transform" as any,
      { matrix: node.matrix },
      element,
    );
  }
  return element;
}

describe("CsgRoot full lifecycle", () => {
  it("matrix added to child — onMesh receives correct idMap", async () => {
    let meshResult: { mesh: Mesh; idMap: OriginalIdMap } | null = null;
    let meshCount = 0;

    const onMesh = (mesh: Mesh, idMap: OriginalIdMap) => {
      meshCount++;
      meshResult = { mesh, idMap };
    };

    const tree1 = {
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

    const elem1 = React.createElement(
      CsgRoot as any,
      { onMesh },
      React.createElement(CsgTreeRenderer, { node: tree1 }),
    );

    const { fiber } = renderInHost(elem1);

    // Wait for queueMicrotask to fire
    await new Promise((r) => setTimeout(r, 50));

    expect(meshResult).not.toBeNull();
    console.log("=== Initial build ===");
    console.log("meshCount:", meshCount);
    console.log("idMap:", Object.fromEntries(meshResult!.idMap));

    const triMap1 = buildTriNodeIdMap(meshResult!.mesh, meshResult!.idMap);
    const undef1 = triMap1.filter((id) => id === undefined).length;
    console.log("triMap:", triMap1.length, "undefined:", undef1);
    expect(undef1).toBe(0);

    // Now: add matrix to A
    const tree2 = {
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

    meshResult = null;
    const elem2 = React.createElement(
      CsgRoot as any,
      { onMesh },
      React.createElement(CsgTreeRenderer, { node: tree2 }),
    );
    updateInHost(fiber, elem2);

    await new Promise((r) => setTimeout(r, 50));

    expect(meshResult).not.toBeNull();
    console.log("\n=== After matrix added ===");
    console.log("meshCount:", meshCount);
    console.log("idMap:", Object.fromEntries(meshResult!.idMap));
    console.log(
      "runOriginalID:",
      Array.from(meshResult!.mesh.runOriginalID ?? []),
    );

    const triMap2 = buildTriNodeIdMap(meshResult!.mesh, meshResult!.idMap);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });

  it("dual CsgRoot: main + selection overlay pattern", async () => {
    let mainResult: { mesh: Mesh; idMap: OriginalIdMap } | null = null;
    let selResult: { mesh: Mesh } | null = null;

    const onMainMesh = (mesh: Mesh, idMap: OriginalIdMap) => {
      mainResult = { mesh, idMap };
    };
    const onSelMesh = (mesh: Mesh) => {
      selResult = { mesh };
    };

    const tree1 = {
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

    // Selection: render just cube A (no matrix, like SelectionOverlay does)
    const selNode1 = { id: "A", type: "cube", size: [2, 2, 2], center: true };

    // Render both CsgRoots in one host tree (like CsgScene does)
    const elem1 = React.createElement(
      React.Fragment,
      null,
      React.createElement(
        CsgRoot as any,
        { onMesh: onMainMesh },
        React.createElement(CsgTreeRenderer, { node: tree1 }),
      ),
      React.createElement(
        CsgRoot as any,
        { onMesh: onSelMesh },
        React.createElement(CsgTreeRenderer, { node: selNode1 }),
      ),
    );

    const { fiber } = renderInHost(elem1);
    await new Promise((r) => setTimeout(r, 50));

    expect(mainResult).not.toBeNull();
    console.log("=== Initial ===");
    console.log("main idMap:", Object.fromEntries(mainResult!.idMap));

    const triMap1 = buildTriNodeIdMap(mainResult!.mesh, mainResult!.idMap);
    expect(triMap1.filter((id) => id === undefined).length).toBe(0);

    // Edit: add matrix to A, re-render both
    mainResult = null;
    selResult = null;

    const tree2 = {
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
    const selNode2 = { id: "A", type: "cube", size: [2, 2, 2], center: true };

    const elem2 = React.createElement(
      React.Fragment,
      null,
      React.createElement(
        CsgRoot as any,
        { onMesh: onMainMesh },
        React.createElement(CsgTreeRenderer, { node: tree2 }),
      ),
      React.createElement(
        CsgRoot as any,
        { onMesh: onSelMesh },
        React.createElement(CsgTreeRenderer, { node: selNode2 }),
      ),
    );

    updateInHost(fiber, elem2);
    await new Promise((r) => setTimeout(r, 50));

    expect(mainResult).not.toBeNull();
    console.log("\n=== After edit ===");
    console.log("main idMap:", Object.fromEntries(mainResult!.idMap));
    console.log(
      "runOriginalID:",
      Array.from(mainResult!.mesh.runOriginalID ?? []),
    );

    const triMap2 = buildTriNodeIdMap(mainResult!.mesh, mainResult!.idMap);
    const undef2 = triMap2.filter((id) => id === undefined).length;
    console.log("triMap:", triMap2.length, "undefined:", undef2);

    expect(undef2).toBe(0);
  });
});
