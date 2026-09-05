// Pure, dependency-free helpers used by the vite.config.js dev-server
// middleware. Kept in a separate module so they can be unit tested without
// pulling in `vite`, `node:sqlite`, or touching the filesystem.
import { join, resolve } from 'path';

const MD5_RE = /^[0-9a-f]{32}$/i;

export function isValidMd5(value) {
  return typeof value === 'string' && MD5_RE.test(value);
}

// Resolves `fileName` against `dir` and rejects anything that would escape
// the directory (path traversal via `..`, absolute paths, null bytes, etc).
// Returns the resolved absolute path, or null if the name is unsafe.
export function safeDownloadedPath(dir, fileName) {
  if (!fileName || typeof fileName !== 'string' || fileName.includes('\0')) {
    return null;
  }
  const root = resolve(dir);
  const filePath = resolve(root, fileName);
  if (filePath !== root && !filePath.startsWith(`${root}/`)) {
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
