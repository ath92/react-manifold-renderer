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

// --- Transform (single matrix-based type) ---

export interface CsgTransformNode extends CsgNodeBase {
  type: "transform";
  matrix: number[]; // 16 elements, column-major (matches THREE.Matrix4.elements and Manifold Mat4)
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
export type CsgParentNode = CsgBooleanNode | CsgTransformNode | CsgGroupNode;

export type CsgTreeNode =
  | CsgPrimitiveNode
  | CsgBooleanNode
  | CsgTransformNode
  | CsgGroupNode;

export function hasChildren(node: CsgTreeNode): node is CsgParentNode {
  return "children" in node;
}

// ─── Matrix Helpers (column-major 4×4) ───────────────────────────────────────

export function makeTranslationMatrix(
  x: number,
  y: number,
  z: number,
): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

export function makeRotationMatrix(
  xDeg: number,
  yDeg: number,
  zDeg: number,
): number[] {
  const xr = (xDeg * Math.PI) / 180;
  const yr = (yDeg * Math.PI) / 180;
  const zr = (zDeg * Math.PI) / 180;
  const cx = Math.cos(xr),
    sx = Math.sin(xr);
  const cy = Math.cos(yr),
    sy = Math.sin(yr);
  const cz = Math.cos(zr),
    sz = Math.sin(zr);
  // XYZ Euler rotation, column-major
  // prettier-ignore
  return [
    cy * cz,                  cy * sz,                  -sy,    0,
    sx * sy * cz - cx * sz,   sx * sy * sz + cx * cz,   sx * cy, 0,
    cx * sy * cz + sx * sz,   cx * sy * sz - sx * cz,   cx * cy, 0,
    0,                        0,                        0,       1,
  ];
}

export function makeScaleMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];
}

export function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

// ─── Convenience Node Constructors ───────────────────────────────────────────

export function translateNode(
  x: number,
  y: number,
  z: number,
  children: CsgTreeNode[],
): CsgTransformNode {
  return {
    id: genId(),
    type: "transform",
    matrix: makeTranslationMatrix(x, y, z),
    children,
  };
}

export function rotateNode(
  xDeg: number,
  yDeg: number,
  zDeg: number,
  children: CsgTreeNode[],
): CsgTransformNode {
  return {
    id: genId(),
    type: "transform",
    matrix: makeRotationMatrix(xDeg, yDeg, zDeg),
    children,
  };
}

export function scaleNode(
  x: number,
  y: number,
  z: number,
  children: CsgTreeNode[],
): CsgTransformNode {
  return {
    id: genId(),
    type: "transform",
    matrix: makeScaleMatrix(x, y, z),
    children,
  };
}

// ─── Tree Queries ────────────────────────────────────────────────────────────

/**
 * Find a node by its id within a tree. Returns undefined if not found.
 */
export function findNodeById(
  root: CsgTreeNode,
  id: string,
): CsgTreeNode | undefined {
  if (root.id === id) return root;
  if (hasChildren(root)) {
    for (const child of root.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Collect all leaf primitive IDs that are descendants of a given node.
 * If the node itself is a primitive, returns just its ID.
 */
export function getLeafPrimitiveIds(node: CsgTreeNode): Set<string> {
  const ids = new Set<string>();
  collectLeafIds(node, ids);
  return ids;
}

function collectLeafIds(node: CsgTreeNode, ids: Set<string>): void {
  if (hasChildren(node)) {
    for (const child of node.children) {
      collectLeafIds(child, ids);
    }
  } else {
    ids.add(node.id);
  }
}

// ─── Ancestor Transform Utilities ────────────────────────────────────────────

/**
 * Collect ancestor transform matrices from root down to (but not including)
 * the node with the given id. Returns the matrices in root-to-target order,
 * or null if the target isn't found.
 */
export function getAncestorTransforms(
  root: CsgTreeNode,
  targetId: string,
): number[][] | null {
  const matrices: number[][] = [];
  if (findAncestorPath(root, targetId, matrices)) {
    return matrices;
  }
  return null;
}

function findAncestorPath(
  node: CsgTreeNode,
  targetId: string,
  matrices: number[][],
): boolean {
  if (node.id === targetId) return true;
  if (!hasChildren(node)) return false;

  const isTransform = node.type === "transform";
  if (isTransform) {
    matrices.push((node as CsgTransformNode).matrix);
  }

  for (const child of node.children) {
    if (findAncestorPath(child, targetId, matrices)) {
      return true;
    }
  }

  // Backtrack: this branch didn't contain the target
  if (isTransform) {
    matrices.pop();
  }
  return false;
}

// ─── Immutable Tree Updates ──────────────────────────────────────────────────

/**
 * Return a new tree with the node at `targetId` replaced by `newNode`.
 * Returns null if the target isn't found.
 */
export function replaceNode(
  root: CsgTreeNode,
  targetId: string,
  newNode: CsgTreeNode,
): CsgTreeNode | null {
  if (root.id === targetId) return newNode;
  if (!hasChildren(root)) return null;

  for (let i = 0; i < root.children.length; i++) {
    const result = replaceNode(root.children[i], targetId, newNode);
    if (result !== null) {
      const newChildren = [...root.children];
      newChildren[i] = result;
      return { ...root, children: newChildren } as CsgTreeNode;
    }
  }
  return null;
}

/**
 * Find the parent of a node by its id. Returns undefined if the node is
 * the root or not found.
 */
export function findParentNode(
  root: CsgTreeNode,
  targetId: string,
): CsgParentNode | undefined {
  if (!hasChildren(root)) return undefined;
  for (const child of root.children) {
    if (child.id === targetId) return root;
    const found = findParentNode(child, targetId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Apply a transform delta to a node in the tree.
 *
 * If the node's immediate parent is already a transform node with the target
 * as its only child, the delta matrix is multiplied into the existing one.
 * Otherwise, the target is wrapped in a new transform node.
 *
 * The `deltaMatrix` should be a 16-element column-major 4×4 matrix
 * representing the incremental transform to apply.
 */
export function applyTransformDelta(
  root: CsgTreeNode,
  targetId: string,
  deltaMatrix: number[],
): CsgTreeNode | null {
  const parent = findParentNode(root, targetId);

  // If parent is a transform with this as its only child, multiply matrices
  if (parent && parent.type === "transform" && parent.children.length === 1) {
    const combined = multiplyMatrices(parent.matrix, deltaMatrix);
    const updatedParent: CsgTransformNode = {
      ...parent,
      matrix: combined,
    };
    return replaceNode(root, parent.id, updatedParent);
  }

  // No matching parent transform — wrap with a new transform node
  const target = findNodeById(root, targetId);
  if (!target) return null;

  const wrapper: CsgTransformNode = {
    id: genId(),
    type: "transform",
    matrix: deltaMatrix,
    children: [target],
  };

  return replaceNode(root, targetId, wrapper);
}
