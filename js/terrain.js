import * as THREE from 'three';
import { fbm2, smoothstep, mulberry32 } from './noise.js';

// Analytic height function shared by rendering and bullet/ground collision.
export function makeTerrain({ slope = 0, hills = 1, seed = 1, backstop = 1500 }) {
  return function height(x, z) {
    const d = -z, ax = Math.abs(x);
    let y = slope * Math.max(-300, Math.min(d, backstop + 300));
    const outside = smoothstep(70, 450, ax);
    y += outside * hills * (55 * fbm2(x * 0.0016, z * 0.0016, seed) + 30);
    y += 0.3 * smoothstep(25, 160, d) * fbm2(x * 0.012, z * 0.012, seed + 5);
    y += 1.2 * outside * fbm2(x * 0.03, z * 0.03, seed + 9);
    y += smoothstep(backstop + 150, backstop + 900, d) * (220 + 120 * fbm2(x * 0.002, 3, seed + 3));
    y += smoothstep(40, 500, -d) * 25;
    return y;
  };
}

const PALETTES = {
  grass: { a: [0.26, 0.38, 0.14], b: [0.40, 0.46, 0.20], dry: [0.58, 0.54, 0.30], dirt: [0.42, 0.34, 0.24], rock: [0.45, 0.43, 0.39], tree: 0x2c4a22 },
  desert: { a: [0.76, 0.63, 0.44], b: [0.66, 0.52, 0.35], dry: [0.80, 0.70, 0.50], dirt: [0.58, 0.44, 0.30], rock: [0.55, 0.44, 0.34], tree: 0x5b5a32 },
  snow: { a: [0.92, 0.94, 0.97], b: [0.84, 0.87, 0.92], dry: [0.95, 0.96, 0.98], dirt: [0.62, 0.62, 0.64], rock: [0.36, 0.35, 0.35], tree: 0x1f3322 },
  wet: { a: [0.20, 0.30, 0.12], b: [0.28, 0.32, 0.17], dry: [0.36, 0.36, 0.22], dirt: [0.27, 0.21, 0.15], rock: [0.33, 0.32, 0.30], tree: 0x1e3219 },
};

// Tileable ground detail: soft blotches plus short grass strokes (greyscale, tinted by vertex colour).
function detailTexture(seed, palette) {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    // periodic noise so the texture tiles
    const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
    const n = fbm2(Math.cos(u) * 3 + 10, Math.sin(u) * 3 + Math.cos(v) * 3, seed, 4) * 0.6 + fbm2(Math.sin(v) * 9, Math.cos(u) * 9, seed + 3, 3) * 0.4;
    const val = Math.max(0, Math.min(255, 205 + n * 55));
    img.data[i * 4] = val; img.data[i * 4 + 1] = val; img.data[i * 4 + 2] = val * 0.97; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const rng = mulberry32(seed + 1);
  for (let i = 0; i < (palette === 'snow' ? 0 : 9000); i++) {
    const x = rng() * size, y = rng() * size, l = 3 + rng() * 7, a = -Math.PI / 2 + (rng() - 0.5) * 0.9;
    const sh = 150 + rng() * 105;
    g.strokeStyle = `rgba(${sh},${sh},${sh * 0.95},0.55)`;
    g.lineWidth = 0.8 + rng();
    g.beginPath();
    for (const ox of [0, size, -size]) for (const oy of [0, size, -size]) {
      g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

export function buildTerrainMesh(height, { zMin, zMax, xHalf = 2600, palette = "grass", seed = 1 }) {
  const width = xHalf * 2, depth = zMax - zMin;
  const geo = new THREE.PlaneGeometry(width, depth, 300, Math.round(depth / 8));
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (zMin + zMax) / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const pal = PALETTES[palette] || PALETTES.grass;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, height(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const m = 0.5 + 0.5 * fbm2(x * 0.004, z * 0.004, seed + 21);
    const dry = smoothstep(0.1, 0.45, fbm2(x * 0.0022 + 5, z * 0.0022, seed + 31));
    const dirt = smoothstep(0.25, 0.5, fbm2(x * 0.009, z * 0.009, seed + 41)) * 0.8;
    const fine = 0.92 + 0.16 * fbm2(x * 0.05, z * 0.05, seed + 51, 2);
    const steep = smoothstep(0.93, 0.72, nrm.getY(i));
    for (let k = 0; k < 3; k++) {
      let c = pal.a[k] + (pal.b[k] - pal.a[k]) * m;
      c += (pal.dry[k] - c) * dry * 0.7;
      c += (pal.dirt[k] - c) * dirt;
      c += (pal.rock[k] - c) * steep;
      colors[i * 3 + k] = Math.pow(Math.min(1, c * fine * 1.12), 2.2); // palette is sRGB
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const tex = detailTexture(seed, palette);
  tex.repeat.set(width / 7, depth / 7);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "terrain";
  return mesh;
}

export function buildTrees(height, { zMin, zMax, palette = 'grass', seed = 1, count = 1400 }) {
  const pal = PALETTES[palette] || PALETTES.grass;
  const rng = mulberry32(seed + 99);
  const group = new THREE.Group();
  const n = palette === 'desert' ? Math.round(count * 0.25) : count;
  const crownGeo = palette === 'desert' ? new THREE.SphereGeometry(1.6, 7, 5) : new THREE.ConeGeometry(2.3, 8, 7);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.4, 5);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: pal.tree }), n);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x4a3625 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let i = 0;
  while (i < n) {
    const x = (rng() * 2 - 1) * 2400;
    const z = zMin + rng() * (zMax - zMin);
    if (Math.abs(x) < 38 + Math.max(0, -z) * 0.02) continue;
    if (Math.hypot(x, z) < 30) continue;
    const y = height(x, z);
    const k = 0.6 + rng() * 1.0;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
    s.set(k, k * (0.8 + rng() * 0.5), k);
    p.set(x, y + 2.4 * s.y + (palette === 'desert' ? 1.2 : 4) * s.y, z);
    m.compose(p, q, s);
    crowns.setMatrixAt(i, m);
    col.setHex(pal.tree).multiplyScalar(0.8 + rng() * 0.4);
    crowns.setColorAt(i, col);
    p.set(x, y + 1.2 * s.y, z);
    m.compose(p, q, s);
    trunks.setMatrixAt(i, m);
    i++;
  }
  crowns.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  group.add(crowns, trunks);
  return group;
}
