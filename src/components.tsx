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
  const fiberRef = useRef<ReturnType<typeof reconciler.createContainer> | null>(null);

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
      0, // LegacyRoot
      null, // hydrationCallbacks
      false, // isStrictMode
      null, // concurrentUpdatesByDefaultOverride
      'csg', // identifierPrefix
      (error: Error) => onError?.(error), // onUncaughtError
      (error: Error) => onError?.(error), // onCaughtError
      (error: Error) => onError?.(error), // onRecoverableError
      () => {} // onDefaultTransitionIndicator
    );

    reconciler.updateContainer(children, fiberRef.current, null, () => {});

    return () => {
      reconciler.updateContainer(null, fiberRef.current!, null, () => {});
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

// --- Group ---

export const Group = 'group' as unknown as React.FC<{
  children: React.ReactNode;
}>;
