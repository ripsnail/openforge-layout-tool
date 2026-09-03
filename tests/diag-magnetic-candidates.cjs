#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, '..', 'models');
const MODEL = process.argv[2] || 'plain#base+curved+inverted.3x3+2r.openlock+topless,magnetic+flex.stl';

const TOP_THRESHOLD_MM = 5;
const MAGNETIC_AREA_MIN = 5.5;
const MAGNETIC_AREA_MAX = 6.5;
const MAGNETIC_MAX_DIM = 5.0;
const MAGNETIC_MAX_EDGE_DIST = 15;
const MAGNETIC_MIN_EDGE_DIST = 2;
const MAGNETIC_MERGE_DIST = 5;

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
    merged.push({ position: { x: avgX, y: avgY, z: avgZ }, size: group[0].size });
  }
  return merged;
}

const verts = parseSTL(path.join(MODELS_DIR, MODEL));
const tris = [];
for (let i = 0; i < verts.length; i += 3) tris.push([i, i + 1, i + 2]);

const topTris = tris.filter(t => t.every(i => verts[i].y > TOP_THRESHOLD_MM));
console.log(`${topTris.length} top tris (y > ${TOP_THRESHOLD_MM}mm)`);

const loops = findBoundaryLoops(topTris, verts);
console.log(`${loops.length} top loops found`);

let maxArea = 0;
let perimeterLoop = null;
for (const loop of loops) {
  const area = Math.abs(calculateLoopArea(loop, verts));
  if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
}

let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
for (const tri of topTris) {
  for (const v of tri) {
    bbMinX = Math.min(bbMinX, verts[v].x);
    bbMaxX = Math.max(bbMaxX, verts[v].x);
    bbMinZ = Math.min(bbMinZ, verts[v].z);
    bbMaxZ = Math.max(bbMaxZ, verts[v].z);
  }
}
const bbox = { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ };

console.log(`top bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);

const candidates = [];
let filtered = 0;
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, verts));
  if (area < MAGNETIC_AREA_MIN || area > MAGNETIC_AREA_MAX) { filtered++; continue; }
  const slot = detectSlot(loop, verts, bbox);
  if (!slot) { filtered++; continue; }
  const { width, depth } = slot.size;
  if (Math.max(width, depth) > MAGNETIC_MAX_DIM) { filtered++; continue; }
  const distToEdge = Math.min(
    Math.abs(slot.position.z - bbMinZ),
    Math.abs(slot.position.z - bbMaxZ),
    Math.abs(slot.position.x - bbMinX),
    Math.abs(slot.position.x - bbMaxX)
  );
  if (distToEdge < MAGNETIC_MIN_EDGE_DIST || distToEdge > MAGNETIC_MAX_EDGE_DIST) { filtered++; continue; }
  candidates.push({ slot, area, distToEdge, verts: loop.length });
}

console.log(`\nAll magnetic candidates (area ${MAGNETIC_AREA_MIN}-${MAGNETIC_AREA_MAX}, dim <= ${MAGNETIC_MAX_DIM}, edge dist ${MAGNETIC_MIN_EDGE_DIST}-${MAGNETIC_MAX_EDGE_DIST}):`);
console.log(`  # | area   | dims     | edgeDist | verts | pos`);
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  console.log(`  ${(i+1).toString().padStart(2)} | ${c.area.toFixed(2).padStart(6)} | ${c.slot.size.width.toFixed(1)}×${c.slot.size.depth.toFixed(1).padStart(4)} | ${c.distToEdge.toFixed(1).padStart(8)} | ${c.verts.toString().padStart(5)} | (${c.slot.position.x.toFixed(1)}, ${c.slot.position.z.toFixed(1)})`);
}
console.log(`\n${candidates.length} candidates, ${filtered} filtered`);

const merged = mergeNearbySlots(candidates.map(c => c.slot), MAGNETIC_MERGE_DIST);
console.log(`\nAfter merge (${MAGNETIC_MERGE_DIST}mm): ${merged.length} magnetic slots`);
for (const m of merged) {
  console.log(`  pos=(${m.position.x.toFixed(1)}, ${m.position.z.toFixed(1)})`);
}
