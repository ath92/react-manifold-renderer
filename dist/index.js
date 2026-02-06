"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CsgMesh: () => CsgMesh,
  CsgRoot: () => CsgRoot,
  Cube: () => Cube,
  Cylinder: () => Cylinder,
  Difference: () => Difference,
  Extrude: () => Extrude,
  Group: () => Group,
  Intersection: () => Intersection,
  Rotate: () => Rotate,
  Scale: () => Scale,
  Sphere: () => Sphere,
  Translate: () => Translate,
  Union: () => Union,
  initManifold: () => initManifold,
  isManifoldReady: () => isManifoldReady,
  meshToGeometry: () => meshToGeometry,
  setWasmPath: () => setWasmPath,
  updateGeometry: () => updateGeometry
});
module.exports = __toCommonJS(index_exports);

// src/components.tsx
var import_react = require("react");

// src/reconciler/index.ts
var import_react_reconciler = __toESM(require("react-reconciler"));

// src/reconciler/nodes.ts
function createNode(type, props) {
  return {
    type,
    props,
    children: [],
    parent: null,
    manifold: null,
    dirty: true
  };
}
function markDirty(node) {
  let current = node;
  while (current !== null) {
    if (current.dirty) break;
    current.dirty = true;
    current = current.parent;
  }
}
function disposeNode(node) {
  if (node.manifold) {
    node.manifold.delete();
    node.manifold = null;
  }
  for (const child of node.children) {
    disposeNode(child);
  }
}

// src/manifold-module.ts
var import_manifold_3d = __toESM(require("manifold-3d"));
var modulePromise = null;
var module2 = null;
var wasmPath = null;
function setWasmPath(path) {
  wasmPath = path;
}
async function initManifold() {
  if (module2) return module2;
  if (!modulePromise) {
    const config = wasmPath ? { locateFile: () => wasmPath } : void 0;
    modulePromise = (0, import_manifold_3d.default)(config).then((m) => {
      m.setup();
      module2 = m;
      return m;
    });
  }
  return modulePromise;
}
function getManifold() {
  if (!module2) {
    throw new Error("Manifold not initialized. Call initManifold() first.");
  }
  return module2;
}
function isManifoldReady() {
  return module2 !== null;
}

// src/reconciler/geometry-builder.ts
function buildGeometry(node) {
  if (!node.dirty && node.manifold) {
    return node.manifold;
  }
  if (node.manifold) {
    node.manifold.delete();
    node.manifold = null;
  }
  const mod = getManifold();
  const { Manifold: M, CrossSection } = mod;
  const childManifolds = [];
  for (const child of node.children) {
    const m = buildGeometry(child);
    if (m) childManifolds.push(m);
  }
  let result = null;
  switch (node.type) {
    // --- Primitives ---
    case "cube": {
      const size = normalizeVec3(node.props.size, [1, 1, 1]);
      const center = node.props.center ?? true;
      result = M.cube(size, center);
      break;
    }
    case "sphere": {
      const radius = node.props.radius ?? 1;
      const segments = node.props.segments ?? 32;
      result = M.sphere(radius, segments);
      break;
    }
    case "cylinder": {
      const radiusLow = node.props.radius ?? node.props.radiusLow ?? 1;
      const radiusHigh = node.props.radiusHigh ?? radiusLow;
      const height = node.props.height ?? 1;
      const segments = node.props.segments ?? 32;
      const center = node.props.center ?? true;
      result = M.cylinder(height, radiusLow, radiusHigh, segments, center);
      break;
    }
    case "extrude": {
      const polygon = node.props.polygon;
      const height = node.props.height ?? 1;
      if (polygon && polygon.length >= 3) {
        const crossSection = new CrossSection([polygon], "Positive");
        result = M.extrude(crossSection, height);
        crossSection.delete();
      }
      break;
    }
    // --- Boolean Operations ---
    case "union": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else {
        result = M.union(childManifolds);
      }
      break;
    }
    case "difference": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else {
        const [first, ...rest] = childManifolds;
        result = first.subtract(M.union(rest));
      }
      break;
    }
    case "intersection": {
      if (childManifolds.length === 0) {
        result = null;
      } else if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else {
        result = M.intersection(childManifolds);
      }
      break;
    }
    // --- Transforms ---
    case "translate": {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ["x", "y", "z"]);
        result = childManifolds[0].translate(v);
      }
      break;
    }
    case "rotate": {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [0, 0, 0], ["x", "y", "z"]);
        result = childManifolds[0].rotate(v);
      }
      break;
    }
    case "scale": {
      if (childManifolds.length === 1) {
        const v = normalizeVec3(node.props, [1, 1, 1], ["x", "y", "z"]);
        result = childManifolds[0].scale(v);
      }
      break;
    }
    // --- Group (passthrough) ---
    case "group": {
      if (childManifolds.length === 1) {
        result = childManifolds[0];
      } else if (childManifolds.length > 1) {
        result = M.union(childManifolds);
      }
      break;
    }
  }
  node.manifold = result;
  node.dirty = false;
  return result;
}
function normalizeVec3(input, defaultValue, keys = ["0", "1", "2"]) {
  if (Array.isArray(input)) {
    return [
      input[0] ?? defaultValue[0],
      input[1] ?? defaultValue[1],
      input[2] ?? defaultValue[2]
    ];
  }
  if (typeof input === "number") {
    return [input, input, input];
  }
  if (typeof input === "object" && input !== null) {
    const obj = input;
    return [
      obj[keys[0]] ?? defaultValue[0],
      obj[keys[1]] ?? defaultValue[1],
      obj[keys[2]] ?? defaultValue[2]
    ];
  }
  return defaultValue;
}

// src/reconciler/host-config.ts
var hostConfig = {
  // --- Configuration ---
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: false,
  // --- Instance Creation ---
  createInstance(type, props) {
    return createNode(type, props);
  },
  createTextInstance() {
    throw new Error("Text nodes are not supported in CSG renderer");
  },
  // --- Tree Operations ---
  appendInitialChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
  },
  appendChild(parent, child) {
    child.parent = parent;
    parent.children.push(child);
    markDirty(parent);
  },
  removeChild(parent, child) {
    const index = parent.children.indexOf(child);
    if (index !== -1) {
      parent.children.splice(index, 1);
    }
    child.parent = null;
    markDirty(parent);
    disposeNode(child);
  },
  insertBefore(parent, child, beforeChild) {
    child.parent = parent;
    const index = parent.children.indexOf(beforeChild);
    if (index !== -1) {
      parent.children.splice(index, 0, child);
    } else {
      parent.children.push(child);
    }
    markDirty(parent);
  },
  // --- Updates ---
  prepareUpdate(_instance, _type, oldProps, newProps) {
    return !shallowEqual(oldProps, newProps);
  },
  commitUpdate(instance, _updatePayload, _type, _oldProps, newProps) {
    if (instance.manifold) {
      instance.manifold.delete();
      instance.manifold = null;
    }
    instance.props = newProps;
    markDirty(instance);
  },
  // --- Container Operations ---
  appendChildToContainer(container, child) {
    container.root = child;
    child.parent = null;
  },
  removeChildFromContainer(container, child) {
    if (container.root === child) {
      container.root = null;
    }
    disposeNode(child);
  },
  insertInContainerBefore(container, child, _beforeChild) {
    container.root = child;
    child.parent = null;
  },
  clearContainer(container) {
    if (container.root) {
      disposeNode(container.root);
      container.root = null;
    }
  },
  // --- Commit Phase ---
  prepareForCommit() {
    return null;
  },
  resetAfterCommit(container) {
    if (container.root && container.root.dirty) {
      try {
        buildGeometry(container.root);
        if (container.root.manifold) {
          const mesh = container.root.manifold.getMesh();
          container.onMesh(mesh);
        }
      } catch (error) {
        container.onError?.(error);
      }
    }
  },
  finalizeInitialChildren() {
    return false;
  },
  // --- Misc ---
  getPublicInstance(instance) {
    return instance;
  },
  getRootHostContext() {
    return {};
  },
  getChildHostContext(parentContext) {
    return parentContext;
  },
  shouldSetTextContent() {
    return false;
  },
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  getCurrentEventPriority: () => 16,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {
  },
  afterActiveInstanceBlur: () => {
  },
  prepareScopeUpdate: () => {
  },
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {
  }
};
function shallowEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// src/reconciler/index.ts
var reconciler = (0, import_react_reconciler.default)(hostConfig);

// src/components.tsx
function CsgRoot({ children, onMesh, onError, onReady }) {
  const [ready, setReady] = (0, import_react.useState)(isManifoldReady());
  const containerRef = (0, import_react.useRef)(null);
  const fiberRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    if (!ready) {
      initManifold().then(() => {
        setReady(true);
        onReady?.();
      }).catch((err) => onError?.(err));
    }
  }, []);
  (0, import_react.useEffect)(() => {
    if (!ready) return;
    const container = {
      root: null,
      onMesh,
      onError
    };
    containerRef.current = container;
    fiberRef.current = reconciler.createContainer(
      container,
      0,
      // LegacyRoot
      null,
      // hydrationCallbacks
      false,
      // isStrictMode
      null,
      // concurrentUpdatesByDefaultOverride
      "csg",
      // identifierPrefix
      (error) => onError?.(error),
      // onUncaughtError
      (error) => onError?.(error),
      // onCaughtError
      (error) => onError?.(error),
      // onRecoverableError
      () => {
      }
      // onDefaultTransitionIndicator
    );
    reconciler.updateContainer(children, fiberRef.current, null, () => {
    });
    return () => {
      reconciler.updateContainer(null, fiberRef.current, null, () => {
      });
    };
  }, [ready]);
  (0, import_react.useEffect)(() => {
    if (fiberRef.current && ready) {
      reconciler.updateContainer(children, fiberRef.current, null, () => {
      });
    }
  }, [children, ready]);
  (0, import_react.useEffect)(() => {
    if (containerRef.current) {
      containerRef.current.onMesh = onMesh;
      containerRef.current.onError = onError;
    }
  }, [onMesh, onError]);
  return null;
}
var Cube = "cube";
var Sphere = "sphere";
var Cylinder = "cylinder";
var Extrude = "extrude";
var Union = "union";
var Difference = "difference";
var Intersection = "intersection";
var Translate = "translate";
var Rotate = "rotate";
var Scale = "scale";
var Group = "group";

// src/three.ts
var THREE = __toESM(require("three"));
function meshToGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();
  const { vertProperties, triVerts, numProp } = mesh;
  const vertexCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3 + 0] = vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();
  return geometry;
}
function updateGeometry(geometry, mesh) {
  const { vertProperties, triVerts, numProp } = mesh;
  const vertexCount = vertProperties.length / numProp;
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3 + 0] = vertProperties[i * numProp + 0];
    positions[i * 3 + 1] = vertProperties[i * numProp + 1];
    positions[i * 3 + 2] = vertProperties[i * numProp + 2];
  }
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(triVerts, 1));
  geometry.computeVertexNormals();
  geometry.attributes.position.needsUpdate = true;
}

// src/r3f.tsx
var import_react2 = require("react");
var THREE2 = __toESM(require("three"));
var import_jsx_runtime = require("react/jsx-runtime");
function CsgMesh({ children, onError, material }) {
  const [geometry, setGeometry] = (0, import_react2.useState)(null);
  const geometryRef = (0, import_react2.useRef)(null);
  const meshRef = (0, import_react2.useRef)(null);
  const handleMesh = (0, import_react2.useCallback)((mesh) => {
    const newGeometry = meshToGeometry(mesh);
    geometryRef.current?.dispose();
    geometryRef.current = newGeometry;
    setGeometry(newGeometry);
  }, []);
  (0, import_react2.useEffect)(() => {
    if (meshRef.current && geometry) {
      meshRef.current.geometry = geometry;
    }
  }, [geometry]);
  (0, import_react2.useEffect)(() => {
    return () => {
      geometryRef.current?.dispose();
    };
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!meshRef.current) {
      meshRef.current = new THREE2.Mesh(
        geometry ?? new THREE2.BufferGeometry(),
        material ?? new THREE2.MeshStandardMaterial({ color: 16750848 })
      );
    }
  }, [material, geometry]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CsgRoot, { onMesh: handleMesh, onError, children });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CsgMesh,
  CsgRoot,
  Cube,
  Cylinder,
  Difference,
  Extrude,
  Group,
  Intersection,
  Rotate,
  Scale,
  Sphere,
  Translate,
  Union,
  initManifold,
  isManifoldReady,
  meshToGeometry,
  setWasmPath,
  updateGeometry
});
