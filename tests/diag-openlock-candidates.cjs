#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');

const MODEL = process.argv[2] || 'plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl';

const BOTTOM_THRESHOLD_MM = 3;
const OPENLOCK_MIN_AREA = 15;
const OPENLOCK_MIN_ASPECT = 3.0;
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
    bounds: { minX, maxX, minZ, maxZ },
  };
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

const verts = parseSTL(path.join(MODELS_DIR, MODEL));
const tris = [];
for (let i = 0; i < verts.length; i += 3) tris.push([i, i + 1, i + 2]);

const bottomTris = tris.filter(t => t.every(i => verts[i].y < BOTTOM_THRESHOLD_MM));
const loops = findBoundaryLoops(bottomTris, verts);

let maxArea = 0;
let perimeterLoop = null;
for (const loop of loops) {
  const area = Math.abs(calculateLoopArea(loop, verts));
  if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
}

let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
for (const tri of bottomTris) {
  for (const v of tri) {
    bbMinX = Math.min(bbMinX, verts[v].x);
    bbMaxX = Math.max(bbMaxX, verts[v].x);
    bbMinZ = Math.min(bbMinZ, verts[v].z);
    bbMaxZ = Math.max(bbMaxZ, verts[v].z);
  }
}
const bbox = { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ };
const centerX = (bbMinX + bbMaxX) / 2;
const centerZ = (bbMinZ + bbMaxZ) / 2;
const spanX = bbMaxX - bbMinX;
const spanZ = bbMaxZ - bbMinZ;

const allEdgeMidpoints = [
  { name: 'n', x: centerX, z: bbMinZ },
  { name: 's', x: centerX, z: bbMaxZ },
  { name: 'e', x: bbMaxX, z: centerZ },
  { name: 'w', x: bbMinX, z: centerZ },
];

console.log(`=== ${MODEL} ===`);
console.log(`bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);
console.log(`spanX=${spanX.toFixed(1)}, spanZ=${spanZ.toFixed(1)}`);
console.log(`total loops: ${loops.length}, perimeter area: ${maxArea.toFixed(1)}`);
console.log();

// Show ALL non-perimeter loops sorted by area, with pass/fail info
const candidates = [];
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, verts));
  const slot = detectSlot(loop, verts, bbox);
  const minDim = slot ? Math.min(slot.size.width, slot.size.depth) : 0;
  const maxDim = slot ? Math.max(slot.size.width, slot.size.depth) : 0;
  const aspect = minDim > 0 ? maxDim / minDim : 0;

  let bestEm = null;
  let bestDist = OPENLOCK_MAX_DIST;
  if (slot) {
    for (const em of allEdgeMidpoints) {
      const dx = slot.position.x - em.x;
      const dz = slot.position.z - em.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; bestEm = em; }
    }
  }

  candidates.push({ loop, area, slot, minDim, maxDim, aspect, bestEm, bestDist, verts: loop.length });
}

// Sort by area descending
candidates.sort((a, b) => b.area - a.area);

console.log(`All non-perimeter loops (area >= ${OPENLOCK_MIN_AREA}, aspect >= ${OPENLOCK_MIN_ASPECT}):`);
console.log(`  # | area   | dims (w×d)     | aspect | verts | edge | dist | pos`);
let passCount = 0;
for (const c of candidates) {
  if (c.area < OPENLOCK_MIN_AREA) continue;
  if (!c.slot) continue;
  if (c.aspect < OPENLOCK_MIN_ASPECT) continue;
  passCount++;
  const edgeName = c.bestEm ? c.bestEm.name : '?';
  const dist = c.bestDist < OPENLOCK_MAX_DIST ? c.bestDist.toFixed(1) : 'OOB';
  console.log(`  ${passCount.toString().padStart(2)} | ${c.area.toFixed(1).padStart(6)} | ${c.slot.size.width.toFixed(1)}×${c.slot.size.depth.toFixed(1).padStart(4)} | ${c.aspect.toFixed(1).padStart(6)} | ${c.verts.toString().padStart(5)} |   ${edgeName}   | ${typeof dist === 'string' ? dist : dist.padStart(4)} | (${c.slot.position.x.toFixed(1)}, ${c.slot.position.z.toFixed(1)})`);
}
console.log(`\n${passCount} candidates pass filters`);
