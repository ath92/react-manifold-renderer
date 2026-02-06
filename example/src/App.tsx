import { useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Mesh } from 'manifold-3d';
import {
  CsgRoot,
  Difference,
  Union,
  Intersection,
  Cube,
  Sphere,
  Cylinder,
  Translate,
  Rotate,
  meshToGeometry,
} from 'react-manifold';

type Operation = 'difference' | 'union' | 'intersection';

function CsgGeometry({
  operation,
  sphereRadius,
  cylinderRadius,
}: {
  operation: Operation;
  sphereRadius: number;
  cylinderRadius: number;
}) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleMesh = useCallback((mesh: Mesh) => {
    const newGeometry = meshToGeometry(mesh);
    setGeometry((prev) => {
      prev?.dispose();
      return newGeometry;
    });
    setError(null);
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error('CSG Error:', err);
    setError(err.message);
  }, []);

  const children = (
    <>
      <Cube size={1} />
      <Sphere radius={sphereRadius} segments={48} />
      <Translate x={0.5}>
        <Rotate z={90}>
          <Cylinder radius={cylinderRadius} height={2} />
        </Rotate>
      </Translate>
      <Translate y={0.5}>
        <Rotate x={90}>
          <Cylinder radius={cylinderRadius} height={2} />
        </Rotate>
      </Translate>
      <Translate z={0.5}>
        <Cylinder radius={cylinderRadius} height={2} />
      </Translate>
    </>
  );

  const OperationComponent =
    operation === 'difference'
      ? Difference
      : operation === 'union'
        ? Union
        : Intersection;

  return (
    <>
      <CsgRoot onMesh={handleMesh} onError={handleError}>
        <OperationComponent>{children}</OperationComponent>
      </CsgRoot>
      {error && (
        <mesh position={[0, 2, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}
      {geometry && (
        <mesh geometry={geometry}>
          <meshStandardMaterial color="#ff9900" flatShading />
        </mesh>
      )}
    </>
  );
}

function App() {
  const [operation, setOperation] = useState<Operation>('difference');
  const [sphereRadius, setSphereRadius] = useState(0.65);
  const [cylinderRadius, setCylinderRadius] = useState(0.25);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      <div
        style={{
          width: '250px',
          padding: '20px',
          background: '#1a1a1a',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <h2 style={{ margin: 0 }}>React Manifold</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#888' }}>
          CSG operations with React
        </p>

        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            Operation
          </label>
          <select
            value={operation}
            onChange={(e) => setOperation(e.target.value as Operation)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: 'none',
              background: '#333',
              color: '#fff',
            }}
          >
            <option value="difference">Difference</option>
            <option value="union">Union</option>
            <option value="intersection">Intersection</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            Sphere Radius: {sphereRadius.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.01}
            value={sphereRadius}
            onChange={(e) => setSphereRadius(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px' }}>
            Cylinder Radius: {cylinderRadius.toFixed(2)}
          </label>
          <input
            type="range"
            min={0.05}
            max={0.5}
            step={0.01}
            value={cylinderRadius}
            onChange={(e) => setCylinderRadius(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ marginTop: 'auto', fontSize: '12px', color: '#666' }}>
          <p>Drag to rotate</p>
          <p>Scroll to zoom</p>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <Canvas camera={{ position: [2.5, 2.5, 2.5], fov: 50 }}>
          <color attach="background" args={['#242424']} />
          <ambientLight intensity={0.4} />
          <directionalLight position={[10, 10, 10]} intensity={1} />
          <directionalLight position={[-10, -10, -10]} intensity={0.3} />

          <CsgGeometry
            operation={operation}
            sphereRadius={sphereRadius}
            cylinderRadius={cylinderRadius}
          />

          <gridHelper args={[4, 20, '#444', '#333']} />
          <OrbitControls makeDefault />
        </Canvas>
      </div>
    </div>
  );
}

export default App;
