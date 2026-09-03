const OVERRIDES_KEY = 'openforge-model-overrides';

let overrides = {};

export function initOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (raw) overrides = JSON.parse(raw);
  } catch (e) {
    overrides = {};
  }
}

function save() {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  } catch (e) {
    console.warn('Failed to save overrides');
  }
}

export function getOverride(fileName) {
  return overrides[fileName] || null;
}

export function setOverride(fileName, overrideData) {
  if (overrideData === null || overrideData === undefined) {
    delete overrides[fileName];
  } else {
    overrides[fileName] = { ...overrideData, updatedAt: Date.now() };
  }
  save();
}

export function removeOverride(fileName) {
  delete overrides[fileName];
  save();
}

export function hasOverride(fileName) {
  return !!overrides[fileName];
}

export function getAllOverrides() {
  return { ...overrides };
}

export function applyOverride(modelInfo) {
  const ov = overrides[modelInfo.fileName];
  if (!ov) return modelInfo;

  const result = { ...modelInfo, hasOverride: true };

  if (ov.primaryType !== undefined) result.primaryType = ov.primaryType;
  if (ov.size !== undefined) result.size = ov.size;
  if (ov.typeTags !== undefined) result.typeTags = ov.typeTags;
  if (ov.format !== undefined) result.format = ov.format;
  if (ov.attributes !== undefined) result.attributes = ov.attributes;
  if (ov.theme !== undefined) {
    result.theme = ov.theme;
    result.themeLabel = ov.themeLabel || ov.theme.replace(/[+_%-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  if (ov.color !== undefined) result.color = ov.color;

  if (ov.customFootprint) {
    result.customFootprint = ov.customFootprint;
  }

  if (ov.snapBehavior) {
    result.snapBehavior = ov.snapBehavior;
  }

  if (ov.displayName !== undefined) result.displayName = ov.displayName;

  return result;
}

export const OVERRIDE_FIELDS = [
  { key: 'primaryType', label: 'Type', type: 'select', options: ['floor', 'wall', 'base', 'column', 'corner', 'other'] },
  { key: 'size.x', label: 'Width (tiles)', type: 'number', min: 0.5, max: 8, step: 0.5 },
  { key: 'size.y', label: 'Depth (tiles)', type: 'number', min: 0.5, max: 8, step: 0.5 },
  { key: 'format', label: 'Connection Format', type: 'text', placeholder: 'e.g. openlock, openforge' },
  { key: 'theme', label: 'Theme Override', type: 'text', placeholder: 'e.g. dungeon_stone' },
  { key: 'displayName', label: 'Display Name', type: 'text', placeholder: 'Custom name' },
];

export const CUSTOM_FOOTPRINT_FIELDS = [
  { key: 'w', label: 'Width (mm)', type: 'number', min: 1, max: 200, step: 0.1 },
  { key: 'd', label: 'Depth (mm)', type: 'number', min: 1, max: 200, step: 0.1 },
];

export const SNAP_BEHAVIOR_FIELDS = [
  { key: 'isBase', label: 'Is Base Tile', type: 'checkbox' },
  { key: 'acceptsWalls', label: 'Accepts Walls', type: 'checkbox' },
  { key: 'acceptsFloors', label: 'Accepts Floors (stackable)', type: 'checkbox' },
  { key: 'snapsToCorners', label: 'Snaps to Corners', type: 'checkbox' },
  { key: 'customSnapRadius', label: 'Custom Snap Radius (mm)', type: 'number', min: 0, max: 500, step: 1 },
];

export function buildOverrideFromUI(uiState) {
  const ov = {};

  if (uiState.primaryType && uiState.primaryType !== 'auto') {
    ov.primaryType = uiState.primaryType;
  }

  const sizeX = uiState.sizeX != null && uiState.sizeX !== '' ? parseFloat(uiState.sizeX) : null;
  const sizeY = uiState.sizeY != null && uiState.sizeY !== '' ? parseFloat(uiState.sizeY) : null;
  if (sizeX != null && !isNaN(sizeX) && sizeY != null && !isNaN(sizeY)) {
    ov.size = { x: sizeX, y: sizeY };
  }

  if (uiState.format) ov.format = uiState.format;
  if (uiState.theme) ov.theme = uiState.theme;
  if (uiState.displayName) ov.displayName = uiState.displayName;

  const customWidth = uiState.customWidth != null && uiState.customWidth !== '' ? parseFloat(uiState.customWidth) : null;
  const customDepth = uiState.customDepth != null && uiState.customDepth !== '' ? parseFloat(uiState.customDepth) : null;
  if (customWidth != null && !isNaN(customWidth) && customDepth != null && !isNaN(customDepth)) {
    ov.customFootprint = {
      w: customWidth,
      d: customDepth,
    };
  }

  const snap = {};
  if (uiState.isBase) snap.isBase = true;
  if (uiState.acceptsWalls) snap.acceptsWalls = true;
  if (uiState.acceptsFloors) snap.acceptsFloors = true;
  if (uiState.snapsToCorners) snap.snapsToCorners = true;
  if (uiState.customSnapRadius) {
    const radius = parseFloat(uiState.customSnapRadius);
    if (!isNaN(radius)) snap.customSnapRadius = radius;
  }
  if (Object.keys(snap).length > 0) ov.snapBehavior = snap;

  return ov;
}
