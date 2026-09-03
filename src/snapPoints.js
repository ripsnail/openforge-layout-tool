import { getTileFootprintMm, isFloorTile, isWallTile, isBaseTile, isWallBaseTile, isColumnTile, isCornerTile, hasS2W } from './modelCatalog.js';
import { getScannedSnapPoints } from './modelScanner.js';

const SNAP_DEBUG = false;
const log = (...args) => { if (SNAP_DEBUG) console.log('[Snap]', ...args); };

const HALF_INCH = 12.7;
const INCH = 25.4;

const DEFAULT_SNAP_SETTINGS = { grid: true, edge: false, corner: false, openlock: false, magnetic: false };
let snapSettings = { ...DEFAULT_SNAP_SETTINGS };

export function setSnapSettings(settings) {
  snapSettings = { ...DEFAULT_SNAP_SETTINGS, ...settings };
}

export function getSnapSettings() {
  return { ...snapSettings };
}

export function isSnapPointEnabled(pt) {
  if (pt.connectionType === 'openlock') return snapSettings.openlock;
  if (pt.connectionType === 'magnetic') return snapSettings.magnetic;
  if (pt.type === 'edge') return snapSettings.edge;
  if (pt.type === 'corner') return snapSettings.corner;
  return true;
}

function rotatePoint(px, pz, cos, sin) {
  return {
    x: px * cos + pz * sin,
    z: -px * sin + pz * cos,
  };
}

export function getSnapPoints(modelInfo, rotation = 0, geometry = null) {
  if (geometry) {
    const scanned = getScannedSnapPoints(modelInfo, geometry);
    if (scanned.length > 0) {
      const pts = convertScannedPoints(scanned, rotation, modelInfo);
      log(`getSnapPoints(${modelInfo.fileName}, rot=${(rotation * 180 / Math.PI).toFixed(0)}°): ${pts.length} SCANNED points`);
      return pts;
    }
  }

  const fp = getTileFootprintMm(modelInfo);
  let hw = fp.w / 2;
  let hd = fp.d / 2;

  if (hasS2W(modelInfo) && modelInfo.size) {
    hw = (modelInfo.size.x * INCH) / 2;
    hd = (modelInfo.size.y * INCH) / 2;
  }

  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const points = [];

  if (isWallTile(modelInfo)) {
    points.push(
      { name: 'long_north', x: 0, z: -hd, nx: 0, nz: -1, type: 'edge', accepts: ['wall_base', 'floor', 'base'] },
      { name: 'long_south', x: 0, z: hd, nx: 0, nz: 1, type: 'edge', accepts: ['wall_base', 'floor', 'base'] },
      { name: 'short_east', x: hw, z: 0, nx: 1, nz: 0, type: 'edge', accepts: ['wall'] },
      { name: 'short_west', x: -hw, z: 0, nx: -1, nz: 0, type: 'edge', accepts: ['wall'] },
      { name: 'nw', x: -hw, z: -hd, nx: -1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'ne', x: hw, z: -hd, nx: 1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'sw', x: -hw, z: hd, nx: -1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'se', x: hw, z: hd, nx: 1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
    );
  } else if (isWallBaseTile(modelInfo)) {
    points.push(
      { name: 'long_north', x: 0, z: -hd, nx: 0, nz: -1, type: 'edge', accepts: ['wall'] },
      { name: 'long_south', x: 0, z: hd, nx: 0, nz: 1, type: 'edge', accepts: ['wall'] },
      { name: 'short_east', x: hw, z: 0, nx: 1, nz: 0, type: 'edge', accepts: ['wall_base', 'base'] },
      { name: 'short_west', x: -hw, z: 0, nx: -1, nz: 0, type: 'edge', accepts: ['wall_base', 'base'] },
      { name: 'nw', x: -hw, z: -hd, nx: -1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'ne', x: hw, z: -hd, nx: 1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'sw', x: -hw, z: hd, nx: -1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'se', x: hw, z: hd, nx: 1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
    );
  } else if (isColumnTile(modelInfo)) {
    points.push(
      { name: 'nw', x: -hw, z: -hd, nx: -1, nz: -1, type: 'corner', accepts: ['wall', 'base', 'floor', 'wall_base'] },
      { name: 'ne', x: hw, z: -hd, nx: 1, nz: -1, type: 'corner', accepts: ['wall', 'base', 'floor', 'wall_base'] },
      { name: 'sw', x: -hw, z: hd, nx: -1, nz: 1, type: 'corner', accepts: ['wall', 'base', 'floor', 'wall_base'] },
      { name: 'se', x: hw, z: hd, nx: 1, nz: 1, type: 'corner', accepts: ['wall', 'base', 'floor', 'wall_base'] },
    );
  } else if (isCornerTile(modelInfo)) {
    points.push(
      { name: 'n', x: 0, z: -hd, nx: 0, nz: -1, type: 'edge', accepts: ['wall', 'base', 'floor'] },
      { name: 's', x: 0, z: hd, nx: 0, nz: 1, type: 'edge', accepts: ['wall', 'base', 'floor'] },
      { name: 'e', x: hw, z: 0, nx: 1, nz: 0, type: 'edge', accepts: ['wall', 'base', 'floor'] },
      { name: 'w', x: -hw, z: 0, nx: -1, nz: 0, type: 'edge', accepts: ['wall', 'base', 'floor'] },
    );
  } else {
    points.push(
      { name: 'n', x: 0, z: -hd, nx: 0, nz: -1, type: 'edge', accepts: ['wall', 'wall_base', 'floor', 'base'] },
      { name: 's', x: 0, z: hd, nx: 0, nz: 1, type: 'edge', accepts: ['wall', 'wall_base', 'floor', 'base'] },
      { name: 'e', x: hw, z: 0, nx: 1, nz: 0, type: 'edge', accepts: ['wall', 'wall_base', 'floor', 'base'] },
      { name: 'w', x: -hw, z: 0, nx: -1, nz: 0, type: 'edge', accepts: ['wall', 'wall_base', 'floor', 'base'] },
      { name: 'nw', x: -hw, z: -hd, nx: -1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'ne', x: hw, z: -hd, nx: 1, nz: -1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'sw', x: -hw, z: hd, nx: -1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
      { name: 'se', x: hw, z: hd, nx: 1, nz: 1, type: 'corner', accepts: ['column', 'corner'] },
    );
  }

  const result = points.map(p => {
    const rotated = rotatePoint(p.x, p.z, cos, sin);
    const normal = p.nx != null ? rotatePoint(p.nx, p.nz, cos, sin) : null;
    return {
      name: p.name,
      x: rotated.x,
      z: rotated.z,
      nx: normal ? normal.x : 0,
      nz: normal ? normal.z : 0,
      localNx: p.nx != null ? p.nx : 0,
      localNz: p.nz != null ? p.nz : 0,
      type: p.type,
      accepts: p.accepts,
    };
  });

  log(`getSnapPoints(${modelInfo.fileName}, rot=${(rotation * 180 / Math.PI).toFixed(0)}°): ${result.length} HARDCODED points`);
  return result;
}

function convertScannedPoints(scanned, rotation, modelInfo) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const category = getTileCategory(modelInfo);

  return scanned.map((sp, i) => {
    const rotated = rotatePoint(sp.position.x, sp.position.z, cos, sin);
    const normal = rotatePoint(sp.normal.x, sp.normal.z, cos, sin);

    const accepts = [];
    if (sp.type === 'openlock') {
      if (category === 'wall') {
        accepts.push('wall');
      } else if (category === 'wall_base') {
        accepts.push('wall_base', 'base');
      } else {
        accepts.push('floor', 'base', 'wall', 'wall_base');
      }
    } else if (sp.type === 'magnetic') {
      accepts.push('floor', 'base', 'wall', 'wall_base', 'column', 'corner');
    }

    return {
      name: `scanned_${sp.type}_${i}`,
      x: rotated.x,
      z: rotated.z,
      nx: normal.x,
      nz: normal.z,
      localNx: sp.normal.x,
      localNz: sp.normal.z,
      type: sp.type === 'openlock' ? 'edge' : 'corner',
      accepts: accepts,
      scanned: true,
      connectionType: sp.type,
    };
  });
}

function getTileCategory(modelInfo) {
  if (isWallTile(modelInfo)) return 'wall';
  if (isWallBaseTile(modelInfo)) return 'wall_base';
  if (isFloorTile(modelInfo)) return 'floor';
  if (isBaseTile(modelInfo)) return 'base';
  if (isColumnTile(modelInfo)) return 'column';
  if (isCornerTile(modelInfo)) return 'corner';
  return 'other';
}

export function findBestSnap(rawPoint, modelInfo, rotation, placedMeshes, snapRadius, geometry = null) {
  const newPoints = getSnapPoints(modelInfo, rotation, geometry).filter(isSnapPointEnabled);
  const newCategory = getTileCategory(modelInfo);

  let best = null;
  let bestDist = snapRadius;

  log(`findBestSnap: new=${modelInfo.fileName} cat=${newCategory} points=${newPoints.length} candidates=${placedMeshes.length} radius=${snapRadius.toFixed(1)}mm`);

  for (const placed of placedMeshes) {
    const pInfo = placed.userData.modelInfo;
    if (!pInfo) continue;

    const placedGeo = placed.userData.geometry || null;
    const placedPoints = getSnapPoints(pInfo, placed.rotation.y, placedGeo).filter(isSnapPointEnabled);
    const placedCategory = getTileCategory(pInfo);

    let tested = 0;
    let skippedCategory = 0;
    let skippedNormal = 0;
    let skippedType = 0;

    for (const np of newPoints) {
      if (!np.accepts.includes(placedCategory)) { skippedCategory++; continue; }

      for (const pp of placedPoints) {
        const dot = np.nx * pp.nx + np.nz * pp.nz;
        if (dot > -0.5) { skippedNormal++; continue; }

        if (pp.type === 'corner' && np.type !== 'corner') { skippedType++; continue; }
        if (pp.type === 'edge' && np.type !== 'edge') { skippedType++; continue; }

        tested++;

        const placedEdgeX = placed.position.x + pp.x;
        const placedEdgeZ = placed.position.z + pp.z;

        const snapX = placedEdgeX - np.x;
        const snapZ = placedEdgeZ - np.z;

        const dx = rawPoint.x - snapX;
        const dz = rawPoint.z - snapZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < bestDist) {
          bestDist = dist;
          best = {
            position: { x: snapX, y: placed.position.y, z: snapZ },
            rotation: computeSnapRotation(np, pp, rotation),
            type: 'point-pair',
            placedMesh: placed,
            newPoint: np,
            placedPoint: pp,
            distance: dist,
          };
        }
      }
    }

    log(`  vs ${pInfo.fileName} cat=${placedCategory}: ${tested} tested, ${skippedCategory} cat-skip, ${skippedNormal} normal-skip, ${skippedType} type-skip`);
  }

  if (best) {
    log(`  → BEST: dist=${best.distance.toFixed(1)}mm newPt=${best.newPoint.name} placedPt=${best.placedPoint.name} rot=${(best.rotation * 180 / Math.PI).toFixed(0)}°`);
  } else {
    log(`  → no snap found`);
  }

  return best;
}

function computeSnapRotation(newPoint, placedPoint, pendingRotation) {
  const desiredWorldNx = -placedPoint.nx;
  const desiredWorldNz = -placedPoint.nz;

  const localNx = newPoint.localNx;
  const localNz = newPoint.localNz;

  const cosTheta = desiredWorldNx * localNx + desiredWorldNz * localNz;
  const sinTheta = desiredWorldNx * localNz - desiredWorldNz * localNx;

  let angle = Math.atan2(sinTheta, cosTheta);
  const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return snapped;
}
