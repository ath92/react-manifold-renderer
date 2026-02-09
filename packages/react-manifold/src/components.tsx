import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Mesh } from "manifold-3d";
import { reconciler, Container } from "./reconciler";
import { initManifold, isManifoldReady } from "./manifold-module";
import type { OriginalIdMap } from "./reconciler/geometry-builder";

// --- Root Component ---

interface CsgRootProps {
  children: React.ReactNode;
  onMesh: (mesh: Mesh, idMap: OriginalIdMap) => void;
  onError?: (error: Error) => void;
  onReady?: () => void;
}

export function CsgRoot({ children, onMesh, onError, onReady }: CsgRootProps) {
  const [ready, setReady] = useState(isManifoldReady());
  const containerRef = useRef<Container | null>(null);
  const fiberRef = useRef<ReturnType<typeof reconciler.createContainer> | null>(
    null,
  );
  const childrenRef = useRef<React.ReactNode>(children);
  const onMeshRef = useRef(onMesh);
  const onErrorRef = useRef(onError);

  // Keep refs updated every render
  childrenRef.current = children;
  onMeshRef.current = onMesh;
  onErrorRef.current = onError;

  // Initialize WASM module
  useEffect(() => {
    let mounted = true;
    if (!ready) {
      initManifold()
        .then(() => {
          if (mounted) {
            setReady(true);
            onReady?.();
          }
        })
        .catch((err) => onErrorRef.current?.(err));
    }
    return () => {
      mounted = false;
    };
  }, [ready, onReady]);

  // Create container and update children
  useLayoutEffect(() => {
    if (!ready) return;

    // Create container once
    if (!fiberRef.current) {
      const container: Container = {
        root: null,
        onMesh: (mesh, idMap) => onMeshRef.current(mesh, idMap),
        onError: (err) => onErrorRef.current?.(err),
      };
      containerRef.current = container;

      fiberRef.current = reconciler.createContainer(
        container,
        0, // LegacyRoot
        null, // hydrationCallbacks
        false, // isStrictMode
        null, // concurrentUpdatesByDefaultOverride
        "csg", // identifierPrefix
        (error: Error) => onErrorRef.current?.(error), // onUncaughtError
        (error: Error) => onErrorRef.current?.(error), // onCaughtError
        (error: Error) => onErrorRef.current?.(error), // onRecoverableError
        () => {}, // onDefaultTransitionIndicator
      );
    }

    // Update children
    reconciler.updateContainer(
      childrenRef.current,
      fiberRef.current,
      null,
      () => {},
    );
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fiberRef.current) {
        reconciler.updateContainer(null, fiberRef.current, null, () => {});
        fiberRef.current = null;
      }
    };
  }, []);

  return null;
}

// --- Primitive Components ---

export const Cube = "cube" as unknown as React.FC<{
  size?: number | [number, number, number];
  center?: boolean;
  nodeId?: string;
}>;

export const Sphere = "sphere" as unknown as React.FC<{
  radius?: number;
  segments?: number;
  nodeId?: string;
}>;

export const Cylinder = "cylinder" as unknown as React.FC<{
  radius?: number;
  radiusLow?: number;
  radiusHigh?: number;
  height?: number;
  segments?: number;
  center?: boolean;
  nodeId?: string;
}>;

export const Extrude = "extrude" as unknown as React.FC<{
  polygon: [number, number][];
  height?: number;
  nodeId?: string;
}>;

// --- Boolean Operations ---

export const Union = "union" as unknown as React.FC<{
  children: React.ReactNode;
}>;

export const Difference = "difference" as unknown as React.FC<{
  children: React.ReactNode;
}>;

export const Intersection = "intersection" as unknown as React.FC<{
  children: React.ReactNode;
}>;

// --- Transforms ---

export const Translate = "translate" as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

export const Rotate = "rotate" as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

export const Scale = "scale" as unknown as React.FC<{
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}>;

// --- Group ---

export const Group = "group" as unknown as React.FC<{
  children: React.ReactNode;
}>;
