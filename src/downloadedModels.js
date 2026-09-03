import { parseCatalogTags, blueprintToModelInfo } from './catalogApi.js';
import { generateModelId, registerModelId } from './modelCatalog.js';

const STORAGE_KEY = 'openforge-downloaded-models';

const downloadCache = new Map();
let manifest = [];

function safeEncode(str) {
  return str.replace(/[^a-zA-Z0-9._-]/g, c => '_' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

function stlName(sha) {
  return sha ? `${sha}.stl` : null;
}

function isValidStlBinary(buffer) {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  if (triCount === 0) return false;
  return buffer.byteLength === 84 + triCount * 50;
}

function isValidStl(buffer) {
  if (isValidStlBinary(buffer)) return true;
  const head = new Uint8Array(buffer.slice(0, 512));
  const text = new TextDecoder('ascii', { fatal: false }).decode(head);
  if (text.startsWith('solid') && text.includes('facet')) return true;
  return false;
}

export function clearCorruptCache() {
  downloadCache.clear();
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
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const buf = await resp.arrayBuffer();
    const postResp = await fetch(`/downloaded/thumbs/${safeName}.png`, {
      method: 'POST',
      body: new Uint8Array(buf),
    });
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
      const head = await fetch(local, { method: 'HEAD' });
      if (head.ok) return;
    } catch (e) { /* fall through to cache it */ }
    try {
      let url = imageUrl;
      if (url.startsWith('https://objects.openforge.tools/')) {
        url = '/catalog-objects' + url.replace('https://objects.openforge.tools', '');
      }
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      await fetch(local, { method: 'POST', body: new Uint8Array(buf) });
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

  try {
    if (!localStorage.getItem('openforge-manifest-purge-1')) {
      const survivors = [];
      let dropped = 0;
      for (const m of manifest) {
        const name = (m.fileName || '').toLowerCase();
        if (name.startsWith('aztlan') || name.startsWith('arch')) {
          const cached = downloadCache.get(m._id);
          if (cached) {
            URL.revokeObjectURL(cached.blobUrl);
            downloadCache.delete(m._id);
          }
          dropped++;
        } else {
          survivors.push(m);
        }
      }
      if (dropped > 0) {
        manifest = survivors;
        saveManifest();
        console.log(`[catalog] purged ${dropped} browse-polluted entries from saved models`);
      }
      localStorage.setItem('openforge-manifest-purge-1', '1');
    }
  } catch (e) {}

  let migrated = false;
  for (const entry of manifest) {
    if (!entry._id) entry._id = generateModelId(entry.fileName);
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
      fetch(thumbPath(tn), { method: 'HEAD' }).then(r => {
        if (r.ok) return;
        const oldTn = safeEncode(entry.fileName);
        if (oldTn === tn) { entry.hasThumb = false; return; }
        fetch(thumbPath(oldTn)).then(r2 => {
          if (!r2.ok) { entry.hasThumb = false; return; }
          r2.arrayBuffer().then(buf => {
            fetch(thumbPath(tn), { method: 'POST', body: new Uint8Array(buf) }).then(r3 => {
              if (!r3.ok) { entry.hasThumb = false; }
            }).catch(() => { entry.hasThumb = false; });
          });
        }).catch(() => { entry.hasThumb = false; });
      }).catch(() => {});
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
  return manifest;
}

function extractMd5FromUrl(url) {
  if (!url) return null;
  const m = url.match(/([0-9a-f]{32})\.stl$/i);
  return m ? m[1] : null;
}

function saveManifest() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
  } catch (e) {
    console.warn('Failed to save downloaded models manifest');
  }
}

export function syncMetadataToServer(modelInfo) {
  const sha = modelInfo?.sha;
  if (!sha) return;
  fetch(`/metadata/${sha}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(modelInfo),
  }).catch(() => {});
}

export async function hydrateMetadataFromServer() {
  const empty = { added: [], pruned: [] };
  let items = [];
  try {
    const resp = await fetch('/metadata');
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
  for (const m of manifest) {
    const sha = m.sha || m.modelInfo?.sha;
    const row = sha ? serverRows.get(sha) : null;
    if (sha && healthyDb && (!row || row.stl_cached !== true)) {
      pruned.push(m._id);
    } else {
      kept.push(m);
    }
  }
  if (pruned.length > 0) {
    manifest = kept;
    for (const _id of pruned) {
      const cached = downloadCache.get(_id);
      if (cached) {
        URL.revokeObjectURL(cached.blobUrl);
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
  return { added, pruned };
}

export async function importBlueprint(blueprint, stlArrayBuffer) {
  const fileName = blueprint.file_name || blueprint.blueprint_name;
  if (!fileName) throw new Error('Blueprint has no filename');

  const blob = new Blob([stlArrayBuffer], { type: 'model/stl' });
  const blobUrl = URL.createObjectURL(blob);

  const modelInfo = blueprint.modelInfo || blueprintToModelInfo(blueprint);

  const entry = {
    _id: modelInfo._id,
    fileName,
    safeName: safeEncode(modelInfo._id),
    sha: blueprint.file_md5 || modelInfo.sha || null,
    stlName: stlName(blueprint.file_md5 || modelInfo.sha) || safeEncode(modelInfo._id),
    catalogId: blueprint.id,
    storageUrl: blueprint.storage_address || null,
    modelInfo,
    importedAt: Date.now(),
  };

  downloadCache.set(entry._id, { blobUrl, arrayBuffer: stlArrayBuffer });

  try {
    const resp = await fetch(`/downloaded/${entry.stlName}`, {
      method: 'POST',
      body: new Uint8Array(stlArrayBuffer),
    });
    if (resp.ok) entry.savedToDisk = true;
  } catch (e) {
    console.warn('Failed to save STL to disk:', e);
  }

  const existing = manifest.findIndex(m => m._id === entry._id);
  if (existing >= 0) {
    manifest[existing] = entry;
  } else {
    manifest.push(entry);
    registerModelId(entry._id);
  }

  saveManifest();
  if (entry.sha) syncMetadataToServer({ ...modelInfo, sha: entry.sha });
  console.log('[catalog] imported', fileName, entry.sha || '');
  const thumbUrl = blueprint.images?.[0]?.image_url;
  if (thumbUrl) {
    cacheThumbnail(thumbNameForEntry(entry), thumbUrl).then(ok => {
      if (ok) { entry.hasThumb = true; saveManifest(); }
    });
  }
  return modelInfo;
}

export function isDownloaded(fileName) {
  return manifest.some(m => m.fileName === fileName);
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
    URL.revokeObjectURL(cached.blobUrl);
    downloadCache.delete(_id);
  }
  if (fileName) {
    manifest = manifest.filter(m => m.fileName !== fileName);
  } else {
    manifest = manifest.filter(m => m._id !== _id);
  }
  saveManifest();
  if (sha) {
    fetch(`/metadata/${sha}`, { method: 'DELETE' }).catch(() => {});
  }
}

export function getManifest() {
  return [...manifest];
}

export function ensureCached(_id, modelInfo, buffer) {
  if (downloadCache.has(_id)) return;
  const blob = new Blob([buffer], { type: 'model/stl' });
  const blobUrl = URL.createObjectURL(blob);
  downloadCache.set(_id, { blobUrl, arrayBuffer: buffer });

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

  fetch(`/downloaded/${entry.stlName || entry.safeName}`, {
    method: 'POST',
    body: new Uint8Array(buffer),
  }).catch(() => {});
}
