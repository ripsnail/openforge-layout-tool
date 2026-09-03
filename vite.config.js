import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';

function findCachedByMd5(dir, md5) {
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

function openMetadataDb(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'metadata.sqlite'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      sha TEXT PRIMARY KEY,
      file_name TEXT,
      catalog_id TEXT,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      stl_cached INTEGER NOT NULL DEFAULT 0
    )
  `);
  try {
    const cols = db.prepare('PRAGMA table_info(models)').all().map((c) => c.name);
    if (!cols.includes('stl_cached')) {
      db.exec('ALTER TABLE models ADD COLUMN stl_cached INTEGER NOT NULL DEFAULT 0');
    }
  } catch (e) {
    console.error('Failed to migrate metadata table:', e);
  }
  return db;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function downloadedStlPlugin() {
  const dir = join(process.cwd(), 'downloaded');
  const metaDb = openMetadataDb(dir);
  const getAllMeta = () => metaDb.prepare('SELECT data, stl_cached FROM models ORDER BY file_name').all();
  const getMeta = (sha) => metaDb.prepare('SELECT data, stl_cached FROM models WHERE sha = ?').get(sha);
  const putMeta = metaDb.prepare(`
    INSERT INTO models (sha, file_name, catalog_id, data, updated_at, stl_cached)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sha) DO UPDATE SET
      file_name = excluded.file_name,
      catalog_id = excluded.catalog_id,
      data = excluded.data,
      updated_at = excluded.updated_at,
      stl_cached = excluded.stl_cached
  `);
  const deleteMeta = metaDb.prepare('DELETE FROM models WHERE sha = ?');
  const setStlCached = metaDb.prepare('UPDATE models SET stl_cached = ? WHERE sha = ?');
  const withCachedFlag = (row) => ({ ...JSON.parse(row.data), stl_cached: row.stl_cached === 1 });
  // Backfill stl_cached from the files actually on disk.
  try {
    metaDb.prepare('UPDATE models SET stl_cached = 0').run();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        const m = f.match(/^([0-9a-f]{32})\.stl$/i);
        if (m) setStlCached.run(1, m[1].toLowerCase());
      }
    }
  } catch (e) {
    console.error('Failed to backfill stl_cached:', e);
  }
  return {
    name: 'downloaded-stl',
    configureServer(server) {
      server.middlewares.use('/metadata', (req, res, next) => {
        const raw = (req.url || '').replace(/^\//, '').replace(/\.stl$/, '');
        if (req.method === 'GET' && !raw) {
          try {
            const rows = getAllMeta();
            const items = rows.map(withCachedFlag);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(items));
          } catch (e) {
            console.error('Failed to list metadata:', e);
            res.writeHead(500); res.end('Metadata read failed');
          }
          return;
        }
        const sha = raw.toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(sha)) {
          res.writeHead(400); res.end('Bad request');
          return;
        }
        if (req.method === 'GET') {
          const row = getMeta(sha);
          if (!row) {
            res.writeHead(404); res.end('Not found');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(withCachedFlag(row)));
          return;
        }
        if (req.method === 'POST') {
          readJsonBody(req).then((info) => {
            try {
              if (!info || typeof info !== 'object') throw new Error('Invalid body');
              const stored = { ...info, sha };
              delete stored.stl_cached;
              const cached = existsSync(join(dir, `${sha}.stl`)) ? 1 : 0;
              putMeta.run(
                sha,
                stored.fileName || stored.file_name || null,
                stored.catalogId || stored.catalog_id || null,
                JSON.stringify(stored),
                Date.now(),
                cached,
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true, sha }));
            } catch (e) {
              res.writeHead(400); res.end('Invalid metadata');
            }
          }).catch(() => {
            res.writeHead(400); res.end('Invalid metadata');
          });
          return;
        }
        if (req.method === 'DELETE') {
          deleteMeta.run(sha);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        next();
      });
      server.middlewares.use('/getModel', (req, res, next) => {
        const md5 = (req.url || '').replace(/^\//, '').replace(/\.stl$/, '');
        if (!/^[0-9a-f]{32}$/i.test(md5)) {
          res.writeHead(400); res.end('Bad request');
          return;
        }
        const filePath = findCachedByMd5(dir, md5);
        if (!filePath) {
          res.writeHead(404); res.end('Not cached');
          return;
        }
        const data = readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': 'model/stl', 'Content-Length': data.length, 'Cache-Control': 'no-store' });
        res.end(data);
      });

      server.middlewares.use('/downloaded', (req, res, next) => {
        if (req.method === 'POST') {
          let body = [];
          req.on('data', chunk => body.push(chunk));
          req.on('end', () => {
            try {
              if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
              const fileName = decodeURIComponent(req.url.slice(1));
              if (!fileName || fileName.includes('..')) {
                res.writeHead(400);
                res.end('Invalid filename');
                return;
              }
              const filePath = join(dir, fileName);
              const fileDir = join(dir, fileName.substring(0, fileName.lastIndexOf('/')));
              if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
              writeFileSync(filePath, Buffer.concat(body));
              const shaMatch = fileName.match(/^([0-9a-f]{32})\.stl$/i);
              if (shaMatch) {
                try { setStlCached.run(1, shaMatch[1].toLowerCase()); } catch (e) {}
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: true }));
            } catch (e) {
              console.error('Failed to save STL:', e);
              res.writeHead(500);
              res.end('Write failed');
            }
          });
        } else if (req.method === 'GET' || req.method === 'HEAD') {
          const fileName = decodeURIComponent(req.url.slice(1));
          if (!fileName || fileName.includes('..')) {
            next();
            return;
          }
          const filePath = join(dir, fileName);
          if (existsSync(filePath)) {
            const data = readFileSync(filePath);
            const ext = fileName.split('.').pop().toLowerCase();
            const mime = ext === 'stl' ? 'model/stl' : `application/${ext}`;
            res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Cache-Control': 'no-store' });
            res.end(req.method === 'HEAD' ? null : data);
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } else if (req.method === 'DELETE') {
          const fileName = decodeURIComponent(req.url.slice(1));
          if (!fileName || fileName.includes('..')) {
            next();
            return;
          }
          const filePath = join(dir, fileName);
          if (existsSync(filePath)) {
            unlinkSync(filePath);
          }
          const shaMatch = fileName.match(/^([0-9a-f]{32})\.stl$/i);
          if (shaMatch) {
            try { setStlCached.run(0, shaMatch[1].toLowerCase()); } catch (e) {}
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [downloadedStlPlugin()],
  server: {
    fs: {
      strict: false,
    },
    proxy: {
      '/catalog-api': {
        target: 'https://staging.openforge.tools',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/catalog-api/, '/api'),
      },
      '/catalog-objects': {
        target: 'https://objects.openforge.tools',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/catalog-objects/, ''),
      },
    },
  },
});
