// Persistent browser-side cache for STL file buffers (IndexedDB).
// STLs are keyed by SHA (content-addressed, immutable), so a stored buffer
// is always valid for its key. Survives page refresh, unlike the in-memory
// geometry/download caches in modelLoader.js / downloadedModels.js.

const DB_NAME = 'openforge-stl-cache';
const STORE_NAME = 'stl-buffers';
const DB_VERSION = 1;

// Fraction of cached entries (oldest-updated first) removed by a single
// evictOldest() pass.
const DEFAULT_EVICTION_FRACTION = 0.25;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'sha' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export async function getCachedStlBuffer(sha) {
  if (!sha) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const rec = await new Promise((resolve, reject) => {
      const rq = tx.objectStore(STORE_NAME).get(sha.toLowerCase());
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    if (!rec?.buffer) return null;
    // Touch the record so eviction favours recently used entries.
    try {
      const wtx = db.transaction(STORE_NAME, 'readwrite');
      wtx.objectStore(STORE_NAME).put({ ...rec, updatedAt: Date.now() });
    } catch (e) { console.warn('Failed to update STL cache recency:', e); }
    return rec.buffer;
  } catch (e) {
    return null;
  }
}

async function evictOldest(fraction = DEFAULT_EVICTION_FRACTION) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const idx = tx.objectStore(STORE_NAME).index('updatedAt');
  const keys = await new Promise((resolve, reject) => {
    const out = [];
    const rq = idx.openCursor();
    rq.onsuccess = () => {
      const cur = rq.result;
      if (cur) { out.push(cur.primaryKey); cur.continue(); }
      else resolve(out);
    };
    rq.onerror = () => reject(rq.error);
  });
  const drop = Math.max(1, Math.floor(keys.length * fraction));
  const wtx = db.transaction(STORE_NAME, 'readwrite');
  const store = wtx.objectStore(STORE_NAME);
  for (const k of keys.slice(0, drop)) store.delete(k);
  await new Promise((resolve) => { wtx.oncomplete = resolve; wtx.onerror = resolve; });
}

export async function putCachedStlBuffer(sha, buffer) {
  if (!sha || !buffer) return false;
  const record = { sha: sha.toLowerCase(), buffer, updatedAt: Date.now() };
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) {
    // Storage full? Evict oldest entries once and retry.
    try {
      await evictOldest(0.25);
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (e2) {
      return false;
    }
  }
}
