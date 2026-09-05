import { getOverride, applyOverride } from './modelOverrides.js';

let _nextModelId = 1;
const _usedIds = new Set();

// Filename -> texture name overrides. Edit this map to add more
// special-case texture defaults without changing code logic.
const FILENAME_TEXTURE_OVERRIDES = {
  'towne#floor+wall+s2w.2x2.openforge.stl': 'wood',
};

export function applyFilenameTextureOverrides(modelInfo) {
  if (!modelInfo || !modelInfo.fileName) return modelInfo;
  const tex = FILENAME_TEXTURE_OVERRIDES[modelInfo.fileName];
  if (!tex) return modelInfo;
  modelInfo.textureTags = setTextureOverride(modelInfo.textureTags, tex);
  return modelInfo;
}

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
  // Merge version colors here so versions are treated like normal themes.
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

const SIZE_LETTER_CODES = {
  'A': { x: 1, y: 1 },
  'B': { x: 2, y: 2 },
  'BA': { x: 2, y: 1 },
  'C': { x: 1, y: 1 },
  'L': { x: 1, y: 1 },
  'col+L': { x: 1, y: 1 },
  '1.5': { x: 1.5, y: 1.5 },
  '2x': { x: 2, y: 1 },
};

const WALL_SIZE_LETTER_CODES = {
  'A': { x: 2, y: 0.5 },
  'B': { x: 2, y: 0.5 },
  'BA': { x: 1.5, y: 0.5 },
  'C': { x: 1, y: 0.5 },
  'L': { x: 1, y: 0.5 },
  'col+L': { x: 1, y: 0.5 },
  '2x': { x: 2, y: 0.5 },
};

const KNOWN_ATTRIBUTES = ['side'];

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
];

export function getThemeLabel(theme) {
  return THEME_LABELS[theme] || theme.replace(/[+_%-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function splitTypeTags(typePart) {
  const parts = typePart ? typePart.split('+') : [];
  const result = [];
  for (const p of parts) {
    const sub = p.split(',');
    for (const s of sub) {
      if (s) result.push(s);
    }
  }
  return result;
}

function parseLetterCode(p, typeTags = []) {
  const isWall = typeTags.includes('wall') || typeTags.includes('base+wall');
  const codes = isWall ? WALL_SIZE_LETTER_CODES : SIZE_LETTER_CODES;
  
  if (codes[p]) return codes[p];
  const base = p.split('+')[0];
  return codes[base] || null;
}

export function parseModelFilename(filename) {
  const name = filename.replace(/\.stl$/i, '');
  const afterHash = name.split('#');
  const theme = afterHash[0];
  const rest = afterHash[1] || '';

  const dotParts = rest.split('.');

  const typePart = dotParts[0];
  const typeTags = splitTypeTags(typePart);

  let size = null;
  let format = null;
  let attributes = [];

  for (let i = 1; i < dotParts.length; i++) {
    const p = dotParts[i];

    if (/^\d+x\d+$/.test(p)) {
      const [sx, sy] = p.split('x').map(Number);
      size = { x: sx, y: sy };
      continue;
    }

    const letterSize = parseLetterCode(p, typeTags);
    if (letterSize) {
      size = letterSize;
      continue;
    }

    if (p.includes(',')) {
      const commaIdx = p.indexOf(',');
      format = format || p.slice(0, commaIdx);
      attributes = p.slice(commaIdx + 1).split(',');
      continue;
    }

    if (KNOWN_ATTRIBUTES.includes(p)) {
      attributes.push(p);
      continue;
    }

    format = format || p;
  }

  let primaryType = detectPrimaryType(typeTags);
  if (PRIMARY_TYPE_OVERRIDES[filename]) {
    primaryType = PRIMARY_TYPE_OVERRIDES[filename];
  }
  const connCaps = getConnectionCapabilities(typeTags, primaryType, size);

  let modelInfo = {
    _id: generateModelId(filename),
    theme,
    themeLabel: getThemeLabel(theme),
    color: getThemeColor(theme),
    typeTags,
    primaryType,
    size,
    format,
    attributes,
    fileName: filename,
    displayName: typeTags.join('+').replace(/_/g, ' '),
    connCaps,
    source: 'local',
    // Filename theme prefixes like "shingles,stucco" carry the texture sets.
    // Capture them so menus and the colour tracker work even when no raw
    // catalog tags are available (e.g. layout-restore fallback).
    textureTags: theme.split(/[,+]/).map(s => s.trim()).filter(s => s && s !== 'plain').map(name => ({ name, isVersion: false, tag: `texture|${name}` })),
  };

  modelInfo = applyOverride(modelInfo);

  // Apply any filename-based texture overrides from the map.
  applyFilenameTextureOverrides(modelInfo);

  return modelInfo;
}

function detectPrimaryType(tags) {
  const order = ['floor', 'base', 'wall', 'column', 'corner'];
  for (const t of order) {
    if (tags.includes(t)) return t;
  }
  return tags[0] || 'other';
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

const PRIMARY_TYPE_OVERRIDES = {
  'dungeon_stone#magnetic.A.openforge.stl': 'wall',
};

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

function getConnectionCapabilities(typeTags, primaryType, size) {
  const defaults = { tileW: 50.8, tileD: 50.8 };
  if (primaryType === 'wall') {
    defaults.tileW = (size?.x || 1) * 25.4;
    defaults.tileD = 12.7;
  } else if (primaryType === 'column') {
    defaults.tileW = 25.4;
    defaults.tileD = 25.4;
  } else if (primaryType === 'base') {
    const isWallBase = typeTags.includes('wall') && !typeTags.includes('s2w');
    if (isWallBase) {
      defaults.tileW = (size?.x || 1) * 25.4;
      defaults.tileD = (size?.y || 1) * 25.4;
    } else {
      defaults.tileW = (size?.x || 2) * 25.4;
      defaults.tileD = (size?.y || 2) * 25.4;
    }
  } else {
    defaults.tileW = (size?.x || 2) * 25.4;
    defaults.tileD = (size?.y || 2) * 25.4;
  }

  const caps = {
    category: 'other',
    acceptsWall: false,
    acceptsFloor: false,
    snapsTo: [],
    edgeProfile: null,
    tileW: defaults.tileW,
    tileD: defaults.tileD,
  };

  if (primaryType === 'floor') {
    caps.category = 'floor';
    caps.acceptsFloor = true;
    caps.snapsTo = ['floor', 'base'];

    if (typeTags.includes('s2w')) {
      caps.acceptsWall = true;
      caps.edgeProfile = 's2w';
    }
    if (typeTags.includes('corner')) {
      caps.edgeProfile = caps.edgeProfile ? 's2w+corner' : 'corner';
    }
  } else if (primaryType === 'wall') {
    caps.category = 'wall';
    caps.snapsTo = ['floor', 'base'];
  } else if (primaryType === 'base') {
    caps.category = 'base';
    caps.acceptsFloor = true;
    caps.snapsTo = ['floor', 'base'];
    if (typeTags.includes('s2w')) {
      caps.acceptsWall = true;
      caps.edgeProfile = 's2w';
    } else if (typeTags.includes('wall')) {
      caps.acceptsWall = true;
      caps.edgeProfile = 'separate-wall';
    }
  } else if (primaryType === 'column') {
    caps.category = 'column';
    caps.snapsTo = ['wall', 'floor'];
  } else if (primaryType === 'corner') {
    caps.category = 'corner';
    caps.snapsTo = ['floor', 'wall'];
  }

  return caps;
}
