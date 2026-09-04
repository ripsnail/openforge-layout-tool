import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ensureCached, isValidStl } from './downloadedModels.js';
import { fetchWithTimeout } from './catalogApi.js';
import { getCachedStlBuffer, putCachedStlBuffer } from './stlCache.js';
import { resolveTextureColor, getTextureOverride, getEffectiveTextureTags } from './modelCatalog.js';
import { getThemeColorOverride } from './settings.js';

const geometryCache = new Map();
const materialCache = new Map();

// Drops cached geometries not in `keepKeys` (same key derivation as
// loadModelGeometry: modelInfo._id || modelInfo.fileName). Call after
// meshes are removed so long sessions don't pin every geometry forever.
// Note: BufferGeometry.dispose() only frees GPU buffers — the attribute
// arrays stay in JS, so an unexpectedly reused geometry re-uploads.
export function pruneGeometries(keepKeys) {
  const keep = keepKeys instanceof Set ? keepKeys : new Set(keepKeys || []);
  for (const key of [...geometryCache.keys()]) {
    if (!keep.has(key)) {
      try { geometryCache.get(key)?.dispose(); } catch (e) { /* best effort */ }
      geometryCache.delete(key);
    }
  }
}
const loader = new STLLoader();
const _outlineGeoCache = new Map();

function hexToNumber(hex) {
  if (typeof hex === 'number') return hex;
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const num = parseInt(h, 16);
  return isNaN(num) ? null : num;
}

// In-flight loads: concurrent requests for the same model (e.g. a layout
// with 20 copies, or parallel restore) share one fetch + parse.
const pendingGeometryLoads = new Map();

export async function loadModelGeometry(modelInfo) {
  const cacheKey = modelInfo._id || modelInfo.fileName;
  if (geometryCache.has(cacheKey)) {
    return geometryCache.get(cacheKey);
  }
  if (pendingGeometryLoads.has(cacheKey)) {
    return pendingGeometryLoads.get(cacheKey);
  }

  const promise = (async () => {
    const fileName = modelInfo.fileName || '';
    const { fromCdn, buffer } = await fetchAndCacheGeometry(modelInfo, cacheKey, fileName);

    let geometry = geometryCache.get(cacheKey);

    if (fromCdn && modelInfo.storageUrl && buffer) {
      ensureCached(cacheKey, modelInfo, buffer);
    }

    return geometry;
  })();
  pendingGeometryLoads.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    pendingGeometryLoads.delete(cacheKey);
  }
}

async function fetchAndCacheGeometry(modelInfo, cacheKey, fileName) {
  // 1. Persistent browser cache (IndexedDB): survives page refresh.
  // 2. Server-side /getModel endpoint (local downloaded/ cache on disk).
  // 3. CDN as a last resort.
  const sha = modelInfo.sha;
  if (sha) {
    try {
      const cached = await getCachedStlBuffer(sha);
      if (cached && isValidStl(cached)) {
        let geometry = loader.parse(cached);
        geometry = convertZupToYup(geometry);
        centerGeometry(geometry);
        geometryCache.set(cacheKey, geometry);
        return { fromCdn: false, buffer: cached };
      }
    } catch (e) { /* fall through to network */ }
  }

  let resp = null;
  try {
    if (sha) {
      resp = await fetchWithTimeout(`/getModel/${sha}`, {}, 120000);
    }
  } catch (e) {
    resp = null;
  }

  let fromCdn = false;
  if (!resp || !resp.ok) {
    const cdnUrl = resolveCdnUrl(modelInfo);
    if (!cdnUrl) {
      throw new Error(`No STL found for ${fileName}`);
    }
    try {
      resp = await fetchWithTimeout(cdnUrl, {}, 120000);
      fromCdn = true;
    } catch (e) {
      throw new Error(`No STL found for ${fileName}`, { cause: e });
    }
    if (!resp || !resp.ok) throw new Error(`No STL found for ${fileName}`);
  }

  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error(`No STL found for ${fileName}`);
  const buffer = await resp.arrayBuffer();
  if (!isValidStl(buffer)) throw new Error(`No STL found for ${fileName}`);

  // Persist to the browser cache so the next refresh skips the network.
  if (sha) {
    try { await putCachedStlBuffer(sha, buffer); } catch (e) { /* best effort */ }
  }

  let geometry = loader.parse(buffer);
  geometry = convertZupToYup(geometry);
  centerGeometry(geometry);
  geometryCache.set(cacheKey, geometry);

  return { fromCdn, buffer };
}

function resolveCdnUrl(modelInfo) {
  let url = modelInfo.storageUrl;
  if (!url) return null;
  if (url.startsWith('https://objects.openforge.tools/')) {
    url = '/catalog-objects' + url.replace('https://objects.openforge.tools', '');
  }
  return url;
}

function convertZupToYup(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return geometry;

  const verts = new Float32Array(pos.array);
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i];
    const y = verts[i + 1];
    const z = verts[i + 2];
    verts[i] = x;
    verts[i + 1] = z;
    verts[i + 2] = -y;
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  newGeo.setIndex(geometry.getIndex());
  // Normals are recomputed from the rotated positions — no need to copy
  // the source normals first.
  newGeo.computeVertexNormals();

  return newGeo;
}

function centerGeometry(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;

  const cx = (box.max.x + box.min.x) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  const minY = box.min.y;

  geometry.translate(-cx, -minY, -cz);
}



export function resolveModelColor(modelInfo) {
  const tags = getEffectiveTextureTags(modelInfo);
  if (getTextureOverride(tags)) {
    return resolveTextureColor(tags, modelInfo?.theme);
  }
  const themeOverride = getThemeColorOverride(modelInfo?.theme);
  if (themeOverride) {
    const n = hexToNumber(themeOverride);
    if (n != null) return n;
  }
  return resolveTextureColor(tags, modelInfo?.theme);
}

export function createMesh(geometry, modelInfo) {
  const color = resolveModelColor(modelInfo);
  modelInfo.color = color;
  const cacheKey = `${color}_0.7_0.1`;
  let material = materialCache.get(cacheKey);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false,
    });
    material.userData.shared = true;
    materialCache.set(cacheKey, material);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.modelInfo = modelInfo;
  mesh.userData.isPlaced = true;
  mesh.userData.geometry = geometry;

  geometry.computeBoundingBox();
  mesh.userData.height = geometry.boundingBox ? geometry.boundingBox.max.y : 0;

  return mesh;
}

export function recolorMesh(mesh, modelInfo) {
  const color = resolveModelColor(modelInfo);
  modelInfo.color = color;
  const cacheKey = `${color}_0.7_0.1`;
  let material = materialCache.get(cacheKey);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false,
    });
    material.userData.shared = true;
    materialCache.set(cacheKey, material);
  }
  disposeMeshMaterial(mesh);
  mesh.material = material;
}

// Disposes a mesh's material only when it is NOT a shared cached instance.
// Disposing shared materials forces GPU re-upload for every mesh using them.
export function disposeMeshMaterial(mesh) {
  const mat = mesh?.material;
  if (!mat || mat.userData.shared) return;
  mat.dispose();
}

export function createGhostMesh(geometry, modelInfo) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x44cc88,
    roughness: 0.5,
    metalness: 0,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.modelInfo = modelInfo;
  mesh.userData.isGhost = true;

  return mesh;
}

export function createOutlineMesh(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);

  const sizeKey = `${size.x.toFixed(2)}_${size.y.toFixed(2)}_${size.z.toFixed(2)}`;
  let geo = _outlineGeoCache.get(sizeKey);
  if (!geo) {
    geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    geo.translate(0, size.y / 2, 0);
    _outlineGeoCache.set(sizeKey, geo);
    if (_outlineGeoCache.size > 200) {
      const firstKey = _outlineGeoCache.keys().next().value;
      _outlineGeoCache.get(firstKey)?.dispose();
      _outlineGeoCache.delete(firstKey);
    }
  }
  const mat = new THREE.LineBasicMaterial({
    color: 0x6c63ff,
    transparent: true,
    opacity: 0.8,
  });
  const line = new THREE.LineSegments(geo, mat);
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  line.scale.copy(mesh.scale);
  line.userData = { sourceMesh: mesh };
  return line;
}
