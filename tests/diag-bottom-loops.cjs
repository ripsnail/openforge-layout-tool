#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const BOTTOM_THRESHOLD_MM = 3;
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

const models = [
  { name: 'plain#base+electronics+square.2x2.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4 },
  { name: 'plain#base+square.2x1.openlock+topless,magnetic+flex.stl', expectedOpenlock: 4 },
  { name: 'plain#base+curved+inverted.3x3+2r.openlock+topless,magnetic+flex.stl', expectedOpenlock: 6 },
];

for (const model of models) {
  console.log(`\n=== ${model.name} ===`);
  const filePath = path.join(__dirname, '..', 'models', model.name);
  const vertices = parseSTL(filePath);
  const tris = [];
  for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);

  const bottomTris = tris.filter(t => t.every(i => vertices[i].y < BOTTOM_THRESHOLD_MM));
  const loops = findBoundaryLoops(bottomTris, vertices);

  let maxArea = 0, perimeterLoop = null;
  for (const loop of loops) {
    const area = Math.abs(calculateLoopArea(loop, vertices));
    if (area > maxArea) { maxArea = area; perimeterLoop = loop; }
  }

  let bbMinX = Infinity, bbMaxX = -Infinity, bbMinZ = Infinity, bbMaxZ = -Infinity;
  for (const tri of bottomTris) { for (const v of tri) {
    bbMinX = Math.min(bbMinX, vertices[v].x); bbMaxX = Math.max(bbMaxX, vertices[v].x);
    bbMinZ = Math.min(bbMinZ, vertices[v].z); bbMaxZ = Math.max(bbMaxZ, vertices[v].z);
  }}
  const centerX = (bbMinX + bbMaxX) / 2, centerZ = (bbMinZ + bbMaxZ) / 2;
  const edgeMidpoints = [
    { name: 'n', x: centerX, z: bbMinZ },
    { name: 's', x: centerX, z: bbMaxZ },
    { name: 'e', x: bbMaxX, z: centerZ },
    { name: 'w', x: bbMinX, z: centerZ },
  ];

  // Collect all inner loops with their stats
  const innerLoops = [];
  for (const loop of loops) {
    if (loop === perimeterLoop) continue;
    const area = Math.abs(calculateLoopArea(loop, vertices));
    const xs = loop.map(i => vertices[i].x);
    const zs = loop.map(i => vertices[i].z);
    const w = Math.max(...xs) - Math.min(...xs);
    const d = Math.max(...zs) - Math.min(...zs);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const maxDim = Math.max(w, d);
    const minDim = Math.min(w, d);
    const aspect = minDim > 0 ? maxDim / minDim : 0;

    let bestEdge = null, bestDist = OPENLOCK_MAX_DIST;
    for (const em of edgeMidpoints) {
      const dx = cx - em.x, dz = cz - em.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) { bestDist = dist; bestEdge = em.name; }
    }

    innerLoops.push({ area, cx, cz, w, d, maxDim, minDim, aspect, edge: bestEdge, dist: bestDist, verts: loop.length });
  }

  innerLoops.sort((a, b) => b.area - a.area);

  console.log(`Total inner loops: ${innerLoops.length}`);
  console.log(`\nTop 30 by area:`);
  console.log(`area   center        size      maxDim aspect edge dist  verts`);
  for (const l of innerLoops.slice(0, 30)) {
    console.log(`${l.area.toFixed(2).padStart(6)} (${l.cx.toFixed(1)},${l.cz.toFixed(1)}) ${l.w.toFixed(1)}x${l.d.toFixed(1)}  ${l.maxDim.toFixed(1).padStart(5)}  ${l.aspect.toFixed(1).padStart(5)}  ${l.edge || '-'}  ${l.dist.toFixed(1).padStart(4)}  ${l.verts}`);
  }
}
