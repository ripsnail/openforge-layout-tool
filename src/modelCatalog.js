import { getOverride, applyOverride } from './modelOverrides.js';

let _nextModelId = 1;
const _usedIds = new Set();

export function registerModelId(id) {
  _usedIds.add(id);
}

export function generateModelId(baseName) {
  if (!_usedIds.has(baseName)) {
    _usedIds.add(baseName);
    return baseName;
  }
  let i = 2;
  while (_usedIds.has(baseName + '_' + i)) i++;
  const id = baseName + '_' + i;
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
};

const VERSION_COLORS = {
  'stucco': 0xd4c4a8,
  'wood': 0x8b6b4b,
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

const THEME_LABELS = {
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
  if (version && VERSION_COLORS[version]) return VERSION_COLORS[version];
  if (THEME_COLORS[set]) return THEME_COLORS[set];
  if (normalized.includes('_')) {
    const fallback = normalized.split('_')[0];
    if (THEME_COLORS[fallback]) return THEME_COLORS[fallback];
  }
  return hashStringToColor(theme);
}

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
  };

  modelInfo = applyOverride(modelInfo);

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

export function hasTag(tags, tag) {
  return tags.includes(tag);
}

export function isFloorTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType) return ov.primaryType === 'floor';
  if (ov?.snapBehavior?.isBase === false) return false;
  return modelInfo.primaryType === 'floor';
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

export function isCornerTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType) return ov.primaryType === 'corner';
  return modelInfo.primaryType === 'corner';
}

export function isWallBaseTile(modelInfo) {
  const ov = getOverride(modelInfo.fileName);
  if (ov?.primaryType && ov.primaryType !== 'base') return false;
  if (ov?.snapBehavior?.acceptsWalls === true && isBaseTile(modelInfo)) return true;
  return modelInfo.primaryType === 'base' &&
         modelInfo.typeTags.includes('wall') &&
         !modelInfo.typeTags.includes('s2w');
}

export function hasS2W(modelInfo) {
  return modelInfo.typeTags.includes('s2w');
}

export function hasCorner(modelInfo) {
  return modelInfo.typeTags.includes('corner');
}

export function hasSide(modelInfo) {
  return modelInfo.attributes?.includes('side') || modelInfo.typeTags.includes('side');
}

const PRIMARY_TYPE_OVERRIDES = {
  'dungeon_stone#magnetic.A.openforge.stl': 'wall',
};

export function resolveTagColor(theme, typeTags) {
  return null;
}

const MODEL_FOOTPRINTS = {
  'dungeon_stone#base+wall.A.openlock+topless,magnetic+flex.stl': { w: 50.8, d: 12.7 },
  'dungeon_stone#base+wall.BA.openlock+topless,magnetic+flex.stl': { w: 38.1, d: 12.7 },
  'dungeon_stone#base+wall.BA+mirror.openlock+topless,magnetic+flex.stl': { w: 38.1, d: 12.7 },
  'wood#base+wall.A.openlock+topless,magnetic+flex.stl': { w: 50.8, d: 12.7 },
  'dungeon_stone#wall.A.openforge.stl': { w: 51.1, d: 12.7 },
  'dungeon_stone#wall.BA.openforge.stl': { w: 38.4, d: 12.7 },
  'dungeon_stone#wall.BA.openforge,side.stl': { w: 38.3, d: 12.7 },
  'rough_stone#wall.A.openforge.stl': { w: 51.1, d: 12.7 },
  'towne+stucco#wall.A.openforge.stl': { w: 50.8, d: 12.7 },
  'dungeon_stone_block#wall,door+arched+standard.A.openforge.stl': { w: 51.2, d: 12.7 },
  'dungeon_stone#magnetic.A.openforge.stl': { w: 51.1, d: 12.7 },
  'dungeon_stone#secret_door.A.bottom,openforge,magnetic+imperial.stl': { w: 51.0, d: 12.7 },
  'dungeon_stone#secret_door.A.top,magnetic+imperial.stl': { w: 51.1, d: 12.7 },
  'dungeon_stone#wall,trap+top+axe.2x.magnetic+imperial.stl': { w: 51.2, d: 12.7 },
  'dungeon_stone#wall,trap+top+dart_holes.2x.magnetic+imperial.stl': { w: 51.2, d: 12.7 },
  'plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl': { w: 50.8, d: 38.1 },
  'plain#base+s2w+square+corner.2x2.openlock+topless,magnetic+flex.stl': { w: 38.1, d: 38.1 },
  'dungeon_stone_block#floor+s2w+wall.2x2.openforge.stl': { w: 50.8, d: 38.1 },
};

export function getTileFootprintMm(modelInfo) {
  if (modelInfo.customFootprint) {
    return { ...modelInfo.customFootprint };
  }

  const ov = getOverride(modelInfo.fileName);
  if (ov?.customFootprint) {
    return { ...ov.customFootprint };
  }

  const custom = MODEL_FOOTPRINTS[modelInfo.fileName];
  if (custom) return { ...custom };

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

export function getTileWidthMm(modelInfo) {
  return getTileFootprintMm(modelInfo).w;
}

export function getTileDepthMm(modelInfo) {
  return getTileFootprintMm(modelInfo).d;
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
