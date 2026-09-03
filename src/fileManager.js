const FILES_KEY = 'openforge-files';
const ACTIVE_KEY = 'openforge-active-file';
const LEGACY_KEY = 'openforge-layout';

let files = [];
let activeId = null;
let onSwitch = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function initFileManager(callback) {
  onSwitch = callback;

  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(FILES_KEY));
  } catch (e) {
    stored = null;
  }

  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    const legacyData = localStorage.getItem(LEGACY_KEY);
    if (legacyData) {
      const id = generateId();
      files = [{ id, name: 'Untitled' }];
      try { localStorage.setItem('openforge-layout-' + id, legacyData); } catch (e) {}
      try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
    } else {
      const id = generateId();
      files = [{ id, name: 'Untitled' }];
    }
    activeId = files[0].id;
    saveIndex();
    saveActiveId();
  } else {
    files = stored;
    activeId = localStorage.getItem(ACTIVE_KEY);
    if (!activeId || !files.find(f => f.id === activeId)) {
      activeId = files[0].id;
      saveActiveId();
    }
  }
}

export function getFiles() {
  return files;
}

export function getActiveId() {
  return activeId;
}

export function getActiveName() {
  const f = files.find(f => f.id === activeId);
  return f ? f.name : 'Untitled';
}

function saveIndex() {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(files)); } catch (e) {}
}

function saveActiveId() {
  try { localStorage.setItem(ACTIVE_KEY, activeId); } catch (e) {}
}

function fileKey(id) {
  return 'openforge-layout-' + id;
}

export function saveFileData(id, data) {
  try { localStorage.setItem(fileKey(id), JSON.stringify(data)); } catch (e) {}
}

export function loadFileData(id) {
  try {
    const raw = localStorage.getItem(fileKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function createFile(name, duplicate) {
  const id = generateId();
  files.push({ id, name });
  saveIndex();

  if (duplicate) {
    const sourceData = loadFileData(activeId);
    if (sourceData) {
      saveFileData(id, sourceData);
    }
  }

  return id;
}

export function renameFile(id, newName) {
  const f = files.find(f => f.id === id);
  if (f) {
    f.name = newName;
    saveIndex();
  }
}

export function deleteFile(id) {
  if (files.length <= 1) return false;
  const idx = files.findIndex(f => f.id === id);
  if (idx < 0) return false;

  files.splice(idx, 1);
  try { localStorage.removeItem(fileKey(id)); } catch (e) {}
  saveIndex();

  if (activeId === id) {
    activeId = files[0].id;
    saveActiveId();
  }
  return true;
}

export function switchToFile(id) {
  if (id === activeId) return false;
  if (!files.find(f => f.id === id)) return false;
  activeId = id;
  saveActiveId();
  return true;
}
