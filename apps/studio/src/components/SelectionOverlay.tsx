import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import type { Mesh } from "manifold-3d";
import {
  CsgRoot,
  Rotate,
  meshToGeometry,
} from "@manifold-studio/react-manifold";
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
import {
  useTransformMode,
  useSetIsDraggingGizmo,
  useUpdateShape,
} from "../store";

// ─── Coordinate Conversion ───────────────────────────────────────────────────
// CSG is Z-up, Three.js is Y-up. The CsgRoot applies <Rotate x={-90}> which
// rotates CSG output into Three.js space. We need the same rotation for the
// ancestor transform matrix so the selection overlay aligns with the main mesh.

const Z_UP_TO_Y_UP = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const Y_UP_TO_Z_UP = new THREE.Matrix4().makeRotationX(Math.PI / 2);

/**
 * Build a Three.js Matrix4 from a chain of CSG ancestor transform matrices,
 * converted to Three.js Y-up space.
 */
function buildAncestorMatrix(matrices: number[][]): THREE.Matrix4 {
  // Multiply all ancestor matrices together (root-to-target order)
  let combined = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const m of matrices) {
    combined = multiplyMatrices(combined, m);
  }

  const csgMatrix = new THREE.Matrix4();
  csgMatrix.fromArray(combined);

  // Convert to Three.js Y-up space: R * M_csg * R^-1
  const result = new THREE.Matrix4();
  result.multiplyMatrices(Z_UP_TO_Y_UP, csgMatrix);
  result.multiply(Y_UP_TO_Z_UP);
  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface SelectionOverlayProps {
  tree: CsgTreeNode;
  selectedId: string;
  shapeIndex: number;
}

export function SelectionOverlay({
  tree,
  selectedId,
  shapeIndex,
}: SelectionOverlayProps) {
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
      const dx3 = group.position.x - origPos.x;
      const dy3 = group.position.y - origPos.y;
      const dz3 = group.position.z - origPos.z;

      if (Math.abs(dx3) < 1e-6 && Math.abs(dy3) < 1e-6 && Math.abs(dz3) < 1e-6)
        return;

      // Three.js Y-up (x, y, z) → CSG Z-up (x, -z, y)
      deltaMatrix = makeTranslationMatrix(dx3, -dz3, dy3);
    } else if (transformMode === "rotate") {
      const deltaQuat = origQuat.clone().invert().premultiply(group.quaternion);
      const euler3 = new THREE.Euler().setFromQuaternion(deltaQuat, "XYZ");

      const dxDeg = (euler3.x * 180) / Math.PI;
      const dyDeg = (euler3.y * 180) / Math.PI;
      const dzDeg = (euler3.z * 180) / Math.PI;

      if (
        Math.abs(dxDeg) < 0.01 &&
        Math.abs(dyDeg) < 0.01 &&
        Math.abs(dzDeg) < 0.01
      )
        return;

      // Three.js Y-up rot(x, y, z) → CSG Z-up rot(x, -z, y)
      deltaMatrix = makeRotationMatrix(dxDeg, -dzDeg, dyDeg);
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

      // Three.js Y-up scale(x, y, z) → CSG Z-up scale(x, z, y)
      deltaMatrix = makeScaleMatrix(sx, sz, sy);
    }

    if (deltaMatrix) {
      const newTree = applyTransformDelta(tree, selectedId, deltaMatrix);
      if (newTree) {
        updateShape(shapeIndex, newTree);
      }
    }

    // Reset group to ancestor transform
    const { pos, quat, scl } = originalTransform;
    group.position.copy(pos);
    group.quaternion.copy(quat);
    group.scale.copy(scl);
  }, [
    transformMode,
    originalTransform,
    tree,
    selectedId,
    shapeIndex,
    updateShape,
  ]);

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
        <Rotate x={-90}>
          <CsgTreeRenderer node={selectedNode} />
        </Rotate>
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
