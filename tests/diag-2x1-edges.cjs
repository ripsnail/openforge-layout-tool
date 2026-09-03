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

const TOP_THRESHOLD_MM = 5;
const filePath = path.join(__dirname, '..', 'models', 'plain#base+square.2x1.openlock+topless,magnetic+flex.stl');
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

console.log('Features near EAST edge (x > 40) with area > 1:');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < 1) continue;
  const slot = detectSlot(loop, vertices, bbox);
  if (!slot) continue;
  if (slot.position.x > 40) {
    const { width, depth } = slot.size;
    const distToEdge = Math.min(
      Math.abs(slot.position.z - bbMinZ), Math.abs(slot.position.z - bbMaxZ),
      Math.abs(slot.position.x - bbMinX), Math.abs(slot.position.x - bbMaxX)
    );
    console.log(`  area=${area.toFixed(2)} pos=(${slot.position.x.toFixed(1)},${slot.position.z.toFixed(1)}) size=${width.toFixed(1)}x${depth.toFixed(1)} maxDim=${Math.max(width,depth).toFixed(1)} dist=${distToEdge.toFixed(1)}`);
  }
}

console.log('\nFeatures near WEST edge (x < 10) with area > 1:');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < 1) continue;
  const slot = detectSlot(loop, vertices, bbox);
  if (!slot) continue;
  if (slot.position.x < 10) {
    const { width, depth } = slot.size;
    const distToEdge = Math.min(
      Math.abs(slot.position.z - bbMinZ), Math.abs(slot.position.z - bbMaxZ),
      Math.abs(slot.position.x - bbMinX), Math.abs(slot.position.x - bbMaxX)
    );
    console.log(`  area=${area.toFixed(2)} pos=(${slot.position.x.toFixed(1)},${slot.position.z.toFixed(1)}) size=${width.toFixed(1)}x${depth.toFixed(1)} maxDim=${Math.max(width,depth).toFixed(1)} dist=${distToEdge.toFixed(1)}`);
  }
}

console.log('\nALL features with area >= 5 and area <= 7:');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < 5 || area > 7) continue;
  const slot = detectSlot(loop, vertices, bbox);
  if (!slot) continue;
  const { width, depth } = slot.size;
  const distToEdge = Math.min(
    Math.abs(slot.position.z - bbMinZ), Math.abs(slot.position.z - bbMaxZ),
    Math.abs(slot.position.x - bbMinX), Math.abs(slot.position.x - bbMaxX)
  );
  console.log(`  area=${area.toFixed(2)} pos=(${slot.position.x.toFixed(1)},${slot.position.z.toFixed(1)}) size=${width.toFixed(1)}x${depth.toFixed(1)} maxDim=${Math.max(width,depth).toFixed(1)} dist=${distToEdge.toFixed(1)}`);
}
