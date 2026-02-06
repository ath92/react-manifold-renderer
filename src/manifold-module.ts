import Module, { type ManifoldToplevel } from 'manifold-3d';

let modulePromise: Promise<ManifoldToplevel> | null = null;
let module: ManifoldToplevel | null = null;
let wasmPath: string | null = null;

/**
 * Set custom path to the manifold.wasm file.
 * Must be called before initManifold().
 */
export function setWasmPath(path: string): void {
  wasmPath = path;
}

export async function initManifold(): Promise<ManifoldToplevel> {
  if (module) return module;

  if (!modulePromise) {
    const config = wasmPath
      ? { locateFile: () => wasmPath! }
      : undefined;

    modulePromise = Module(config).then((m) => {
      m.setup();
      module = m;
      return m;
    });
  }

  return modulePromise;
}

export function getManifold(): ManifoldToplevel {
  if (!module) {
    throw new Error('Manifold not initialized. Call initManifold() first.');
  }
  return module;
}

export function isManifoldReady(): boolean {
  return module !== null;
}
