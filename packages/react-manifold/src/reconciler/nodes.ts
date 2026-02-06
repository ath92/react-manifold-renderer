import type { CsgNode, NodeType } from '../types';

export function createNode(type: NodeType, props: Record<string, unknown>): CsgNode {
  return {
    type,
    props,
    children: [],
    parent: null,
    manifold: null,
    dirty: true,
  };
}

export function markDirty(node: CsgNode): void {
  let current: CsgNode | null = node;
  while (current !== null) {
    if (current.dirty) break; // Already dirty up the chain
    current.dirty = true;
    current = current.parent;
  }
}

export function disposeNode(node: CsgNode): void {
  // Dispose this node's manifold
  if (node.manifold) {
    node.manifold.delete();
    node.manifold = null;
  }

  // Recursively dispose children
  for (const child of node.children) {
    disposeNode(child);
  }
}
