import { getOverride, applyOverride } from './modelOverrides.js';

let _nextModelId = 1;
const _usedIds = new Set();

export function registerModelId(id) {
  _usedIds.add(id);
}

// Generate a stable model id. If a content `sha` is provided, prefer a
// content-derived id to avoid filename-based collisions across re-imports.
export function generateModelId(baseName, sha) {
  const name = String(baseName || 'model');
  if (sha) {
    const short = String(sha).slice(0, 8);
    let id = `${name}#${short}`;
    if (!_usedIds.has(id)) { _usedIds.add(id); return id; }
    let i = 2;
    while (_usedIds.has(id + '_' + i)) i++;
    id = id + '_' + i;
    _usedIds.add(id);
    return id;
  }

  if (!_usedIds.has(name)) {
    _usedIds.add(name);
    return name;
  }
  let i = 2;
  while (_usedIds.has(name + '_' + i)) i++;
  const id = name + '_' + i;
  _usedIds.add(id);
  return id;
}

const THEME_COLORS = {
  'dungeon_stone': 0x8a8a98,
  'rough_stone': 0x7b7b6b,
  'cut-stone': 0x9a9a8a,
  'towne': 0xc4b99a,
  'wood': 0x6b4b2b,
  'plain': 0x9a9a9a,
  'sewer': 0x5a6a5a,
  'cave': 0x6a5a4a,
  'aztlan': 0x8a7a5a,
  'streets': 0x8a7a6a,
  'shingles': 0xb05a3c,
  'stucco': 0xd4c4a8,
  'bricks_sidewalk': 0xb05a3c,
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

export const THEME_LABELS = {
  'dungeon_stone': 'Dungeon Stone',
  'rough_stone': 'Rough Stone',
  'cut-stone': 'Cut Stone',
  'towne': 'Towne',
  'wood': 'Wood',
  'plain': 'Plain',
  'sewer': 'Sewer',
  'cave': 'Cave',
  'aztlan': 'Aztlan',
  'streets': 'Streets',
  'shingles': 'Shingles',
  'stucco': 'Stucco',
  'bricks_sidewalk': 'Bricks/Sidewalk',
};

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

const TYPE_ICONS = {
  'floor': '▦',
  'wall': '▤',
  'base+wall': '▥',
  'corner': '◩',
  'column': '◈',
  'base': '▣',
};

export function getThemeColor(theme) {
  if (THEME_COLORS[theme]) return THEME_COLORS[theme];
  const normalized = theme.replace(/%/g, '_');
  if (THEME_COLORS[normalized]) return THEME_COLORS[normalized];
  const { set, version } = parseThemeParts(theme);
  if (THEME_COLORS[set] && set === 'shingles') return THEME_COLORS[set];
  // Treat version suffixes like normal themes by checking THEME_COLORS
  if (version && THEME_COLORS[version]) return THEME_COLORS[version];
  if (THEME_COLORS[set]) return THEME_COLORS[set];
  if (normalized.includes('_')) {
    const fallback = normalized.split('_')[0];
    if (THEME_COLORS[fallback]) return THEME_COLORS[fallback];
  }
  return hashStringToColor(theme);
}

const TEXTURE_PRIORITY = [
  'shingles', 'bricks_sidewalk', 'stucco', 'marble', 'cobblestone',
  'cut-stone', 'rough_stone', 'dungeon_stone', 'smooth_stone',
  'wood', 'sewer', 'cave', 'aztlan', 'streets', 'towne', 'plain',
];

function textureColorFor(name, isVersion) {
  if (name === undefined || name === null) return null;
  if (isVersion) {
    // Versions are treated as normal themes; look up in THEME_COLORS.
    if (THEME_COLORS[name] !== undefined) return THEME_COLORS[name];
    return null;
  }
  if (THEME_COLORS[name] !== undefined) return THEME_COLORS[name];
  return null;
}

function pickTexture(list, isVersion) {
  if (!list || list.length === 0) return null;
  for (const p of TEXTURE_PRIORITY) {
    if (list.includes(p)) return p;
  }
  for (const name of list) {
    if (textureColorFor(name, isVersion) !== null) return name;
  }
  return null;
}

export function deriveTextureTags(rawTags) {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const result = [];
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('texture|')) continue;
    const parts = tag.split('|');
    if (parts.length === 3) {
      result.push({ name: parts[2], isVersion: true, tag });
      if (!result.some(t => t.name === parts[1] && !t.isVersion)) {
        result.push({ name: parts[1], isVersion: false, tag: `texture|${parts[1]}` });
      }
    } else if (parts.length === 2 && parts[1] !== 'plain') {
      if (!result.some(t => t.name === parts[1])) {
        result.push({ name: parts[1], isVersion: false, tag });
      }
    }
  }
  return result;
}

export function getEffectiveTextureTags(modelInfo) {
  if (modelInfo?.textureTags && modelInfo.textureTags.length > 0) return modelInfo.textureTags;
  const derived = deriveTextureTags(modelInfo?.tags);
  return derived.length > 0 ? derived : null;
}

export function resolveTextureColor(textureTags, theme) {
  if (textureTags && textureTags.length > 0) {
    const override = textureTags.find(t => t.override);
    if (override) {
      const c = textureColorFor(override.name, override.isVersion);
      if (c !== null) return c;
    }

    const versions = textureTags.filter(t => t.isVersion && !t.override);
    const sets = textureTags.filter(t => !t.isVersion && !t.override);

    const versionPick = pickTexture(versions.map(t => t.name), true);
    if (versionPick) {
      const c = textureColorFor(versionPick, true);
      if (c !== null) return c;
    }

    const setPick = pickTexture(sets.map(t => t.name), false);
    if (setPick) {
      const c = textureColorFor(setPick, false);
      if (c !== null) return c;
    }
  }
  return getThemeColor(theme);
}

export function getTextureOverride(textureTags) {
  if (!textureTags) return null;
  const tag = textureTags.find(t => t.override);
  return tag ? tag.name : null;
}

export function setTextureOverride(textureTags, name) {
  if (!Array.isArray(textureTags)) return [{ name, isVersion: false, override: true, tag: `texture|${name}` }];
  const rest = textureTags.filter(t => !t.override);
  if (!name) return rest;
  return [{ name, isVersion: false, override: true, tag: `texture|${name}` }, ...rest];
}

export function formatTextureTag(t) {
  if (!t) return '';
  const full = t.tag || `texture|${t.name}`;
  const encodesVersion = full.split('|').length === 3;
  const versionMark = t.isVersion && !encodesVersion ? ' (version)' : '';
  return full + versionMark + (t.override ? ' (override)' : '');
}

// Escapes a string for interpolation into HTML text or double-quoted
// attribute values. Use for anything originating outside this codebase:
// catalog tag strings (remote API), filenames, and user-entered overrides.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const TEXTURE_OPTIONS = [
  { name: 'dungeon_stone', label: 'Dungeon Stone' },
  { name: 'rough_stone', label: 'Rough Stone' },
  { name: 'cut-stone', label: 'Cut Stone' },
  { name: 'towne', label: 'Towne' },
  { name: 'wood', label: 'Wood' },
  { name: 'plain', label: 'Plain' },
  { name: 'sewer', label: 'Sewer' },
  { name: 'cave', label: 'Cave' },
  { name: 'aztlan', label: 'Aztlan' },
  { name: 'streets', label: 'Streets' },
  { name: 'shingles', label: 'Shingles' },
  { name: 'stucco', label: 'Stucco' },
  { name: 'bricks_sidewalk', label: 'Bricks/Sidewalk' },
];

export function getThemeLabel(theme) {
  return THEME_LABELS[theme] || theme.replace(/[+_%-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function getTypeIcon(type) {
  return TYPE_ICONS[type] || '■';
}

export function isWallTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType) return ov.primaryType === 'wall';
  return modelInfo.primaryType === 'wall';
}

export function isBaseTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType) return ov.primaryType === 'base';
  if (ov?.snapBehavior?.isBase === true) return true;
  if (ov?.snapBehavior?.isBase === false) return false;
  return modelInfo.primaryType === 'base';
}

export function isColumnTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType) return ov.primaryType === 'column';
  return modelInfo.primaryType === 'column';
}

export function isWallBaseTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType && ov.primaryType !== 'base') return false;
  if (ov?.snapBehavior?.acceptsWalls === true && isBaseTile(modelInfo)) return true;
  return modelInfo.primaryType === 'base' &&
         modelInfo.typeTags.includes('wall') &&
         !modelInfo.typeTags.includes('s2w');
}

export function getTileFootprintMm(modelInfo) {
  if (modelInfo.customFootprint) {
    return { ...modelInfo.customFootprint };
  }

  const ov = getOverride(modelInfo.fileName);
  if (ov?.customFootprint) {
    return { ...ov.customFootprint };
  }

  if (isWallBaseTile(modelInfo)) {
    return {
      w: (modelInfo.size?.x || 1) * 25.4,
      d: (modelInfo.size?.y || 1) * 25.4,
    };
  }
  if (modelInfo.primaryType === 'wall') {
    if (modelInfo.size) {
      return { w: modelInfo.size.x * 25.4, d: 12.7 };
    }
    return { w: 25.4, d: 12.7 };
  }
  if (modelInfo.primaryType === 'column') {
    return { w: 25.4, d: 25.4 };
  }
  return {
    w: (modelInfo.size?.x || 2) * 25.4,
    d: (modelInfo.size?.y || 2) * 25.4,
  };
}
