#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BOTTOM_THRESHOLD_MM = 3;
const TOP_THRESHOLD_MM = 5;
const MAGNETIC_AREA_MIN = 5.5;
const MAGNETIC_AREA_MAX = 6.5;
const MAGNETIC_MAX_DIM = 5.0;
const MAGNETIC_MAX_EDGE_DIST = 15;
const MAGNETIC_MIN_EDGE_DIST = 2;
const MAGNETIC_MERGE_DIST = 5;
const OPENLOCK_MAX_DIST = 20;

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
    verts.push({ x: parseFloat(m[1]), y: parseFloat(m[3]), z: -parseFloat(m[2]) });
  }
  return verts;
}

function calculateLoopArea(loop, vertices) {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const v0 = vertices[loop[i]];
    const v1 = vertices[loop[(i + 1) % loop.length]];
    area += v0.x * v1.z - v1.x * v0.z;
  }
  return area / 2;
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
  const adj = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const loops = [];
  const used = new Set();
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const neighbors0 = adj.get(start);
    if (neighbors0.length !== 2) continue;
    const loop = [start];
    used.add(start);
    let prev = start;
    let current = neighbors0[0];
    while (current !== start) {
      loop.push(current);
      used.add(current);
      const neighbors = adj.get(current);
      if (neighbors.length !== 2) break;
      const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
      prev = current;
      current = next;
    }
    if (current === start) loops.push(loop);
  }
  return loops;
}

function detectSlot(loop, vertices, bbox) {
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  return { position: { x: cx, z: cz }, size: { width, depth }, bbox: { minX, maxX, minZ, maxZ } };
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
      if (Math.sqrt(dx * dx + dz * dz) < mergeDist) { group.push(slots[j]); used.add(j); }
    }
    const avgX = group.reduce((s, g) => s + g.position.x, 0) / group.length;
    const avgZ = group.reduce((s, g) => s + g.position.z, 0) / group.length;
    merged.push({ position: { x: avgX, z: avgZ }, size: group[0].size });
  }
  return merged;
}

const filePath = path.join(__dirname, '..', 'models', 'plain#base+curved+inverted.3x3+2r.openlock+topless,magnetic+flex.stl');
const vertices = parseSTL(filePath);
const tris = [];
for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);

// Bounding box
let allMinX = Infinity, allMaxX = -Infinity, allMinY = Infinity, allMaxY = -Infinity, allMinZ = Infinity, allMaxZ = -Infinity;
for (const v of vertices) {
  allMinX = Math.min(allMinX, v.x); allMaxX = Math.max(allMaxX, v.x);
  allMinY = Math.min(allMinY, v.y); allMaxY = Math.max(allMaxY, v.y);
  allMinZ = Math.min(allMinZ, v.z); allMaxZ = Math.max(allMaxZ, v.z);
}
console.log(`Model bbox: x=[${allMinX.toFixed(1)},${allMaxX.toFixed(1)}] y=[${allMinY.toFixed(1)},${allMaxY.toFixed(1)}] z=[${allMinZ.toFixed(1)},${allMaxZ.toFixed(1)}]`);
console.log(`Size: ${(allMaxX-allMinX).toFixed(1)} x ${(allMaxZ-allMinZ).toFixed(1)} mm\n`);

// === OPENLOCK ===
const bottomTris = tris.filter(t => t.every(i => vertices[i].y < BOTTOM_THRESHOLD_MM));
console.log(`Bottom tris: ${bottomTris.length}`);
const bottomLoops = findBoundaryLoops(bottomTris, vertices);
let maxArea = 0, perimeterLoop = null;
for (const loop of bottomLoops) {
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
}

let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
for (const tri of bottomTris) { for (const v of tri) {
  bbMinX = Math.min(bbMinX, vertices[v].x); bbMaxX = Math.max(bbMaxX, vertices[v].x);
  bbMinZ = Math.min(bbMinZ, vertices[v].z); bbMaxZ = Math.max(bbMaxZ, vertices[v].z);
}}
const centerX = (bbMinX + bbMaxX) / 2, centerZ = (bbMinZ + bbMaxZ) / 2;
const spanX = bbMaxX - bbMinX, spanZ = bbMaxZ - bbMinZ;
const edgeMidpoints = [
  { name: 'n', x: centerX, z: bbMinZ },
  { name: 's', x: centerX, z: bbMaxZ },
  { name: 'e', x: bbMaxX, z: centerZ },
  { name: 'w', x: bbMinX, z: centerZ },
];

const openlock = [];
for (const em of edgeMidpoints) {
  let bestSlot = null, bestDist = OPENLOCK_MAX_DIST;
  for (const loop of bottomLoops) {
    if (loop === perimeterLoop) continue;
    const slot = detectSlot(loop, vertices, { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ });
    if (!slot) continue;
    const dx = slot.position.x - em.x, dz = slot.position.z - em.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < bestDist) { bestDist = dist; bestSlot = slot; }
  }
  if (bestSlot) {
    const nx = em.name === 'e' ? 1 : em.name === 'w' ? -1 : 0;
    const nz = em.name === 's' ? 1 : em.name === 'n' ? -1 : 0;
    openlock.push({ edge: em.name, position: bestSlot.position, normal: { x: nx, z: nz }, dist: bestDist.toFixed(1) });
  }
}
console.log(`\nOPENLOCK: ${openlock.length}`);
for (const o of openlock) console.log(`  ${o.edge} @ (${o.position.x.toFixed(1)}, ${o.position.z.toFixed(1)}) dist=${o.dist}`);

// === MAGNETIC ===
const topTris = tris.filter(t => t.every(i => vertices[i].y > TOP_THRESHOLD_MM));
console.log(`\nTop tris: ${topTris.length}`);
const topLoops = findBoundaryLoops(topTris, vertices);
maxArea = 0; perimeterLoop = null;
for (const loop of topLoops) {
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
}

let tbMinX = Infinity, tbMaxX = -Infinity, tbMinZ = Infinity, tbMaxZ = -Infinity;
for (const tri of topTris) { for (const v of tri) {
  tbMinX = Math.min(tbMinX, vertices[v].x); tbMaxX = Math.max(tbMaxX, vertices[v].x);
  tbMinZ = Math.min(tbMinZ, vertices[v].z); tbMaxZ = Math.max(tbMaxZ, vertices[v].z);
}}

const magneticCandidates = [];
for (const loop of topLoops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < MAGNETIC_AREA_MIN || area > MAGNETIC_AREA_MAX) continue;
  const slot = detectSlot(loop, vertices, { minX: tbMinX, maxX: tbMaxX, minZ: tbMinZ, maxZ: tbMaxZ });
  if (!slot) continue;
  const { width, depth } = slot.size;
  if (Math.max(width, depth) > MAGNETIC_MAX_DIM) continue;
  const distToEdge = Math.min(
    Math.abs(slot.position.z - tbMinZ), Math.abs(slot.position.z - tbMaxZ),
    Math.abs(slot.position.x - tbMinX), Math.abs(slot.position.x - tbMaxX)
  );
  if (distToEdge < MAGNETIC_MIN_EDGE_DIST || distToEdge > MAGNETIC_MAX_EDGE_DIST) continue;
  magneticCandidates.push({ ...slot, distToEdge: distToEdge.toFixed(1) });
}
const merged = mergeNearbySlots(magneticCandidates, MAGNETIC_MERGE_DIST);
console.log(`\nMAGNETIC: ${merged.length}`);
for (const m of merged) console.log(`  @ (${m.position.x.toFixed(1)}, ${m.position.z.toFixed(1)}) size=${m.size.width.toFixed(1)}x${m.size.depth.toFixed(1)} dist=${m.distToEdge}`);

// Also show rejected candidates
console.log(`\n--- Rejected magnetic candidates (area in range but failed other filters) ---`);
let rejCount = 0;
for (const loop of topLoops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < MAGNETIC_AREA_MIN || area > MAGNETIC_AREA_MAX) continue;
  const slot = detectSlot(loop, vertices, { minX: tbMinX, maxX: tbMaxX, minZ: tbMinZ, maxZ: tbMaxZ });
  if (!slot) continue;
  const { width, depth } = slot.size;
  const maxDim = Math.max(width, depth);
  const distToEdge = Math.min(
    Math.abs(slot.position.z - tbMinZ), Math.abs(slot.position.z - tbMaxZ),
    Math.abs(slot.position.x - tbMinX), Math.abs(slot.position.x - tbMaxX)
  );
  const reasons = [];
  if (maxDim > MAGNETIC_MAX_DIM) reasons.push(`maxDim=${maxDim.toFixed(1)}`);
  if (distToEdge < MAGNETIC_MIN_EDGE_DIST) reasons.push(`dist=${distToEdge.toFixed(1)}<min`);
  if (distToEdge > MAGNETIC_MAX_EDGE_DIST) reasons.push(`dist=${distToEdge.toFixed(1)}>max`);
  if (reasons.length > 0) {
    console.log(`  area=${area.toFixed(2)} @ (${slot.position.x.toFixed(1)},${slot.position.z.toFixed(1)}) size=${width.toFixed(1)}x${depth.toFixed(1)} → ${reasons.join(', ')}`);
    rejCount++;
  }
}
if (rejCount === 0) console.log('  (none)');
