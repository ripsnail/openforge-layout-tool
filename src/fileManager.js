import { setStorageItem, removeStorageItem } from './storage.js';

const FILES_KEY = 'openforge-files';
const ACTIVE_KEY = 'openforge-active-file';

let files = [];
let activeId = null;

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function initFileManager() {

  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(FILES_KEY));
  } catch (e) {
    stored = null;
  }

  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    const id = generateId();
    files = [{ id, name: 'Untitled' }];
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
  setStorageItem(FILES_KEY, JSON.stringify(files));
}

function saveActiveId() {
  setStorageItem(ACTIVE_KEY, activeId);
}

function fileKey(id) {
  return 'openforge-layout-' + id;
}

export function saveFileData(id, data) {
  return setStorageItem(fileKey(id), JSON.stringify(data));
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
  removeStorageItem(fileKey(id));
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
