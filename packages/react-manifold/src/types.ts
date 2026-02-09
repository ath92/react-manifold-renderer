import type { Manifold } from "manifold-3d";

export interface CsgNode {
  type: NodeType;
  props: Record<string, unknown>;
  children: CsgNode[];
  parent: CsgNode | null;

  // Cached Manifold handle - lives in WASM memory
  manifold: Manifold | null;
  dirty: boolean;
}

export type PrimitiveType = "cube" | "sphere" | "cylinder" | "extrude";
export type BooleanType = "union" | "difference" | "intersection";
export type TransformType = "transform";
export type GroupType = "group";

export type NodeType = PrimitiveType | BooleanType | TransformType | GroupType;

export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}
