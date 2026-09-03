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

// Check the 2x2 model to see how its short-side magnetic snaps look on the TOP face
const TOP_THRESHOLD_MM = 3;
const filePath = path.join(__dirname, '..', 'models', 'plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl');
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

console.log(`2x2 bbox: (${bbMinX.toFixed(1)},${bbMinZ.toFixed(1)}) to (${bbMaxX.toFixed(1)},${bbMaxZ.toFixed(1)})`);
console.log(`Top face threshold: y > ${TOP_THRESHOLD_MM}`);
console.log(`Total loops: ${loops.length} (1 perimeter + ${loops.length - 1} inner)\n`);

// Show all inner loops near the short sides (east/west at x=50.8 and x=0)
// The east-side magnetic snaps should be at x≈46.8
console.log('=== 2x2 inner loops near EAST side (x > 43) with area 5-7 ===');
for (const loop of loops) {
  if (loop === perimeterLoop) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < 5 || area > 7) continue;
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...zs) - Math.min(...zs);
  if (cx > 43) {
    console.log(`  area=${area.toFixed(2)} center=(${cx.toFixed(1)},${cz.toFixed(1)}) size=${w.toFixed(1)}x${d.toFixed(1)}`);
  }
}

// Now try with lower threshold
console.log('\n=== 2x2 inner loops with LOWER threshold (y > 1) near EAST side ===');
const topTrisLow = tris.filter(t => t.every(i => vertices[i].y > 1));
const loopsLow = findBoundaryLoops(topTrisLow, vertices);
let maxAreaLow = 0, perimeterLow = null;
for (const loop of loopsLow) {
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area > maxAreaLow) { maxAreaLow = area; perimeterLow = loop; }
}
console.log(`Total loops at y>1: ${loopsLow.length}`);
for (const loop of loopsLow) {
  if (loop === perimeterLow) continue;
  const area = Math.abs(calculateLoopArea(loop, vertices));
  if (area < 3 || area > 8) continue;
  const xs = loop.map(i => vertices[i].x);
  const zs = loop.map(i => vertices[i].z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const d = Math.max(...zs) - Math.min(...zs);
  if (cx > 43) {
    console.log(`  area=${area.toFixed(2)} center=(${cx.toFixed(1)},${cz.toFixed(1)}) size=${w.toFixed(1)}x${d.toFixed(1)}`);
  }
}
