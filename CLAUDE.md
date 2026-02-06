# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifold Studio is a 3D solid modeling tool built with React. The project uses a monorepo structure with:

- **apps/studio** - The main 3D modeling application (React + Three.js + React Three Fiber)
- **packages/react-manifold** - Custom React renderer for declarative CSG modeling using manifold-3d

## Commands

```bash
# Install dependencies (from root)
pnpm install

# Development
pnpm dev                # Start the studio app dev server
pnpm build              # Build all packages and apps
pnpm build:lib          # Build only the react-manifold library
pnpm build:studio       # Build only the studio app
pnpm typecheck          # Type check all packages
pnpm lint               # Lint all packages
pnpm clean              # Clean all build outputs

# Working in specific packages
cd packages/react-manifold && pnpm dev    # Watch mode for library
cd apps/studio && pnpm dev                # Start studio dev server
```

## Monorepo Structure

```
├── apps/
│   └── studio/              # 3D modeling application
│       └── src/
│           ├── App.tsx      # Main app with building generator demo
│           └── main.tsx     # Entry point, sets WASM path
├── packages/
│   └── react-manifold/      # CSG React renderer library
│       └── src/
│           ├── components.tsx       # CsgRoot + primitive components
│           ├── reconciler/          # React reconciler implementation
│           ├── three.ts             # Three.js BufferGeometry conversion
│           └── r3f.tsx              # React Three Fiber integration
└── pnpm-workspace.yaml
```

## Library Architecture (packages/react-manifold)

### React Reconciler Pattern
The library implements a custom React reconciler (similar to react-three-fiber) that maps React component operations to CSG tree mutations:

1. **Host Config** (`src/reconciler/host-config.ts`) - Implements react-reconciler interface. Key methods:
   - `createInstance` - Creates CsgNode for each element type
   - `appendChild/removeChild/insertBefore` - Tree mutations that call `markDirty`
   - `commitUpdate` - Handles prop changes, disposes old manifold handles
   - `resetAfterCommit` - Triggers geometry rebuild after React commits

2. **Geometry Builder** (`src/reconciler/geometry-builder.ts`) - Recursively builds Manifold objects from CsgNode tree. Uses dirty tracking to skip unchanged subtrees.

3. **Node Management** (`src/reconciler/nodes.ts`) - CsgNode creation, dirty propagation up the tree, and disposal of WASM handles.

### Data Flow
```
React Components → CsgRoot → Reconciler → CsgNode Tree → buildGeometry() → Manifold → getMesh() → onMesh callback
```

### WASM Integration
- `manifold-module.ts` manages WASM lifecycle. Must call `m.setup()` after initialization.
- Manifold objects are WASM handles requiring explicit `.delete()` calls to prevent memory leaks.
- `setWasmPath()` must be called before `initManifold()` if using custom WASM location.

### Component Types
- **Primitives**: Cube, Sphere, Cylinder, Extrude
- **Boolean Operations**: Union, Difference, Intersection
- **Transforms**: Translate, Rotate, Scale
- **Group**: Passthrough that unions children

## Key Patterns

### Props Comparison
`prepareUpdate` uses deep equality for arrays/objects to avoid unnecessary rebuilds when props like `size={[1,1,1]}` are re-created each render.

### Avoiding Infinite Loops
`resetAfterCommit` uses `queueMicrotask` to defer `onMesh` callback, breaking synchronous update cycles.

### Memory Management
- Single-child boolean operations use `translate([0,0,0])` to create copies, avoiding shared ownership double-free issues.
- `disposeNode` recursively cleans up WASM handles when subtrees are removed.

## Vite Integration

The studio app requires specific Vite config for WASM:
- `vite-plugin-static-copy` copies manifold.wasm to public
- `resolve.dedupe` for react/react-dom/react-reconciler prevents multiple React copies
- `optimizeDeps.exclude` for manifold-3d

## React Version Compatibility

Uses React 18 with react-reconciler@0.29. The studio app uses @react-three/fiber@8 for compatibility.
