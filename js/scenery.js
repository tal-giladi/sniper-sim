// Sky dome with sun and clouds, grass, rocks, bushes, trees and a distant mountain ring.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2, mulberry32, smoothstep } from './noise.js';

export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.56).normalize();

const srgb = (hex) => new THREE.Color(hex).convertLinearToSRGB();

// ---------- sky ----------
export function buildSky(preset) {
  const storm = preset === 'storm' ? 1 : 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: srgb(storm ? 0x3a4149 : 0x3f78c4) },
      horizon: { value: srgb(storm ? 0x737c84 : 0xc9d8e6) },
      sunDir: { value: SUN_DIR },
      cover: { value: storm ? 0.95 : 0.42 },
      storm: { value: storm },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 zenith, horizon, sunDir;
      uniform float cover, storm, time;
      varying vec3 vDir;
      float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float s = 0.0, a = 0.5;
        mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
        for (int i = 0; i < 6; i++) { s += a * noise(p); p = m * p + vec2(3.7, 1.3); a *= 0.5; }
        return s;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.5));
        if (h < 0.0) col = horizon;
        float sd = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.92, 0.75) * (pow(sd, 900.0) * 3.0 + pow(sd, 10.0) * 0.22) * (1.0 - storm * 0.92);
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 0.8 + vec2(time * 0.004, time * 0.0015);
          float n = fbm(uv * 1.3);
          float c = smoothstep(1.0 - cover - 0.05, 1.0 - cover + 0.35, n) * smoothstep(0.0, 0.15, h);
          vec3 lit = mix(vec3(1.0, 0.99, 0.97), vec3(0.52, 0.55, 0.6), storm);
          vec3 shade = mix(vec3(0.72, 0.76, 0.84), vec3(0.33, 0.36, 0.4), storm);
          vec3 cc = mix(lit, shade, smoothstep(0.45, 0.95, n)) + vec3(0.12) * pow(sd, 6.0) * (1.0 - storm);
          col = mix(col, cc, c * 0.95);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

// ---------- grass ----------
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const rng = mulberry32(7);
  for (let i = 0; i < 46; i++) {
    const x = 10 + rng() * 108, h = 55 + rng() * 70, lean = (rng() - 0.5) * 40;
    const l = 55 + rng() * 45;
    g.strokeStyle = `hsl(${60 + rng() * 30}, ${22 + rng() * 22}%, ${l * 0.5}%)`;
    g.lineWidth = 1.5 + rng() * 2.5;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const grassUniforms = { uTime: { value: 0 }, uWind: { value: 2 } };

export function buildGrass(height, { maxDist, palette, seed, targets }) {
  if (palette === 'snow') return null;
  const quad = (rot) => {
    const p = new THREE.PlaneGeometry(0.7, 0.5);
    p.translate(0, 0.25, 0);
    p.rotateY(rot);
    return p;
  };
  const geo = mergeGeometries([quad(0), quad(Math.PI / 3), quad(-Math.PI / 3)]);
  const tint = { grass: 0xa3ad7e, desert: 0xd2bd8a, wet: 0x87956a }[palette] || 0xa3ad7e;
  const mat = new THREE.MeshLambertMaterial({
    map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: tint,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = grassUniforms.uTime;
    sh.uniforms.uWind = grassUniforms.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float gh = clamp(position.y / 0.5, 0.0, 1.0);
       vec4 ip = instanceMatrix[3];
       float ph = ip.x * 0.31 + ip.z * 0.17;
       float sw = sin(uTime * (1.6 + uWind * 0.25) + ph) * (0.02 + uWind * 0.012);
       transformed.x += gh * gh * sw;
       transformed.z += gh * gh * sw * 0.6;`);
  };
  const count = palette === 'desert' ? 22000 : 60000;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const rng = mulberry32(seed + 5);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  let i = 0, guard = 0;
  while (i < count && guard++ < count * 4) {
    let x, d;
    const r = rng();
    if (r < 0.35) { d = 3 + rng() * 160; x = (rng() * 2 - 1) * (15 + d * 0.8); }
    else if (r < 0.55 && targets.length) {
      const t = targets[Math.floor(rng() * targets.length)];
      const a = rng() * 6.28, rr = Math.sqrt(rng()) * 22;
      d = t.dist + Math.sin(a) * rr; x = (t.x || 0) + Math.cos(a) * rr;
    } else { d = 3 + rng() * (maxDist + 250); x = (rng() * 2 - 1) * 260; }
    // keep the line of fire near the shooter clear
    if (d < 25 && rng() < 0.75) continue;
    const corridor = d < 300 && Math.abs(x) < 1.5 + d * 0.035;
    const z = -d;
    // short grass where targets stand or fall so they (and the aftermath) stay visible
    const nearTarget = targets.some((t) => d > t.dist - 45 && d < t.dist + 6 && Math.abs(x - (t.x || 0)) < (t.move ? t.move.span / 2 : 0) + 6);
    const k = (nearTarget ? 0.1 + rng() * 0.1 : corridor ? 0.15 + rng() * 0.15 : d < 200 && Math.abs(x) < 25 + d * 0.1 ? 0.15 + rng() * 0.2 : d < 150 ? 0.3 + rng() * 0.3 : 0.4 + rng() * 0.45) * (palette === 'desert' ? 0.8 : 1);
    q.setFromAxisAngle(up, rng() * 6.28);
    s.set(k * (0.8 + rng() * 0.6), k, k * (0.8 + rng() * 0.6));
    p.set(x, height(x, z) - 0.02, z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    const v = 0.75 + rng() * 0.4, dry = fbm2(x * 0.01, z * 0.01, seed + 44);
    col.setRGB(v * (1 + dry * 0.3), v, v * (1 - dry * 0.2));
    mesh.setColorAt(i, col);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- rocks & bushes ----------
export function buildRocksAndBushes(height, { zMin, zMax, palette, seed }) {
  const group = new THREE.Group();
  const rng = mulberry32(seed + 71);
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + 0.25 * fbm2(pos.getX(i) * 2, pos.getZ(i) * 2 + pos.getY(i), 3);
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.6, pos.getZ(i) * n);
  }
  rockGeo.computeVertexNormals();
  const rockColor = { grass: 0x7d7a72, desert: 0x9c7f60, snow: 0x55534f, wet: 0x5f5d58 }[palette] || 0x7d7a72;
  const bushColor = { grass: 0x3f5a2a, desert: 0x6b6a3c, snow: 0x2d3d2a, wet: 0x2f4522 }[palette] || 0x3f5a2a;
  const place = (geo, color, n, minD, scale, flatten) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const c = new THREE.Color();
    let i = 0;
    while (i < n) {
      const x = (rng() * 2 - 1) * 1400;
      const z = zMin * 0.8 + rng() * (zMax - zMin * 0.8);
      const d = -z;
      if (d > 0 && Math.abs(x) < minD + d * 0.03) continue;
      if (Math.hypot(x, z) < 12) continue;
      const k = scale * (0.3 + rng() ** 2 * 1.7);
      e.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
      q.setFromEuler(e);
      s.set(k * (0.8 + rng() * 0.5), k * flatten, k * (0.8 + rng() * 0.5));
      p.set(x, height(x, z) + k * flatten * 0.2, z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      c.setHex(color).multiplyScalar(0.75 + rng() * 0.5);
      mesh.setColorAt(i, c);
      i++;
    }
    return mesh;
  };
  group.add(place(rockGeo, rockColor, 700, 6, 1.1, 1));
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  group.add(place(bushGeo, bushColor, palette === 'snow' ? 250 : 900, 8, 1.3, 0.75));
  return group;
}

// ---------- trees ----------
function pineGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
  trunk.translate(0, 1.5, 0);
  parts.push(trunk);
  const tiers = [[2.6, 4.2, 3.2], [2.1, 3.6, 5.4], [1.5, 3.0, 7.4], [0.9, 2.4, 9.2]];
  for (const [r, h, y] of tiers) {
    const c = new THREE.ConeGeometry(r, h, 8);
    c.translate(0, y, 0);
    parts.push(c);
  }
  // colour: trunk brown, foliage green via vertex colours
  const out = mergeGeometries(parts.map((g, i) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const [r, gg, b] = i === 0 ? [0.3, 0.21, 0.14] : [0.16 + i * 0.015, 0.29 + i * 0.02, 0.13];
    for (let k = 0; k < n; k++) { col[k * 3] = r ** 2.2; col[k * 3 + 1] = gg ** 2.2; col[k * 3 + 2] = b ** 2.2; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.toNonIndexed();
  }));
  return out;
}

function broadleafGeometry() {
  const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3.4, 6);
  trunk.translate(0, 1.7, 0);
  const blobs = [[0, 5.2, 0, 2.4], [1.3, 4.6, 0.4, 1.7], [-1.2, 4.7, -0.3, 1.8], [0.2, 4.4, 1.2, 1.6], [-0.1, 6.4, -0.2, 1.6]]
    .map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, 1); g.translate(x, y, z); return g; });
  const parts = [trunk, ...blobs];
  return mergeGeometries(parts.map((g, i) => {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const [r, gg, b] = i === 0 ? [0.3, 0.22, 0.15] : [0.22 + i * 0.01, 0.34 + i * 0.012, 0.14];
    for (let k = 0; k < n; k++) { col[k * 3] = r ** 2.2; col[k * 3 + 1] = gg ** 2.2; col[k * 3 + 2] = b ** 2.2; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g.index ? g.toNonIndexed() : g;
  }));
}

export function buildForest(height, { zMin, zMax, palette, seed, count = 1600 }) {
  const rng = mulberry32(seed + 99);
  const group = new THREE.Group();
  const tint = { grass: 0xffffff, desert: 0xc9b98a, snow: 0xb8c8c0, wet: 0xd0dcc8 }[palette] || 0xffffff;
  const kinds = palette === 'desert'
    ? [[broadleafGeometry(), Math.round(count * 0.3)]]
    : palette === 'snow'
      ? [[pineGeometry(), count]]
      : [[pineGeometry(), Math.round(count * 0.6)], [broadleafGeometry(), Math.round(count * 0.4)]];
  for (const [geo, n] of kinds) {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, color: tint }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const c = new THREE.Color();
    let i = 0;
    while (i < n) {
      // clustered: pick a clump centre, then scatter around it
      const cx = (rng() * 2 - 1) * 2300, cz = zMin + rng() * (zMax - zMin);
      const clump = 1 + Math.floor(rng() * 7);
      for (let j = 0; j < clump && i < n; j++) {
        const x = cx + (rng() - 0.5) * 60, z = cz + (rng() - 0.5) * 60;
        if (Math.abs(x) < 40 + Math.max(0, -z) * 0.02 || Math.hypot(x, z) < 35) continue;
        const k = 0.6 + rng() * 0.9;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28);
        s.set(k, k * (0.85 + rng() * 0.35), k);
        p.set(x, height(x, z) - 0.2, z);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
        c.setScalar(0.75 + rng() * 0.45);
        mesh.setColorAt(i, c);
        i++;
      }
    }
    group.add(mesh);
  }
  return group;
}

// ---------- distant mountains ----------
export function buildMountains({ palette, seed }) {
  const seg = 256;
  const rings = [3600, 5200, 7000, 8600];
  const positions = [], colors = [], index = [];
  const base = { grass: [0.36, 0.42, 0.33], desert: [0.62, 0.5, 0.38], snow: [0.42, 0.44, 0.48], wet: [0.3, 0.35, 0.3] }[palette] || [0.36, 0.42, 0.33];
  for (let r = 0; r < rings.length; r++) {
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = fbm2(Math.cos(a) * 3 + r * 0.7, Math.sin(a) * 3, seed + 400, 5) * 0.5 + 0.5;
      const hgt = r === 0 ? -20 : r === 3 ? 150 + n * 300 : (r === 1 ? 250 : 550) + n * (r === 1 ? 700 : 1400);
      positions.push(Math.cos(a) * rings[r], hgt, Math.sin(a) * rings[r]);
      const snow = palette !== 'desert' && hgt > 1000 ? smoothstep(1000, 1300, hgt) : 0;
      const shade = 0.8 + 0.3 * n;
      for (let k = 0; k < 3; k++) colors.push((base[k] * shade * (1 - snow) + 0.95 * snow) ** 2.2);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}
