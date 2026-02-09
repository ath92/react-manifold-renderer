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

export interface AncestorTransform {
  type: "translate" | "rotate" | "scale";
  x: number;
  y: number;
  z: number;
}

/**
 * Collect the chain of ancestor transform nodes from root down to (but not
 * including) the node with the given id. Returns the transforms in
 * root-to-target order, or null if the target isn't found.
 */
export function getAncestorTransforms(
  root: CsgTreeNode,
  targetId: string,
): AncestorTransform[] | null {
  const path: AncestorTransform[] = [];
  if (findAncestorPath(root, targetId, path)) {
    return path;
  }
  return null;
}

function findAncestorPath(
  node: CsgTreeNode,
  targetId: string,
  path: AncestorTransform[],
): boolean {
  if (node.id === targetId) return true;
  if (!hasChildren(node)) return false;

  const isTransform =
    node.type === "translate" ||
    node.type === "rotate" ||
    node.type === "scale";
  if (isTransform) {
    path.push({
      type: node.type as AncestorTransform["type"],
      x: (node as CsgTransformNode).x ?? 0,
      y: (node as CsgTransformNode).y ?? 0,
      z: (node as CsgTransformNode).z ?? 0,
    });
  }

  for (const child of node.children) {
    if (findAncestorPath(child, targetId, path)) {
      return true;
    }
  }

  // Backtrack: this branch didn't contain the target
  if (isTransform) {
    path.pop();
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
 * Return a new tree where the node at `targetId` is wrapped in a new
 * transform node.
 */
export function wrapNodeWithTransform(
  root: CsgTreeNode,
  targetId: string,
  transformType: "translate" | "rotate" | "scale",
  x: number,
  y: number,
  z: number,
): CsgTreeNode | null {
  const target = findNodeById(root, targetId);
  if (!target) return null;

  const wrapper: CsgTransformNode = {
    id: genId(),
    type: transformType,
    x,
    y,
    z,
    children: [target],
  };

  return replaceNode(root, targetId, wrapper);
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
 * Apply a transform delta to a node in the tree. If the node's immediate
 * parent is already a transform of the same type with the target as its
 * only child, update that parent's values. Otherwise, wrap the target in
 * a new transform node.
 *
 * For translate: delta values are added to existing values.
 * For rotate: delta values are added to existing values.
 * For scale: delta values are multiplied with existing values.
 */
export function applyTransformDelta(
  root: CsgTreeNode,
  targetId: string,
  transformType: "translate" | "rotate" | "scale",
  dx: number,
  dy: number,
  dz: number,
): CsgTreeNode | null {
  const parent = findParentNode(root, targetId);

  // Check if parent is a matching transform with this as its only child
  if (parent && parent.type === transformType && parent.children.length === 1) {
    const p = parent as CsgTransformNode;
    let newX: number, newY: number, newZ: number;

    if (transformType === "scale") {
      // Scale compounds multiplicatively
      newX = (p.x ?? 1) * dx;
      newY = (p.y ?? 1) * dy;
      newZ = (p.z ?? 1) * dz;
    } else {
      // Translate and rotate compound additively
      newX = (p.x ?? 0) + dx;
      newY = (p.y ?? 0) + dy;
      newZ = (p.z ?? 0) + dz;
    }

    const updatedParent: CsgTreeNode = {
      ...p,
      x: newX,
      y: newY,
      z: newZ,
    } as CsgTreeNode;

    return replaceNode(root, parent.id, updatedParent);
  }

  // No matching parent transform — wrap with a new one
  return wrapNodeWithTransform(root, targetId, transformType, dx, dy, dz);
}
