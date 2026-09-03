#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

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

const TOP_THRESHOLD_MM = 5;
const MAGNETIC_AREA_MIN = 5.5;
const MAGNETIC_AREA_MAX = 6.5;
const MAGNETIC_MAX_DIM = 5.0;
const MAGNETIC_MIN_EDGE_DIST = 2;
const MAGNETIC_MAX_EDGE_DIST = 15;
const MAGNETIC_MERGE_DIST = 5;

function detectSlot(loop, vertices, bbox) {
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
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
  return { position: { x: centerX, y: avgY, z: centerZ }, size: { width, depth } };
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
      const dx = slots[j].position.x - slots[i].position.x;
      const dz = slots[j].position.z - slots[i].position.z;
      if (Math.sqrt(dx*dx + dz*dz) < mergeDist) {
        group.push(slots[j]);
        used.add(j);
      }
    }
    const cx = group.reduce((s, g) => s + g.position.x, 0) / group.length;
    const cz = group.reduce((s, g) => s + g.position.z, 0) / group.length;
    merged.push({ position: { x: cx, y: group[0].position.y, z: cz }, size: group[0].size, area: group[0].area, dist: group[0].dist });
  }
  return merged;
}

function analyzeModel(name) {
  const filePath = path.join(__dirname, '..', 'models', name);
  const vertices = parseSTL(filePath);
  const tris = [];
  for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);
  const topTris = tris.filter(t => t.every(i => vertices[i].y > TOP_THRESHOLD_MM));
  const loops = findBoundaryLoops(topTris, vertices);
  let maxArea = 0, perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
  }
  let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
  for (const tri of topTris) { for (const v of tri) {
    bbMinX = Math.min(bbMinX, vertices[v].x); bbMaxX = Math.max(bbMaxX, vertices[v].x);
    bbMinZ = Math.min(bbMinZ, vertices[v].z); bbMaxZ = Math.max(bbMaxZ, vertices[v].z);
  }}
  const bbox = { minX: bbMinX, maxX: bbMaxX, minZ: bbMinZ, maxZ: bbMaxZ };

  const candidates = [];
  for (const loop of loops) {
    if (loop === perimeterLoop) continue;
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area < MAGNETIC_AREA_MIN || area > MAGNETIC_AREA_MAX) continue;
    const slot = detectSlot(loop, vertices, bbox);
    if (!slot) continue;
    const { width, depth } = slot.size;
    if (Math.max(width, depth) > MAGNETIC_MAX_DIM) continue;
    const distToEdge = Math.min(
      Math.abs(slot.position.z - bbMinZ), Math.abs(slot.position.z - bbMaxZ),
      Math.abs(slot.position.x - bbMinX), Math.abs(slot.position.x - bbMaxX)
    );
    if (distToEdge < MAGNETIC_MIN_EDGE_DIST || distToEdge > MAGNETIC_MAX_EDGE_DIST) continue;
    candidates.push({ ...slot, area, dist: distToEdge, maxDim: Math.max(width, depth) });
  }
  const merged = mergeNearbySlots(candidates, MAGNETIC_MERGE_DIST);
  console.log(`\n--- ${name} ---`);
  console.log(`bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);
  console.log(`${candidates.length} candidates → ${merged.length} after merge:`);
  for (const c of merged) {
    console.log(`  (${c.position.x.toFixed(1)}, ${c.position.z.toFixed(1)}) area=${c.area.toFixed(2)} dist=${c.dist.toFixed(1)}`);
  }
}

analyzeModel('plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl');
analyzeModel('plain#base+s2w+square+wall.2x2.openlock+topless,magnetic+flex.stl');
analyzeModel('plain#base+s2w+square+corner.2x2.openlock+topless,magnetic+flex.stl');
analyzeModel('plain#base+square.2x1.openlock+topless,magnetic+flex.stl');
