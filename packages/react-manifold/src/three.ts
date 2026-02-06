import * as THREE from 'three';
import type { Mesh } from 'manifold-3d';

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

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Update an existing BufferGeometry in place
 */
export function updateGeometry(geometry: THREE.BufferGeometry, mesh: Mesh): void {
  const { vertProperties, triVerts, numProp } = mesh;

  const vertexCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertexCount * 3);

  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3 + 0] = vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;
}
