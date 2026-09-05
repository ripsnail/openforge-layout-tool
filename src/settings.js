import { THEME_LABELS } from './modelCatalog.js';

const THEME_COLOR_OVERRIDES_KEY = 'openforge-theme-color-overrides';

let themeColorOverrides = {};

export function initSettings() {
  try {
    const raw = localStorage.getItem(THEME_COLOR_OVERRIDES_KEY);
    if (raw) themeColorOverrides = JSON.parse(raw);
  } catch (e) {
    themeColorOverrides = {};
  }
}

function saveOverrides() {
  try {
    localStorage.setItem(THEME_COLOR_OVERRIDES_KEY, JSON.stringify(themeColorOverrides));
  } catch (e) {
    console.warn('Failed to save theme color overrides');
  }
}

export function getThemeColorOverride(theme) {
  if (!theme) return null;
  if (themeColorOverrides[theme]) return themeColorOverrides[theme];
  const base = theme.split(/[+%_]/)[0];
  if (base && base !== theme && themeColorOverrides[base]) return themeColorOverrides[base];
  return null;
}

export function setThemeColorOverride(theme, hexOrNull) {
  if (hexOrNull === null || hexOrNull === undefined || hexOrNull === '') {
    delete themeColorOverrides[theme];
  } else {
    themeColorOverrides[theme] = hexOrNull;
  }
  saveOverrides();
}

export function getThemeLabels() {
  return { ...THEME_LABELS };
}
