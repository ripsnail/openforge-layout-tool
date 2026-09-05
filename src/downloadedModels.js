import { blueprintToModelInfo, fetchWithTimeout } from './catalogApi.js';
import { generateModelId, registerModelId } from './modelCatalog.js';
import { notify } from './notifications.js';
const STORAGE_KEY = 'openforge-downloaded-models';

const downloadCache = new Map();
let manifest = [];

let manifestByFileName = new Map();

function reindexManifest() {
  manifestByFileName = new Map(manifest.map(m => [m.fileName, m]));
}

function safeEncode(str) {
  const value = String(str || '');
  const encoded = value.replace(/[^a-zA-Z0-9.-]/g, c => '_' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  if (encoded.length <= 180) return encoded;

  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const suffix = `_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  return `${encoded.slice(0, 180 - suffix.length)}${suffix}`;
}

function stlName(sha) {
  return sha ? `${sha}.stl` : null;
}

// Binary STL layout: an 80-byte header, followed by a uint32 triangle count,
// followed by 50 bytes (12 floats for normal+3 verts + a uint16 attribute)
// per triangle. A file smaller than the header+count can't be valid.
const STL_HEADER_SIZE = 84;
const STL_BYTES_PER_TRIANGLE = 50;
// Sanity cap to reject corrupt triangle counts before doing size
// arithmetic on them (a real-world STL this large would be gigabytes).
const STL_MAX_TRIANGLES = 50_000_000;

function isValidStlBinary(buffer) {
  if (buffer.byteLength < STL_HEADER_SIZE) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  if (triCount === 0 || triCount > STL_MAX_TRIANGLES) return false;
  return buffer.byteLength === STL_HEADER_SIZE + triCount * STL_BYTES_PER_TRIANGLE;
}

function isValidStl(buffer) {
  if (isValidStlBinary(buffer)) return true;
  const head = new Uint8Array(buffer.slice(0, 512));
  const text = new TextDecoder('ascii', { fatal: false }).decode(head);
  if (text.startsWith('solid') && text.includes('facet')) return true;
  return false;
}

function thumbPath(safeName) {
  return `/downloaded/thumbs/${safeName}.png`;
}

function thumbNameForEntry(entry) {
  return entry.safeName || safeEncode(entry._id);
}

async function cacheThumbnail(safeName, thumbnailUrl) {
  if (!thumbnailUrl) return false;
  try {
    let url = thumbnailUrl;
    if (url.startsWith('https://objects.openforge.tools/')) {
      url = '/catalog-objects' + url.replace('https://objects.openforge.tools', '');
    }
    const resp = await fetchWithTimeout(url, {}, 30000);
    if (!resp.ok) return false;
    const buf = await resp.arrayBuffer();
    const postResp = await fetchWithTimeout(`/downloaded/thumbs/${safeName}.png`, {
      method: 'POST',
      body: new Uint8Array(buf),
    }, 30000);
    return postResp.ok;
  } catch (e) { return false; }
}

export function getThumbnailUrl(_id) {
  const entry = manifest.find(m => m._id === _id);
  if (!entry) return null;
  if (entry.hasThumb) return thumbPath(thumbNameForEntry(entry));
  return entry?.modelInfo?.thumbnailUrl || null;
}

const catalogThumbSeen = new Set();

function thumbKeyForImageUrl(imageUrl) {
  const m = (imageUrl || '').match(/([0-9a-f]{32})\.png$/i);
  return m ? m[1].toLowerCase() : safeEncode(imageUrl || 'thumb');
}

export function ensureCatalogThumbCached(imageUrl) {
  if (!imageUrl) return null;
  const key = thumbKeyForImageUrl(imageUrl);
  const local = `/downloaded/thumbs/${key}.png`;
  if (catalogThumbSeen.has(key)) return local;
  catalogThumbSeen.add(key);
  (async () => {
    try {
      const head = await fetchWithTimeout(local, { method: 'HEAD' }, 15000);
      if (head.ok) return;
    } catch (e) { /* fall through to cache it */ }
    try {
      let url = imageUrl;
      if (url.startsWith('https://objects.openforge.tools/')) {
        url = '/catalog-objects' + url.replace('https://objects.openforge.tools', '');
      }
      const resp = await fetchWithTimeout(url, {}, 30000);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      await fetchWithTimeout(local, { method: 'POST', body: new Uint8Array(buf) }, 30000);
    } catch (e) { /* best effort */ }
  })();
  return local;
}

export { isValidStl };

export function initDownloadedModels() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) manifest = JSON.parse(raw);
  } catch (e) {
    manifest = [];
  }

  manifest = manifest.filter(entry => entry && entry._id && entry.fileName && entry.modelInfo);

  const seenFileNames = new Set();
  manifest = manifest.filter(entry => {
    if (seenFileNames.has(entry.fileName)) return false;
    seenFileNames.add(entry.fileName);
    return true;
  });

  for (const entry of manifest) {
    registerModelId(entry._id);
  }

  let migrated = false;
  for (const entry of manifest) {
    if (!entry._id) entry._id = generateModelId(entry.fileName, entry.sha || entry.modelInfo?.sha);
    if (entry.modelInfo && !entry.modelInfo._id) entry.modelInfo._id = entry._id;
    if (!entry.safeName) {
      entry.safeName = safeEncode(entry._id);
      entry.hasThumb = false;
      migrated = true;
    }
    if (!entry.hasThumb && entry.modelInfo?.thumbnailUrl) {
      const tn = thumbNameForEntry(entry);
      cacheThumbnail(tn, entry.modelInfo.thumbnailUrl).then(ok => {
        if (ok) { entry.hasThumb = true; saveManifest(); }
      });
    } else if (entry.hasThumb) {
      const tn = thumbNameForEntry(entry);
      fetchWithTimeout(thumbPath(tn), { method: 'HEAD' }, 15000).then(r => {
        if (r.ok) return;
        const oldTn = safeEncode(entry.fileName);
        if (oldTn === tn) { entry.hasThumb = false; return; }
        fetchWithTimeout(thumbPath(oldTn), {}, 15000).then(r2 => {
          if (!r2.ok) { entry.hasThumb = false; return; }
          r2.arrayBuffer().then(buf => {
            fetchWithTimeout(thumbPath(tn), { method: 'POST', body: new Uint8Array(buf) }, 30000).then(r3 => {
              if (!r3.ok) { entry.hasThumb = false; }
            }).catch(e => { console.warn(`Failed to migrate thumbnail for "${entry.fileName}":`, e); entry.hasThumb = false; });
          });
        }).catch(e => { console.warn(`Failed to fetch legacy thumbnail for "${entry.fileName}":`, e); entry.hasThumb = false; });
      }).catch(e => { console.warn(`Failed to verify thumbnail for "${entry.fileName}":`, e); });
    }
  }

  if (migrated) saveManifest();

  for (const entry of manifest) {
    const sha = entry.sha || entry.modelInfo?.sha || extractMd5FromUrl(entry.storageUrl);
    if (!sha || !entry.modelInfo) continue;
    if (!entry.sha) {
      entry.sha = sha;
      entry.stlName = stlName(sha) || entry.stlName;
    }
    entry.modelInfo.sha = sha;
    syncMetadataToServer(entry.modelInfo);
  }
  reindexManifest();
  return manifest;
}

function extractMd5FromUrl(url) {
  if (!url) return null;
  const m = url.match(/([0-9a-f]{32})\.stl$/i);
  return m ? m[1] : null;
}

let manifestQuotaWarned = false;

export function saveManifest() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
  } catch (e) {
    if (!manifestQuotaWarned) {
      manifestQuotaWarned = true;
      console.warn(
        'Failed to save downloaded-models manifest — browser storage is full. ' +
        'Imported-model bookkeeping may be lost on refresh.',
        e
      );
    }
  }
}

export function syncMetadataToServer(modelInfo) {
  const sha = modelInfo?.sha;
  if (!sha) return;
  fetchWithTimeout(`/metadata/${sha}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(modelInfo),
  }, 15000).catch(() => {});
}

export async function hydrateMetadataFromServer() {
  const empty = { added: [], pruned: [] };
  let items;
  try {
    const resp = await fetchWithTimeout('/metadata', {}, 30000);
    if (!resp.ok) return empty;
    items = await resp.json();
  } catch (e) {
    return empty;
  }
  if (!Array.isArray(items)) return empty;
  const serverRows = new Map(items.filter(i => i && i.sha).map(i => [i.sha, i]));
  // Guard: never prune against an empty/errored DB snapshot.
  const healthyDb = items.length > 0;

  const pruned = [];
  const kept = [];
  let metadataChanged = false;
  for (const m of manifest) {
    const sha = m.sha || m.modelInfo?.sha;
    const row = sha ? serverRows.get(sha) : null;
    // Prune only on explicit server state (row exists, STL known uncached).
    // A missing row means unknown state (e.g. server DB was reset) — keep
    // the local entry so saved models and layouts keep resolving.
    if (sha && healthyDb && row && row.stl_cached !== true) {
      pruned.push(m._id);
    } else {
      if (row) {
        const { stl_cached, ...metadata } = row;
        m.fileName = metadata.fileName || m.fileName;
        m.sha = metadata.sha || m.sha;
        m.catalogId = metadata.catalogId || m.catalogId || null;
        m.storageUrl = metadata.storageUrl || m.storageUrl || null;
        m.modelInfo = {
          ...m.modelInfo,
          ...metadata,
          _id: m._id,
          source: 'downloaded',
        };
        metadataChanged = true;
      }
      kept.push(m);
    }
  }
  if (pruned.length > 0 || metadataChanged) {
    manifest = kept;
    for (const _id of pruned) {
      const cached = downloadCache.get(_id);
      if (cached) {
        if (cached.blobUrl) URL.revokeObjectURL(cached.blobUrl);
        downloadCache.delete(_id);
      }
    }
    saveManifest();
  }

  const haveSha = new Set(manifest.map(m => m.sha).filter(Boolean));
  const haveId = new Set(manifest.map(m => m._id));
  const added = [];
  for (const info of items) {
    if (!info || !info.sha || !info.fileName) continue;
    if (info.stl_cached !== true) continue;
    if (haveSha.has(info.sha) || haveId.has(info._id)) continue;
    const { stl_cached, ...rest } = info;
    const _id = rest._id || rest.fileName;
    const safe = safeEncode(_id);
    const entry = {
      _id,
      fileName: rest.fileName,
      safeName: safe,
      sha: rest.sha,
      stlName: stlName(rest.sha) || safe,
      catalogId: rest.catalogId || null,
      storageUrl: rest.storageUrl || null,
      modelInfo: { ...rest, _id, source: 'downloaded' },
      savedToDisk: stl_cached === true,
      importedAt: Date.now(),
    };
    manifest.push(entry);
    registerModelId(_id);
    haveSha.add(info.sha);
    haveId.add(_id);
    added.push(entry.modelInfo);
  }
  if (added.length > 0) saveManifest();
  reindexManifest();
  return { added, pruned };
}

export async function importBlueprint(blueprint, stlArrayBuffer) {
  const fileName = blueprint.file_name || blueprint.blueprint_name;
  if (!fileName) throw new Error('Blueprint has no filename');

  const modelInfo = blueprint.modelInfo || blueprintToModelInfo(blueprint);
  const sha = blueprint.file_md5 || modelInfo.sha || null;

  const entry = {
    _id: modelInfo._id,
    fileName,
    safeName: safeEncode(modelInfo._id),
    sha,
    stlName: stlName(sha) || safeEncode(modelInfo._id),
    catalogId: blueprint.id,
    storageUrl: blueprint.storage_address || null,
    modelInfo,
    importedAt: Date.now(),
  };

  downloadCache.set(entry._id, { cachedAt: Date.now() });

  try {
    const resp = await fetchWithTimeout(`/downloaded/${entry.stlName}`, {
      method: 'POST',
      body: new Uint8Array(stlArrayBuffer),
    }, 120000);
    if (resp.ok) entry.savedToDisk = true;
  } catch (e) {
    console.warn('Failed to save STL to disk:', e);
    notify(`Could not save ${fileName} to local storage. It may need to be downloaded again.`);
  }

  // Dedup by identity (content sha) or filename: re-importing replaces the
  // old entry instead of minting a second identity for the same model.
  // Layout tiles referencing a superseded _id still resolve via the
  // fileName fallback in _loadFromData / resolveTemplateTiles.
  const existing = manifest.findIndex(m =>
    m._id === entry._id ||
    (sha && (m.sha === sha || m.modelInfo?.sha === sha)) ||
    (fileName && m.fileName === fileName)
  );
  if (existing >= 0) {
    manifest[existing] = entry;
  } else {
    manifest.push(entry);
    registerModelId(entry._id);
  }
  reindexManifest();

  saveManifest();
  if (entry.sha) syncMetadataToServer({ ...modelInfo, sha: entry.sha });
  const thumbUrl = blueprint.images?.[0]?.image_url;
  if (thumbUrl) {
    cacheThumbnail(thumbNameForEntry(entry), thumbUrl).then(ok => {
      if (ok) { entry.hasThumb = true; saveManifest(); }
    });
  }
  return modelInfo;
}

export function isDownloaded(fileName) {
  return manifestByFileName.has(fileName);
}

export function getDownloadedModels() {
  return manifest.filter(m => m.modelInfo?.fileName).map(m => ({ ...m.modelInfo, source: 'downloaded' }));
}

export function removeDownloaded(_id) {
  const entry = manifest.find(m => m._id === _id);
  const fileName = entry?.fileName;
  const sha = entry?.sha;
  const cached = downloadCache.get(_id);
  if (cached) {
    if (cached.blobUrl) URL.revokeObjectURL(cached.blobUrl);
    downloadCache.delete(_id);
  }
  if (fileName) {
    manifest = manifest.filter(m => m.fileName !== fileName);
  } else {
    manifest = manifest.filter(m => m._id !== _id);
  }
  reindexManifest();
  saveManifest();
  if (sha) {
    fetchWithTimeout(`/metadata/${sha}`, { method: 'DELETE' }, 15000).catch(() => {});
  }
}

export function getManifest() {
  return [...manifest];
}

export function addDownloadedModelEntry(modelInfo) {
  if (!modelInfo || !modelInfo.fileName) return null;
  const existing = manifest.find(m => m.fileName === modelInfo.fileName || m._id === modelInfo._id);
  if (existing) return existing;

  const _id = modelInfo._id || generateModelId(modelInfo.fileName, modelInfo.sha || modelInfo.modelInfo?.sha);
  const entry = {
    _id,
    fileName: modelInfo.fileName,
    safeName: safeEncode(_id),
    sha: modelInfo.sha || null,
    stlName: stlName(modelInfo.sha) || safeEncode(_id),
    storageUrl: modelInfo.storageUrl || null,
    catalogId: modelInfo.catalogId || null,
    modelInfo: { ...modelInfo, _id, source: 'downloaded' },
    savedToDisk: false,
    importedAt: Date.now(),
  };
  manifest.push(entry);
  registerModelId(_id);
  saveManifest();
  reindexManifest();
  return entry;
}

export function ensureCached(_id, modelInfo, buffer) {
  if (downloadCache.has(_id)) return;
  // Marker only — see note in importBlueprint. `buffer` is intentionally
  // not retained (it is already persisted to disk / IndexedDB by callers).
  downloadCache.set(_id, { cachedAt: Date.now() });

  const fileName = modelInfo.fileName || _id;
  const safeName = safeEncode(_id);
  let entry = manifest.find(m => m._id === _id);
  if (!entry) {
    const fullInfo = { ...modelInfo, _id, source: 'downloaded' };
    entry = {
      _id,
      fileName,
      safeName,
      sha: modelInfo.sha || null,
      stlName: stlName(modelInfo.sha) || safeName,
      storageUrl: modelInfo.storageUrl || null,
      catalogId: modelInfo.catalogId || null,
      modelInfo: fullInfo,
      savedToDisk: false,
      importedAt: Date.now(),
    };
    manifest.push(entry);
    registerModelId(_id);
  }
  entry.savedToDisk = true;
  entry.storageUrl = modelInfo.storageUrl || entry.storageUrl;
  if (!entry.sha && modelInfo.sha) {
    entry.sha = modelInfo.sha;
    entry.stlName = stlName(modelInfo.sha) || entry.stlName;
  }
  if (!entry.modelInfo || !entry.modelInfo.displayName) {
    entry.modelInfo = { ...modelInfo, _id, source: 'downloaded' };
  } else {
    entry.modelInfo.storageUrl = entry.storageUrl;
    if (modelInfo.sha) entry.modelInfo.sha = modelInfo.sha;
  }
  saveManifest();
  if (entry.modelInfo?.sha) syncMetadataToServer(entry.modelInfo);

  fetchWithTimeout(`/downloaded/${entry.stlName || entry.safeName}`, {
    method: 'POST',
    body: new Uint8Array(buffer),
  }, 120000).catch(() => {});
}
