// Core
export { CsgRoot } from "./components";
export { initManifold, isManifoldReady, setWasmPath } from "./manifold-module";

// Primitives
export { Cube, Sphere, Cylinder, Extrude } from "./components";

// Boolean Operations
export { Union, Difference, Intersection } from "./components";

// Transforms
export { Transform, Translate, Rotate, Scale } from "./components";

// Group
export { Group } from "./components";

// Three.js Integration
export {
  meshToGeometry,
  updateGeometry,
  buildTriNodeIdMap,
  nodeIdForFace,
} from "./three";
export type { TriNodeIdMap } from "./three";

// React Three Fiber Integration
export { CsgMesh } from "./r3f";

// Types
export type { CsgNode, NodeType, MeshData } from "./types";
export type { OriginalIdMap } from "./reconciler/geometry-builder";
