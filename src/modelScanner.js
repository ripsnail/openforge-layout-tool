const SNAP_DEBUG = false;
const log = (...args) => { if (SNAP_DEBUG) console.log('[Scanner]', ...args); };

const scanCache = new Map();

const BOTTOM_THRESHOLD_MM = 3;
const TOP_THRESHOLD_MM = 5;
const MAGNETIC_AREA_MIN = 5.5;
const MAGNETIC_AREA_MAX = 6.5;
const MAGNETIC_MAX_DIM = 5.0;
const MAGNETIC_MAX_EDGE_DIST = 15;
const MAGNETIC_MIN_EDGE_DIST = 2;
const MAGNETIC_MERGE_DIST = 10;
const MAGNETIC_OFFSET = 4;
const OPENLOCK_OFFSET = 3;
const OPENLOCK_MAX_DIST = 30;
const OPENLOCK_MIN_AREA = 18;
const OPENLOCK_MIN_ASPECT = 3.0;
const OPENLOCK_MAX_EDGE_PROXIMITY = 5;

export function getScannedSnapPoints(modelInfo, geometry) {
  const key = modelInfo._id || modelInfo.fileName;
  if (scanCache.has(key)) {
    const cached = scanCache.get(key);
    log(`${key}: cache hit → ${cached.length} points`);
    return cached;
  }

  const points = analyzeGeometry(geometry);
  scanCache.set(key, points);
  log(`${key}: scanned → ${points.length} points`, points.map(p => `${p.type}@(${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)})`));
  return points;
}

function analyzeGeometry(geometry) {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return [];

  const index = geometry.getIndex();
  const vertices = [];
  for (let i = 0; i < posAttr.count; i++) {
    vertices.push({
      x: posAttr.getX(i),
      y: posAttr.getY(i),
      z: posAttr.getZ(i),
    });
  }

  const triangles = [];
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      triangles.push([
        index.getX(i),
        index.getX(i + 1),
        index.getX(i + 2),
      ]);
    }
  } else {
    for (let i = 0; i < posAttr.count; i += 3) {
      triangles.push([i, i + 1, i + 2]);
    }
  }

  log(`${vertices.length} verts, ${triangles.length} tris`);

  const results = [];
  results.push(...detectOpenlock(vertices, triangles));
  results.push(...detectMagnetic(vertices, triangles));

  log(`total: ${results.filter(r => r.type === 'openlock').length} openlock, ${results.filter(r => r.type === 'magnetic').length} magnetic`);
  return results;
}

function detectOpenlock(vertices, triangles) {
  const bottomTris = [];
  for (const tri of triangles) {
    const [a, b, c] = tri;
    if (vertices[a].y < BOTTOM_THRESHOLD_MM &&
        vertices[b].y < BOTTOM_THRESHOLD_MM &&
        vertices[c].y < BOTTOM_THRESHOLD_MM) {
      bottomTris.push(tri);
    }
  }

  log(`${bottomTris.length} bottom tris (y < ${BOTTOM_THRESHOLD_MM}mm)`);
  if (bottomTris.length === 0) return [];

  const loops = findBoundaryLoops(bottomTris, vertices);
  log(`${loops.length} bottom loops found`);
  if (loops.length === 0) return [];

  let maxArea = 0;
  let perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) {
      maxArea = area;
      perimeterLoop = loop;
    }
  }
  log(`perimeter loop: ${perimeterLoop.length} verts, area=${maxArea.toFixed(1)}`);

  let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
  for (const tri of bottomTris) {
    for (const v of tri) {
      bbMinX = Math.min(bbMinX, vertices[v].x);
      bbMaxX = Math.max(bbMaxX, vertices[v].x);
      bbMinZ = Math.min(bbMinZ, vertices[v].z);
      bbMaxZ = Math.max(bbMaxZ, vertices[v].z);
    }
  }
  const bbox = { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ };
  log(`bottom bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);

  const centerX = (bbMinX + bbMaxX) / 2;
  const centerZ = (bbMinZ + bbMaxZ) / 2;
  const spanX = bbMaxX - bbMinX;
  const spanZ = bbMaxZ - bbMinZ;

  const allEdgeMidpoints = [
    { name: 'n', x: centerX, z: bbMinZ, normal: { x: 0, y: 1, z: -1 }, edgeLen: spanX, perpLen: spanZ },
    { name: 's', x: centerX, z: bbMaxZ, normal: { x: 0, y: 1, z: 1 }, edgeLen: spanX, perpLen: spanZ },
    { name: 'e', x: bbMaxX, z: centerZ, normal: { x: 1, y: 1, z: 0 }, edgeLen: spanZ, perpLen: spanX },
    { name: 'w', x: bbMinX, z: centerZ, normal: { x: -1, y: 1, z: 0 }, edgeLen: spanZ, perpLen: spanX },
  ];

  const edgeMidpoints = allEdgeMidpoints;
  log(`openlock edges: [${edgeMidpoints.map(e => e.name)}] (spanX=${spanX.toFixed(1)}, spanZ=${spanZ.toFixed(1)})`);

  const loopData = [];
  for (const loop of loops) {
    if (loop === perimeterLoop) continue;

    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area < OPENLOCK_MIN_AREA) continue;

    const slot = detectSlot(loop, vertices, bbox);
    if (!slot) continue;

    const minDim = Math.min(slot.size.width, slot.size.depth);
    const maxDim = Math.max(slot.size.width, slot.size.depth);
    const aspect = minDim > 0 ? maxDim / minDim : 0;
    if (aspect < OPENLOCK_MIN_ASPECT) continue;

    let bestEm = null;
    let bestDist = OPENLOCK_MAX_DIST;
    for (const em of edgeMidpoints) {
      const dx = slot.position.x - em.x;
      const dz = slot.position.z - em.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        bestEm = em;
      }
    }

    if (bestEm) {
      const edgeProximity = (bestEm.name === 'n' || bestEm.name === 's')
        ? Math.abs(slot.position.z - bestEm.z)
        : Math.abs(slot.position.x - bestEm.x);
      if (edgeProximity > OPENLOCK_MAX_EDGE_PROXIMITY) continue;

      loopData.push({ slot, em: bestEm, dist: bestDist, area });
    }
  }

  log(`${loopData.length} loops matched to edges after filter`);

  const results = [];
  for (const em of edgeMidpoints) {
    const edgeLoops = loopData.filter(d => d.em.name === em.name).sort((a, b) => a.dist - b.dist);
    for (const { slot, dist } of edgeLoops) {
      const tooClose = results.some(r =>
        r.normal.x === em.normal.x && r.normal.z === em.normal.z &&
        Math.hypot(slot.position.x - r.position.x, slot.position.z - r.position.z) < 10
      );
      if (tooClose) continue;

      log(`  openlock on ${em.name}: dist=${dist.toFixed(1)}mm pos=(${slot.position.x.toFixed(1)}, ${slot.position.z.toFixed(1)})`);
      results.push({
        position: {
          x: slot.position.x + em.normal.x * OPENLOCK_OFFSET,
          y: slot.position.y,
          z: slot.position.z + em.normal.z * OPENLOCK_OFFSET,
        },
        normal: em.normal,
        type: 'openlock',
        size: slot.size,
      });
    }
  }

  return results;
}

function detectMagnetic(vertices, triangles) {
  const topTris = [];
  for (const tri of triangles) {
    const [a, b, c] = tri;
    if (vertices[a].y > TOP_THRESHOLD_MM &&
        vertices[b].y > TOP_THRESHOLD_MM &&
        vertices[c].y > TOP_THRESHOLD_MM) {
      topTris.push(tri);
    }
  }

  log(`${topTris.length} top tris (y > ${TOP_THRESHOLD_MM}mm)`);
  if (topTris.length === 0) return [];

  const loops = findBoundaryLoops(topTris, vertices);
  log(`${loops.length} top loops found`);
  if (loops.length === 0) return [];

  let maxArea = 0;
  let perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) {
      maxArea = area;
      perimeterLoop = loop;
    }
  }

  let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
  for (const tri of topTris) {
    for (const v of tri) {
      bbMinX = Math.min(bbMinX, vertices[v].x);
      bbMaxX = Math.max(bbMaxX, vertices[v].x);
      bbMinZ = Math.min(bbMinZ, vertices[v].z);
      bbMaxZ = Math.max(bbMaxZ, vertices[v].z);
    }
  }
  const bbox = { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ };
  log(`top bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);

  const centerX = (bbMinX + bbMaxX) / 2;
  const centerZ = (bbMinZ + bbMaxZ) / 2;
  const halfW = (bbMaxX - bbMinX) / 2;
  const halfD = (bbMaxZ - bbMinZ) / 2;

  const magneticCandidates = [];
  for (const loop of loops) {
    if (loop === perimeterLoop) continue;

    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area < MAGNETIC_AREA_MIN || area > MAGNETIC_AREA_MAX) continue;

    const slot = detectSlot(loop, vertices, bbox);
    if (!slot) continue;

    const { width, depth } = slot.size;
    if (Math.max(width, depth) > MAGNETIC_MAX_DIM) continue;

    const distToEdge = Math.min(
      Math.abs(slot.position.z - bbMinZ),
      Math.abs(slot.position.z - bbMaxZ),
      Math.abs(slot.position.x - bbMinX),
      Math.abs(slot.position.x - bbMaxX)
    );
    if (distToEdge < MAGNETIC_MIN_EDGE_DIST || distToEdge > MAGNETIC_MAX_EDGE_DIST) continue;

    magneticCandidates.push(slot);
  }

  log(`${magneticCandidates.length} magnetic candidates after area filter (${MAGNETIC_AREA_MIN}-${MAGNETIC_AREA_MAX}mm²)`);
  const merged = mergeNearbySlots(magneticCandidates, MAGNETIC_MERGE_DIST);
  log(`${merged.length} after merge`);

  const results = [];
  for (const slot of merged) {
    const dx = slot.position.x - centerX;
    const dz = slot.position.z - centerZ;

    const distN = halfD > 0 ? Math.abs(dz + halfD) : Infinity;
    const distS = halfD > 0 ? Math.abs(dz - halfD) : Infinity;
    const distE = halfW > 0 ? Math.abs(dx - halfW) : Infinity;
    const distW = halfW > 0 ? Math.abs(dx + halfW) : Infinity;

    const nearest = [
      { name: 'n', dist: distN, normal: { x: 0, y: 1, z: -1 } },
      { name: 's', dist: distS, normal: { x: 0, y: 1, z: 1 } },
      { name: 'e', dist: distE, normal: { x: 1, y: 1, z: 0 } },
      { name: 'w', dist: distW, normal: { x: -1, y: 1, z: 0 } },
    ].sort((a, b) => a.dist - b.dist)[0];

    results.push({
      position: {
        x: slot.position.x + nearest.normal.x * MAGNETIC_OFFSET,
        y: slot.position.y,
        z: slot.position.z + nearest.normal.z * MAGNETIC_OFFSET,
      },
      normal: nearest.normal,
      type: 'magnetic',
      size: slot.size,
    });
  }

  return results;
}

function findBoundaryLoops(tris, vertices) {
  const edgeCount = new Map();
  for (const tri of tris) {
    for (let i = 0; i < 3; i++) {
      const v0 = tri[i];
      const v1 = tri[(i + 1) % 3];
      const key = v0 < v1 ? `${v0}-${v1}` : `${v1}-${v0}`;
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }

  const boundaryEdges = [];
  for (const [key, count] of edgeCount) {
    if (count === 1) {
      const [a, b] = key.split('-').map(Number);
      boundaryEdges.push([a, b]);
    }
  }

  log(`${boundaryEdges.length} boundary edges`);
  return chainEdgesIntoLoops(boundaryEdges);
}

function chainEdgesIntoLoops(edges) {
  if (edges.length === 0) return [];

  const adj = new Map();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const visited = new Set();
  const loops = [];

  for (const start of adj.keys()) {
    if (visited.has(start)) continue;

    const loop = [];
    let current = start;
    let prev = -1;

    while (true) {
      visited.add(current);
      loop.push(current);

      const neighbors = adj.get(current);
      let next = -1;
      for (const n of neighbors) {
        if (n !== prev && !visited.has(n)) {
          next = n;
          break;
        }
      }

      if (next === -1) {
        if (loop.length > 2 && adj.get(current).includes(start)) {
          loops.push(loop);
        }
        break;
      }

      prev = current;
      current = next;

      if (current === start) {
        loops.push(loop);
        break;
      }
    }
  }

  return loops;
}

function calculateLoopArea(loop, vertices) {
  if (loop.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const v0 = vertices[loop[i]];
    const v1 = vertices[loop[(i + 1) % loop.length]];
    area += v0.x * v1.z - v1.x * v0.z;
  }
  return area / 2;
}

function detectSlot(loop, vertices, bbox) {
  if (loop.length < 3) return null;

  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const width = maxX - minX;
  const depth = maxZ - minZ;

  if (width === 0 && depth === 0) return null;

  const spanX = bbox.maxX - bbox.minX;
  const spanZ = bbox.maxZ - bbox.minZ;
  if (spanX > 0 && spanZ > 0) {
    if (width / spanX > 0.8 || depth / spanZ > 0.8) return null;
  }

  if (width < 2 || depth < 2) return null;
  if (width > 25 || depth > 25) return null;

  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const avgY = loop.reduce((sum, i) => sum + vertices[i].y, 0) / loop.length;

  return {
    position: { x: centerX, y: avgY, z: centerZ },
    size: { width, depth },
  };
}

function mergeNearbySlots(slots, mergeDist) {
  if (slots.length === 0) return [];

  const merged = [];
  const used = new Set();

  for (let i = 0; i < slots.length; i++) {
    if (used.has(i)) continue;

    const group = [slots[i]];
    used.add(i);

    for (let j = i + 1; j < slots.length; j++) {
      if (used.has(j)) continue;

      const dx = slots[i].position.x - slots[j].position.x;
      const dz = slots[i].position.z - slots[j].position.z;
      if (Math.sqrt(dx * dx + dz * dz) < mergeDist) {
        group.push(slots[j]);
        used.add(j);
      }
    }

    const avgX = group.reduce((s, g) => s + g.position.x, 0) / group.length;
    const avgZ = group.reduce((s, g) => s + g.position.z, 0) / group.length;
    const avgY = group.reduce((s, g) => s + g.position.y, 0) / group.length;

    merged.push({
      position: { x: avgX, y: avgY, z: avgZ },
      size: group[0].size,
    });
  }

  return merged;
}

export function clearScanCache() {
  scanCache.clear();
}
