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

  return geometry;
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
}
