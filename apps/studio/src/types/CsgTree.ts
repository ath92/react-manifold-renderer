// ─── CSG Tree Data Types ─────────────────────────────────────────────────────
// JSON-serializable data structure representing a CSG tree.
// Maps 1:1 to the CSG React components in @manifold-studio/react-manifold.

// --- Primitives (no children) ---

export interface CsgCubeNode {
  type: 'cube';
  size?: number | [number, number, number];
  center?: boolean;
}

export interface CsgSphereNode {
  type: 'sphere';
  radius?: number;
  segments?: number;
}

export interface CsgCylinderNode {
  type: 'cylinder';
  radius?: number;
  radiusLow?: number;
  radiusHigh?: number;
  height?: number;
  segments?: number;
  center?: boolean;
}

export interface CsgExtrudeNode {
  type: 'extrude';
  polygon: [number, number][];
  height?: number;
}

// --- Boolean Operations ---

export interface CsgUnionNode {
  type: 'union';
  children: CsgTreeNode[];
}

export interface CsgDifferenceNode {
  type: 'difference';
  children: CsgTreeNode[];
}

export interface CsgIntersectionNode {
  type: 'intersection';
  children: CsgTreeNode[];
}

// --- Transforms ---

export interface CsgTranslateNode {
  type: 'translate';
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

export interface CsgRotateNode {
  type: 'rotate';
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

export interface CsgScaleNode {
  type: 'scale';
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

// --- Group ---

export interface CsgGroupNode {
  type: 'group';
  children: CsgTreeNode[];
}

// --- Discriminated Union ---

export type CsgPrimitiveNode = CsgCubeNode | CsgSphereNode | CsgCylinderNode | CsgExtrudeNode;
export type CsgBooleanNode = CsgUnionNode | CsgDifferenceNode | CsgIntersectionNode;
export type CsgTransformNode = CsgTranslateNode | CsgRotateNode | CsgScaleNode;
export type CsgParentNode = CsgBooleanNode | CsgTransformNode | CsgGroupNode;

export type CsgTreeNode =
  | CsgPrimitiveNode
  | CsgBooleanNode
  | CsgTransformNode
  | CsgGroupNode;

export function hasChildren(node: CsgTreeNode): node is CsgParentNode {
  return 'children' in node;
}
