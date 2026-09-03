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

// Histogram of z values
const zBuckets = {};
for (const v of vertices) {
  const bucket = Math.floor(v.z);
  zBuckets[bucket] = (zBuckets[bucket] || 0) + 1;
}
console.log('Vertex z-value histogram:');
for (const [z, count] of Object.entries(zBuckets).sort((a,b) => a[0]-b[0])) {
  console.log(`  z=${z}: ${count} vertices`);
}

// Find all unique z values between -20 and -5, with 0.1 resolution
console.log('\nUnique z values between -20 and -5 (0.1 resolution):');
const zSet = new Set();
for (const v of vertices) {
  if (v.z > -20 && v.z < -5) {
    zSet.add(v.z.toFixed(1));
  }
}
console.log([...zSet].sort((a,b) => a-b).join(', '));
