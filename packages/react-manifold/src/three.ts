import * as THREE from "three";
import type { Mesh } from "manifold-3d";
import type { OriginalIdMap } from "./reconciler/geometry-builder";

/**
 * Per-triangle node ID lookup built from Manifold's run data.
 * triNodeId[triIndex] = the user node ID string for that triangle,
 * or undefined if unmapped.
 */
export type TriNodeIdMap = (string | undefined)[];

/**
 * Build a per-triangle → nodeId lookup from Manifold Mesh run data
 * and the originalID → nodeId map produced during geometry building.
 */
export function buildTriNodeIdMap(
  mesh: Mesh,
  idMap: OriginalIdMap,
): TriNodeIdMap {
  const { runIndex, runOriginalID, triVerts } = mesh;
  const numTri = triVerts.length / 3;
  const result: TriNodeIdMap = new Array(numTri);

  if (!runIndex || !runOriginalID || runOriginalID.length === 0) {
    return result;
  }

  for (let run = 0; run < runOriginalID.length; run++) {
    const nodeId = idMap.get(runOriginalID[run]);
    const triStart = runIndex[run] / 3;
    const triEnd =
      (run + 1 < runIndex.length ? runIndex[run + 1] : triVerts.length) / 3;
    for (let t = triStart; t < triEnd; t++) {
      result[t] = nodeId;
    }
  }

  return result;
}

/**
 * Convert manifold-3d Mesh to Three.js BufferGeometry
 */
export function meshToGeometry(mesh: Mesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  const { vertProperties, triVerts, numProp } = mesh;

  // vertProperties is interleaved: [x, y, z, ...props, x, y, z, ...props, ...]
  // We need to extract positions (first 3 values per vertex)
  const vertexCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3 + 0] = vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();

  // Initialize selection attribute (all zeros = unselected)
  const selected = new Float32Array(vertexCount);
  geometry.setAttribute("selected", new THREE.BufferAttribute(selected, 1));

  return geometry;
}

/**
 * Update the `selected` vertex attribute on a geometry given
 * the set of node IDs that should be highlighted and the tri→nodeId map.
 */
export function updateSelectionAttribute(
  geometry: THREE.BufferGeometry,
  triNodeIdMap: TriNodeIdMap,
  selectedNodeIds: ReadonlySet<string>,
): void {
  const attr = geometry.getAttribute("selected") as THREE.BufferAttribute;
  if (!attr) return;

  const arr = attr.array as Float32Array;
  arr.fill(0);

  if (selectedNodeIds.size === 0) {
    attr.needsUpdate = true;
    return;
  }

  const index = geometry.getIndex();
  if (!index) {
    attr.needsUpdate = true;
    return;
  }

  const indexArr = index.array;
  for (let tri = 0; tri < triNodeIdMap.length; tri++) {
    const nodeId = triNodeIdMap[tri];
    if (nodeId && selectedNodeIds.has(nodeId)) {
      const i = tri * 3;
      arr[indexArr[i]] = 1;
      arr[indexArr[i + 1]] = 1;
      arr[indexArr[i + 2]] = 1;
    }
  }

  attr.needsUpdate = true;
}

/**
 * Look up which node ID a clicked face belongs to.
 */
export function nodeIdForFace(
  triNodeIdMap: TriNodeIdMap,
  faceIndex: number,
): string | undefined {
  return triNodeIdMap[faceIndex];
}

/**
 * Update an existing BufferGeometry in place
 */
export function updateGeometry(
  geometry: THREE.BufferGeometry,
  mesh: Mesh,
): void {
  const { vertProperties, triVerts, numProp } = mesh;

  const vertexCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3 + 0] = vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;

  // Reset selection attribute for new vertex count
  const selected = new Float32Array(vertexCount);
  geometry.setAttribute("selected", new THREE.BufferAttribute(selected, 1));
}
