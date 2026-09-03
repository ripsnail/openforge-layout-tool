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

// All top-face triangles (y > 5.5) near east side
console.log('=== Top-face triangles (y>5.5) with any vertex x>43 ===');
let count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const allTop = verts.every(v => v.y > 5.5);
  const anyEast = verts.some(v => v.x > 43);
  if (allTop && anyEast) {
    const xs = verts.map(v => v.x.toFixed(2));
    const ys = verts.map(v => v.y.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
  }
}
console.log(`  Total: ${count}`);

// All triangles that span x=46.8 (have vertices on both sides)
console.log('\n=== Triangles spanning x≈46.8 with all y>5.5 ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const allTop = verts.every(v => v.y > 5.5);
  const hasBelow = verts.some(v => v.x < 46);
  const hasAbove = verts.some(v => v.x > 47);
  if (allTop && hasBelow && hasAbove) {
    const xs = verts.map(v => v.x.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] z=[${zs}]`);
    count++;
    if (count > 20) break;
  }
}
console.log(`  Total: ${count}`);

// Look at ALL triangles with ANY vertex near z=-12.7 (between -15 and -10)
console.log('\n=== ALL triangles with any vertex z between -15 and -10, x > 40 ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const near = verts.some(v => v.z > -15 && v.z < -10 && v.x > 40);
  if (near) {
    const xs = verts.map(v => v.x.toFixed(2));
    const ys = verts.map(v => v.y.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 20) break;
  }
}
console.log(`  Total: ${count}`);
