import type { Mesh } from 'manifold-3d';
import type { CsgNode, NodeType } from '../types';
import { createNode, markDirty, disposeNode } from './nodes';
import { buildGeometry } from './geometry-builder';

export interface Container {
  root: CsgNode | null;
  onMesh: (mesh: Mesh) => void;
  onError?: (error: Error) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hostConfig: Record<string, any> = {
  // --- Configuration ---
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,

  // --- Instance Creation ---
  createInstance(type: string, props: Record<string, unknown>): CsgNode {
    return createNode(type as NodeType, props);
  },

  createTextInstance(): never {
    throw new Error('Text nodes are not supported in CSG renderer');
  },

  // --- Tree Operations ---
  appendInitialChild(parent: CsgNode, child: CsgNode): void {
    child.parent = parent;
    parent.children.push(child);
  },

  appendChild(parent: CsgNode, child: CsgNode): void {
    child.parent = parent;
    parent.children.push(child);
    markDirty(parent);
  },

  removeChild(parent: CsgNode, child: CsgNode): void {
    const index = parent.children.indexOf(child);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    child.parent = null;
    markDirty(parent);

    // Dispose removed subtree
    disposeNode(child);
  },

  insertBefore(parent: CsgNode, child: CsgNode, beforeChild: CsgNode): void {
    child.parent = parent;
    const index = parent.children.indexOf(beforeChild);
    if (index !== -1) {
      parent.children.splice(index, 0, child);
    } else {
      parent.children.push(child);
    }
    markDirty(parent);
  },

  // --- Updates ---
  prepareUpdate(
    _instance: CsgNode,
    _type: string,
    oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>
  ): boolean {
    return !propsEqual(oldProps, newProps);
  },

  commitUpdate(
    instance: CsgNode,
    _updatePayload: boolean,
    _type: string,
    _oldProps: Record<string, unknown>,
    newProps: Record<string, unknown>
  ): void {
    // Dispose old manifold before updating props
    if (instance.manifold) {
      instance.manifold.delete();
      instance.manifold = null;
    }
    instance.props = newProps;
    markDirty(instance);
  },

  // --- Container Operations ---
  appendChildToContainer(container: Container, child: CsgNode): void {
    container.root = child;
    child.parent = null;
  },

  removeChildFromContainer(container: Container, child: CsgNode): void {
    if (container.root === child) {
      container.root = null;
    }
    disposeNode(child);
  },

  insertInContainerBefore(container: Container, child: CsgNode, _beforeChild: CsgNode): void {
    container.root = child;
    child.parent = null;
  },

  clearContainer(container: Container): void {
    if (container.root) {
      disposeNode(container.root);
      container.root = null;
    }
  },

  // --- Commit Phase ---
  prepareForCommit(): null {
    return null;
  },

  resetAfterCommit(container: Container): void {
    // Rebuild geometry after React commits all changes
    if (container.root && container.root.dirty) {
      try {
        buildGeometry(container.root);

        if (container.root.manifold) {
          const mesh = container.root.manifold.getMesh();
          // Defer callback to break synchronous update cycle
          queueMicrotask(() => container.onMesh(mesh));
        }
      } catch (error) {
        // Defer error callback too
        queueMicrotask(() => container.onError?.(error as Error));
      }
    }
  },

  finalizeInitialChildren(): boolean {
    return false;
  },

  // --- Misc ---
  getPublicInstance(instance: CsgNode): CsgNode {
    return instance;
  },

  getRootHostContext(): Record<string, never> {
    return {};
  },

  getChildHostContext(parentContext: Record<string, never>): Record<string, never> {
    return parentContext;
  },

  shouldSetTextContent() {
    return false;
  },

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  getCurrentEventPriority: () => 16,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
};

function propsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a).filter(k => k !== 'children');
  const keysB = Object.keys(b).filter(k => k !== 'children');

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!valuesEqual(a[key], b[key])) return false;
  }

  return true;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  // Same reference or primitive equality
  if (a === b) return true;

  // Handle null/undefined
  if (a == null || b == null) return a === b;

  // Handle arrays (common for size, position, etc.)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Different types
  if (typeof a !== typeof b) return false;

  // For objects, do shallow comparison (one level deep)
  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
      if (objA[key] !== objB[key]) return false;
    }
    return true;
  }

  return false;
}
