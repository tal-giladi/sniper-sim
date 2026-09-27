import * as THREE from 'three';
import {
  RIFLES, MOA, atmosphere, stationPressure, densityAltitude, muzzleVelocity, stability,
  aeroJumpCoef, zeroAngle, dopeTable, simulate, sampleAtRange, earthRotation, spinDriftCoef,
  GRAIN,
} from './ballistics.js';
import { WindField, shearFactor, clockString } from './wind.js';
import { makeTerrain, buildTerrainMesh, buildTrees } from './terrain.js';
import { Target } from './targets.js';
import { MISSIONS, customMission } from './missions.js';
import { drawOverlay } from './scope.js';
import { Sound } from './audio.js';
import { mulberry32, gauss, noise1 } from './noise.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 12000);
camera.rotation.order = 'YXZ';
const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x4a4436, 1.1);
const sun = new THREE.DirectionalLight(0xfff3e0, 1.8);
sun.position.set(800, 1500, 600);
scene.add(hemi, sun);
let world = new THREE.Group();
scene.add(world);
const sound = new Sound();

const $ = (id) => document.getElementById(id);
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- state ----------
const S = {
  playing: false, paused: false, time: 0,
  mission: null, rifle: null, rifleId: '308',
  yaw: 0, pitch: 0, scoped: false, mag: 12,
  turretE: 0, turretW: 0, cant: 0,
  breath: { holding: false, held: 0, oxygen: 1, amp: 1, phase: 0, hb: 0 },
  recoil: { t: -10, k: 0, ky: 0 },
  sway: { p: 0, y: 0 },
  mouseSpeed: 0,
  lastShot: -99, roundsLeft: 0, shots: [], inflight: [], effects: [],
  barrelHeat: 0, lrf: null, lrfUntil: 0, endAt: null,
  sens: 1, flags: [], targets: [], terrainMesh: null,
};

const HAZE = {
  clear: { top: '#5d8fcb', horizon: '#c9d8e6', fog: () => new THREE.Fog(0xc9d8e6, 1500, 16000), hemi: 1.1, sun: 1.8 },
  storm: { top: '#3d444c', horizon: '#737c84', fog: () => new THREE.FogExp2(0x737c84, 0.00085), hemi: 0.75, sun: 0.35 },
};

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

function disposeWorld() {
  world.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); });
  });
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
}

// ---------- mission setup ----------
const FLAG_W = 1.4, FLAG_H = 0.8;
function buildFlag(x, z) {
  const y = S.terrain(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 4, 6), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
  pole.position.y = 2;
  g.add(pole);
  const head = new THREE.Group(); head.position.y = 3.95; g.add(head);
  const pivot = new THREE.Group(); head.add(pivot);
  const geo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, 10, 2);
  geo.translate(FLAG_W / 2, -FLAG_H / 2, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xe8401c, side: THREE.DoubleSide }));
  pivot.add(cloth);
  world.add(g);
  return { x, z, head, pivot, geo, base: Float32Array.from(geo.attributes.position.array), phase: Math.random() * 10 };
}

function startMission(mission, rifleId) {
  disposeWorld();
  const env = mission.env;
  S.mission = mission;
  S.rifleId = rifleId;
  S.rifle = RIFLES[rifleId];
  const seed = hashStr(mission.id);
  S.rng = mulberry32((seed ^ Date.now()) >>> 0);
  const maxDist = Math.max(...mission.targets.map((t) => t.dist));
  S.maxDist = maxDist;
  S.terrain = makeTerrain({ ...mission.terrain, seed, backstop: maxDist + 250 });
  const zMin = -(maxDist + 2000), zMax = 900;
  S.terrainMesh = buildTerrainMesh(S.terrain, { zMin, zMax, palette: env.palette, seed });
  world.add(S.terrainMesh);
  world.add(buildTrees(S.terrain, { zMin, zMax: zMax - 100, palette: env.palette, seed }));

  S.pressure = stationPressure(env.altitude);
  S.atm = atmosphere(env.tempC, S.pressure, env.humidity);
  S.wind = new WindField(env.wind, seed + 3);
  S.omega = earthRotation(env.latitude, env.azimuth);
  S.mv0 = muzzleVelocity(S.rifle, env.tempC);
  S.zeroAng = zeroAngle(S.rifle, atmosphere(15, 1013.25, 0.5), S.rifle.mv);
  const ranges = [];
  for (let r = 100; r <= Math.min(2600, maxDist + 300); r += 50) ranges.push(r);
  S.dope = dopeTable(S.rifle, S.atm, S.mv0, S.zeroAng, ranges);

  S.targets = mission.targets.map((d, i) => new Target(d, S.terrain, S.rng, i));
  S.targets.forEach((t) => { world.add(t.group); t.update(0); });

  S.flags = [];
  for (let d = 100; d <= maxDist + 50; d += 100) {
    const side = (d / 100) % 2 ? -1 : 1;
    S.flags.push(buildFlag(side * (12 + d * 0.035), -d));
  }

  const sky = HAZE[env.sky] || HAZE.clear;
  scene.fog = sky.fog();
  hemi.intensity = sky.hemi; sun.intensity = sky.sun;
  document.body.style.background = `linear-gradient(${sky.top}, ${sky.horizon} 55%, ${sky.horizon})`;

  S.eye = new THREE.Vector3(0, S.terrain(0, 0) + 0.35, 0);
  camera.position.copy(S.eye);
  const t0 = S.targets[0].posAt(0);
  S.yaw = Math.atan2(-t0.x, -t0.z);
  S.pitch = Math.atan2(t0.y + 1 - S.eye.y, Math.hypot(t0.x, t0.z));
  S.cant = env.cant || 0;
  S.turretE = 0; S.turretW = 0;
  S.time = 0; S.lastShot = -99; S.roundsLeft = mission.rounds;
  S.shots = []; S.inflight = []; S.effects = [];
  S.barrelHeat = 0; S.lrf = null; S.endAt = null;
  S.breath = { holding: false, held: 0, oxygen: 1, amp: 1, phase: 0, hb: 0 };
  S.recoil = { t: -10, k: 0, ky: 0 };
  S.scoped = true; S.mag = 10;
  $('report').classList.add('hidden');
  $('dope').classList.add('hidden');
  buildDopeCard();
}

// ---------- optics ----------
function scopeRadiusCss() { return 0.46 * Math.min(W, H); }
function focalCss() {
  if (!S.scoped) return (H / 2) / Math.tan((55 * Math.PI) / 360);
  const pxPerMrad = (2 * scopeRadiusCss()) / (370 / S.mag);
  return pxPerMrad * 1000;
}
function applyFov() {
  const f = focalCss();
  const fov = (2 * Math.atan(H / 2 / f) * 180) / Math.PI;
  if (Math.abs(camera.fov - fov) > 1e-6) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

// ---------- sway, breathing, recoil ----------
function updateBody(dt) {
  const b = S.breath;
  if (b.holding && b.oxygen > 0) {
    b.held += dt;
    b.oxygen = Math.max(0, b.oxygen - dt / 11);
    if (b.oxygen === 0) b.holding = false;
  } else {
    b.holding = false;
    b.held = 0;
    b.oxygen = Math.min(1, b.oxygen + dt / 9);
  }
  const ampTarget = b.holding ? 0.04 : 1;
  b.amp += (ampTarget - b.amp) * Math.min(1, dt * 2.5);
  b.phase += dt * (2 * Math.PI) / (3.6 + 1.4 * b.oxygen);
  const hr = 62 + (1 - b.oxygen) * 45;
  b.hb += dt * hr / 60;
  const t = S.time;
  const tremor = 0.05 + (b.holding ? Math.max(0, b.held - 4.5) * 0.08 : 0) + (1 - b.oxygen) * 0.12;
  const beat = Math.exp(-(((b.hb % 1) * 9) ** 2)) * (0.03 + (1 - b.oxygen) * 0.05);
  const p = b.amp * 0.5 * Math.sin(b.phase) + tremor * noise1(t * 2.3, 11) + 0.07 * noise1(t * 0.35, 5) + beat;
  const y = b.amp * 0.18 * Math.sin(b.phase * 0.5 + 1) + tremor * noise1(t * 2.1, 21) + 0.07 * noise1(t * 0.3, 9);
  // recoil
  const rt = S.time - S.recoil.t;
  let rp = 0, ry = 0;
  if (rt >= 0 && rt < 3) {
    const env = rt < 0.04 ? rt / 0.04 : Math.exp(-(rt - 0.04) / 0.16);
    rp = S.recoil.k * env; ry = S.recoil.ky * env;
  }
  return { p: p * 1e-3 + rp, y: y * 1e-3 + ry };
}

// ---------- firing ----------
const V = () => new THREE.Vector3();
function fire() {
  if (!S.playing || S.paused || S.endAt) return;
  const rifle = S.rifle;
  if (S.time - S.lastShot < rifle.cycle || S.roundsLeft <= 0) return;
  S.lastShot = S.time;
  S.roundsLeft--;
  camera.rotation.set(S.pitch + S.sway.p, S.yaw + S.sway.y, 0);
  camera.updateMatrixWorld();
  const f = V().set(0, 0, -1).applyQuaternion(camera.quaternion);
  const r = V().set(1, 0, 0).applyQuaternion(camera.quaternion);
  const u = V().set(0, 1, 0).applyQuaternion(camera.quaternion);
  const rng = S.rng;
  const sigma = (rifle.precisionMoa * MOA) / 2.4 * (1 + Math.max(0, S.barrelHeat - 60) / 80);
  const jerk = Math.min(1, S.mouseSpeed / 1500) * 0.25e-3;
  const e = S.zeroAng + S.turretE * 1e-4 + gauss(rng) * (sigma + jerk);
  const w = S.turretW * 1e-4 + gauss(rng) * (sigma + jerk);
  const c = (S.cant * Math.PI) / 180, cc = Math.cos(c), sc = Math.sin(c);
  const offR = w * cc + e * sc, offU = -w * sc + e * cc;
  const dir = f.clone().addScaledVector(r, offR).addScaledVector(u, offU).normalize();
  const upS = u.clone().multiplyScalar(cc).addScaledVector(r, sc);
  const origin = S.eye.clone().addScaledVector(upS, -rifle.sightHeight);
  const mv = muzzleVelocity(rifle, S.mission.env.tempC, S.barrelHeat) + gauss(rng) * rifle.mvSd;
  const sg = stability(rifle, mv, S.atm);
  const tShot = S.time;
  const windFn = (x, y, z, t) => {
    const s = S.wind.sample(x, z, tShot + t);
    const k = shearFactor(y - S.terrain(x, z));
    return [s.x * k, 0, s.z * k];
  };
  const base = {
    bcG7: rifle.bcG7, atm: S.atm, origin: origin.toArray(), dir: dir.toArray(), mv,
    wind: windFn, omega: S.omega, sg, ajCoef: aeroJumpCoef(rifle, sg),
    maxRange: S.maxDist + 1500, maxTime: 9,
  };
  const res = simulate({
    ...base, rain: S.mission.env.rain, rng, ground: S.terrain,
    onStep: (p0, p1) => {
      for (const tg of S.targets) {
        const hit = tg.testSegment(p0, p1, tShot + p1.t);
        if (hit && hit.inside) return hit;
      }
      return null;
    },
  });

  // intended target = closest to the line of sight
  let intended = null, best = Infinity;
  for (const tg of S.targets) {
    const p = tg.posAt(tShot);
    const to = V().set(p.x, p.y + tg.center, p.z).sub(S.eye).normalize();
    const ang = Math.acos(Math.min(1, to.dot(f)));
    if (ang < best) { best = ang; intended = tg; }
  }
  const report = analyze(res, base, intended, tShot, origin, dir, sg, mv);
  S.inflight.push({ tShot, res, idx: 0, report, n: S.shots.length + S.inflight.length + 1, trail: makeTrail() });

  S.barrelHeat += 7 * rifle.recoil;
  S.recoil = { t: S.time, k: 5.5e-3 * rifle.recoil, ky: (rng() - 0.5) * 2.5e-3 * rifle.recoil };
  // the rifle settles slightly off the original hold after recoil
  S.yaw += gauss(rng) * 0.12e-3 * rifle.recoil;
  S.pitch += gauss(rng) * 0.12e-3 * rifle.recoil;
  sound.shot(0.8 + rifle.recoil * 0.25);
  setTimeout(() => S.playing && S.roundsLeft > 0 && sound.bolt(), 250);
  S.breath.holding = false;
}

function crossingOf(tg, path, tShot) {
  for (let i = 1; i < path.length; i++) {
    const c = tg.testSegment(path[i - 1], path[i], tShot + path[i].t);
    if (c) return c;
  }
  return null;
}

function analyze(res, base, tg, tShot, origin, dir, sg, mv) {
  const path = res.path;
  const c0 = tg.posAt(tShot);
  const hx = c0.x - origin.x, hz = c0.z - origin.z;
  const R = Math.hypot(hx, hz);
  const l = Math.hypot(c0.x, c0.z), nx = -c0.x / l, nz = -c0.z / l;
  const at = (p) => sampleAtRange(p, origin.x, origin.z, hx, hz, R);
  const full = simulate({ ...base, maxRange: R + 5 });
  const noWind = simulate({ ...base, wind: null, ajCoef: 0, maxRange: R + 5 });
  const noCor = simulate({ ...base, omega: null, maxRange: R + 5 });
  const pf = at(full.path), pw = at(noWind.path), pc = at(noCor.path);
  const lat = (a, b) => (a.x - b.x) * nz - (a.z - b.z) * nx;
  const out = { range: R, tgId: tg.id, kind: tg.kind };
  if (pf && pw && pc) {
    const tof = pf.t;
    const along = (dir.x * hx + dir.z * hz) / R; // horizontal bore component toward the target
    const boreY = origin.y + dir.y * (R / along);
    const mil = (m) => (m / R) * 1000;
    out.tof = tof;
    out.vel = pf.v;
    out.energy = 0.5 * S.rifle.massGr * GRAIN * pf.v * pf.v;
    out.drop = boreY - pw.y;
    out.dropMil = mil(out.drop);
    out.windH = lat(pf, pw); out.windV = pf.y - pw.y;
    out.corH = lat(pf, pc); out.corV = pf.y - pc.y;
    out.spin = spinDriftCoef(sg) * Math.pow(tof, 1.83);
    const cT = tg.posAt(tShot + tof);
    out.move = (cT.x - c0.x) * nz - (cT.z - c0.z) * nx;
    out.mil = mil;
  }
  // miss relative to target centre
  const cr = crossingOf(tg, path, tShot);
  let mu = null, mv_ = null;
  if (cr) { mu = cr.u; mv_ = cr.v - tg.center; }
  else {
    const p = at(path);
    if (p) {
      const c = tg.posAt(tShot + p.t);
      mu = (p.x - c.x) * nz - (p.z - c.z) * nx;
      mv_ = p.y - c.y - tg.center;
    }
  }
  out.missU = mu; out.missV = mv_;
  out.hit = res.impact && res.impact.type === 'target' ? res.impact : null;
  out.hitIntended = out.hit && out.hit.target === tg;
  return out;
}

// ---------- in-flight bullets and effects ----------
const puffTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

function makeTrail() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf0f0f0, transparent: true, opacity: 0.45 }));
  line.frustumCulled = false;
  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xffffff, transparent: true, opacity: 0.55, sizeAttenuation: false, depthWrite: false }));
  dot.scale.setScalar(0.012);
  world.add(line, dot);
  return { line, dot };
}

function pathPoint(path, t, hint = 0) {
  let i = hint;
  while (i < path.length - 2 && path[i + 1].t < t) i++;
  const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
  const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, i };
}

function spawnPuff(pos, color, size, dur, count = 4, rise = 0.6) {
  for (let i = 0; i < count; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, opacity: 0.9, depthWrite: false }));
    s.position.set(pos.x + (Math.random() - 0.5) * size * 0.3, pos.y + 0.15, pos.z + (Math.random() - 0.5) * size * 0.3);
    world.add(s);
    S.effects.push({ s, t0: S.time, dur: dur * (0.7 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.6), rise: rise * Math.random() });
  }
}

const DUST = { grass: 0x8a7556, desert: 0xc8ac80, snow: 0xf4f6fa, wet: 0x5b4b3a };

function updateInflight() {
  for (let k = S.inflight.length - 1; k >= 0; k--) {
    const b = S.inflight[k];
    const path = b.res.path;
    const tf = S.time - b.tShot;
    const endT = path[path.length - 1].t;
    const p = pathPoint(path, Math.min(tf, endT), b.idx);
    b.idx = p.i;
    const q = pathPoint(path, Math.max(0, Math.min(tf, endT) - 0.015), Math.max(0, b.idx - 20));
    const arr = b.trail.line.geometry.attributes.position.array;
    arr[0] = q.x; arr[1] = q.y; arr[2] = q.z; arr[3] = p.x; arr[4] = p.y; arr[5] = p.z;
    b.trail.line.geometry.attributes.position.needsUpdate = true;
    b.trail.dot.position.set(p.x, p.y, p.z);
    if (tf >= endT) {
      world.remove(b.trail.line, b.trail.dot);
      b.trail.line.geometry.dispose();
      finalizeShot(b);
      S.inflight.splice(k, 1);
    }
  }
  for (let i = S.effects.length - 1; i >= 0; i--) {
    const e = S.effects[i];
    const a = (S.time - e.t0) / e.dur;
    if (a >= 1) { world.remove(e.s); e.s.material.dispose(); S.effects.splice(i, 1); continue; }
    e.s.scale.setScalar(e.size * (0.3 + 1.2 * Math.sqrt(a)));
    e.s.position.y += e.rise * 0.016;
    e.s.material.opacity = 0.9 * (1 - a) * (1 - a);
  }
}

function finalizeShot(b) {
  const imp = b.res.impact;
  const rep = b.report;
  const dist = imp ? Math.hypot(imp.x - S.eye.x, imp.y - S.eye.y, imp.z - S.eye.z) : rep.range;
  const soundDelay = dist / S.atm.sos;
  let points = 0;
  if (imp && imp.type === 'target') {
    const tg = imp.target;
    points = tg.down ? 0 : tg.score(imp.u, imp.v);
    tg.onHit(imp.u, imp.v, points, S.time);
    if (tg.kind === 'silhouette') spawnPuff(imp, 0xb89a6a, 0.35, 0.8, 3, 0.2);
    else spawnPuff(imp, 0xffffff, 0.25, 0.25, 2, 0);
    if (tg.kind === 'silhouette') sound.thud(soundDelay, dist); else sound.ping(soundDelay, dist);
  } else if (imp && imp.type === 'ground') {
    const wet = S.mission.env.rain > 0.3;
    spawnPuff(imp, DUST[S.mission.env.palette] || DUST.grass, wet ? 0.9 : 1.6, wet ? 0.9 : 2.2, wet ? 3 : 5);
    sound.thud(soundDelay, dist);
  }
  rep.points = points;
  rep.n = S.shots.length + 1;
  S.shots.push(rep);
  showReport(rep);
}

// ---------- HUD ----------
const fmt = (v, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));
const lr = (m, pos = 'R', neg = 'L') => `${fmt(Math.abs(m), 2)} ${m >= 0 ? pos : neg}`;
const ud = (m) => `${fmt(Math.abs(m), 2)} ${m >= 0 ? 'U' : 'D'}`;

function showReport(r) {
  const el = $('report');
  el.classList.remove('hidden');
  const m = r.mil || ((x) => (x / r.range) * 1000);
  const result = r.points > 0 ? `<b class="hit">HIT ${r.points}</b>` : r.hit ? `<b class="hit">HIT</b>` : `<b class="miss">MISS</b>`;
  let rows = `<div class="rt">#${r.n} ${result} <span>${fmt(r.range, 0)} m</span></div>`;
  if (r.tof != null) {
    rows += `<table>
      <tr><td>Time of flight</td><td>${fmt(r.tof, 2)} s</td></tr>
      <tr><td>Impact velocity</td><td>${fmt(r.vel, 0)} m/s · ${fmt(r.energy, 0)} J</td></tr>
      <tr><td>Gravity drop</td><td>${fmt(r.drop, 2)} m · ${fmt(m(r.drop), 2)} mil</td></tr>
      <tr><td>Wind drift</td><td>${fmt(Math.abs(r.windH * 100), 0)} cm ${r.windH >= 0 ? 'R' : 'L'} · ${lr(m(r.windH))}</td></tr>
      <tr><td>Spin drift</td><td>${fmt(r.spin * 100, 0)} cm R · ${fmt(m(r.spin), 2)} mil</td></tr>
      <tr><td>Coriolis</td><td>${lr(m(r.corH))} · ${ud(m(r.corV))}</td></tr>
      <tr><td>Target moved</td><td>${fmt(Math.abs(r.move), 2)} m ${r.move >= 0 ? 'R' : 'L'} · ${lr(m(r.move))}</td></tr>`;
    if (r.missU != null) {
      rows += `<tr class="sep"><td>Impact vs centre</td><td>${fmt(Math.abs(r.missU * 100), 0)} cm ${r.missU >= 0 ? 'R' : 'L'}, ${fmt(Math.abs(r.missV * 100), 0)} cm ${r.missV >= 0 ? 'high' : 'low'}</td></tr>
      <tr><td>Correction</td><td>${ud(-m(r.missV))} · ${lr(-m(r.missU))} mil</td></tr>`;
    }
    rows += '</table>';
  }
  el.innerHTML = rows;
}

function buildDopeCard() {
  const r = S.rifle, env = S.mission.env;
  const da = densityAltitude(S.atm.rho);
  let html = `<div class="dh">${r.name} · ${r.load} · MV ${fmt(S.mv0, 0)} m/s · G7 ${r.bcG7} · ${r.zero} m zero · DA ${fmt(da, 0)} m · ${fmt(env.tempC, 0)}°C</div>
    <table><tr><th>m</th><th>Elev mil</th><th>Wind 1 m/s</th><th>Spin</th><th>TOF s</th><th>m/s</th><th>J</th></tr>`;
  for (const d of S.dope) {
    if (d.range % 100 && d.range > 1000) continue;
    const trans = d.mach < 1.2 ? ' class="trans"' : '';
    html += `<tr${trans}><td>${d.range}</td><td>${fmt(d.elev, 1)}</td><td>${fmt(d.wind1, 2)}</td><td>${fmt(d.spin, 2)}</td><td>${fmt(d.tof, 2)}</td><td>${fmt(d.vel, 0)}</td><td>${fmt(d.energy, 0)}</td></tr>`;
  }
  html += '</table><div class="dn">Level fire, no wind. Wind column = hold per 1 m/s full-value crosswind. Spin = hold left. Shaded = transonic.</div>';
  $('dope').innerHTML = html;
}

let hudTimer = 0;
function updateHud(dt) {
  hudTimer -= dt;
  const b = S.breath;
  $('breathFill').style.width = `${b.oxygen * 100}%`;
  $('breathFill').className = b.holding ? 'holding' : b.oxygen < 0.3 ? 'low' : '';
  if (hudTimer > 0) return;
  hudTimer = 0.12;
  const env = S.mission.env;
  const w = S.wind.sample(0, 0, S.time);
  const kw = w.speed * shearFactor(1.5);
  $('kestrel').innerHTML = `
    <div><span>WIND</span>${fmt(kw, 1)} m/s @ ${clockString(w.dir)}</div>
    <div><span>TEMP</span>${fmt(env.tempC, 1)} °C</div>
    <div><span>BARO</span>${fmt(S.pressure, 0)} hPa</div>
    <div><span>RH</span>${fmt(env.humidity * 100, 0)} %</div>
    <div><span>DA</span>${fmt(densityAltitude(S.atm.rho), 0)} m</div>
    <div><span>LAT/AZ</span>${env.latitude}° / ${env.azimuth}°</div>`;
  const e = S.turretE / 10, wd = S.turretW / 10;
  $('turrets').innerHTML = `
    <div><span>ELEV</span>${e >= 0 ? 'U' : 'D'} ${Math.abs(e).toFixed(1)} mil</div>
    <div><span>WIND</span>${wd >= 0 ? 'R' : 'L'} ${Math.abs(wd).toFixed(1)} mil</div>
    <div><span>ZOOM</span>${S.scoped ? S.mag.toFixed(1) + '×' : 'eye'}</div>
    <div><span>CANT</span>${S.cant >= 0 ? '+' : ''}${S.cant.toFixed(2)}°</div>
    <div><span>BARREL</span>${fmt(20 + S.barrelHeat, 0)} °C</div>`;
  const hits = S.shots.filter((s) => s.points > 0).length;
  const score = S.shots.reduce((a, s) => a + (s.points || 0), 0);
  const ready = S.time - S.lastShot >= S.rifle.cycle;
  $('status').innerHTML = `
    <div><span>ROUNDS</span>${S.roundsLeft}/${S.mission.rounds} ${ready || S.roundsLeft === 0 ? '' : '<i>cycling</i>'}</div>
    <div><span>TARGETS</span>${S.targets.filter((t) => t.hits > 0).length}/${S.targets.length}</div>
    <div><span>HITS</span>${hits}/${S.shots.length}</div>
    <div><span>SCORE</span>${score}</div>`;
}

// ---------- flags ----------
function updateFlags() {
  for (const f of S.flags) {
    const w = S.wind.sample(f.x, f.z, S.time);
    const s = w.speed * shearFactor(3.9);
    f.head.rotation.y = Math.atan2(-w.z, w.x);
    const lift = Math.min(1, s / 9);
    f.pivot.rotation.z = -(1 - lift) * 1.45;
    const pos = f.geo.attributes.position.array, base = f.base;
    const amp = 0.05 + 0.12 * Math.min(1, s / 5);
    const speed = 4 + s * 1.3;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      pos[i + 2] = amp * Math.sin(x * 4.5 - S.time * speed + f.phase) * (x / FLAG_W);
    }
    f.geo.attributes.position.needsUpdate = true;
  }
}

// ---------- rangefinder ----------
const ray = new THREE.Raycaster();
function laser() {
  camera.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  ray.far = 3000 * (1 - 0.6 * S.mission.env.rain);
  const objs = [S.terrainMesh, ...S.targets.map((t) => t.group)];
  const hit = ray.intersectObjects(objs, true)[0];
  const rain = S.mission.env.rain;
  const ang = (S.pitch * 180) / Math.PI;
  if (!hit || (rain > 0.4 && S.rng() < rain * 0.3)) S.lrf = `--- m   ${ang.toFixed(1)}°`;
  else S.lrf = `${Math.round(hit.distance + gauss(S.rng) * 0.5)} m   ${ang >= 0 ? '+' : ''}${ang.toFixed(1)}°`;
  S.lrfUntil = S.time + 6;
  sound.click();
}

// ---------- end / summary ----------
function checkEnd() {
  if (S.endAt == null) {
    const allDown = S.targets.every((t) => t.hits > 0);
    if ((S.roundsLeft <= 0 || allDown) && S.inflight.length === 0) S.endAt = S.time + 2.5;
  } else if (S.time >= S.endAt) {
    showSummary();
  }
}

function showSummary() {
  S.playing = false;
  document.exitPointerLock?.();
  const shots = S.shots;
  const hits = shots.filter((s) => s.points > 0).length;
  const score = shots.reduce((a, s) => a + (s.points || 0), 0);
  const max = S.targets.length * 10;
  let html = `<h2>${S.mission.name}</h2>
    <div class="big"><div><b>${score}</b><span>score / ${max}</span></div>
    <div><b>${S.targets.filter((t) => t.hits > 0).length}/${S.targets.length}</b><span>targets</span></div>
    <div><b>${shots.length ? Math.round((hits / shots.length) * 100) : 0}%</b><span>hit rate</span></div></div>
    <table><tr><th>#</th><th>Range</th><th>Result</th><th>Miss</th><th>TOF</th><th>Wind drift</th></tr>`;
  for (const s of shots) {
    const miss = s.missU != null ? `${fmt(Math.hypot(s.missU, s.missV) * 100, 0)} cm` : '—';
    html += `<tr><td>${s.n}</td><td>${fmt(s.range, 0)} m</td><td>${s.points > 0 ? 'HIT ' + s.points : 'miss'}</td><td>${miss}</td><td>${fmt(s.tof, 2)} s</td><td>${s.windH != null ? fmt(Math.abs(s.windH) * 100, 0) + ' cm' : '—'}</td></tr>`;
  }
  html += `</table><div class="btns"><button id="again">Retry</button><button id="toMenu">Missions</button></div>`;
  $('summaryBody').innerHTML = html;
  $('hud').classList.add('hidden');
  $('summary').classList.remove('hidden');
  $('again').onclick = () => { $('summary').classList.add('hidden'); launch(); };
  $('toMenu').onclick = () => { $('summary').classList.add('hidden'); showMenu(); };
}

// ---------- input ----------
const keys = new Set();
// Pointer lock can be refused (embedded views); fall back to plain mouse movement.
function lockPointer() {
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { S.noLock = true; S.paused = false; $('pause').classList.add('hidden'); });
  } catch { S.noLock = true; }
}
canvas.addEventListener('click', () => { if (S.playing && !document.pointerLockElement && !S.noLock) lockPointer(); });
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) { S.paused = false; $('pause').classList.add('hidden'); }
  else if (S.playing) { S.paused = true; S.breath.holding = false; $('pause').classList.remove('hidden'); }
});
document.addEventListener('mousemove', (e) => {
  if (!S.playing || S.paused) return;
  const k = S.sens / focalCss();
  S.yaw -= e.movementX * k;
  S.pitch = Math.max(-1.2, Math.min(1.2, S.pitch - e.movementY * k));
  S.mouseSpeed += Math.hypot(e.movementX, e.movementY) * 8;
});
document.addEventListener('mousedown', (e) => {
  if (!S.playing || S.paused || (document.pointerLockElement !== canvas && !S.noLock)) return;
  if (e.button === 0) fire();
  if (e.button === 2) S.scoped = !S.scoped;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (!S.playing || S.paused) return;
  S.mag = Math.max(5, Math.min(25, S.mag * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (!S.playing) return;
  if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(e.code)) e.preventDefault();
  if (e.code === 'Escape' && S.noLock) { S.paused = true; $('pause').classList.remove('hidden'); return; }
  if (S.paused) return;
  const step = e.ctrlKey ? 10 : 1;
  switch (e.code) {
    case 'ArrowUp': S.turretE = Math.min(400, S.turretE + step); sound.click(); break;
    case 'ArrowDown': S.turretE = Math.max(-50, S.turretE - step); sound.click(); break;
    case 'ArrowRight': S.turretW = Math.min(100, S.turretW + step); sound.click(); break;
    case 'ArrowLeft': S.turretW = Math.max(-100, S.turretW - step); sound.click(); break;
    case 'KeyX': S.turretE = 0; S.turretW = 0; sound.click(); break;
    case 'KeyQ': S.cant = Math.max(-10, S.cant - 0.25); break;
    case 'KeyE': S.cant = Math.min(10, S.cant + 0.25); break;
    case 'KeyZ': S.scoped = !S.scoped; break;
    case 'KeyF': laser(); break;
    case 'Tab': $('dope').classList.toggle('hidden'); break;
    case 'PageUp': case 'Equal': case 'NumpadAdd': S.mag = Math.min(25, S.mag + 1); break;
    case 'PageDown': case 'Minus': case 'NumpadSubtract': S.mag = Math.max(5, S.mag - 1); break;
    case 'ShiftLeft': case 'ShiftRight': case 'Space':
      if (!e.repeat && S.breath.oxygen > 0.15) S.breath.holding = true; break;
  }
});
document.addEventListener('keyup', (e) => {
  if (['ShiftLeft', 'ShiftRight', 'Space'].includes(e.code)) S.breath.holding = false;
});

// ---------- menu ----------
let selected = MISSIONS[0];
const custom = {
  rifle: '308', kind: 'silhouette', count: 4, minDist: 300, maxDist: 900, moveSpeed: 0,
  windSpeed: 4, windDir: 90, gust: 0.3, rain: 0, tempC: 15, altitude: 300, humidity: 0.5,
  slope: 0, latitude: 32, azimuth: 0, cant: 0,
};
const SLIDERS = [
  ['count', 'Targets', 1, 8, 1, ''], ['minDist', 'Nearest', 100, 2000, 25, 'm'], ['maxDist', 'Farthest', 100, 2500, 25, 'm'],
  ['moveSpeed', 'Target speed', 0, 12, 0.1, 'm/s'], ['windSpeed', 'Wind', 0, 15, 0.5, 'm/s'], ['windDir', 'Wind from', 0, 345, 15, '°'],
  ['gust', 'Gustiness', 0, 1, 0.05, ''], ['rain', 'Rain', 0, 1, 0.05, ''], ['tempC', 'Temperature', -25, 45, 1, '°C'],
  ['altitude', 'Altitude', 0, 4500, 50, 'm'], ['humidity', 'Humidity', 0, 1, 0.05, ''], ['slope', 'Slope', -0.5, 0.5, 0.02, ''],
  ['latitude', 'Latitude', -70, 70, 1, '°'], ['azimuth', 'Azimuth', 0, 355, 5, '°'], ['cant', 'Ground cant', -5, 5, 0.25, '°'],
];

function missionSummary(m) {
  const d = m.targets.map((t) => t.dist);
  const e = m.env;
  const moving = m.targets.some((t) => t.move);
  return `${Math.min(...d)}–${Math.max(...d)} m · wind ${e.wind.speed} m/s ${clockString(e.wind.dir)} · ${e.tempC}°C · ${e.altitude} m${e.rain ? ' · rain' : ''}${moving ? ' · moving' : ''}${m.terrain.slope ? (m.terrain.slope > 0 ? ' · uphill' : ' · downhill') : ''}`;
}

function renderMenu() {
  const list = $('missionList');
  list.innerHTML = '';
  for (const m of [...MISSIONS, { id: 'custom', name: 'Custom' }]) {
    const b = document.createElement('button');
    b.className = 'mission' + (selected.id === m.id ? ' sel' : '');
    b.innerHTML = `<b>${m.name}</b><small>${m.id === 'custom' ? 'Set every condition yourself' : missionSummary(m)}</small>`;
    b.onclick = () => {
      selected = m.id === 'custom' ? { id: 'custom', name: 'Custom' } : m;
      if (m.id !== 'custom') $('rifle').value = m.rifle;
      renderMenu();
    };
    list.appendChild(b);
  }
  const cp = $('customPanel');
  cp.classList.toggle('hidden', selected.id !== 'custom');
  if (selected.id === 'custom' && !cp.dataset.built) {
    cp.dataset.built = '1';
    let html = `<label>Target type <select id="c_kind"><option value="silhouette">Silhouette</option><option value="plate">Steel plate</option><option value="vehicle">Vehicle</option></select></label>`;
    for (const [k, label, min, max, step, unit] of SLIDERS) {
      html += `<label>${label} <input type="range" id="c_${k}" min="${min}" max="${max}" step="${step}" value="${custom[k]}"><output id="o_${k}">${custom[k]}${unit}</output></label>`;
    }
    cp.innerHTML = html;
    $('c_kind').value = custom.kind;
    $('c_kind').onchange = (e) => (custom.kind = e.target.value);
    for (const [k, , , , , unit] of SLIDERS) {
      $(`c_${k}`).oninput = (e) => { custom[k] = +e.target.value; $(`o_${k}`).textContent = custom[k] + unit; };
    }
  }
}

function showMenu() {
  S.playing = false;
  $('hud').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  renderMenu();
}

function launch() {
  sound.init();
  const rifleId = $('rifle').value;
  let m = selected;
  if (m.id === 'custom') {
    custom.rifle = rifleId;
    if (custom.maxDist < custom.minDist) custom.maxDist = custom.minDist;
    m = customMission(custom);
  }
  S.sens = +$('sens').value;
  startMission(m, rifleId);
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  S.playing = true;
  S.paused = false;
  lockPointer();
}

const rs = $('rifle');
for (const [id, r] of Object.entries(RIFLES)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = `${r.name} — ${r.load}`;
  rs.appendChild(o);
}
rs.value = selected.rifle;
$('start').onclick = launch;
$('resume').onclick = () => lockPointer();
$('restart').onclick = () => { $('pause').classList.add('hidden'); launch(); };
$('quit').onclick = () => showMenu();

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mission) {
    if (S.playing && !S.paused) {
      S.time += dt;
      S.mouseSpeed *= Math.exp(-dt * 10);
      S.barrelHeat *= Math.exp(-dt / 150);
      updateInflight();
      checkEnd();
      updateHud(dt);
    }
    const sway = (S.sway = S.playing ? updateBody(S.paused ? 0 : dt) : { p: 0, y: 0 });
    camera.position.copy(S.eye);
    camera.rotation.set(S.pitch + sway.p, S.yaw + sway.y, 0);
    applyFov();
    for (const t of S.targets) t.update(S.time);
    updateFlags();
    const w = S.wind.sample(0, -60, S.time);
    const cam = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), S.yaw);
    const crossWind = w.x * cam.x + w.z * cam.z;
    sound.ambient(S.playing ? S.mission.env.rain : 0, S.playing ? w.speed : 0);
    if (S.lrf && S.time > S.lrfUntil) S.lrf = null;
    const scoped = S.playing && S.scoped;
    const f = focalCss();
    drawOverlay(octx, overlay.width, overlay.height, {
      dpr, scoped, rain: S.mission.env.rain, crossWind,
      R: scopeRadiusCss() * dpr, pxPerMil: f * dpr / 1000, cant: S.cant, lrf: S.lrf,
    }, dt);
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// background scene behind the menu
startMission(MISSIONS[1], '308');
S.scoped = false;
showMenu();
requestAnimationFrame(frame);
window.__sim = { S, fire, laser, startMission, MISSIONS, camera }; // console access for debugging
