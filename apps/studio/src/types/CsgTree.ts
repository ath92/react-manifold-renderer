// ─── CSG Tree Data Types ─────────────────────────────────────────────────────
// JSON-serializable data structure representing a CSG tree.
// Maps 1:1 to the CSG React components in @manifold-studio/react-manifold.

// --- Base mixin (every node gets an id) ---

export interface CsgNodeBase {
  id: string;
}

export function genId(): string {
  return crypto.randomUUID();
}

// --- Primitives (no children) ---

export interface CsgCubeNode extends CsgNodeBase {
  type: "cube";
  size?: number | [number, number, number];
  center?: boolean;
}

export interface CsgSphereNode extends CsgNodeBase {
  type: "sphere";
  radius?: number;
  segments?: number;
}

export interface CsgCylinderNode extends CsgNodeBase {
  type: "cylinder";
  radius?: number;
  radiusLow?: number;
  radiusHigh?: number;
  height?: number;
  segments?: number;
  center?: boolean;
}

export interface CsgExtrudeNode extends CsgNodeBase {
  type: "extrude";
  polygon: [number, number][];
  height?: number;
}

// --- Boolean Operations ---

export interface CsgUnionNode extends CsgNodeBase {
  type: "union";
  children: CsgTreeNode[];
}

export interface CsgDifferenceNode extends CsgNodeBase {
  type: "difference";
  children: CsgTreeNode[];
}

export interface CsgIntersectionNode extends CsgNodeBase {
  type: "intersection";
  children: CsgTreeNode[];
}

export interface CsgNodeName {
  name?: string;
}

// --- Transforms ---

export interface CsgTranslateNode extends CsgNodeBase {
  type: "translate";
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

export interface CsgRotateNode extends CsgNodeBase {
  type: "rotate";
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

export interface CsgScaleNode extends CsgNodeBase {
  type: "scale";
  x?: number;
  y?: number;
  z?: number;
  children: CsgTreeNode[];
}

// --- Group ---

export interface CsgGroupNode extends CsgNodeBase {
  type: "group";
  children: CsgTreeNode[];
}

// --- Discriminated Union ---

export type CsgPrimitiveNode =
  | CsgCubeNode
  | CsgSphereNode
  | CsgCylinderNode
  | CsgExtrudeNode;
export type CsgBooleanNode = (
  | CsgUnionNode
  | CsgDifferenceNode
  | CsgIntersectionNode
) &
  CsgNodeName;
export type CsgTransformNode = CsgTranslateNode | CsgRotateNode | CsgScaleNode;
export type CsgParentNode = CsgBooleanNode | CsgTransformNode | CsgGroupNode;

export type CsgTreeNode =
  | CsgPrimitiveNode
  | CsgBooleanNode
  | CsgTransformNode
  | CsgGroupNode;

export function hasChildren(node: CsgTreeNode): node is CsgParentNode {
  return "children" in node;
}
