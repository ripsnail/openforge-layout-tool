import { initScene } from './scene.js';
import { initPalette } from './catalogPalette.js';
import { PlacementSystem } from './placement.js';
import { initOverrides } from './modelOverrides.js';
import { TEMPLATES, initUserTemplates, getUserTemplates, saveUserTemplate, deleteUserTemplate, selectionToTemplate } from './templates.js';
import { setSnapSettings } from './snapPoints.js';
import { clearScanCache } from './modelScanner.js';
import {
  initFileManager, getFiles, getActiveId, getActiveName,
  createFile, renameFile, deleteFile, switchToFile,
  saveFileData, loadFileData
} from './fileManager.js';

function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.getElementById('sidebar');
  if (!handle || !sidebar) return;

  const key = 'sidebar-width';
  const saved = parseInt(localStorage.getItem(key));
  if (!isNaN(saved)) {
    sidebar.style.width = saved + 'px';
    document.documentElement.style.setProperty('--sidebar-current-width', saved + 'px');
  }

  let startX, startWidth;

  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('active');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const newWidth = Math.min(Math.max(startWidth + (e.clientX - startX), 200), 600);
    sidebar.style.width = newWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-current-width', newWidth + 'px');
  }

  function onMouseUp() {
    handle.classList.remove('active');
    const current = sidebar.offsetWidth;
    localStorage.setItem(key, current);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', onMouseDown);
}

function initBomResize() {
  const handle = document.getElementById('bom-resize');
  const bom = document.getElementById('bom-section');
  if (!handle || !bom) return;

  const key = 'bom-height';
  const saved = parseInt(localStorage.getItem(key));
  if (!isNaN(saved)) {
    bom.style.height = saved + 'px';
  }

  let startY, startHeight;

  function onMouseDown(e) {
    e.preventDefault();
    startY = e.clientY;
    startHeight = bom.offsetHeight;
    handle.classList.add('active');
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    const newHeight = Math.min(Math.max(startHeight - (e.clientY - startY), 40), 500);
    bom.style.height = newHeight + 'px';
  }

  function onMouseUp() {
    handle.classList.remove('active');
    localStorage.setItem(key, bom.offsetHeight);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }

  handle.addEventListener('mousedown', onMouseDown);
}

let isLoading = false;

function setLoading(loading) {
  isLoading = loading;
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.classList.toggle('active', loading);
  }
}

function closeAllMenus() {
  document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
}

function toggleMenu(menu) {
  const isOpen = menu.classList.contains('open');
  closeAllMenus();
  if (!isOpen) menu.classList.add('open');
}

function initTemplatesMenu(placement) {
  const btn = document.getElementById('templates-btn');
  const menu = document.getElementById('templates-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    renderTemplatesMenu(menu, placement);
    toggleMenu(menu);
  });
}

function renderTemplatesMenu(menu, placement) {
  menu.innerHTML = '';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'template-item template-save';
  saveBtn.textContent = '+ Save Selection as Template';
  saveBtn.disabled = placement.selectedMeshes.length === 0;
  saveBtn.title = placement.selectedMeshes.length === 0 ? 'Select tiles first' : 'Save selected tiles as a reusable template';
  saveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeAllMenus();
    const tiles = selectionToTemplate(placement.selectedMeshes);
    if (!tiles) return;
    const name = prompt('Template name:');
    if (!name || !name.trim()) return;
    saveUserTemplate(name.trim(), tiles);
    placement.updateInfo();
  });
  menu.appendChild(saveBtn);

  const userTemplates = getUserTemplates();
  if (userTemplates.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'template-separator';
    sep.textContent = 'User Templates';
    menu.appendChild(sep);

    userTemplates.forEach((template, idx) => {
      const item = document.createElement('div');
      item.className = 'template-item-row';

      const btn = document.createElement('button');
      btn.className = 'template-item';
      btn.textContent = template.name;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        closeAllMenus();
        await placement.setActiveTemplate(template);
      });
      item.appendChild(btn);

      const del = document.createElement('button');
      del.className = 'template-delete';
      del.textContent = '×';
      del.title = 'Delete template';
      del.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteUserTemplate(idx);
        renderTemplatesMenu(menu, placement);
      });
      item.appendChild(del);

      menu.appendChild(item);
    });
  }

  if (TEMPLATES.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'template-separator';
    sep.textContent = 'Built-in';
    menu.appendChild(sep);

    for (const template of TEMPLATES) {
      const item = document.createElement('button');
      item.className = 'template-item';
      item.textContent = template.name;
      item.addEventListener('click', async (e) => {
        e.preventDefault();
        closeAllMenus();
        await placement.setActiveTemplate(template);
      });
      menu.appendChild(item);
    }
  }
}

function initSnapMenu() {
  const btn = document.getElementById('snap-btn');
  const menu = document.getElementById('snap-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu(menu);
  });

  const checkboxes = menu.querySelectorAll('input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const settings = {};
      checkboxes.forEach(c => { settings[c.dataset.snap] = c.checked; });
      setSnapSettings(settings);
      clearScanCache();
    });
  });
}

function initFileMenu(placement) {
  const btn = document.getElementById('file-btn');
  const menu = document.getElementById('file-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleMenu(menu);
  });

  const saveItem = menu.querySelector('[data-action="save"]');
  if (saveItem) {
    saveItem.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllMenus();
      const data = placement.exportLayout();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'openforge-layout.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const loadItem = menu.querySelector('[data-action="load"]');
  if (loadItem) {
    loadItem.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllMenus();
      if (placement.placedMeshes.length > 0 &&
          !confirm('Load layout? This will delete the existing scene.')) {
        return;
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          await placement.importLayout(data);
        } catch (err) {
          console.error('Failed to load layout:', err);
        }
      });
      input.click();
    });
  }
}

function renderTabs(placement) {
  const tabList = document.getElementById('tab-list');
  if (!tabList) return;
  const files = getFiles();
  const activeId = getActiveId();
  tabList.innerHTML = '';
  for (const file of files) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (file.id === activeId ? ' active' : '');
    tab.dataset.id = file.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = file.name;
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = file.name;
      input.className = 'tab-rename-input';
      nameSpan.replaceWith(input);
      input.focus();
      input.select();

      const finish = () => {
        const newName = input.value.trim() || file.name;
        renameFile(file.id, newName);
        renderTabs(placement);
      };
      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') input.blur();
        if (ke.key === 'Escape') { input.value = file.name; input.blur(); }
      });
    });
    tab.appendChild(nameSpan);

    if (files.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close';
      closeBtn.textContent = '×';
      closeBtn.title = 'Close file';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveFileData(file.id, placement.exportLayout());
        deleteFile(file.id);
        renderTabs(placement);
        if (getActiveId() !== activeId || !placement.placedMeshes.length) {
          switchActiveFile(placement);
        }
      });
      tab.appendChild(closeBtn);
    }

    tab.addEventListener('click', () => {
      if (isLoading) return;
      if (file.id === activeId) return;
      switchActiveFile(placement, file.id);
    });

    tabList.appendChild(tab);
  }
}

async function switchActiveFile(placement, newId) {
  if (isLoading) return;
  if (newId) {
    const data = placement.exportLayout();
    saveFileData(getActiveId(), data);
    if (!switchToFile(newId)) return;
  }

  setLoading(true);
  try {
    placement.clearScene();
    const data = loadFileData(getActiveId());
    if (data && data.tiles && data.tiles.length > 0) {
      await placement.loadFileData(data.tiles);
    }
    placement._requestRenderFrame();
    renderTabs(placement);
  } finally {
    setLoading(false);
  }
}

function init() {
  const viewport = document.getElementById('viewport');
  if (!viewport) return;

  initOverrides();
  initUserTemplates();
  initSidebarResize();
  initBomResize();

  const { scene, camera, renderer, controls, ground, requestRender } = initScene(viewport);

  const placement = new PlacementSystem(scene, camera, controls, ground);
  placement.setRenderCallback(requestRender);

  const toolbarBtns = document.querySelectorAll('.tool-btn');
  placement.setToolbarButtons(toolbarBtns);

  initPalette((modelInfo) => {
    placement.setActiveModel(modelInfo);
  });

  initFileManager();
  renderTabs(placement);

  const newFileBtn = document.getElementById('tab-new');
  const newFileMenu = document.getElementById('new-file-menu');
  if (newFileBtn && newFileMenu) {
    newFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = newFileMenu.classList.contains('open');
      closeAllMenus();
      if (!isOpen) newFileMenu.classList.add('open');
    });

    newFileMenu.querySelector('[data-action="new-blank"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      closeAllMenus();
      if (isLoading) return;
      saveFileData(getActiveId(), placement.exportLayout());
      setLoading(true);
      try {
        placement.clearScene();
        const id = createFile('Untitled', false);
        switchToFile(id);
        renderTabs(placement);
        placement._requestRenderFrame();
      } finally {
        setLoading(false);
      }
    });

    newFileMenu.querySelector('[data-action="new-duplicate"]')?.addEventListener('click', async (e) => {
      e.preventDefault();
      closeAllMenus();
      if (isLoading) return;
      saveFileData(getActiveId(), placement.exportLayout());
      setLoading(true);
      try {
        const id = createFile(getActiveName() + ' (copy)', true);
        placement.clearScene();
        switchToFile(id);
        const newData = loadFileData(id);
        if (newData && newData.tiles && newData.tiles.length > 0) {
          await placement.loadFileData(newData.tiles);
        }
        placement._requestRenderFrame();
        renderTabs(placement);
      } finally {
        setLoading(false);
      }
    });
  }

  initTemplatesMenu(placement);
  initFileMenu(placement);
  initSnapMenu();

  const downloadAllBtn = document.getElementById('bom-download-all');
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => placement._downloadAllModels());
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.toolbar-dropdown')) {
      closeAllMenus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#new-file-wrapper')) {
      const m = document.getElementById('new-file-menu');
      if (m) m.classList.remove('open');
    }
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.focus();
  }

  setLoading(true);
  placement.loadState().finally(() => setLoading(false));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
