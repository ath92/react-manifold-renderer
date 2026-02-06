# React Manifold Renderer

A custom React renderer for declarative CSG modeling using manifold-3d, implemented entirely in TypeScript.

## Goals

1. **Declarative API**: Define CSG models as React component trees
2. **Efficient updates**: Only recompute geometry for changed subtrees
3. **Minimal JS/WASM overhead**: Keep Manifold objects alive, only extract mesh for final render
4. **Three.js integration**: Output geometry compatible with Three.js

## Key Insight: manifold-3d Already Minimizes Crossing

The `manifold-3d` npm package provides JS wrappers around WASM objects. A `Manifold` instance in JS is essentially a handle to geometry stored in WASM memory. By keeping `Manifold` objects alive and only calling `.getMesh()` on the final result, we naturally minimize JS/WASM boundary crossings.

```typescript
// Each of these is a lightweight handle - geometry stays in WASM
const cube = manifold.cube([1, 1, 1]);
const sphere = manifold.sphere(0.6, 32);
const result = cube.subtract(sphere);  // Still in WASM

// Only this crosses the boundary with actual geometry data
const mesh = result.getMesh();  // Extracts vertices/indices
```

---

## Target API

```tsx
import { CsgRoot, Union, Difference, Cube, Sphere, Translate } from 'react-manifold';

function BoltHead({ radius, height, holeRadius }) {
  return (
    <Difference>
      <Cylinder radius={radius} height={height} />
      <Translate z={height / 2}>
        <Cylinder radius={holeRadius} height={height} />
      </Translate>
    </Difference>
  );
}

function Assembly({ parts }) {
  return (
    <CsgRoot onMesh={(mesh) => updateThreeGeometry(mesh)}>
      <Union>
        {parts.map(part => (
          <Translate key={part.id} x={part.x} y={part.y} z={part.z}>
            <BoltHead {...part} />
          </Translate>
        ))}
      </Union>
    </CsgRoot>
  );
}
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React Application                                              │
│  └── <CsgRoot>                                                  │
│       └── Component tree with CSG primitives & operations       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  React Reconciler (TypeScript)                                  │
│  - Maintains CsgNode tree with parent refs + dirty flags        │
│  - Each node caches its Manifold object (WASM handle)           │
│  - On commit: rebuild only dirty subtrees                       │
│  - Extract mesh only from root, only when tree changes          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  manifold-3d (WASM)                                             │
│  - Manifold objects = handles to WASM geometry                  │
│  - Boolean ops, transforms operate in WASM                      │
│  - getMesh() extracts data for rendering                        │
└─────────────────────┬───────────────────────────────────────────┘
                      │  (only final mesh)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Three.js                                                       │
│  - BufferGeometry from mesh data                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Core Types

```typescript
// src/types.ts

import type { Manifold, Mesh } from 'manifold-3d';

export interface CsgNode {
  type: NodeType;
  props: Record<string, unknown>;
  children: CsgNode[];
  parent: CsgNode | null;

  // Cached Manifold handle - lives in WASM memory
  manifold: Manifold | null;
  dirty: boolean;
}

export type PrimitiveType = 'cube' | 'sphere' | 'cylinder' | 'extrude';
export type BooleanType = 'union' | 'difference' | 'intersection';
export type TransformType = 'translate' | 'rotate' | 'scale';
export type GroupType = 'group';

export type NodeType = PrimitiveType | BooleanType | TransformType | GroupType;

export interface MeshData {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  numProp: number;
}
```

---

## Part 2: Manifold Module Wrapper

Handle async initialization and provide a clean API.

```typescript
// src/manifold-module.ts

import Module, { type ManifoldToplevel, type Manifold } from 'manifold-3d';

let modulePromise: Promise<ManifoldToplevel> | null = null;
let module: ManifoldToplevel | null = null;

export async function initManifold(): Promise<ManifoldToplevel> {
  if (module) return module;

  if (!modulePromise) {
    modulePromise = Module().then((m) => {
      module = m;
      return m;
    });
  }

  return modulePromise;
}

export function getManifold(): ManifoldToplevel {
  if (!module) {
    throw new Error('Manifold not initialized. Call initManifold() first.');
  }
  return module;
}

// Helper to check if initialized (useful for sync code paths)
export function isManifoldReady(): boolean {
  return module !== null;
}
```

---

## Part 3: React Reconciler

### 3.1 Node Management

```typescript
// src/reconciler/nodes.ts

import type { Manifold } from 'manifold-3d';
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
```

### 3.2 Host Config

```typescript
// src/reconciler/host-config.ts

import type { HostConfig } from 'react-reconciler';
import type { Mesh } from 'manifold-3d';
import type { CsgNode } from '../types';
import { createNode, markDirty, disposeNode } from './nodes';
import { buildGeometry } from './geometry-builder';

export interface Container {
  root: CsgNode | null;
  onMesh: (mesh: Mesh) => void;
  onError?: (error: Error) => void;
}

type Type = string;
type Props = Record<string, unknown>;
type TextInstance = never;
type SuspenseInstance = never;
type HydratableInstance = never;
type PublicInstance = CsgNode;
type HostContext = Record<string, never>;
type UpdatePayload = boolean;
type ChildSet = never;
type TimeoutHandle = ReturnType<typeof setTimeout>;
type NoTimeout = -1;

export const hostConfig: HostConfig<
  Type,
  Props,
  Container,
  CsgNode,
  TextInstance,
  SuspenseInstance,
  HydratableInstance,
  PublicInstance,
  HostContext,
  UpdatePayload,
  ChildSet,
  TimeoutHandle,
  NoTimeout
> = {
  // --- Configuration ---
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,

  // --- Instance Creation ---
  createInstance(type, props) {
    return createNode(type as any, props);
  },

  createTextInstance() {
    throw new Error('Text nodes are not supported in CSG renderer');
  },

  // --- Tree Operations ---
  appendInitialChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
  },

  appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    markDirty(parent);
  },

  removeChild(parent, child) {
    const index = parent.children.indexOf(child);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    child.parent = null;
    markDirty(parent);

    // Dispose removed subtree
    disposeNode(child);
  },

  insertBefore(parent, child, beforeChild) {
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
  prepareUpdate(_instance, _type, oldProps, newProps) {
    return !shallowEqual(oldProps, newProps);
  },

  commitUpdate(instance, _updatePayload, _type, _oldProps, newProps) {
    // Dispose old manifold before updating props
    if (instance.manifold) {
      instance.manifold.delete();
      instance.manifold = null;
    }
    instance.props = newProps;
    markDirty(instance);
  },

  // --- Container Operations ---
  appendChildToContainer(container, child) {
    container.root = child;
    child.parent = null;
  },

  removeChildFromContainer(container, child) {
    if (container.root === child) {
      container.root = null;
    }
    disposeNode(child);
  },

  insertInContainerBefore(container, child, _beforeChild) {
    container.root = child;
    child.parent = null;
  },

  clearContainer(container) {
    if (container.root) {
      disposeNode(container.root);
      container.root = null;
    }
  },

  // --- Commit Phase ---
  prepareForCommit() {
    return null;
  },

  resetAfterCommit(container) {
    // Rebuild geometry after React commits all changes
    if (container.root && container.root.dirty) {
      try {
        buildGeometry(container.root);

        if (container.root.manifold) {
          const mesh = container.root.manifold.getMesh();
          container.onMesh(mesh);
        }
      } catch (error) {
        container.onError?.(error as Error);
      }
    }
  },

  finalizeInitialChildren() {
    return false;
  },

  // --- Misc ---
  getPublicInstance(instance) {
    return instance;
  },

  getRootHostContext() {
    return {};
  },

  getChildHostContext(parentContext) {
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

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}
```

### 3.3 Geometry Builder

```typescript
// src/reconciler/geometry-builder.ts

import type { Manifold } from 'manifold-3d';
import type { CsgNode } from '../types';
import { getManifold } from '../manifold-module';

export function buildGeometry(node: CsgNode): Manifold | null {
  // Cache hit: not dirty and has manifold
  if (!node.dirty && node.manifold) {
    return node.manifold;
  }

  // Dispose old manifold if exists
  if (node.manifold) {
    node.manifold.delete();
    node.manifold = null;
  }

  const mod = getManifold();

  // Build children first (recursive)
  const childManifolds: Manifold[] = [];
  for (const child of node.children) {
    const m = buildGeometry(child);
    if (m) childManifolds.push(m);
  }

  let result: Manifold | null = null;

  switch (node.type) {
    // --- Primitives ---
    case 'cube': {
      const size = normalizeVec3(node.props.size, [1, 1, 1]);
      const center = node.props.center ?? true;
      result = mod.cube(size, center);
      break;
    }

    case 'sphere': {
      const radius = (node.props.radius as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      result = mod.sphere(radius, segments);
      break;
    }

    case 'cylinder': {
      const radiusLow = (node.props.radius as number) ?? (node.props.radiusLow as number) ?? 1;
      const radiusHigh = (node.props.radiusHigh as number) ?? radiusLow;
      const height = (node.props.height as number) ?? 1;
      const segments = (node.props.segments as number) ?? 32;
      const center = node.props.center ?? true;
      result = mod.cylinder(height, radiusLow, radiusHigh, segments, center);
      break;
    }

    case 'extrude': {
      const polygon = node.props.polygon as [number, number][];
      const height = (node.props.height as number) ?? 1;
      if (polygon && polygon.length >= 3) {
        const crossSection = new mod.CrossSection([polygon], 'Positive');
        result = mod.extrude(crossSection, height);
        crossSection.delete();
      }
      break;
    }

    // --- Boolean Operations ---
    case 'union': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        // Clone to avoid ownership issues
        result = childManifolds[0].add(mod.cube([0, 0, 0])); // identity-ish hack
        // Better: just reference it, but be careful with disposal
        result = childManifolds[0];
      } else {
        result = mod.union(childManifolds);
      }
      break;
    }

    case 'difference': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else {
        const [first, ...rest] = childManifolds;
        result = first.subtract(mod.union(rest));
      }
      break;
    }

    case 'intersection': {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else {
        result = mod.intersection(childManifolds);
      }
      break;
    }

    // --- Transforms ---
    case 'translate': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ['x', 'y', 'z']);
        result = childManifolds[0].translate(v);
      }
      break;
    }

    case 'rotate': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ['x', 'y', 'z']);
        result = childManifolds[0].rotate(v);
      }
      break;
    }

    case 'scale': {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [1, 1, 1], ['x', 'y', 'z']);
        result = childManifolds[0].scale(v);
      }
      break;
    }

    // --- Group (passthrough) ---
    case 'group': {
      if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else if (childManifolds.length > 1) {
        result = mod.union(childManifolds);
      }
      break;
    }
  }

  node.manifold = result;
  node.dirty = false;

  return result;
}

// --- Helpers ---

function normalizeVec3(
  input: unknown,
  defaultValue: [number, number, number],
  keys: [string, string, string] = ['0', '1', '2']
): [number, number, number] {
  if (Array.isArray(input)) {
    return [
      input[0] ?? defaultValue[0],
      input[1] ?? defaultValue[1],
      input[2] ?? defaultValue[2],
    ];
  }

  if (typeof input === 'number') {
    return [input, input, input];
  }

  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    return [
      (obj[keys[0]] as number) ?? defaultValue[0],
      (obj[keys[1]] as number) ?? defaultValue[1],
      (obj[keys[2]] as number) ?? defaultValue[2],
    ];
  }

  return defaultValue;
}
```

### 3.4 Reconciler Instance

```typescript
// src/reconciler/index.ts

import Reconciler from 'react-reconciler';
import { hostConfig, Container } from './host-config';

export const reconciler = Reconciler(hostConfig);

export type { Container };
```

---

## Part 4: Public Components

```typescript
// src/components.tsx

import React, { useEffect, useRef, useState } from 'react';
import type { Mesh } from 'manifold-3d';
import { reconciler, Container } from './reconciler';
import { initManifold, isManifoldReady } from './manifold-module';

// --- Root Component ---

interface CsgRootProps {
  children: React.ReactNode;
  onMesh: (mesh: Mesh) => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

export function CsgRoot({ children, onMesh, onError, onReady }: CsgRootProps) {
  const [ready, setReady] = useState(isManifoldReady());
  const containerRef = useRef<Container | null>(null);
  const fiberRef = useRef<any>(null);

  // Initialize WASM module
  useEffect(() => {
    if (!ready) {
      initManifold()
        .then(() => {
          setReady(true);
          onReady?.();
        })
        .catch((err) => onError?.(err));
    }
  }, []);

  // Create reconciler container once ready
  useEffect(() => {
    if (!ready) return;

    const container: Container = {
      root: null,
      onMesh,
      onError,
    };
    containerRef.current = container;

    fiberRef.current = reconciler.createContainer(
      container,
      0, // ConcurrentRoot = 1, LegacyRoot = 0
      null,
      false,
      null,
      'csg',
      (error) => onError?.(error),
      null
    );

    reconciler.updateContainer(children, fiberRef.current, null, () => {});

    return () => {
      reconciler.updateContainer(null, fiberRef.current, null, () => {});
    };
  }, [ready]);

  // Update children
  useEffect(() => {
    if (fiberRef.current && ready) {
      reconciler.updateContainer(children, fiberRef.current, null, () => {});
    }
  }, [children, ready]);

  // Update callbacks
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.onMesh = onMesh;
      containerRef.current.onError = onError;
    }
  }, [onMesh, onError]);

  return null;
}

// --- Primitive Components ---
// These are string types that the reconciler interprets

export const Cube = 'cube' as unknown as React.FC<{
  size?: number | [number, number, number];
  center?: boolean;
}>;

export const Sphere = 'sphere' as unknown as React.FC<{
  radius?: number;
  segments?: number;
}>;

export const Cylinder = 'cylinder' as unknown as React.FC<{
  radius?: number;
  radiusLow?: number;
  radiusHigh?: number;
  height?: number;
  segments?: number;
  center?: boolean;
}>;

export const Extrude = 'extrude' as unknown as React.FC<{
  polygon: [number, number][];
  height?: number;
}>;

// --- Boolean Operations ---

export const Union = 'union' as unknown as React.FC<{
  children: React.ReactNode;
}>;

export const Difference = 'difference' as unknown as React.FC<{
  children: React.ReactNode;
}>;

export const Intersection = 'intersection' as unknown as React.FC<{
  children: React.ReactNode;
}>;

// --- Transforms ---

export const Translate = 'translate' as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

export const Rotate = 'rotate' as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

export const Scale = 'scale' as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

// --- Group (useful for conditional rendering) ---

export const Group = 'group' as unknown as React.FC<{
  children: React.ReactNode;
}>;
```

---

## Part 5: Three.js Integration

```typescript
// src/three.ts

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
 * Update an existing BufferGeometry in place (avoids reallocation)
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
```

### React Three Fiber Integration

```tsx
// src/r3f.tsx

import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { Mesh } from 'manifold-3d';
import { CsgRoot } from './components';
import { meshToGeometry } from './three';

interface CsgMeshProps extends Omit<JSX.IntrinsicElements['mesh'], 'geometry'> {
  children: React.ReactNode;
}

export function CsgMesh({ children, ...meshProps }: CsgMeshProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh);

    // Dispose old geometry
    geometryRef.current?.dispose();
    geometryRef.current = newGeometry;

    setGeometry(newGeometry);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
    };
  }, []);

  return (
    <>
      <CsgRoot onMesh={handleMesh}>
        {children}
      </CsgRoot>
      {geometry && (
        <mesh geometry={geometry} {...meshProps}>
          <meshStandardMaterial color="#ff9900" />
        </mesh>
      )}
    </>
  );
}
```

---

## Part 6: Project Structure

```
react-manifold-renderer/
├── src/
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # TypeScript types
│   ├── manifold-module.ts          # WASM module wrapper
│   ├── components.tsx              # React components
│   ├── three.ts                    # Three.js utilities
│   ├── r3f.tsx                     # React Three Fiber integration
│   └── reconciler/
│       ├── index.ts                # Reconciler instance
│       ├── host-config.ts          # React reconciler host config
│       ├── nodes.ts                # Node management utilities
│       └── geometry-builder.ts     # CSG tree → Manifold builder
├── package.json
├── tsconfig.json
└── README.md
```

### package.json

```json
{
  "name": "react-manifold",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0"
  },
  "dependencies": {
    "manifold-3d": "^3.0.0",
    "react-reconciler": "^0.29.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "typescript": "^5.0.0"
  }
}
```

---

## Part 7: Implementation Phases

### Phase 1: Foundation
- [ ] Set up TypeScript project with build tooling
- [ ] Create manifold-module wrapper with async init
- [ ] Set up basic reconciler with host config
- [ ] Implement node creation, dirty tracking, disposal

### Phase 2: Primitives
- [ ] Implement Cube, Sphere, Cylinder
- [ ] Implement Extrude (from 2D polygon)
- [ ] Test primitives render correctly

### Phase 3: Boolean Operations
- [ ] Implement Union, Difference, Intersection
- [ ] Handle edge cases (empty children, single child)
- [ ] Test nested boolean operations

### Phase 4: Transforms
- [ ] Implement Translate, Rotate, Scale
- [ ] Test transform + boolean combinations

### Phase 5: Three.js Integration
- [ ] Implement meshToGeometry conversion
- [ ] Create CsgMesh component for r3f
- [ ] Build interactive example with controls

### Phase 6: Optimization & Polish
- [ ] Profile and optimize rebuild performance
- [ ] Add error boundaries for invalid CSG
- [ ] Add Suspense support for async init
- [ ] Write documentation and examples

---

## Caching Behavior

The caching strategy is simple and automatic:

1. **On prop change**: `commitUpdate` disposes old manifold, marks node dirty
2. **On structural change**: `appendChild`/`removeChild` marks parent dirty
3. **On rebuild**: `buildGeometry` skips nodes where `!dirty && manifold !== null`
4. **Dirty propagation**: Changes bubble up via `markDirty` (child change → parent dirty)

Example scenario:

```
Union (dirty: true)         ← needs rebuild because child changed
├── Cube (dirty: false)     ← cache hit, reuse manifold
└── Sphere (dirty: true)    ← radius changed, rebuild
```

Only the Sphere and Union are recomputed. The Cube's cached `Manifold` is reused.

---

## Memory Management

Manifold objects must be explicitly deleted (they're WASM handles). The reconciler handles this:

| Event | Action |
|-------|--------|
| Node removed from tree | `disposeNode()` deletes manifold + children |
| Props updated | `commitUpdate()` deletes old manifold |
| Container cleared | `clearContainer()` disposes entire tree |

The `buildGeometry` function also disposes old manifolds before rebuilding dirty nodes.

---

## Design Decisions

1. **Manifold ownership in boolean ops**: Assume operations like `mod.union([a, b])` return new objects and do *not* consume inputs. Child manifolds stay alive for caching. If this is wrong, we'll adjust during implementation.

2. **Async builds**: No. Keep it synchronous. Only add web worker complexity if real performance issues arise.

3. **Incremental mesh updates**: No. Rebuild the entire root mesh on each change. Premature optimization otherwise.

4. **Error recovery**: Simple - let CSG errors throw, catch in `resetAfterCommit`, call `onError` callback. No automatic recovery.

5. **Multiple roots**: Supported by default. Each `<CsgRoot>` creates its own container and works independently. No special code needed.

---

## Example Usage

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CsgMesh, Difference, Cube, Sphere, Translate } from 'react-manifold';

function App() {
  const [holeRadius, setHoleRadius] = useState(0.4);

  return (
    <div>
      <input
        type="range"
        min={0.1}
        max={0.9}
        step={0.05}
        value={holeRadius}
        onChange={(e) => setHoleRadius(parseFloat(e.target.value))}
      />

      <Canvas camera={{ position: [3, 3, 3] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} />

        <CsgMesh>
          <Difference>
            <Cube size={1} />
            <Sphere radius={holeRadius} segments={48} />
            <Translate x={0.5}>
              <Cylinder radius={0.2} height={2} />
            </Translate>
          </Difference>
        </CsgMesh>

        <OrbitControls />
      </Canvas>
    </div>
  );
}
```

---

## References

- [manifold-3d npm](https://www.npmjs.com/package/manifold-3d)
- [manifold GitHub](https://github.com/elalish/manifold)
- [react-reconciler](https://github.com/facebook/react/tree/main/packages/react-reconciler)
- [Building a Custom React Renderer](https://agent.dev/blog/build-custom-react-renderer)
- [react-three-fiber](https://docs.pmnd.rs/react-three-fiber)
