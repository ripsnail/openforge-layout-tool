import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ensureCached, isValidStl } from './downloadedModels.js';
import { getThemeColor } from './modelCatalog.js';

const geometryCache = new Map();
const materialCache = new Map();
const loader = new STLLoader();
const _outlineGeoCache = new Map();

export async function loadModelGeometry(modelInfo) {
  const cacheKey = modelInfo._id || modelInfo.fileName;
  if (geometryCache.has(cacheKey)) {
    return geometryCache.get(cacheKey);
  }

  const fileName = modelInfo.fileName || '';
  const { fromCdn, buffer } = await fetchAndCacheGeometry(modelInfo, cacheKey, fileName);

  let geometry = geometryCache.get(cacheKey);

  if (fromCdn && modelInfo.storageUrl && buffer) {
    ensureCached(cacheKey, modelInfo, buffer);
  }

  return geometry;
}

async function fetchAndCacheGeometry(modelInfo, cacheKey, fileName) {
  // Prefer the server-side /getModel endpoint, which serves from the local
  // downloaded/ cache on disk, keyed by the file's SHA (catalog file_md5).
  // Fall back to the CDN only if it isn't cached.
  let resp = null;
  const sha = modelInfo.sha;
  try {
    if (sha) {
      resp = await fetch(`/getModel/${sha}`);
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
      resp = await fetch(cdnUrl);
      fromCdn = true;
    } catch (e) {
      throw new Error(`No STL found for ${fileName}`);
    }
    if (!resp || !resp.ok) throw new Error(`No STL found for ${fileName}`);
  }

  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/html')) throw new Error(`No STL found for ${fileName}`);
  const buffer = await resp.arrayBuffer();
  if (!isValidStl(buffer)) throw new Error(`No STL found for ${fileName}`);

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
  if (geometry.getAttribute('normal')) {
    const norms = new Float32Array(geometry.getAttribute('normal').array);
    for (let i = 0; i < norms.length; i += 3) {
      const x = norms[i];
      const y = norms[i + 1];
      const z = norms[i + 2];
      norms[i] = x;
      norms[i + 1] = z;
      norms[i + 2] = -y;
    }
    newGeo.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
  }
  newGeo.setIndex(geometry.getIndex());
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



const HARDCODED_COLORS = {
  'shingles,stucco#gable.4x.openlock.stl': 0xb05a3c,
  'towne#railings+internal_corner.2x.rail.stl': 0x8b6b4b,
  'towne#railings.2x.rail.stl': 0x8b6b4b,
  'towne#floor+wall+s2w.2x2.openforge.stl': 0x8b6b4b,
  'towne#floor+wall+s2w.1x1.openforge.stl': 0x8b6b4b,
};

export function createMesh(geometry, modelInfo) {
  const fileKey = (modelInfo?.fileName || '').toLowerCase();
  if (HARDCODED_COLORS[fileKey]) {
    modelInfo.color = HARDCODED_COLORS[fileKey];
  } else if (modelInfo?.theme) {
    modelInfo.color = getThemeColor(modelInfo.theme);
  }
  const color = modelInfo.color || 0x888888;
  const cacheKey = `${color}_0.7_0.1`;
  let material = materialCache.get(cacheKey);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      flatShading: false,
    });
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

export function createGhostMesh(geometry, modelInfo) {
  const color = modelInfo.color || 0x888888;
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
