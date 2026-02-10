import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import type { Mesh } from "manifold-3d";
import { CsgRoot, meshToGeometry } from "@manifold-studio/react-manifold";
import type { CsgTreeNode } from "../types/CsgTree";
import {
  findNodeById,
  getAncestorTransforms,
  applyTransformDelta,
  multiplyMatrices,
  makeTranslationMatrix,
  makeRotationMatrix,
  makeScaleMatrix,
} from "../types/CsgTree";
import { CsgTreeRenderer } from "./CsgTreeRenderer";
import { useTransformMode, useSetIsDraggingGizmo } from "../store";
import { useUpdateShape } from "../sync-store";

// ─── Ancestor Matrix ─────────────────────────────────────────────────────────

/**
 * Build a Three.js Matrix4 from a chain of CSG ancestor transform matrices.
 * No coordinate conversion needed — Three.js camera is Z-up, same as CSG.
 */
function buildAncestorMatrix(matrices: number[][]): THREE.Matrix4 {
  let combined = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const m of matrices) {
    combined = multiplyMatrices(combined, m);
  }
  const result = new THREE.Matrix4();
  result.fromArray(combined);
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SelectionOverlayProps {
  tree: CsgTreeNode;
  selectedId: string;
}

export function SelectionOverlay({ tree, selectedId }: SelectionOverlayProps) {
  const [selectionGeometry, setSelectionGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const groupRef = useRef<THREE.Group>(null!);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);
  const transformMode = useTransformMode();
  const setIsDraggingGizmo = useSetIsDraggingGizmo();
  const updateShape = useUpdateShape();

  const selectedNode = useMemo(
    () => findNodeById(tree, selectedId),
    [tree, selectedId],
  );

  // Compute ancestor matrix
  const ancestorMatrix = useMemo(() => {
    const matrices = getAncestorTransforms(tree, selectedId);
    if (!matrices || matrices.length === 0) return new THREE.Matrix4();
    return buildAncestorMatrix(matrices);
  }, [tree, selectedId]);

  // Decompose the ancestor matrix to get the "original" position/rotation/scale
  const originalTransform = useMemo(() => {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    ancestorMatrix.decompose(pos, quat, scl);
    return { pos, quat, scl };
  }, [ancestorMatrix]);

  // Apply ancestor matrix to group whenever it changes
  useEffect(() => {
    if (!groupRef.current) return;
    const { pos, quat, scl } = originalTransform;
    groupRef.current.position.copy(pos);
    groupRef.current.quaternion.copy(quat);
    groupRef.current.scale.copy(scl);
  }, [originalTransform]);

  // Listen for dragging-changed on TransformControls
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDraggingChanged = (event: any) => {
      setIsDraggingGizmo(event.value as boolean);
    };

    controls.addEventListener("dragging-changed", onDraggingChanged);
    return () => {
      controls.removeEventListener("dragging-changed", onDraggingChanged);
    };
  }, [setIsDraggingGizmo, selectedNode]);

  // Handle selection mesh from the second CsgRoot
  const handleSelectionMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
    setSelectionGeometry((prev) => {
      prev?.dispose();
      return newGeometry;
    });
  }, []);

  // Commit transform on mouse up
  const handleMouseUp = useCallback(() => {
    if (!groupRef.current) return;
    const group = groupRef.current;
    const { pos: origPos, quat: origQuat, scl: origScl } = originalTransform;

    let deltaMatrix: number[] | null = null;

    if (transformMode === "translate") {
      const dx = group.position.x - origPos.x;
      const dy = group.position.y - origPos.y;
      const dz = group.position.z - origPos.z;

      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(dz) < 1e-6)
        return;

      deltaMatrix = makeTranslationMatrix(dx, dy, dz);
    } else if (transformMode === "rotate") {
      const deltaQuat = origQuat.clone().invert().premultiply(group.quaternion);
      const euler = new THREE.Euler().setFromQuaternion(deltaQuat, "XYZ");

      const dxDeg = (euler.x * 180) / Math.PI;
      const dyDeg = (euler.y * 180) / Math.PI;
      const dzDeg = (euler.z * 180) / Math.PI;

      if (
        Math.abs(dxDeg) < 0.01 &&
        Math.abs(dyDeg) < 0.01 &&
        Math.abs(dzDeg) < 0.01
      )
        return;

      deltaMatrix = makeRotationMatrix(dxDeg, dyDeg, dzDeg);
    } else if (transformMode === "scale") {
      const sx = group.scale.x / origScl.x;
      const sy = group.scale.y / origScl.y;
      const sz = group.scale.z / origScl.z;

      if (
        Math.abs(sx - 1) < 1e-6 &&
        Math.abs(sy - 1) < 1e-6 &&
        Math.abs(sz - 1) < 1e-6
      )
        return;

      deltaMatrix = makeScaleMatrix(sx, sy, sz);
    }

    if (deltaMatrix) {
      const newTree = applyTransformDelta(tree, selectedId, deltaMatrix);
      if (newTree) {
        updateShape(tree.id, newTree);
      }
    }

    // Reset group to ancestor transform
    const { pos, quat, scl } = originalTransform;
    group.position.copy(pos);
    group.quaternion.copy(quat);
    group.scale.copy(scl);
  }, [transformMode, originalTransform, tree, selectedId, updateShape]);

  // Cleanup geometry on unmount
  useEffect(() => {
    return () => {
      selectionGeometry?.dispose();
    };
  }, [selectionGeometry]);

  if (!selectedNode) return null;

  return (
    <>
      {/* Build selection subtree geometry via a second CsgRoot */}
      <CsgRoot onMesh={handleSelectionMesh}>
        <CsgTreeRenderer node={selectedNode} />
      </CsgRoot>

      {/* Selection overlay mesh positioned by ancestor transforms */}
      <group ref={groupRef}>
        {selectionGeometry && (
          <mesh geometry={selectionGeometry as unknown as THREE.BufferGeometry}>
            <meshStandardMaterial
              color="#ff6b6b"
              transparent
              opacity={0.4}
              depthTest={false}
              flatShading
            />
          </mesh>
        )}
      </group>

      {/* Transform gizmo */}
      <TransformControls
        ref={controlsRef}
        object={groupRef.current ?? undefined}
        mode={transformMode}
        onMouseUp={handleMouseUp}
      />
    </>
  );
}
