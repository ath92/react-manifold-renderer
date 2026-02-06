import React, { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { Mesh } from 'manifold-3d';
import { CsgRoot } from './components';
import { meshToGeometry } from './three';

interface CsgMeshProps {
  children: React.ReactNode;
  onError?: (error: Error) => void;
  material?: THREE.Material;
}

export function CsgMesh({ children, onError, material }: CsgMeshProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh);

    // Dispose old geometry
    geometryRef.current?.dispose();
    geometryRef.current = newGeometry;

    setGeometry(newGeometry);
  }, []);

  // Update Three.js mesh when geometry changes
  useEffect(() => {
    if (meshRef.current && geometry) {
      meshRef.current.geometry = geometry;
    }
  }, [geometry]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      geometryRef.current?.dispose();
    };
  }, []);

  // Create Three.js mesh imperatively for vanilla Three.js usage
  useEffect(() => {
    if (!meshRef.current) {
      meshRef.current = new THREE.Mesh(
        geometry ?? new THREE.BufferGeometry(),
        material ?? new THREE.MeshStandardMaterial({ color: 0xff9900 })
      );
    }
  }, [material, geometry]);

  return (
    <CsgRoot onMesh={handleMesh} onError={onError}>
      {children}
    </CsgRoot>
  );
}
