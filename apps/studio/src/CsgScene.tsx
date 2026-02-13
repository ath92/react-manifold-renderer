import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import {
  findDirectChildAncestor,
  findNodeById,
  getAncestorTransforms,
  hasChildren,
  multiplyMatrices,
  replaceNode,
  genId,
  type CsgTreeNode,
  type CsgGroupNode,
} from "./types/CsgTree";
import {
  useCursorParentId,
  useSelectedId,
  useSetCursorParentId,
  useSetSelectedId,
  usePreviewTree,
} from "./store";
import {
  buildTriNodeIdMap,
  CsgRoot,
  meshToGeometry,
  nodeIdForFace,
  type OriginalIdMap,
  type TriNodeIdMap,
} from "@manifold-studio/react-manifold";
import type { Mesh } from "manifold-3d";
import type { ThreeEvent } from "@react-three/fiber";
import { CsgTreeRenderer } from "./components/CsgTreeRenderer";
import { SelectionOverlay } from "./components/SelectionOverlay";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_GROUP: CsgGroupNode = { id: genId(), type: "group", children: [] };

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

export function CsgScene({ tree }: { tree: CsgTreeNode }) {
  // Active part (cursor subtree)
  const [activeGeometry, setActiveGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  // Inactive part (everything else)
  const [inactiveGeometry, setInactiveGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedId = useSelectedId();
  const setSelectedId = useSetSelectedId();
  const cursorParentId = useCursorParentId();
  const setCursorParentId = useSetCursorParentId();
  const previewTree = usePreviewTree();
  const activeTriMapRef = useRef<TriNodeIdMap>([]);
  const activeGroupRef = useRef<THREE.Group>(null!);

  // Determine the cursor node (if any)
  const cursorNode = useMemo(
    () => (cursorParentId ? findNodeById(tree, cursorParentId) : null),
    [tree, cursorParentId],
  );

  // Active tree: the cursor node, or the full tree if no cursor
  const activeTree = cursorNode ?? tree;

  // Inactive tree: full tree with cursor node replaced by empty group
  // Only needed when a cursor is active
  const inactiveTree = useMemo(() => {
    if (!cursorParentId || !cursorNode) return null;
    return replaceNode(tree, cursorParentId, EMPTY_GROUP);
  }, [tree, cursorParentId, cursorNode]);

  // Clear stale inactive geometry when leaving cursor mode
  if (!inactiveTree && inactiveGeometry) {
    inactiveGeometry.dispose();
    setInactiveGeometry(null);
  }

  // Ancestor matrix to position the active geometry correctly
  const ancestorMatrix = useMemo(() => {
    if (!cursorParentId) return null;
    const matrices = getAncestorTransforms(tree, cursorParentId);
    if (!matrices || matrices.length === 0) return null;
    return buildAncestorMatrix(matrices);
  }, [tree, cursorParentId]);

  // Apply ancestor matrix to the active group
  useEffect(() => {
    if (!activeGroupRef.current) return;
    if (ancestorMatrix) {
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      ancestorMatrix.decompose(pos, quat, scl);
      activeGroupRef.current.position.copy(pos);
      activeGroupRef.current.quaternion.copy(quat);
      activeGroupRef.current.scale.copy(scl);
    } else {
      activeGroupRef.current.position.set(0, 0, 0);
      activeGroupRef.current.quaternion.identity();
      activeGroupRef.current.scale.set(1, 1, 1);
    }
  }, [ancestorMatrix]);

  const handleActiveMesh = useCallback((mesh: Mesh, idMap: OriginalIdMap) => {
    const newGeometry = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
    activeTriMapRef.current = buildTriNodeIdMap(mesh, idMap);
    setActiveGeometry((prev) => {
      prev?.dispose();
      return newGeometry;
    });
    setError(null);
  }, []);

  const handleInactiveMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh) as unknown as THREE.BufferGeometry;
    setInactiveGeometry((prev) => {
      prev?.dispose();
      return newGeometry;
    });
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error("CSG Error:", err);
    setError(err.message);
  }, []);

  // Resolve a face click to the correct node at the current cursor level
  const resolveClickTarget = useCallback(
    (faceIndex: number): string | undefined => {
      const leafId = nodeIdForFace(activeTriMapRef.current, faceIndex);
      if (!leafId) return undefined;
      // The active tree root is the effective cursor parent
      return findDirectChildAncestor(activeTree, leafId, activeTree.id);
    },
    [activeTree],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.faceIndex != null) {
        const resolvedId = resolveClickTarget(e.faceIndex);
        if (resolvedId) {
          setSelectedId(resolvedId);
        }
      }
    },
    [setSelectedId, resolveClickTarget],
  );

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      if (e.faceIndex != null) {
        const resolvedId = resolveClickTarget(e.faceIndex);
        if (resolvedId) {
          const node = findNodeById(activeTree, resolvedId);
          if (node && hasChildren(node)) {
            setCursorParentId(node.id);
            return;
          }
        }
      }
    },
    [activeTree, resolveClickTarget, setCursorParentId],
  );

  const selectedNode = selectedId ? findNodeById(tree, selectedId) : undefined;

  return (
    <>
      {/* Active CSG: cursor subtree (or full tree if no cursor) */}
      <CsgRoot onMesh={handleActiveMesh} onError={handleError}>
        <CsgTreeRenderer node={activeTree} />
      </CsgRoot>

      {/* Inactive CSG: everything outside the cursor */}
      {inactiveTree && (
        <CsgRoot onMesh={handleInactiveMesh} onError={handleError}>
          <CsgTreeRenderer node={inactiveTree} />
        </CsgRoot>
      )}

      {error && (
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}

      {/* Active mesh — interactive */}
      <group ref={activeGroupRef}>
        {activeGeometry && (
          <mesh
            geometry={activeGeometry}
            onClick={previewTree ? undefined : handleClick}
            onDoubleClick={previewTree ? undefined : handleDoubleClick}
          >
            <meshStandardMaterial color="#e8d4b8" flatShading />
          </mesh>
        )}
      </group>

      {/* Inactive mesh — transparent, non-interactive */}
      {inactiveGeometry && (
        <mesh geometry={inactiveGeometry}>
          <meshStandardMaterial
            color="#e8d4b8"
            flatShading
            transparent
            opacity={0.3}
          />
        </mesh>
      )}

      {selectedNode && !previewTree && (
        <SelectionOverlay tree={tree} selectedId={selectedId!} />
      )}
    </>
  );
}
