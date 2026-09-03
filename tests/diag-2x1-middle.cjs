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

// Search ALL loops near the expected short-side magnet positions
console.log('=== ALL inner loops near x=46-51 or x=0-5 (short side regions) ===');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const area = Math.abs(calculateLoopArea(loop, vertices));

  const nearEast = cx > 43;
  const nearWest = cx < 8;
  if (!nearEast && !nearWest) continue;

  const side = nearEast ? 'EAST' : 'WEST';
  console.log(`  [${side}] area=${area.toFixed(2)} center=(${cx.toFixed(1)},${cz.toFixed(1)}) size=${w.toFixed(1)}x${d.toFixed(1)} verts=${loop.length}`);
}

console.log('\n=== ALL inner loops with center z between -10 and -16 (middle of short side) ===');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const area = Math.abs(calculateLoopArea(loop, vertices));

  if (cz >= -16 && cz <= -10) {
    console.log(`  area=${area.toFixed(2)} center=(${cx.toFixed(1)},${cz.toFixed(1)}) size=${w.toFixed(1)}x${d.toFixed(1)} verts=${loop.length}`);
  }
}

console.log('\n=== ALL inner loops with ANY vertex near z=-12.7 ===');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const hasVertexNearMiddle = loop.some(i => vertices[i].z >= -16 && vertices[i].z <= -10);
  if (!hasVertexNearMiddle) continue;
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  console.log(`  area=${area.toFixed(2)} center=(${cx.toFixed(1)},${cz.toFixed(1)}) xRange=[${minX.toFixed(1)},${maxX.toFixed(1)}] zRange=[${minZ.toFixed(1)},${maxZ.toFixed(1)}]`);
}
