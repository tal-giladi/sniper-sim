// Point-mass (3-DOF) external ballistics with G7 drag, real atmosphere,
// wind, Coriolis/Eötvös, spin drift (Litz) and aerodynamic jump.
// World frame: +x = right of the range, +y = up, -z = downrange.

import { gauss } from './noise.js';

export const GRAV = 9.80665;
export const GRAIN = 6.479891e-5;          // kg
export const LBIN2 = 703.06958;            // lb/in^2 -> kg/m^2
export const EARTH_OMEGA = 7.2921159e-5;   // rad/s
export const MOA = 2.908882e-4;            // rad

// Standard G7 drag function (Mach, Cd)
const G7 = [
  [0.00, 0.1198], [0.05, 0.1197], [0.10, 0.1196], [0.15, 0.1194], [0.20, 0.1193],
  [0.25, 0.1194], [0.30, 0.1194], [0.35, 0.1194], [0.40, 0.1193], [0.45, 0.1193],
  [0.50, 0.1194], [0.55, 0.1193], [0.60, 0.1194], [0.65, 0.1197], [0.70, 0.1202],
  [0.725, 0.1207], [0.75, 0.1215], [0.775, 0.1226], [0.80, 0.1242], [0.825, 0.1266],
  [0.85, 0.1306], [0.875, 0.1368], [0.90, 0.1464], [0.925, 0.1660], [0.95, 0.2054],
  [0.975, 0.2993], [1.00, 0.3803], [1.025, 0.4015], [1.05, 0.4043], [1.075, 0.4034],
  [1.10, 0.4014], [1.125, 0.3987], [1.15, 0.3955], [1.20, 0.3884], [1.25, 0.3810],
  [1.30, 0.3732], [1.35, 0.3657], [1.40, 0.3580], [1.50, 0.3440], [1.55, 0.3376],
  [1.60, 0.3315], [1.65, 0.3260], [1.70, 0.3209], [1.75, 0.3160], [1.80, 0.3117],
  [1.85, 0.3078], [1.90, 0.3042], [1.95, 0.3010], [2.00, 0.2980], [2.05, 0.2951],
  [2.10, 0.2922], [2.15, 0.2892], [2.20, 0.2864], [2.25, 0.2835], [2.30, 0.2807],
  [2.35, 0.2779], [2.40, 0.2752], [2.45, 0.2725], [2.50, 0.2697], [2.55, 0.2670],
  [2.60, 0.2643], [2.65, 0.2615], [2.70, 0.2588], [2.75, 0.2561], [2.80, 0.2533],
  [2.85, 0.2506], [2.90, 0.2479], [2.95, 0.2451], [3.00, 0.2424], [3.10, 0.2368],
  [3.20, 0.2313], [3.30, 0.2258], [3.40, 0.2205], [3.50, 0.2154], [3.60, 0.2106],
  [3.70, 0.2060], [3.80, 0.2017], [3.90, 0.1975], [4.00, 0.1935], [4.20, 0.1861],
  [4.40, 0.1793], [4.60, 0.1730], [4.80, 0.1672], [5.00, 0.1618],
];

export function cdG7(mach) {
  if (mach <= 0) return G7[0][1];
  const n = G7.length;
  if (mach >= G7[n - 1][0]) return G7[n - 1][1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (G7[mid][0] > mach) hi = mid; else lo = mid;
  }
  const [m0, c0] = G7[lo], [m1, c1] = G7[hi];
  return c0 + (c1 - c0) * (mach - m0) / (m1 - m0);
}

export const RIFLES = {
  '65cm': {
    name: '6.5 Creedmoor', load: '140 gr ELD-M', caliberIn: 0.264, massGr: 140, lengthIn: 1.37,
    bcG7: 0.326, mv: 823, twistIn: 8, sightHeight: 0.05, zero: 100,
    precisionMoa: 0.5, mvSd: 3, tempSens: 0.45, recoil: 0.7, cycle: 1.1,
  },
  '308': {
    name: '.308 Winchester', load: '175 gr SMK', caliberIn: 0.308, massGr: 175, lengthIn: 1.24,
    bcG7: 0.243, mv: 792, twistIn: 10, sightHeight: 0.05, zero: 100,
    precisionMoa: 0.6, mvSd: 3.5, tempSens: 0.55, recoil: 1.0, cycle: 1.2,
  },
  '338': {
    name: '.338 Lapua Magnum', load: '250 gr Scenar', caliberIn: 0.338, massGr: 250, lengthIn: 1.53,
    bcG7: 0.314, mv: 900, twistIn: 10, sightHeight: 0.055, zero: 100,
    precisionMoa: 0.6, mvSd: 4, tempSens: 0.7, recoil: 1.6, cycle: 1.5,
  },
  '50': {
    name: '.50 BMG', load: '750 gr A-MAX', caliberIn: 0.510, massGr: 750, lengthIn: 2.31,
    bcG7: 0.52, mv: 860, twistIn: 15, sightHeight: 0.065, zero: 100,
    precisionMoa: 1.0, mvSd: 5, tempSens: 0.6, recoil: 2.0, cycle: 2.0,
  },
};

export function stationPressure(altitudeM, qnhHPa = 1013.25) {
  return qnhHPa * Math.pow(1 - 2.25577e-5 * altitudeM, 5.25588);
}

// humidity 0..1
export function atmosphere(tempC, pressureHPa, humidity) {
  const T = tempC + 273.15;
  const es = 6.1078 * Math.pow(10, (7.5 * tempC) / (tempC + 237.3)); // hPa
  const pv = humidity * es * 100;
  const pd = pressureHPa * 100 - pv;
  const rho = pd / (287.058 * T) + pv / (461.495 * T);
  const sos = 331.3 * Math.sqrt(1 + tempC / 273.15);
  return { tempC, pressureHPa, humidity, rho, sos };
}

export function densityAltitude(rho) {
  return (1 - Math.pow(rho / 1.225, 1 / 4.2559)) / 2.25577e-5;
}

export function muzzleVelocity(rifle, tempC, barrelHeat = 0) {
  return rifle.mv + rifle.tempSens * (tempC - 15) + 0.02 * barrelHeat;
}

// Miller gyroscopic stability with velocity and atmosphere correction.
export function stability(rifle, mv, atm) {
  const d = rifle.caliberIn, l = rifle.lengthIn / d, t = rifle.twistIn / d;
  let sg = (30 * rifle.massGr) / (t * t * d * d * d * l * (1 + l * l));
  sg *= Math.cbrt(mv / 0.3048 / 2800);
  const tF = atm.tempC * 9 / 5 + 32, pIn = atm.pressureHPa * 0.02953;
  sg *= ((tF + 460) / 519) * (29.92 / pIn);
  return sg;
}

// Litz: vertical jump in MOA per mph of crosswind (right-hand twist).
export function aeroJumpCoef(rifle, sg) {
  return 0.01 * sg - 0.0024 * (rifle.lengthIn / rifle.caliberIn) + 0.032;
}

export function spinDriftCoef(sg) {
  return 1.25 * (sg + 1.2) * 0.0254; // metres * t^1.83
}

/**
 * Integrate a trajectory.
 * o: { bcG7, atm, origin[3], dir[3], mv, wind?(x,y,z,t)->[3], omega?[3],
 *      sg?, ajCoef?, rain?, rng?, ground?(x,z)->y, onStep?(prev,cur)->hit|null,
 *      dt?, maxTime?, maxRange? }
 * Returned path points include spin drift.
 */
export function simulate(o) {
  const { rho, sos } = o.atm;
  const kBase = (rho * Math.PI) / (8 * o.bcG7 * LBIN2);
  const dt = o.dt ?? 0.001, maxTime = o.maxTime ?? 8, maxRange = o.maxRange ?? 4000;
  const wind = o.wind, om = o.omega, ground = o.ground, rain = o.rain || 0;
  const rng = o.rng || Math.random;
  const dragMul = 1 + 0.015 * rain;
  const [ox, oy, oz] = o.origin;
  let [dx, dy, dz] = o.dir;
  const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
  let px = ox, py = oy, pz = oz;
  let vx = dx * o.mv, vy = dy * o.mv, vz = dz * o.mv;

  const hl = Math.hypot(dx, dz);
  const rx = -dz / hl, rz = dx / hl; // horizontal right of the bore
  const sdCoef = o.sg ? spinDriftCoef(o.sg) : 0;

  let jumpRad = 0;
  if (o.ajCoef && wind) {
    const w = wind(px, py, pz, 0);
    const cwMph = (w[0] * rx + w[2] * rz) * 2.23694; // wind blowing toward the right
    jumpRad = o.ajCoef * cwMph * MOA;
    let ux = -dy * dx, uy = 1 - dy * dy, uz = -dy * dz;
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    vx += ux * o.mv * jumpRad; vy += uy * o.mv * jumpRad; vz += uz * o.mv * jumpRad;
  }

  const a = [0, 0, 0], b = [0, 0, 0];
  const acc = (x, y, z, ux, uy, uz, t, out) => {
    let wx = 0, wy = 0, wz = 0;
    if (wind) { const w = wind(x, y, z, t); wx = w[0]; wy = w[1]; wz = w[2]; }
    const qx = ux - wx, qy = uy - wy, qz = uz - wz;
    const s = Math.hypot(qx, qy, qz);
    const k = kBase * cdG7(s / sos) * s * dragMul;
    let ax = -k * qx, ay = -k * qy - GRAV, az = -k * qz;
    if (om) {
      ax -= 2 * (om[1] * uz - om[2] * uy);
      ay -= 2 * (om[2] * ux - om[0] * uz);
      az -= 2 * (om[0] * uy - om[1] * ux);
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  };

  const path = [{ t: 0, x: px, y: py, z: pz, v: o.mv }];
  let t = 0, impact = null;
  while (t < maxTime) {
    acc(px, py, pz, vx, vy, vz, t, a);
    const h = dt * 0.5;
    const mx = px + vx * h, my = py + vy * h, mz = pz + vz * h;
    const mvx = vx + a[0] * h, mvy = vy + a[1] * h, mvz = vz + a[2] * h;
    acc(mx, my, mz, mvx, mvy, mvz, t + h, b);
    px += mvx * dt; py += mvy * dt; pz += mvz * dt;
    vx += b[0] * dt; vy += b[1] * dt; vz += b[2] * dt;
    t += dt;
    const speed = Math.hypot(vx, vy, vz);

    if (rain > 0 && rng() < rain * 0.05 * speed * dt) {
      // raindrop strike: tiny random momentum transfer
      vx += gauss(rng) * 0.012; vy += gauss(rng) * 0.012; vz += gauss(rng) * 0.012;
    }

    const sd = sdCoef * Math.pow(t, 1.83);
    const cur = { t, x: px + rx * sd, y: py, z: pz + rz * sd, v: speed };
    const prev = path[path.length - 1];
    path.push(cur);

    if (o.onStep) {
      const hit = o.onStep(prev, cur);
      if (hit) {
        path[path.length - 1] = { t: hit.t, x: hit.x, y: hit.y, z: hit.z, v: speed };
        impact = { type: 'target', ...hit, speed }; // hit.v is the target-local height
        break;
      }
    }
    if (ground && t > 0.003) {
      const gy = ground(cur.x, cur.z);
      if (cur.y < gy) {
        const pgy = ground(prev.x, prev.z);
        const d0 = prev.y - pgy, d1 = cur.y - gy;
        const f = d0 > 0 ? d0 / (d0 - d1) : 0;
        const ip = {
          t: prev.t + (cur.t - prev.t) * f,
          x: prev.x + (cur.x - prev.x) * f,
          y: prev.y + (cur.y - prev.y) * f,
          z: prev.z + (cur.z - prev.z) * f,
          v: speed,
        };
        path[path.length - 1] = ip;
        impact = { type: 'ground', ...ip };
        break;
      }
    }
    if (Math.hypot(cur.x - ox, cur.z - oz) > maxRange || speed < 60) break;
  }
  return { path, impact, sdCoef, jumpRad };
}

// Interpolated path point whose horizontal projection on (dirX,dirZ) from (ox,oz) equals range.
export function sampleAtRange(path, ox, oz, dirX, dirZ, range) {
  const l = Math.hypot(dirX, dirZ); dirX /= l; dirZ /= l;
  const proj = (p) => (p.x - ox) * dirX + (p.z - oz) * dirZ;
  for (let i = 1; i < path.length; i++) {
    const r0 = proj(path[i - 1]), r1 = proj(path[i]);
    if (r0 <= range && r1 >= range) {
      const f = r1 === r0 ? 0 : (range - r0) / (r1 - r0);
      const p = path[i - 1], q = path[i];
      return {
        t: p.t + (q.t - p.t) * f, x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f,
        z: p.z + (q.z - p.z) * f, v: p.v + (q.v - p.v) * f,
      };
    }
  }
  return null;
}

// Bore elevation (rad) that puts the bullet on a level line of sight at the zero range.
export function zeroAngle(rifle, atm, mv) {
  const h = rifle.sightHeight, R = rifle.zero;
  const err = (ang) => {
    const r = simulate({ bcG7: rifle.bcG7, atm, origin: [0, 0, 0], dir: [0, Math.sin(ang), -Math.cos(ang)], mv, maxRange: R + 5, maxTime: 2 });
    return sampleAtRange(r.path, 0, 0, 0, -1, R).y - h;
  };
  let lo = -0.005, hi = 0.02;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (err(mid) < 0) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Level-fire data card: elevation hold, 1 m/s full-value wind hold, spin drift, TOF, velocity.
export function dopeTable(rifle, atm, mv, zeroAng, ranges) {
  const dir = [0, Math.sin(zeroAng), -Math.cos(zeroAng)];
  const maxRange = Math.max(...ranges) + 10;
  const sg = stability(rifle, mv, atm);
  const base = { bcG7: rifle.bcG7, atm, origin: [0, 0, 0], dir, mv, maxRange, maxTime: 12 };
  const a = simulate(base);
  const b = simulate({ ...base, wind: () => [-1, 0, 0] }); // 1 m/s from 3 o'clock
  const sdc = spinDriftCoef(sg);
  const m = rifle.massGr * GRAIN;
  return ranges.map((R) => {
    const p = sampleAtRange(a.path, 0, 0, 0, -1, R);
    const q = sampleAtRange(b.path, 0, 0, 0, -1, R);
    if (!p || !q) return null;
    return {
      range: R,
      elev: Math.atan2(rifle.sightHeight - p.y, R) * 1000,
      wind1: Math.atan2(-q.x, R) * 1000,
      spin: -(sdc * Math.pow(p.t, 1.83)) / R * 1000,
      tof: p.t,
      vel: p.v,
      energy: 0.5 * m * p.v * p.v,
      mach: p.v / atm.sos,
    };
  }).filter(Boolean);
}

// Earth rotation in world coordinates for latitude/azimuth (deg) of downrange.
export function earthRotation(latDeg, azDeg) {
  const phi = (latDeg * Math.PI) / 180, A = (azDeg * Math.PI) / 180;
  return [
    -EARTH_OMEGA * Math.cos(phi) * Math.sin(A),
    EARTH_OMEGA * Math.sin(phi),
    -EARTH_OMEGA * Math.cos(phi) * Math.cos(A),
  ];
}
