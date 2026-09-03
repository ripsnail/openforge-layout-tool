#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');

const TEST_MODELS = [
  { name: 'plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4, expectedMagnetic: 8 },
  { name: 'plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4, expectedMagnetic: 6 },
  { name: 'plain#base+s2w+square+corner.2x2.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4, expectedMagnetic: 4 },
  { name: 'plain#base+square.2x1.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4, expectedMagnetic: 4 },
  { name: 'plain#base+curved+inverted.3x3+2r.openlock+topless,magnetic+flex.stl', expectedOpenlock: 6, expectedMagnetic: 6 },
];

const BOTTOM_THRESHOLD_MM = 3;
const TOP_THRESHOLD_MM = 5;
const MAGNETIC_AREA_MIN = 5.5;
const MAGNETIC_AREA_MAX = 6.5;
const MAGNETIC_MAX_DIM = 5.0;
const MAGNETIC_MAX_EDGE_DIST = 15;
const MAGNETIC_MIN_EDGE_DIST = 2;
const MAGNETIC_MERGE_DIST = 10;
const MAGNETIC_OFFSET = 4;
const OPENLOCK_MIN_AREA = 18;
const OPENLOCK_MIN_ASPECT = 3.0;
const OPENLOCK_MAX_EDGE_PROXIMITY = 5;
const OPENLOCK_MAX_DIST_FROM_MIDPOINT = 30;

function parseSTL(filePath) {
  const buf = fs.readFileSync(filePath);
  const triCount = buf.readUInt32LE(80);
  const isBinary = triCount > 0 && triCount * 50 + 84 === buf.length;
  if (isBinary) {
    const verts = [];
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
      offset += 12;
      for (let j = 0; j < 3; j++) {
        const x = buf.readFloatLE(offset); offset += 4;
        const y = buf.readFloatLE(offset); offset += 4;
        const z = buf.readFloatLE(offset); offset += 4;
        verts.push({ x, y: z, z: -y });
      }
      offset += 2;
    }
    return verts;
  }
  const text = buf.toString('utf8');
  const verts = [];
  const re = /vertex\s+([-\d.e+]+)\s+([-\d.e+]+)\s+([-\d.e+]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = parseFloat(m[3]);
    verts.push({ x, y: z, z: -y });
  }
  return verts;
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
        if (n !== prev && !visited.has(n)) { next = n; break; }
      }
      if (next === -1) {
        if (loop.length > 2 && adj.get(current).includes(start)) loops.push(loop);
        break;
      }
      prev = current;
      current = next;
      if (current === start) { loops.push(loop); break; }
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
  return {
    position: { x: (minX + maxX) / 2, y: loop.reduce((s, i) => s + vertices[i].y, 0) / loop.length, z: (minZ + maxZ) / 2 },
    size: { width, depth },
  };
}

function analyzeGeometry(vertices) {
  const tris = [];
  for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);

  const openlockResult = detectOpenlock(vertices, tris);
  const magneticCount = detectMagneticCount(vertices, tris);

  return { openlock: openlockResult, magneticCount };
}

function detectOpenlock(vertices, tris) {
  const bottomTris = tris.filter(t => t.every(i => vertices[i].y < BOTTOM_THRESHOLD_MM));
  if (bottomTris.length === 0) return [];

  const loops = findBoundaryLoops(bottomTris, vertices);
  if (loops.length === 0) return [];

  let maxArea = 0;
  let perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
  }

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

  const openlock = [];

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
    let bestDist = OPENLOCK_MAX_DIST_FROM_MIDPOINT;
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

      loopData.push({ slot, em: bestEm, dist: bestDist });
    }
  }

  const edgeGroups = new Map();
  for (const data of loopData) {
    if (!edgeGroups.has(data.em.name)) edgeGroups.set(data.em.name, []);
    edgeGroups.get(data.em.name).push(data);
  }

  for (const [, group] of edgeGroups) {
    group.sort((a, b) => a.dist - b.dist);
    for (const { slot, em, dist } of group) {
      const tooClose = openlock.some(r =>
        r.edge === em.name &&
        Math.hypot(slot.position.x - r.position.x, slot.position.z - r.position.z) < 10
      );
      if (tooClose) continue;
      openlock.push({
        edge: em.name,
        normal: em.normal,
        position: slot.position,
        distFromMidpoint: dist,
      });
    }
  }

  return openlock;
}

function detectMagneticCount(vertices, tris) {
  const topTris = tris.filter(t => t.every(i => vertices[i].y > TOP_THRESHOLD_MM));
  if (topTris.length === 0) return 0;

  const loops = findBoundaryLoops(topTris, vertices);
  if (loops.length === 0) return 0;

  let maxArea = 0;
  let perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
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

  const merged = mergeNearbySlots(magneticCandidates, MAGNETIC_MERGE_DIST);
  return merged.length;
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

  return chainEdgesIntoLoops(boundaryEdges);
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

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

console.log('Scanner tests\n');

for (const test of TEST_MODELS) {
  const filePath = path.join(MODELS_DIR, test.name);
  if (!fs.existsSync(filePath)) {
    console.log(`SKIP: ${test.name} (file not found)`);
    continue;
  }

  console.log(`--- ${test.name} ---`);

  const verts = parseSTL(filePath);
  const result = analyzeGeometry(verts);

  assert(result.openlock.length === test.expectedOpenlock, `expected ${test.expectedOpenlock} openlock, got ${result.openlock.length}`);
  console.log(`  openlock: ${result.openlock.length}`);

  const edges = result.openlock.map(r => r.edge).sort();
  const uniqueEdges = [...new Set(edges)];
  assert(uniqueEdges.length <= test.expectedOpenlock, `expected at most ${test.expectedOpenlock} unique edges, got ${uniqueEdges.length}: [${uniqueEdges}]`);
  for (const e of uniqueEdges) {
    assert(['n', 's', 'e', 'w'].includes(e), `unexpected edge: ${e}`);
  }

  for (const r of result.openlock) {
    assert(
      r.distFromMidpoint < OPENLOCK_MAX_DIST_FROM_MIDPOINT,
      `${r.edge}: dist ${r.distFromMidpoint.toFixed(1)}mm exceeds max ${OPENLOCK_MAX_DIST_FROM_MIDPOINT}mm`
    );
  }

  assert(result.magneticCount === test.expectedMagnetic, `expected ${test.expectedMagnetic} magnetic, got ${result.magneticCount}`);

  const normals = result.openlock.map(r => `${r.edge}:(${r.normal.x},${r.normal.z})`);
  console.log(`  edges: [${edges}]`);
  console.log(`  normals: [${normals}]`);
  console.log(`  magnetic: ${result.magneticCount}`);
  console.log();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
