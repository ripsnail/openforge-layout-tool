const warnedKeys = new Set();

function warnOnce(key, message, error) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message, error);
}

export function getStorageItem(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (error) {
    warnOnce(`read:${key}`, `Failed to read browser storage key "${key}".`, error);
    return fallback;
  }
}

export function setStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    warnOnce(`write:${key}`, `Failed to save browser storage key "${key}". Storage may be full.`, error);
    return false;
  }
}

export function removeStorageItem(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    warnOnce(`remove:${key}`, `Failed to remove browser storage key "${key}".`, error);
    return false;
  }
}
