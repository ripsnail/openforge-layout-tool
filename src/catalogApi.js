import { generateModelId, resolveTextureColor } from './modelCatalog.js';

const API_BASE = '/catalog-api';

// fetch() with a hard timeout: hung requests (stalled proxy, dead CDN)
// reject instead of hanging the UI forever.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`, { cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const CATALOG_THEMES = {
  'dungeon_stone': { color: 0x8a8a98, label: 'Dungeon Stone' },
  'cut-stone': { color: 0x9a9a8a, label: 'Cut Stone' },
  'towne': { color: 0xc4b99a, label: 'Towne' },
  'wood': { color: 0x6b4b2b, label: 'Wood' },
  'plain': { color: 0x9a9a9a, label: 'Plain' },
  'sewer': { color: 0x5a6a5a, label: 'Sewer' },
  'cave': { color: 0x6a5a4a, label: 'Cave' },
  'aztlan': { color: 0x8a7a5a, label: 'Aztlan' },
  'rough_stone': { color: 0x7b7b6b, label: 'Rough Stone' },
  'streets': { color: 0x8a7a6a, label: 'Streets' },
  'shingles': { color: 0xb05a3c, label: 'Shingles' },
  // Treat version names as normal themes by including them here.
  'stucco': { color: 0xd4c4a8, label: 'Stucco' },
  'bricks_sidewalk': { color: 0xb05a3c, label: 'Bricks Sidewalk' },
};

function parseThemeParts(theme) {
  const sep = theme.match(/[%+]/);
  if (sep) {
    const idx = theme.indexOf(sep[0]);
    return { set: theme.slice(0, idx), version: theme.slice(idx + 1) };
  }
  const lastUnderscore = theme.lastIndexOf('_');
  if (lastUnderscore >= 0) {
    return { set: theme.slice(0, lastUnderscore), version: theme.slice(lastUnderscore + 1) };
  }
  return { set: theme, version: null };
}

function hashStringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const r = (hash >> 16) & 0xff;
  const g = (hash >> 8) & 0xff;
  const b = hash & 0xff;
  return ((r & 0xf0) << 4) | ((g & 0xf0)) | ((b & 0xf0) >> 4);
}

function getCatalogThemeInfo(theme) {
  if (CATALOG_THEMES[theme]) return CATALOG_THEMES[theme];
  const normalized = theme.replace(/%/g, '_');
  if (CATALOG_THEMES[normalized]) return CATALOG_THEMES[normalized];
  const { set, version } = parseThemeParts(theme);
  if (CATALOG_THEMES[set] && set === 'shingles') return CATALOG_THEMES[set];
  if (version && CATALOG_THEMES[version]) return CATALOG_THEMES[version];
  if (CATALOG_THEMES[set]) return CATALOG_THEMES[set];
  const label = theme.replace(/[+_%-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { color: hashStringToColor(theme), label };
}

export function parseCatalogTags(tags, blueprint) {
  const tagSet = new Set(tags);

  let primaryType = 'other';
  if (tagSet.has('shape|floor')) primaryType = 'floor';
  else if (tagSet.has('shape|base')) primaryType = 'base';
  else if (tagSet.has('shape|wall')) primaryType = 'wall';
  else if (tagSet.has('shape|column')) primaryType = 'column';
  else if (tagSet.has('shape|corner')) primaryType = 'corner';

  const typeTags = [];
  if (primaryType !== 'other') typeTags.push(primaryType);

  if (tagSet.has('shape|base|wall') || (tagSet.has('shape|base') && tagSet.has('shape|wall'))) {
    if (!typeTags.includes('wall')) typeTags.push('wall');
    if (!typeTags.includes('base')) typeTags.push('base');
  }
  if (tagSet.has('build|s2w')) typeTags.push('s2w');
  if (tagSet.has('build|separate wall')) typeTags.push('separate_wall');
  if (tagSet.has('build|wall on tile')) typeTags.push('wall_on_tile');
  if (tagSet.has('build|thick wall')) typeTags.push('thick_wall');
  if (tagSet.has('shape|corner')) typeTags.push('corner');
  if (tagSet.has('component|secret_door')) typeTags.push('secret_door');

  let theme;
  let versionTheme = null;
  const textureSets = [];
  const textureTags = [];
  for (const tag of tags) {
    if (tag.startsWith('texture|')) {
      const parts = tag.split('|');
      if (parts.length === 3) {
        versionTheme = parts[1] + '%' + parts[2];
        textureTags.push({ name: parts[2], isVersion: true, tag });
        if (!textureSets.includes(parts[1])) {
          textureSets.push(parts[1]);
        }
        if (!textureTags.some(t => t.name === parts[1] && !t.isVersion)) {
          textureTags.push({ name: parts[1], isVersion: false, tag: `texture|${parts[1]}` });
        }
      } else if (parts.length === 2 && parts[1] !== 'plain' && !textureSets.includes(parts[1])) {
        textureSets.push(parts[1]);
        if (!textureTags.some(t => t.name === parts[1])) {
          textureTags.push({ name: parts[1], isVersion: false, tag });
        }
      }
    }
  }
  theme = versionTheme || textureSets.join('+') || 'plain';

  let format = null;
  for (const tag of tags) {
    if (tag.startsWith('connection|') && !tag.startsWith('connection|side') && !tag.startsWith('connection|pegs')) {
      const parts = tag.split('|');
      if (parts.length === 2) {
        format = parts[1];
      } else if (parts.length >= 3) {
        format = parts.slice(1).join('+');
      }
    }
  }

  const attributes = [];
  if (tagSet.has('connection|magnetic|flex')) {
    attributes.push('magnetic', 'flex');
  } else if (tagSet.has('connection|magnetic')) {
    attributes.push('magnetic');
  }
  if (tagSet.has('connection|openlock|topless')) {
    attributes.push('topless');
  }
  if (tagSet.has('connection|side')) attributes.push('side');
  if (tagSet.has('connection|left')) attributes.push('left');
  if (tagSet.has('connection|right')) attributes.push('right');

  let sizeX = null;
  let sizeY = null;
  for (const tag of tags) {
    if (tag.startsWith('size|width|')) {
      const val = tag.split('|')[2];
      sizeX = parseFloat(val) || null;
    }
    if (tag.startsWith('size|depth|')) {
      const val = tag.split('|')[2];
      sizeY = parseFloat(val) || null;
    }
  }

  if (sizeX === null && sizeY === null) {
    const fname = blueprint?.file_name || blueprint?.blueprint_name || '';
    const sizeMatch = fname.match(/\.(\d+)x(\d+)\./);
    if (sizeMatch) {
      sizeX = parseInt(sizeMatch[1]);
      sizeY = parseInt(sizeMatch[2]);
    } else {
      const letterMatch = fname.match(/\.([A-Z](?:\+[A-Z])?)\./);
      if (letterMatch) {
        const codes = {
          'A': [1, 1], 'B': [2, 2], 'BA': [2, 1],
          'C': [1, 1], 'L': [1, 1], '2x': [2, 1],
        };
        const c = codes[letterMatch[1]];
        if (c) { sizeX = c[0]; sizeY = c[1]; }
      }
    }
  }

  if (sizeX !== null && sizeY === null) sizeY = sizeX;
  if (sizeX === null && sizeY !== null) sizeX = sizeY;
  const size = (sizeX !== null) ? { x: sizeX, y: sizeY } : null;

  const themeInfo = getCatalogThemeInfo(theme);

  const fileName = blueprint?.file_name || blueprint?.blueprint_name || '';

  return {
    _id: generateModelId(fileName, blueprint?.file_md5 || null),
    theme,
    textureTags,
    themeLabel: themeInfo.label,
    color: resolveTextureColor(textureTags, theme),
    typeTags,
    primaryType,
    size,
    format,
    attributes,
    fileName: blueprint?.file_name || blueprint?.blueprint_name || '',
    displayName: typeTags.filter(t => t !== primaryType).join('+').replace(/_/g, ' ') || primaryType,
    source: 'catalog',
    catalogId: blueprint?.id || null,
    sha: blueprint?.file_md5 || null,
    thumbnailUrl: blueprint?.images?.[0]?.image_url || null,
    storageUrl: blueprint?.storage_address || null,
    tags,
  };
}

export function blueprintToModelInfo(blueprint) {
  return parseCatalogTags(blueprint.tags || [], blueprint);
}

export async function searchBlueprints({ require = [], deny = [], limit = 50, nextToken = null, prevToken = null } = {}) {
  const params = new URLSearchParams();
  params.set('models', 'true');
  params.set('blueprints', 'true');
  if (limit) params.set('limit', String(limit));
  if (nextToken) params.set('next', nextToken);
  if (prevToken) params.set('previous', prevToken);

  const body = {};
  if (require.length > 0) body.require = require.map(t => ({ tag: t }));
  if (deny.length > 0) body.deny = deny.map(t => ({ tag: t }));

  const url = `${API_BASE}/blueprints/tags?${params.toString()}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, 30000);

  if (!resp.ok) throw new Error(`Catalog API error: ${resp.status}`);
  const data = await resp.json();

  console.log('[catalog] search', { require, deny, limit, found: (data.blueprints || []).length, total: data.paging?.total_count });

  return {
    blueprints: (data.blueprints || []).map(b => ({
      ...b,
      modelInfo: blueprintToModelInfo(b),
    })),
    tagCounts: data.tag_counts || {},
    paging: data.paging || { total_count: 0 },
  };
}

export async function downloadBlueprintSTL(blueprint, onProgress) {
  const url = blueprint.storage_address || blueprint.modelInfo?.storageUrl;
  if (!url) throw new Error('No storage address for blueprint');

  let fetchUrl = url;
  if (url.startsWith('https://objects.openforge.tools/')) {
    fetchUrl = '/catalog-objects' + url.replace('https://objects.openforge.tools', '');
  }

  const resp = await fetchWithTimeout(fetchUrl, {}, 120000);
  if (!resp.ok) throw new Error(`Failed to download STL: ${resp.status}`);

  const contentLength = parseInt(resp.headers.get('content-length') || '0');
  const reader = resp.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && contentLength > 0) {
      onProgress(received / contentLength);
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  console.log('[catalog] STL downloaded', blueprint.file_name || blueprint.blueprint_name, `${received} bytes`);
  return buffer;
}

export { CATALOG_THEMES, getCatalogThemeInfo };
