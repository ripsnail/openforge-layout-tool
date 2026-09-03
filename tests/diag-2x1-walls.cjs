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

// Look for triangles on the INNER WALLS of the open center section
// The walls run along x at z≈-8 (south wall of north half) and z≈-17.7 (north wall of south half)
console.log('=== Triangles near inner walls (z≈-7.7 to -8.0, the south edge of north half) ===');
let count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const nearWall = verts.some(v => v.z > -9 && v.z < -7);
  if (nearWall) {
    const xs = verts.map(v => v.x.toFixed(2));
    const ys = verts.map(v => v.y.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 30) { console.log('  ... truncated'); break; }
  }
}
console.log(`  Total: ${count}`);

// Check for any triangles on the vertical east wall (x≈48-51) in the open center zone
console.log('\n=== Triangles on east wall (x>47) in center zone (z between -18 and -7) ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const nearEastWall = verts.some(v => v.x > 47);
  const inCenter = verts.some(v => v.z > -18 && v.z < -7);
  if (nearEastWall && inCenter) {
    const xs = verts.map(v => v.x.toFixed(2));
    const ys = verts.map(v => v.y.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
    count++;
    if (count > 30) { console.log('  ... truncated'); break; }
  }
}
console.log(`  Total: ${count}`);

// Check for vertical faces (faces where y varies but x or z is constant)
console.log('\n=== All unique z-values for vertices with x > 47 (east wall region) ===');
const zvals = new Set();
for (const v of vertices) {
  if (v.x > 47) zvals.add(v.z.toFixed(2));
}
console.log([...zvals].sort((a,b) => a-b).join(', '));

// Check: what does the east face look like?
console.log('\n=== Triangles at x≈50.8 (exact east edge) ===');
count = 0;
for (const tri of tris) {
  const verts = tri.map(i => vertices[i]);
  const atEdge = verts.some(v => Math.abs(v.x - 50.8) < 0.1);
  if (atEdge) {
    const xs = verts.map(v => v.x.toFixed(2));
    const ys = verts.map(v => v.y.toFixed(2));
    const zs = verts.map(v => v.z.toFixed(2));
    const avgZ = (verts[0].z + verts[1].z + verts[2].z) / 3;
    if (avgZ > -18 && avgZ < -7) {
      console.log(`  x=[${xs}] y=[${ys}] z=[${zs}]`);
      count++;
      if (count > 20) break;
    }
  }
}
console.log(`  Total in center zone: ${count}`);
