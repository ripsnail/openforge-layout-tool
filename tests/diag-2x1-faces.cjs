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

const filePath = path.join(__dirname, '..', 'models', 'plain#base+square.2x1.openlock+topless,magnetic+flex.stl');
const vertices = parseSTL(filePath);
const tris = [];
for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);

// Check Y values to understand the model height
let minY = Infinity, maxY = -Infinity;
for (const v of vertices) {
  minY = Math.min(minY, v.y);
  maxY = Math.max(maxY, v.y);
}
console.log(`Model Y range: ${minY.toFixed(1)} to ${maxY.toFixed(1)}`);

// Group triangles by their face normal direction
// Look at ALL triangles near the east face (x near 50.8) and west face (x near 0)
// to find the magnetic snap recess geometry

// First, let's look at the vertices near x=46-51, z=-14 to -11 (center of east short side)
console.log('\n=== Triangles with any vertex in east short-side center region (x>44, z between -16 and -9) ===');
let count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const inRegion = verts.some(v => v.x > 44 && v.z > -16 && v.z < -9);
  if (inRegion) {
    const ys = verts.map(v => v.y.toFixed(1));
    const xs = verts.map(v => v.x.toFixed(1));
    const zs = verts.map(v => v.z.toFixed(1));
    console.log(`  tri: x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 30) { console.log('  ... (truncated)'); break; }
  }
}

console.log('\n=== Triangles with any vertex in west short-side center region (x<6, z between -16 and -9) ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const inRegion = verts.some(v => v.x < 6 && v.z > -16 && v.z < -9);
  if (inRegion) {
    const ys = verts.map(v => v.y.toFixed(1));
    const xs = verts.map(v => v.x.toFixed(1));
    const zs = verts.map(v => v.z.toFixed(1));
    console.log(`  tri: x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 30) { console.log('  ... (truncated)'); break; }
  }
}

// Also check: what is the top face Y value at the center?
console.log('\n=== Y values of triangles with vertices near (46.8, z=-12.7) ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const nearCenter = verts.some(v => Math.abs(v.x - 46.8) < 5 && Math.abs(v.z + 12.7) < 5);
  if (nearCenter) {
    const ys = verts.map(v => v.y.toFixed(2));
    const xs = verts.map(v => v.x.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 20) { console.log('  ... (truncated)'); break; }
  }
}
