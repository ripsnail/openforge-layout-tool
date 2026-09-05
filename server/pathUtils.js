// Pure, dependency-free helpers used by the vite.config.js dev-server
// middleware. Kept in a separate module so they can be unit tested without
// pulling in `vite`, `node:sqlite`, or touching the filesystem. Functions
// that do need filesystem access (symlink-escape checks) take the fs
// functions as an injected argument, same pattern as `findCachedByMd5`
// below, so callers can still test the pure path-math without touching disk.
import { resolve, dirname, join } from 'path';

const MD5_RE = /^[0-9a-f]{32}$/i;

export function isValidMd5(value) {
  return typeof value === 'string' && MD5_RE.test(value);
}

// Resolves `fileName` against `dir` and rejects anything that would escape
// the directory (path traversal via `..`, absolute paths, null bytes, etc).
// Returns the resolved absolute path, or null if the name is unsafe.
//
// The syntactic check alone only catches `..`-style traversal — if a
// symlink inside `dir` (or `dir` itself) points outside of it, the
// resolved-but-not-yet-realpath'd path can still look "inside" while the
// real file lives elsewhere. When `fsOps` (`{ existsSync, realpathSync }`)
// is supplied, this additionally resolves real paths and re-verifies
// containment, walking up to the nearest existing ancestor for
// not-yet-created files (e.g. a fresh POST upload) since `realpathSync`
// requires its target to exist. Callers that don't pass `fsOps` only get
// the syntactic check (kept for backward compatibility / pure callers).
export function safeDownloadedPath(dir, fileName, fsOps) {
  if (!fileName || typeof fileName !== 'string' || fileName.includes('\0')) {
    return null;
  }
  const root = resolve(dir);
  const filePath = resolve(root, fileName);
  if (filePath !== root && !filePath.startsWith(`${root}/`)) {
    return null;
  }

  const { existsSync, realpathSync } = fsOps || {};
  if (!existsSync || !realpathSync) return filePath;

  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch (e) {
    // Root doesn't exist yet — caller is expected to create it before
    // writing, so there's nothing on disk to resolve against yet.
    return filePath;
  }

  let ancestor = filePath;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return null; // hit filesystem root; shouldn't happen
    ancestor = parent;
  }

  let realAncestor;
  try {
    realAncestor = realpathSync(ancestor);
  } catch (e) {
    return null;
  }
  if (realAncestor !== realRoot && !realAncestor.startsWith(`${realRoot}/`)) {
    return null;
  }
  return filePath;
}

// Finds a cached STL on disk for a given md5, tolerating the
// `<md5>.stl_<n>` naming used by some downloaded/renamed files.
export function findCachedByMd5(dir, md5, { existsSync, readdirSync }) {
  const exact = join(dir, `${md5}.stl`);
  if (existsSync(exact)) return exact;

  if (existsSync(dir)) {
    const prefix = `${md5}.stl_`;
    for (const f of readdirSync(dir)) {
      if (f.startsWith(prefix) && f.endsWith('.stl')) return join(dir, f);
    }
  }
  return null;
}
