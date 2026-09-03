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

const filePath = path.join(__dirname, '..', 'models', 'plain#base+square.2x1.openlock+topless,magnetic+flex.stl');
const vertices = parseSTL(filePath);
const tris = [];
for (let i = 0; i < vertices.length; i += 3) tris.push([i, i + 1, i + 2]);

// Find all unique x-values near the east side to understand the geometry
console.log('=== All unique X values near east side (x > 40) with vertex z near -12.7 (z between -16 and -9) ===');
const xvals = new Set();
for (const tri of tris) {
  for (const i of tri) {
    const v = vertices[i];
    if (v.x > 40 && v.z > -16 && v.z < -9) {
      xvals.add(v.x.toFixed(2));
    }
  }
}
console.log('  x values:', [...xvals].sort((a,b) => b-a).join(', '));

// Same for west side
const xvalsW = new Set();
for (const tri of tris) {
  for (const i of tri) {
    const v = vertices[i];
    if (v.x < 10 && v.z > -16 && v.z < -9) {
      xvalsW.add(v.x.toFixed(2));
    }
  }
}
console.log('  west x values:', [...xvalsW].sort((a,b) => a-b).join(', '));

// Show all triangles with ALL vertices having z between -16 and -9
console.log('\n=== ALL triangles where ALL 3 vertices have z between -16 and -9 ===');
let count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const allInZ = verts.every(v => v.z > -16 && v.z < -9);
  if (allInZ) {
    const xs = verts.map(v => v.x.toFixed(1));
    const ys = verts.map(v => v.y.toFixed(1));
    const zs = verts.map(v => v.z.toFixed(1));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 40) { console.log('  ... (truncated)'); break; }
  }
}
console.log(`  Total: ${count}`);

// Show all triangles spanning z=-12.7 with vertices at different x
console.log('\n=== All unique x-values for vertices with z between -14 and -11 ===');
const xvalsCenter = new Set();
for (const tri of tris) {
  for (const i of tri) {
    const v = vertices[i];
    if (v.z > -14 && v.z < -11) {
      xvalsCenter.add(v.x.toFixed(2));
    }
  }
}
console.log('  x values:', [...xvalsCenter].sort((a,b) => a-b).join(', '));
