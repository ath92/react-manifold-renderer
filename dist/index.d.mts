import React from 'react';
import { Mesh, ManifoldToplevel, Manifold } from 'manifold-3d';
import * as THREE from 'three';
import * as react_jsx_runtime from 'react/jsx-runtime';

interface CsgRootProps {
    children: React.ReactNode;
    onMesh: (mesh: Mesh) => void;
    onError?: (error: Error) => void;
    onReady?: () => void;
}
declare function CsgRoot({ children, onMesh, onError, onReady }: CsgRootProps): null;
declare const Cube: React.FC<{
    size?: number | [number, number, number];
    center?: boolean;
}>;
declare const Sphere: React.FC<{
    radius?: number;
    segments?: number;
}>;
declare const Cylinder: React.FC<{
    radius?: number;
    radiusLow?: number;
    radiusHigh?: number;
    height?: number;
    segments?: number;
    center?: boolean;
}>;
declare const Extrude: React.FC<{
    polygon: [number, number][];
    height?: number;
}>;
declare const Union: React.FC<{
    children: React.ReactNode;
}>;
declare const Difference: React.FC<{
    children: React.ReactNode;
}>;
declare const Intersection: React.FC<{
    children: React.ReactNode;
}>;
declare const Translate: React.FC<{
    x?: number;
    y?: number;
    z?: number;
    children: React.ReactNode;
}>;
declare const Rotate: React.FC<{
    x?: number;
    y?: number;
    z?: number;
    children: React.ReactNode;
}>;
declare const Scale: React.FC<{
    x?: number;
    y?: number;
    z?: number;
    children: React.ReactNode;
}>;
declare const Group: React.FC<{
    children: React.ReactNode;
}>;

/**
 * Set custom path to the manifold.wasm file.
 * Must be called before initManifold().
 */
declare function setWasmPath(path: string): void;
declare function initManifold(): Promise<ManifoldToplevel>;
declare function isManifoldReady(): boolean;

/**
 * Convert manifold-3d Mesh to Three.js BufferGeometry
 */
declare function meshToGeometry(mesh: Mesh): THREE.BufferGeometry;
/**
 * Update an existing BufferGeometry in place
 */
declare function updateGeometry(geometry: THREE.BufferGeometry, mesh: Mesh): void;

interface CsgMeshProps {
    children: React.ReactNode;
    onError?: (error: Error) => void;
    material?: THREE.Material;
}
declare function CsgMesh({ children, onError, material }: CsgMeshProps): react_jsx_runtime.JSX.Element;

interface CsgNode {
    type: NodeType;
    props: Record<string, unknown>;
    children: CsgNode[];
    parent: CsgNode | null;
    manifold: Manifold | null;
    dirty: boolean;
}
type PrimitiveType = 'cube' | 'sphere' | 'cylinder' | 'extrude';
type BooleanType = 'union' | 'difference' | 'intersection';
type TransformType = 'translate' | 'rotate' | 'scale';
type GroupType = 'group';
type NodeType = PrimitiveType | BooleanType | TransformType | GroupType;
interface MeshData {
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    numProp: number;
}

export { CsgMesh, type CsgNode, CsgRoot, Cube, Cylinder, Difference, Extrude, Group, Intersection, type MeshData, type NodeType, Rotate, Scale, Sphere, Translate, Union, initManifold, isManifoldReady, meshToGeometry, setWasmPath, updateGeometry };
