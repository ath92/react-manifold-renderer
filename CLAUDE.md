# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

react-manifold is a custom React renderer for declarative CSG (Constructive Solid Geometry) modeling using the manifold-3d WASM library. It allows building 3D geometry using React components with boolean operations, transforms, and primitives.

## Commands

```bash
# Library development
pnpm build              # Build library with tsup (outputs to dist/)
pnpm dev                # Watch mode for library development
pnpm typecheck          # TypeScript type checking
pnpm lint               # ESLint
pnpm clean              # Remove dist/

# Example app (runs from root)
pnpm example            # Build library then start example Vite dev server

# Example app directly
cd example && pnpm dev  # Start example dev server (requires library built first)
```

## Architecture

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

The example app demonstrates required Vite config for WASM:
- `vite-plugin-static-copy` copies manifold.wasm to public
- `resolve.dedupe` for react/react-dom/react-reconciler prevents multiple React copies
- `optimizeDeps.exclude` for manifold-3d

## React Version Compatibility

Uses React 18 with react-reconciler@0.29. The example pins to React 18 and @react-three/fiber@8 for compatibility.
