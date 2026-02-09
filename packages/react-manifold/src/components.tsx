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

// Host element: accepts a 16-element column-major 4×4 matrix
export const Transform = "transform" as unknown as React.FC<{
  matrix: number[];
  children?: React.ReactNode;
}>;

// Matrix helpers (column-major)

function makeTranslationMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

function makeRotationMatrix(
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

function makeScaleMatrix(x: number, y: number, z: number): number[] {
  // prettier-ignore
  return [
    x, 0, 0, 0,
    0, y, 0, 0,
    0, 0, z, 0,
    0, 0, 0, 1,
  ];
}

// Convenience wrapper components

export function Translate({
  x = 0,
  y = 0,
  z = 0,
  children,
}: {
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}) {
  const matrix = React.useMemo(() => makeTranslationMatrix(x, y, z), [x, y, z]);
  return React.createElement(Transform, { matrix }, children);
}

export function Rotate({
  x = 0,
  y = 0,
  z = 0,
  children,
}: {
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}) {
  const matrix = React.useMemo(() => makeRotationMatrix(x, y, z), [x, y, z]);
  return React.createElement(Transform, { matrix }, children);
}

export function Scale({
  x = 1,
  y = 1,
  z = 1,
  children,
}: {
  x?: number;
  y?: number;
  z?: number;
  children: React.ReactNode;
}) {
  const matrix = React.useMemo(() => makeScaleMatrix(x, y, z), [x, y, z]);
  return React.createElement(Transform, { matrix }, children);
}

// --- Group ---

export const Group = "group" as unknown as React.FC<{
  children: React.ReactNode;
}>;
