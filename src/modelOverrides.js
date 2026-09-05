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
  if (uiState.customSnapRadius) {
    const radius = parseFloat(uiState.customSnapRadius);
    if (!isNaN(radius)) snap.customSnapRadius = radius;
  }
  if (Object.keys(snap).length > 0) ov.snapBehavior = snap;

  return ov;
}
