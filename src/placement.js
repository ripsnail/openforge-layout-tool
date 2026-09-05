import * as THREE from 'three';
import { loadModelGeometry, createMesh, createGhostMesh, createOutlineMesh, recolorMesh, disposeMeshMaterial, pruneGeometries } from './modelLoader.js';
import { isWallTile, isBaseTile, isColumnTile, isWallBaseTile, getTileFootprintMm, getThemeColor, TEXTURE_OPTIONS, getTextureOverride, setTextureOverride, getEffectiveTextureTags, formatTextureTag } from './modelCatalog.js';
import { UndoRedoManager, PlaceCommand, RemoveCommand, MoveCommand, RotateCommand, GroupRotateCommand, BatchCommand } from './undoRedo.js';
import { getManifest, addDownloadedModelEntry } from './downloadedModels.js';
import { resolveTemplateTiles } from './templates.js';
import { saveFileData, loadFileData, getActiveId } from './fileManager.js';
import { fetchWithTimeout } from './catalogApi.js';
import { updateBom, updateModelCount } from './placementUi.js';
import { notify } from './notifications.js';

const INCH = 25.4;
const QUARTER_INCH = INCH / 4;
const SNAP_RADIUS = INCH * 5;

export class PlacementSystem {
  constructor(scene, camera, controls, ground) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.ground = ground;

    this.activeModel = null;
    this.activeGeometry = null;
    this.ghostMesh = null;
    this.activeTemplate = null;
    this.templateTiles = [];
    this.templateGhosts = [];
    this.selectedMeshes = [];
    this.outlineMeshes = [];
    this.placedMeshes = [];
    this.currentTool = 'select';

    this.undoRedo = new UndoRedoManager(() => this._pruneUnusedGeometries());
    this._clipboard = [];

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.pendingSnap = null;
    this._pendingPlaceRotation = 0;
    this._pendingPlaceHeight = 0;

    // rAF coalescing for pointermove: at most one snap/ghost update frame
    // per animation frame, no matter how many mousemove events fire.
    this._pointerFrameQueued = false;
    this._coalescedPointer = null;

    this._isDragging = false;
    this._dragStartPoint = null;
    this._dragStartPositions = null;
    this._dragThreshold = 3;

    this._isMarquee = false;
    this._marqueeStart = null;
    this._marqueeEl = null;

    this._requestRender = null;
    this._saveStateTimer = null;
    this._updateBomTimer = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);

    this._setupEvents();
  }

  setRenderCallback(cb) {
    this._requestRender = cb;
  }

  _requestRenderFrame() {
    if (this._requestRender) this._requestRender();
  }

  _debounceSave() {
    if (this._saveStateTimer) clearTimeout(this._saveStateTimer);
    this._saveStateTimer = setTimeout(() => {
      this._saveStateTimer = null;
      this._saveState();
    }, 300);
  }

  _debounceBom() {
    if (this._updateBomTimer) clearTimeout(this._updateBomTimer);
    this._updateBomTimer = setTimeout(() => {
      this._updateBomTimer = null;
      this._updateBom();
    }, 300);
  }

  _setupEvents() {
    const target = document.querySelector('#viewport');
    if (!target) return;
    target.addEventListener('pointerdown', this._onPointerDown);
    target.addEventListener('pointermove', this._onPointerMove);
    target.addEventListener('pointerup', this._onPointerUp);
    target.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
  }

  setTool(tool) {
    this.currentTool = tool;
    if (tool !== 'place') {
      this._clearGhost();
      this._clearTemplateGhosts();
      this.activeTemplate = null;
      this.templateTiles = [];
      this._pendingPlaceRotation = 0;
      this._pendingPlaceHeight = 0;
    }
    this.updateInfo();
  }

  setActiveModel(modelInfo) {
    if (modelInfo) {
      this._clearTemplateGhosts();
      this.activeTemplate = null;
      this.templateTiles = [];
      if (modelInfo.theme) {
        modelInfo.color = getThemeColor(modelInfo.theme);
      }
    }
    this.activeModel = modelInfo;
    this.activeGeometry = null;
    this._clearGhost();
    this._pendingPlaceRotation = 0;
    this._pendingPlaceHeight = 0;

    if (modelInfo) {
      loadModelGeometry(modelInfo).then(geo => {
        this.activeGeometry = geo;
        if (this.currentTool === 'place' || this.currentTool === 'select') {
          this.currentTool = 'place';
          this._updateToolbar();
        }
        this.updateInfo();
      }).catch(err => {
        console.error('Failed to load model:', err);
        this.activeModel = null;
      });
    } else {
      this.updateInfo();
    }
  }

  async setActiveTemplate(template) {
    this.activeModel = null;
    this.activeGeometry = null;
    this._clearGhost();
    this._clearTemplateGhosts();
    this.activeTemplate = null;
    this.templateTiles = [];
    this._pendingPlaceRotation = 0;
    this._pendingPlaceHeight = 0;
    this.setTool('place');
    this._updateToolbar();

    const el = document.getElementById('tool-info');
    if (el) el.textContent = `Loading template: ${template.name}…`;

    const resolved = await resolveTemplateTiles(template);
    if (resolved.length < template.tiles.length) {
      notify(`${template.tiles.length - resolved.length} of ${template.tiles.length} template tiles could not be loaded.`);
    }
    if (resolved.length === 0) {
      if (el) el.textContent = `Template "${template.name}" has no loadable models — import them from the catalog first  |  Esc to cancel`;
      return false;
    }

    // Build ghost meshes in a local array first and only touch the scene /
    // this.templateGhosts once every mesh has been created successfully, so a
    // failure partway through can't leave orphaned meshes in the scene that
    // aren't tracked (and therefore can't be cleaned up by
    // _clearTemplateGhosts()).
    const newGhosts = [];
    try {
      for (const { modelInfo, geometry } of resolved) {
        const ghost = createGhostMesh(geometry, modelInfo);
        ghost.visible = false;
        newGhosts.push(ghost);
      }
    } catch (e) {
      console.error('Failed to build template ghost meshes:', e);
      if (el) el.textContent = `Failed to prepare template "${template.name}"  |  Esc to cancel`;
      return false;
    }

    this.activeTemplate = template;
    this.templateTiles = resolved;
    for (const ghost of newGhosts) {
      this.scene.add(ghost);
      this.templateGhosts.push(ghost);
    }
    this.updateInfo();
    this._requestRenderFrame();
    return true;
  }

  _clearTemplateGhosts() {
    for (const ghost of this.templateGhosts) {
      this.scene.remove(ghost);
    }
    this.templateGhosts = [];
    this.pendingSnap = null;
    this._requestRenderFrame();
  }

  _templateTransform(anchorTile, anchorPos, groupRot) {
    const transforms = [];
    const cos = Math.cos(groupRot);
    const sin = Math.sin(groupRot);
    for (const { tile, modelInfo, geometry } of this.templateTiles) {
      const dx = (tile.x || 0) - (anchorTile.x || 0);
      const dz = (tile.z || 0) - (anchorTile.z || 0);
      const pos = new THREE.Vector3(
        anchorPos.x + dx * cos + dz * sin,
        anchorPos.y + ((tile.y || 0) - (anchorTile.y || 0)),
        anchorPos.z - dx * sin + dz * cos
      );
      const rotY = (tile.ry || 0) + groupRot;
      transforms.push({ tile, modelInfo, geometry, pos, rot: { x: tile.rx || 0, y: rotY, z: tile.rz || 0 } });
    }
    return transforms;
  }

  _layoutTemplateGhosts(anchorPos, groupRot) {
    if (this.templateTiles.length === 0 || this.templateGhosts.length === 0) return;
    const lifted = anchorPos.clone();
    lifted.y += this._pendingPlaceHeight;
    const anchorTile = this.templateTiles[0].tile;
    const transforms = this._templateTransform(anchorTile, lifted, groupRot);
    for (let i = 0; i < this.templateGhosts.length; i++) {
      const ghost = this.templateGhosts[i];
      const t = transforms[i];
      if (!t) continue;
      ghost.visible = true;
      ghost.position.copy(t.pos);
      ghost.rotation.set(t.rot.x, t.rot.y, t.rot.z);
      ghost.material.color.setHex(0x44cc88);
    }
    this._requestRenderFrame();
  }

  _commitTemplate(anchorPos, groupRot) {
    if (this.templateTiles.length === 0) return;
    const lifted = anchorPos.clone();
    lifted.y += this._pendingPlaceHeight;
    const anchorTile = this.templateTiles[0].tile;
    const transforms = this._templateTransform(anchorTile, lifted, groupRot);
    const commands = [];
    for (const t of transforms) {
      const mesh = createMesh(t.geometry, t.modelInfo);
      mesh.position.copy(t.pos);
      mesh.rotation.set(t.rot.x, t.rot.y, t.rot.z);
      commands.push(new PlaceCommand(this, mesh));
    }
    this.undoRedo.execute(new BatchCommand(commands));
    this._updateBom();
    this._updateModelCount();
    this._saveState();
    this._requestRenderFrame();
  }

  updateInfo() {
    const el = document.getElementById('tool-info');
    if (!el) return;
    if (this.currentTool === 'place' && this.activeTemplate && this.templateGhosts.length > 0) {
      el.textContent = `Placing template: ${this.activeTemplate.name} — ${this.templateGhosts.length} tiles  |  Click to place, [R] rotate  [PgUp/PgDn] adjust height  [Esc] to cancel`;
    } else if (this.currentTool === 'place' && this.activeModel) {
      const snapType = this.pendingSnap?.type || 'grid';
      const snapLabel = snapType === 'on-base' ? 'on base' :
                        snapType === 'on-secret-door-bottom' ? 'on door' :
                        snapType === 'blocked' ? 'blocked' :
                        snapType === 'free' ? 'free' :
                        'grid';
      const rotDeg = Math.round((this._pendingPlaceRotation / Math.PI * 180) % 360);
      const rotLabel = rotDeg !== 0 ? ` [R] ${rotDeg}°` : '';
      el.textContent = `Placing: ${this.activeModel.displayName} — ${snapLabel}${rotLabel} [PgUp/PgDn] adjust height  |  Esc to cancel`;
    } else if (this.currentTool === 'select' && this.selectedMeshes.length > 0) {
      if (this.selectedMeshes.length === 1) {
        const info = this.selectedMeshes[0].userData.modelInfo || {};
        el.textContent = `Selected: ${info.displayName || 'model'}  |  [R] Rotate  [X/Z] tilt  (Shift=45°)  [Del] Delete  [Ctrl+C] Copy  |  [Arrows/PgUp/PgDn] move (Shift=1/8")  |  Esc to deselect`;
      } else {
        el.textContent = `${this.selectedMeshes.length} selected  |  [R] Rotate  [X/Z] tilt  (Shift=45°)  [Del] Delete  [Ctrl+C] Copy  |  [Arrows/PgUp/PgDn] move (Shift=1/8")  |  Esc to deselect`;
      }
    } else if (this.currentTool === 'delete') {
      el.textContent = 'Click a model to delete it  |  Esc to cancel';
    } else {
      el.textContent = 'Select a model from the palette to start  |  [Q] Select  [W] Place  [D] Delete';
    }
    this._requestRenderFrame();
  }

  recolorTheme(theme) {
    for (const mesh of this.placedMeshes) {
      const mi = mesh.userData.modelInfo;
      if (mi && mi.theme === theme) {
        recolorMesh(mesh, mi);
      }
    }
    this._requestRenderFrame();
  }

  _updateToolbar() {
    const buttons = this._toolbarButtons || document.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === this.currentTool);
    });
  }

  setToolbarButtons(buttons) {
    this._toolbarButtons = buttons;
    buttons.forEach(btn => {
      if (!btn.dataset.tool) return;
      btn.addEventListener('click', () => {
        this.setTool(btn.dataset.tool);
        this._updateToolbar();
      });
    });
  }

  _onPointerDown(e) {
    if (this._contextMesh && !e.target.closest('#context-menu')) {
      this._hideContextMenu();
    }
    if (e.target.closest('#toolbar') || e.target.closest('.dropdown-menu')) return;

    const rect = e.currentTarget.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    if (e.button === 2) {
      this._clearGhost();
      this._clearTemplateGhosts();
      this.activeTemplate = null;
      this.templateTiles = [];
      
      return;
    }

    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.currentTool === 'place' && this.activeTemplate && this.templateTiles.length > 0) {
      const intersectPoint = this._getGroundIntersect();
      if (intersectPoint) {
        const anchorInfo = this.templateTiles[0].modelInfo;
        const snap = this._snapWithConnections(intersectPoint, anchorInfo, this._pendingPlaceRotation);
        const rot = snap.rotation + this._pendingPlaceRotation;
        this._commitTemplate(snap.position, rot);
      }
      return;
    }

    if (this.currentTool === 'place' && this.activeModel && this.activeGeometry) {
      const intersectPoint = this._getGroundIntersect();
      if (intersectPoint) {
        const snap = this._snapWithConnections(intersectPoint, this.activeModel, this._pendingPlaceRotation);
        const rot = snap.rotation + this._pendingPlaceRotation;
        this._placeModel(snap.position, rot);
      }
      return;
    }

    if (this.currentTool === 'delete') {
      const hits = this._raycastPlaced();
      if (hits.length > 0) {
        this._removeModel(hits[0].object);
      }
      return;
    }

    if (this.currentTool === 'select') {
      const hits = this._raycastPlaced();
      if (hits.length > 0) {
        if (e.shiftKey) {
          this._toggleSelect(hits[0].object);
        } else {
          this._selectModel(hits[0].object);
        }
        if (this.selectedMeshes.includes(hits[0].object)) {
          this._isDragging = false;
          this._dragStartPoint = new THREE.Vector3(
            this.pointer.x, this.pointer.y, 0
          );
          this._dragStartPositions = new Map(
            this.selectedMeshes.map(m => [m, m.position.clone()])
          );
        }
      } else {
        if (e.shiftKey) {
          this._isMarquee = true;
          this._marqueeStart = { x: e.clientX, y: e.clientY };
          this._marqueeShift = true;
        }
      }
    }
  }

  _onPointerMove(e) {
    // Snapshot coordinates and coalesce: mousemove can fire far more often
    // than the display refreshes; the expensive snap/ghost/indicator work
    // below runs at most once per frame using the latest position.
    this._coalescedPointer = { x: e.clientX, y: e.clientY, target: e.currentTarget };
    if (this._pointerFrameQueued) return;
    this._pointerFrameQueued = true;
    requestAnimationFrame(() => {
      this._pointerFrameQueued = false;
      const p = this._coalescedPointer;
      this._coalescedPointer = null;
      if (p && p.target?.isConnected !== false) this._processPointerMove(p.x, p.y, p.target);
    });
  }

  _processPointerMove(clientX, clientY, target) {
    const rect = target.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this._updateTemplateGhostSnap();
    this._updateActiveModelGhostSnap();
    this._updateDragMove(rect);
    this._updateMarquee(clientX, clientY);
    this._updateHoverCursor();
  }

  // Re-snaps and repositions the template-placement ghost group to follow
  // the pointer, if a multi-model template is currently being placed.
  _updateTemplateGhostSnap() {
    if (!(this.currentTool === 'place' && this.activeTemplate && this.templateTiles.length > 0)) return;

    const intersectPoint = this._getGroundIntersect();
    if (intersectPoint) {
      const anchorInfo = this.templateTiles[0].modelInfo;
      const snap = this._snapWithConnections(intersectPoint, anchorInfo, this._pendingPlaceRotation);
      this.pendingSnap = snap;
      const rot = snap.rotation + this._pendingPlaceRotation;
      this._layoutTemplateGhosts(snap.position, rot);
      this.updateInfo();
    } else {
      for (const ghost of this.templateGhosts) ghost.visible = false;
    }
  }

  // Re-snaps and repositions the single-model placement ghost to follow the
  // pointer, if a single model is currently being placed.
  _updateActiveModelGhostSnap() {
    if (!(this.currentTool === 'place' && this.activeModel && this.activeGeometry)) return;

    const intersectPoint = this._getGroundIntersect();
    if (intersectPoint) {
      const snap = this._snapWithConnections(intersectPoint, this.activeModel, this._pendingPlaceRotation);
      this.pendingSnap = snap;
      const rot = snap.rotation + this._pendingPlaceRotation;
      this._updateGhost(snap.position, rot);
      this.updateInfo();
    } else {
      this._clearGhost();
    }
  }

  // Drags the current selection along the ground plane, if a drag gesture
  // (past the drag threshold) is in progress in the select tool.
  _updateDragMove(rect) {
    if (!(this.currentTool === 'select' && this._dragStartPoint && this.selectedMeshes.length > 0)) return;

    const dx = this.pointer.x - this._dragStartPoint.x;
    const dy = this.pointer.y - this._dragStartPoint.y;
    if (!this._isDragging && Math.sqrt(dx * dx + dy * dy) > this._dragThreshold / rect.width) {
      this._isDragging = true;
      this.controls.enabled = false;
    }
    if (this._isDragging) {
      const startHit = this._getGroundIntersectAt(this._dragStartPoint);
      const currentHit = this._getGroundIntersect();
      if (startHit && currentHit) {
        const delta = currentHit.clone().sub(startHit);
        for (const mesh of this.selectedMeshes) {
          const start = this._dragStartPositions.get(mesh);
          if (start) {
            mesh.position.set(start.x + delta.x, start.y, start.z + delta.z);
          }
        }
        this._syncOutlinesMove();
      }
    }
  }

  // Resizes/repositions the marquee-select rectangle overlay to follow the
  // pointer, if a marquee-select gesture is in progress.
  _updateMarquee(clientX, clientY) {
    if (!(this._isMarquee && this._marqueeStart)) return;

    const dx = clientX - this._marqueeStart.x;
    const dy = clientY - this._marqueeStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!this._marqueeEl) {
        this._marqueeEl = document.createElement('div');
        this._marqueeEl.className = 'marquee-rect';
        document.querySelector('#viewport').appendChild(this._marqueeEl);
        this.controls.enabled = false;
      }
      const vp = document.querySelector('#viewport').getBoundingClientRect();
      const x1 = Math.max(0, Math.min(this._marqueeStart.x - vp.left, clientX - vp.left));
      const y1 = Math.max(0, Math.min(this._marqueeStart.y - vp.top, clientY - vp.top));
      const x2 = Math.min(vp.width, Math.max(this._marqueeStart.x - vp.left, clientX - vp.left));
      const y2 = Math.min(vp.height, Math.max(this._marqueeStart.y - vp.top, clientY - vp.top));
      this._marqueeEl.style.left = x1 + 'px';
      this._marqueeEl.style.top = y1 + 'px';
      this._marqueeEl.style.width = (x2 - x1) + 'px';
      this._marqueeEl.style.height = (y2 - y1) + 'px';
    }
  }

  // Updates the viewport cursor to reflect what a click would currently do.
  _updateHoverCursor() {
    if (this.currentTool === 'select' && !this._isDragging) {
      const hits = this._raycastPlaced();
      document.querySelector('#viewport').style.cursor =
        hits.length > 0 ? 'pointer' : 'default';
    } else if (this.currentTool === 'place') {
      document.querySelector('#viewport').style.cursor = 'crosshair';
    }
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        this.undoRedo.redo();
      } else {
        this.undoRedo.undo();
      }
      this._debounceBom();
      this._updateModelCount();
      this._debounceSave();
      this._requestRenderFrame();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      this.undoRedo.redo();
      this._debounceBom();
      this._updateModelCount();
      this._debounceSave();
      this._requestRenderFrame();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      this._copySelection();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      this._paste();
      return;
    }

    if (e.key === 'r' || e.key === 'R') {
      if (this.currentTool === 'place' && this.templateGhosts.length > 0) {
        this._pendingPlaceRotation += Math.PI / 2;
        if (this.pendingSnap) {
          const snap = this.pendingSnap;
          const rot = snap.rotation + this._pendingPlaceRotation;
          this._layoutTemplateGhosts(snap.position, rot);
        }
        this.updateInfo();
        this._requestRenderFrame();
      } else if (this.currentTool === 'place' && this.ghostMesh) {
        this._pendingPlaceRotation += Math.PI / 2;
        this.ghostMesh.rotation.y = (this.pendingSnap?.rotation || 0) + this._pendingPlaceRotation;
        this.updateInfo();
        this._requestRenderFrame();
      } else if (this.selectedMeshes.length > 0) {
        const angle = e.shiftKey ? Math.PI / 4 : Math.PI / 2;
        if (this.selectedMeshes.length === 1) {
          const mesh = this.selectedMeshes[0];
          const oldRot = mesh.rotation.y;
          const newRot = oldRot + angle;
          this.undoRedo.execute(new RotateCommand(mesh, 'y', oldRot, newRot));
        } else {
          this._rotateGroup('y', angle);
        }
        this._syncOutlines();
        this._saveState();
        this._requestRenderFrame();
      }
    }

    if ((e.key === 'x' || e.key === 'X') && this.selectedMeshes.length > 0) {
      e.preventDefault();
      const angle = e.shiftKey ? Math.PI / 4 : Math.PI / 2;
      this._rotateSelection('x', angle);
    }
    if ((e.key === 'z' || e.key === 'Z') && this.selectedMeshes.length > 0) {
      e.preventDefault();
      const angle = e.shiftKey ? Math.PI / 4 : Math.PI / 2;
      this._rotateSelection('z', angle);
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedMeshes.length > 0) {
        const batch = this.selectedMeshes.map(m => new RemoveCommand(this, m));
        this.undoRedo.execute(new BatchCommand(batch));
        this._clearOutlines();
        this.selectedMeshes = [];
        this._saveState();
        this.updateInfo();
        this._requestRenderFrame();
      }
    }

    if (e.key === 'q' || e.key === 'Q') {
      this.setTool('select');
      this._updateToolbar();
    }
    if (e.key === 'w' || e.key === 'W') {
      if (this.activeModel) {
        this.setTool('place');
        this._updateToolbar();
      }
    }
    if (e.key === 'd' || e.key === 'D') {
      this.setTool('delete');
      this._updateToolbar();
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && this.selectedMeshes.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? INCH / 8 : QUARTER_INCH;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      const dz = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0;
      const batch = this.selectedMeshes.map(m => {
        const oldPos = m.position.clone();
        const raw = new THREE.Vector3(m.position.x + dx, m.position.y, m.position.z + dz);
        const snapped = this._snapToGrid(raw, step);
        snapped.y = oldPos.y;
        return new MoveCommand(m, oldPos, snapped);
      });
      this.undoRedo.execute(new BatchCommand(batch));
      this._syncOutlines();
      this._debounceSave();
      this._requestRenderFrame();
    }

    if ((e.key === 'PageUp' || e.key === 'PageDown') && this.currentTool === 'place' &&
        (this.ghostMesh || this.templateGhosts.length > 0)) {
      e.preventDefault();
      const step = e.shiftKey ? INCH / 8 : QUARTER_INCH;
      this._pendingPlaceHeight += e.key === 'PageUp' ? step : -step;
      if (this.pendingSnap) {
        const snap = this.pendingSnap;
        const rot = snap.rotation + this._pendingPlaceRotation;
        if (this.templateGhosts.length > 0) {
          this._layoutTemplateGhosts(snap.position, rot);
        } else if (this.ghostMesh) {
          this._updateGhost(snap.position, rot);
        }
      }
      this.updateInfo();
      this._requestRenderFrame();
    }

    if ((e.key === 'PageUp' || e.key === 'PageDown') && this.selectedMeshes.length > 0) {
      e.preventDefault();
      const step = e.shiftKey ? INCH / 8 : QUARTER_INCH;
      const dy = e.key === 'PageUp' ? step : -step;
      const batch = this.selectedMeshes.map(m => {
        const oldPos = m.position.clone();
        const newPos = oldPos.clone();
        newPos.y = Math.round((oldPos.y + dy) / step) * step;
        return new MoveCommand(m, oldPos, newPos);
      });
      this.undoRedo.execute(new BatchCommand(batch));
      this._syncOutlines();
      this._debounceSave();
      this._requestRenderFrame();
    }

    if (e.key === 'Escape') {
      this._hideContextMenu();
      this._deselectAll();
      this._clearGhost();
      this._clearTemplateGhosts();
      this.activeTemplate = null;
      this.templateTiles = [];
      
      this._pendingPlaceRotation = 0;
      this._pendingPlaceHeight = 0;
      this.setTool('select');
      this._updateToolbar();
    }
  }

  _onContextMenu(e) {
    e.preventDefault();
    this._clearGhost();
    this._clearTemplateGhosts();
    this.activeTemplate = null;
    this.templateTiles = [];
    

    const viewport = document.querySelector('#viewport');
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const hits = this._raycastPlaced();
    if (hits.length === 0) {
      this._hideContextMenu();
      return;
    }

    const mesh = hits[0].object;
    if (!this.selectedMeshes.includes(mesh)) {
      this._deselectAll();
      this._selectModel(mesh);
    }
    this._showContextMenu(e.clientX - rect.left, e.clientY - rect.top, mesh);
  }

  _hideContextMenu() {
    const menu = document.querySelector('#context-menu');
    if (menu) menu.remove();
    this._contextMesh = null;
  }

  _showContextMenu(x, y, mesh) {
    this._hideContextMenu();
    this._contextMesh = mesh;

    const viewport = document.querySelector('#viewport');
    if (!viewport) return;

    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Tile actions');

    const mi = mesh.userData.modelInfo || {};
    const textureTags = getEffectiveTextureTags(mi) || [];
    const header = document.createElement('div');
    header.className = 'context-menu-header';
    header.textContent = mi.fileName || mi.displayName || 'Model';
    menu.appendChild(header);

    const sep = document.createElement('div');
    sep.className = 'context-menu-sep';
    menu.appendChild(sep);

    if (textureTags.length > 0) {
      const tagsLabel = document.createElement('div');
      tagsLabel.className = 'context-menu-section';
      tagsLabel.textContent = 'Texture Tags';
      menu.appendChild(tagsLabel);

      for (const t of textureTags) {
        const tagItem = document.createElement('div');
        tagItem.className = 'context-menu-tag' + (t.override ? ' override' : '');
        tagItem.textContent = formatTextureTag(t);
        menu.appendChild(tagItem);
      }

      const sep2 = document.createElement('div');
      sep2.className = 'context-menu-sep';
      menu.appendChild(sep2);
    }

    const label = document.createElement('div');
    label.className = 'context-menu-section';
    label.textContent = 'Texture';
    menu.appendChild(label);

    const currentOverride = getTextureOverride(textureTags);

    for (const opt of TEXTURE_OPTIONS) {
      const item = document.createElement('button');
      item.className = 'context-menu-item' + (opt.name === currentOverride ? ' active' : '');
      item.setAttribute('role', 'menuitem');
      item.textContent = opt.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setTextureOverride(mesh, opt.name);
        this._hideContextMenu();
      });
      menu.appendChild(item);
    }

    if (currentOverride) {
      const sep2 = document.createElement('div');
      sep2.className = 'context-menu-sep';
      menu.appendChild(sep2);

      const clear = document.createElement('button');
      clear.className = 'context-menu-item';
      clear.setAttribute('role', 'menuitem');
      clear.textContent = 'Remove texture override';
      clear.addEventListener('click', (e) => {
        e.stopPropagation();
        this._setTextureOverride(mesh, null);
        this._hideContextMenu();
      });
      menu.appendChild(clear);
    }

    viewport.appendChild(menu);

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.min(x, viewport.clientWidth - mw - 4);
    const top = Math.min(y, viewport.clientHeight - mh - 4);
    menu.style.left = Math.max(4, left) + 'px';
    menu.style.top = Math.max(4, top) + 'px';
    menu.querySelector('button')?.focus();
  }

  _setTextureOverride(mesh, name) {
    const mi = mesh.userData.modelInfo;
    if (!mi) return;
    mi.textureTags = setTextureOverride(mi.textureTags, name);
    recolorMesh(mesh, mi);
    this._syncOutlines();
    this._saveState();
    this._requestRenderFrame();
  }

  _onPointerUp() {
    if (this._isMarquee && this._marqueeEl) {
      const vp = document.querySelector('#viewport').getBoundingClientRect();
      const r = this._marqueeEl.getBoundingClientRect();
      const minX = r.left - vp.left;
      const minY = r.top - vp.top;
      const maxX = minX + r.width;
      const maxY = minY + r.height;

      const selected = [];
      for (const mesh of this.placedMeshes) {
        const screen = this._worldToScreen(mesh.position, vp);
        if (screen.x >= minX && screen.x <= maxX && screen.y >= minY && screen.y <= maxY) {
          selected.push(mesh);
        }
      }

      if (this._marqueeShift) {
        for (const m of selected) {
          if (!this.selectedMeshes.includes(m)) this._selectModel(m, true);
        }
      } else {
        this._deselectAll();
        for (const m of selected) this._selectModel(m, true);
      }

      this._marqueeEl.remove();
      this._marqueeEl = null;
      this.controls.enabled = true;
    }
    this._isMarquee = false;
    this._marqueeStart = null;

    if (this._isDragging && this.selectedMeshes.length > 0) {
      const batch = this.selectedMeshes.map(m => {
        const oldPos = this._dragStartPositions.get(m);
        const snapped = this._snapToGrid(m.position);
        snapped.y = oldPos.y;
        return new MoveCommand(m, oldPos, snapped);
      });
      this.undoRedo.execute(new BatchCommand(batch));
      this._syncOutlines();
      this._debounceSave();
    }
    this._isDragging = false;
    this._dragStartPoint = null;
    this._dragStartPositions = null;
    this.controls.enabled = true;
  }

  _copySelection() {
    this._clipboard = this.selectedMeshes.map(m => ({
      _id: m.userData.modelInfo._id,
      fileName: m.userData.modelInfo.fileName,
      storageUrl: m.userData.modelInfo.storageUrl || null,
      x: m.position.x,
      y: m.position.y,
      z: m.position.z,
      rx: m.rotation.x,
      ry: m.rotation.y,
      rz: m.rotation.z,
    }));
  }

  async _paste() {
    if (this._clipboard.length === 0) return;

    const offset = new THREE.Vector3(INCH, 0, INCH);
    const cmds = [];

    for (const item of this._clipboard) {
      let modelInfo;
      const sourceMesh = this.placedMeshes.find(m => m.userData.modelInfo._id === item._id);
      if (sourceMesh) {
        modelInfo = { ...sourceMesh.userData.modelInfo };
      } else {
        continue;
      }
      try {
        const geo = await loadModelGeometry(modelInfo);
        const mesh = createMesh(geo, modelInfo);
        mesh.position.set(item.x + offset.x, item.y, item.z + offset.z);
        mesh.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
        cmds.push(new PlaceCommand(this, mesh));
      } catch (e) {
        console.warn('Paste load failed:', item.fileName);
        notify(`Could not paste ${item.fileName || 'a tile'}.`);
      }
    }

    if (cmds.length > 0) {
      this.undoRedo.execute(new BatchCommand(cmds));
      this._deselectAll();
      for (const cmd of cmds) {
        this._selectModel(cmd.mesh, true);
      }
      this._saveState();
      this._requestRenderFrame();
    }
  }

  _getGroundIntersect() {
    return this._getGroundIntersectAt(this.pointer);
  }

  _getGroundIntersectAt(screenPoint) {
    this.raycaster.setFromCamera(screenPoint, this.camera);
    const intersect = new THREE.Vector3();
    const ray = this.raycaster.ray;
    const denom = ray.direction.dot(this.groundPlane.normal);
    if (Math.abs(denom) < 0.0001) return null;

    const t = -(ray.origin.dot(this.groundPlane.normal) + this.groundPlane.constant) / denom;
    if (t < 0) return null;

    intersect.copy(ray.origin).add(ray.direction.clone().multiplyScalar(t));
    return intersect;
  }

  _snapToGrid(point, step = QUARTER_INCH) {
    return new THREE.Vector3(
      Math.round(point.x / step) * step,
      0,
      Math.round(point.z / step) * step
    );
  }

  _rotateSelection(axis, angle) {
    if (this.selectedMeshes.length === 1) {
      const mesh = this.selectedMeshes[0];
      const oldRot = mesh.rotation[axis];
      const newRot = oldRot + angle;
      this.undoRedo.execute(new RotateCommand(mesh, axis, oldRot, newRot));
      this._syncOutlines();
      this._saveState();
      this._requestRenderFrame();
      return;
    }
    this._rotateGroup(axis, angle);
  }

  _rotateGroup(axis, angle) {
    const meshes = this.selectedMeshes;
    const pivot = new THREE.Vector3(0, 0, 0);
    for (const m of meshes) pivot.add(m.position);
    pivot.divideScalar(meshes.length);

    const axisVec = new THREE.Vector3();
    if (axis === 'x') axisVec.set(1, 0, 0);
    else if (axis === 'y') axisVec.set(0, 1, 0);
    else axisVec.set(0, 0, 1);

    const q = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
    const snapshots = meshes.map(m => {
      const oldPos = m.position.clone();
      const rel = oldPos.clone().sub(pivot);
      rel.applyQuaternion(q);
      const newPos = pivot.clone().add(rel);
      if (axis === 'y') {
        const sn = this._snapToGrid(newPos);
        newPos.x = sn.x;
        newPos.z = sn.z;
      }

      const oldEuler = m.rotation.clone();
      const newQuat = q.clone().multiply(new THREE.Quaternion().setFromEuler(m.rotation));
      const newEuler = new THREE.Euler().setFromQuaternion(newQuat, m.rotation.order);

      return {
        mesh: m,
        oldPos,
        newPos,
        oldRot: [oldEuler.x, oldEuler.y, oldEuler.z],
        newRot: [newEuler.x, newEuler.y, newEuler.z],
      };
    });
    this.undoRedo.execute(new GroupRotateCommand(snapshots));
  }

  _snapWithConnections(rawPoint, modelInfo, placeRotation) {
    const gridPoint = this._snapToGrid(rawPoint);

    if (modelInfo.typeTags.includes('secret_door')) {
      return this._snapSecretDoor(rawPoint, gridPoint, modelInfo);
    }

    if (isBaseTile(modelInfo)) {
      const stackTop = this._findStackTop(rawPoint, modelInfo, placeRotation);
      if (stackTop != null) {
        const gridPt = this._snapToGrid(rawPoint);
        gridPt.y = stackTop;
        return { position: gridPt, rotation: 0, type: 'grid' };
      }
    }

    if (!isBaseTile(modelInfo)) {
      const base = this._findBaseAt(rawPoint);
      const y = base ? (base.userData.height || 0) : 0;
      const gridPt = this._snapToGrid(rawPoint);
      gridPt.y = y;
      return { position: gridPt, rotation: 0, type: 'grid' };
    }

    return { position: gridPoint, rotation: 0, type: 'grid' };
  }

  _findBaseAt(point) {
    for (const placed of this.placedMeshes) {
      const pInfo = placed.userData.modelInfo;
      if (!pInfo) continue;
      const tileMeta = placed.userData.tileMeta;
      if (!(tileMeta?.isBase ?? isBaseTile(pInfo))) continue;
      const pf = tileMeta?.footprint || getTileFootprintMm(pInfo);
      const halfW = pf.w / 2;
      const halfD = pf.d / 2;
      if (Math.abs(point.x - placed.position.x) <= halfW &&
          Math.abs(point.z - placed.position.z) <= halfD) {
        return placed;
      }
    }
    return null;
  }

  _findStackTop(point, modelInfo, rotation) {
    const activeFp = getTileFootprintMm(modelInfo);
    const nw = Math.abs(Math.cos(rotation)) * activeFp.w + Math.abs(Math.sin(rotation)) * activeFp.d;
    const nd = Math.abs(Math.sin(rotation)) * activeFp.w + Math.abs(Math.cos(rotation)) * activeFp.d;
    const halfW = nw / 2;
    const halfD = nd / 2;

    const supports = [];
    for (const placed of this.placedMeshes) {
      const pInfo = placed.userData.modelInfo;
      if (!pInfo) continue;
      const tileMeta = placed.userData.tileMeta;
      if (tileMeta ? !tileMeta.isWall && !tileMeta.isColumn && !tileMeta.isWallBase && !tileMeta.isBase :
        !isWallTile(pInfo) && !isColumnTile(pInfo) && !isWallBaseTile(pInfo) && !isBaseTile(pInfo)) continue;

      const pf = tileMeta?.footprint || getTileFootprintMm(pInfo);
      const pRot = placed.rotation.y;
      const pw = Math.abs(Math.cos(pRot)) * pf.w + Math.abs(Math.sin(pRot)) * pf.d;
      const pd = Math.abs(Math.sin(pRot)) * pf.w + Math.abs(Math.cos(pRot)) * pf.d;

      const overlapX = Math.abs(point.x - placed.position.x) <= (halfW + pw) / 2;
      const overlapZ = Math.abs(point.z - placed.position.z) <= (halfD + pd) / 2;
      if (overlapX && overlapZ) {
        const top = placed.position.y + (placed.userData.height || 0);
        supports.push(top);
      }
    }

    if (supports.length === 0) return null;
    return Math.max(...supports);
  }

  _snapSecretDoor(rawPoint, gridPoint, modelInfo) {
    const isTop = modelInfo.format === 'top';

    if (isTop) {
      let best = { position: gridPoint, rotation: 0, type: 'grid' };
      let bestDist = SNAP_RADIUS;
      for (const placed of this.placedMeshes) {
        const pInfo = placed.userData.modelInfo;
        if (!pInfo || !pInfo.typeTags.includes('secret_door') || pInfo.format !== 'bottom') continue;

        const dist = rawPoint.distanceTo(placed.position);
        if (dist < bestDist) {
          bestDist = dist;
          const y = placed.position.y + (placed.userData.height || 0);
          best = { position: new THREE.Vector3(placed.position.x, y, placed.position.z), rotation: placed.rotation.y, type: 'on-secret-door-bottom' };
        }
      }
      return best;
    }

    let best = { position: gridPoint, rotation: 0, type: 'grid' };
    let bestDist = SNAP_RADIUS;
    for (const placed of this.placedMeshes) {
      const pInfo = placed.userData.modelInfo;
      if (!pInfo || !isWallBaseTile(pInfo)) continue;

      const dist = rawPoint.distanceTo(placed.position);
      if (dist < bestDist) {
        bestDist = dist;
        const y = placed.userData.height || 0;
        best = { position: new THREE.Vector3(placed.position.x, y, placed.position.z), rotation: placed.rotation.y, type: 'on-wall-base' };
      }
    }
    return best;
  }

  _updateGhost(point, rotation) {
    if (!this.activeGeometry) return;

    if (!this.ghostMesh) {
      const mesh = createGhostMesh(this.activeGeometry, this.activeModel);
      this.ghostMesh = mesh;
      this.scene.add(mesh);
    }

    this.ghostMesh.position.copy(point);
    this.ghostMesh.position.y += this._pendingPlaceHeight;
    this.ghostMesh.rotation.y = rotation || 0;
    this.ghostMesh.material.color.setHex(0x44cc88);

    this._requestRenderFrame();
  }

  _clearGhost() {
    if (this.ghostMesh) {
      this.scene.remove(this.ghostMesh);
      disposeMeshMaterial(this.ghostMesh);
      this.ghostMesh = null;
    }
    this.pendingSnap = null;
    this._requestRenderFrame();
  }

  _placeModel(point, rotation) {
    if (!this.activeGeometry) return;

    const mesh = createMesh(this.activeGeometry, this.activeModel);
    mesh.position.copy(point);
    mesh.position.y += this._pendingPlaceHeight;
    mesh.rotation.y = rotation || 0;

    this.undoRedo.execute(new PlaceCommand(this, mesh));
    this._updateBom();
    this._updateModelCount();

    this._saveState();
    this._requestRenderFrame();
  }

  _worldToScreen(worldPos, viewportRect) {
    const v = worldPos.clone().project(this.camera);
    return {
      x: (v.x + 1) / 2 * viewportRect.width,
      y: (-v.y + 1) / 2 * viewportRect.height,
    };
  }

  _raycastPlaced() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObjects(this.placedMeshes, false);
    if (intersects.length > 0) {
      return intersects.filter(i => i.object.userData.isPlaced);
    }
    return [];
  }

  _selectModel(mesh, additive = false) {
    if (!additive) {
      this._clearOutlines();
      this.selectedMeshes = [];
    }

    if (!this.selectedMeshes.includes(mesh)) {
      this.selectedMeshes.push(mesh);
      const outline = createOutlineMesh(mesh);
      this.scene.add(outline);
      this.outlineMeshes.push(outline);
    }
    this.updateInfo();
  }

  _toggleSelect(mesh) {
    const idx = this.selectedMeshes.indexOf(mesh);
    if (idx >= 0) {
      this.selectedMeshes.splice(idx, 1);
      const outlineIdx = this.outlineMeshes.findIndex(o => {
        const src = o.userData?.sourceMesh;
        return src === mesh;
      });
      if (outlineIdx >= 0) {
        this.scene.remove(this.outlineMeshes[outlineIdx]);
        this.outlineMeshes[outlineIdx].geometry?.dispose();
        this.outlineMeshes[outlineIdx].material?.dispose();
        this.outlineMeshes.splice(outlineIdx, 1);
      }
    } else {
      this.selectedMeshes.push(mesh);
      const outline = createOutlineMesh(mesh);
      this.scene.add(outline);
      this.outlineMeshes.push(outline);
    }
    this.updateInfo();
  }

  _deselectAll() {
    this._clearOutlines();
    this.selectedMeshes = [];
    this.updateInfo();
  }

  _clearOutlines() {
    for (const outline of this.outlineMeshes) {
      this.scene.remove(outline);
      outline.geometry?.dispose();
      outline.material?.dispose();
    }
    this.outlineMeshes = [];
  }

  _syncOutlines() {
    this._clearOutlines();
    for (const mesh of this.selectedMeshes) {
      const outline = createOutlineMesh(mesh);
      this.scene.add(outline);
      this.outlineMeshes.push(outline);
    }
  }

  _syncOutlinesMove() {
    for (const outline of this.outlineMeshes) {
      const src = outline.userData?.sourceMesh;
      if (!src) continue;
      outline.position.copy(src.position);
      outline.rotation.copy(src.rotation);
      outline.scale.copy(src.scale);
    }
    this._requestRenderFrame();
  }

  _placedCacheKeys() {
    return new Set(this.placedMeshes.map(m => m.userData.modelInfo?._id || m.userData.modelInfo?.fileName).filter(Boolean));
  }

  _pruneUnusedGeometries() {
    const keepKeys = this._placedCacheKeys();
    for (const mesh of this.undoRedo.getReferencedMeshes()) {
      const key = mesh.userData.modelInfo?._id || mesh.userData.modelInfo?.fileName;
      if (key) keepKeys.add(key);
    }
    pruneGeometries(keepKeys);
  }

  _removeModel(mesh) {
    const idx = this.selectedMeshes.indexOf(mesh);
    if (idx >= 0) {
      this.selectedMeshes.splice(idx, 1);
    }
    this.undoRedo.execute(new RemoveCommand(this, mesh));
    this._updateBom();
    this._updateModelCount();
    this._clearOutlines();
    this._syncOutlines();
    this._saveState();
    this.updateInfo();
    this._requestRenderFrame();
  }

  _updateModelCount() {
    updateModelCount(this.placedMeshes.length);
  }

  exportLayout() {
    return {
      version: 1,
      tiles: this.placedMeshes.map(m => ({
        _id: m.userData.modelInfo._id,
        fileName: m.userData.modelInfo.fileName,
        x: m.position.x,
        y: m.position.y,
        z: m.position.z,
        rx: m.rotation.x,
        ry: m.rotation.y,
        rz: m.rotation.z,
        storageUrl: m.userData.modelInfo.storageUrl || null,
        catalogId: m.userData.modelInfo.catalogId || null,
        textureTags: getTextureOverride(m.userData.modelInfo.textureTags)
          ? m.userData.modelInfo.textureTags.filter(t => t.override)
          : undefined,
      })),
    };
  }

  importLayout(data) {
    this.undoRedo.clear();
    for (const m of [...this.placedMeshes]) {
      this.scene.remove(m);
      disposeMeshMaterial(m);
    }
    this.placedMeshes = [];
    pruneGeometries(new Set());
    this._deselectAll();
    this._requestRenderFrame();

    return this._loadFromData(data.tiles || data);
  }

  _saveState() {
    const tiles = this.placedMeshes.map(m => ({
      _id: m.userData.modelInfo._id,
      fileName: m.userData.modelInfo.fileName,
      x: m.position.x,
      y: m.position.y,
      z: m.position.z,
      rx: m.rotation.x,
      ry: m.rotation.y,
      rz: m.rotation.z,
      storageUrl: m.userData.modelInfo.storageUrl || null,
      catalogId: m.userData.modelInfo.catalogId || null,
      sha: m.userData.modelInfo.sha || null,
      textureTags: getTextureOverride(m.userData.modelInfo.textureTags)
        ? m.userData.modelInfo.textureTags.filter(t => t.override)
        : undefined,
    }));
    saveFileData(getActiveId(), { version: 1, tiles });
  }

  async _loadFromData(data) {
    const manifest = getManifest();
    // Phase 1 (sync): resolve model info for every tile — manifest lookup,
    // saved overrides. No I/O here.
    const resolved = [];
    for (const item of data) {
      let modelInfo;
      const entry = item._id ? manifest.find(m => m._id === item._id) : null;
      if (entry?.modelInfo) {
        modelInfo = { ...entry.modelInfo };
        if (item._id) modelInfo._id = item._id;
        // NOTE: no color assignment here — createMesh() recomputes the color
        // via resolveModelColor(), so writing it would be redundant work.
      } else continue;
      if (item.storageUrl && !modelInfo.storageUrl) {
        modelInfo.storageUrl = item.storageUrl;
      }
      if (item.catalogId && !modelInfo.catalogId) {
        modelInfo.catalogId = item.catalogId;
      }
      if (item.sha && !modelInfo.sha) {
        modelInfo.sha = item.sha;
      }
      if (item.textureTags && item.textureTags.length > 0) {
        modelInfo.textureTags = setTextureOverride(modelInfo.textureTags, item.textureTags[0].name);
      }
      // If this model isn't already in the saved manifest, add it so the
      // browser keeps track of models referenced by loaded layouts.
      if (!entry) {
        try { addDownloadedModelEntry(modelInfo); } catch (e) { console.warn('Failed to register downloaded model:', e); }
      }
      resolved.push({ item, modelInfo });
    }
    // Phase 2: load all geometries concurrently (was serial: N× latency).
    const geos = await Promise.all(resolved.map(async ({ item, modelInfo }) => {
      try {
        return await loadModelGeometry(modelInfo);
      } catch (e) {
        console.warn('Failed to restore model:', item.fileName);
        return null;
      }
    }));
    const failed = geos.filter(geo => !geo).length;
    if (failed > 0) {
      notify(`${failed} of ${resolved.length} layout tiles could not be loaded.`);
    }
    // Phase 3: create meshes in saved order.
    for (let i = 0; i < resolved.length; i++) {
      if (!geos[i]) continue;
      const { item, modelInfo } = resolved[i];
      const mesh = createMesh(geos[i], modelInfo);
      mesh.position.set(item.x, item.y, item.z);
      mesh.rotation.set(item.rx || 0, item.ry || 0, item.rz || 0);
      this.scene.add(mesh);
      this.placedMeshes.push(mesh);
    }

    this._requestRenderFrame();
    this._updateModelCount();
    this._updateBom();
    // Auto-save loaded state so the freshly-loaded layout is persisted.
    this._saveState();
  }

  async loadState() {
    const raw = loadFileData(getActiveId());
    if (!raw) return;
    const tiles = raw.tiles || raw;
    if (!Array.isArray(tiles) || tiles.length === 0) return;
    try {
      await this._loadFromData(tiles);
      this._requestRenderFrame();
    } catch (e) {
      console.warn('Failed to load state:', e);
    }
  }

  async loadFileData(data) {
    const tiles = data.tiles || data;
    if (!Array.isArray(tiles) || tiles.length === 0) return;
    await this._loadFromData(tiles);
  }

  clearScene() {
    this._deselectAll();
    this._clearGhost();
    this.undoRedo.clear();
    for (const m of [...this.placedMeshes]) {
      this.scene.remove(m);
      disposeMeshMaterial(m);
    }
    this.placedMeshes = [];
    pruneGeometries(new Set());
    this._updateModelCount();
    this._updateBom();
  }

  _updateBom() {
    updateBom(this.placedMeshes);
  }

  async _downloadAllModels() {
    const seen = new Set();
    for (const m of this.placedMeshes) {
      const fileName = m.userData.modelInfo.fileName;
      if (!fileName || seen.has(fileName)) continue;
      seen.add(fileName);

      const sha = m.userData.modelInfo.sha;
      const url = sha ? `/getModel/${sha}` : null;
      if (!url) continue;

      try {
        const resp = await fetchWithTimeout(url, {}, 120000);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) {
        console.warn('Download failed:', fileName, e);
      }
    }
  }

  destroy() {
    const target = document.querySelector('#viewport');
    if (!target) return;
    target.removeEventListener('pointerdown', this._onPointerDown);
    target.removeEventListener('pointermove', this._onPointerMove);
    target.removeEventListener('pointerup', this._onPointerUp);
    target.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    this._hideContextMenu();
  }
}
