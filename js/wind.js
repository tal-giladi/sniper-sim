// Spatially and temporally varying wind field along the range.
// dirDeg = direction the wind comes FROM, clockwise from downrange (0 = 12 o'clock headwind,
// 90 = from 3 o'clock / right, 270 = from 9 o'clock / left).

import { noise1 } from './noise.js';

export class WindField {
  constructor({ speed = 0, dir = 90, gust = 0.2 }, seed = 1) {
    this.speed = speed;
    this.dir = dir;
    this.gust = gust;
    this.seed = seed;
  }

  // Wind at ground reference height (~3 m) at downrange coordinate z and time t.
  sample(x, z, t) {
    const d = -z, g = this.gust, s0 = this.seed;
    const gustFactor = 1
      + g * 0.55 * noise1(t * 0.11 + d * 0.0017 + x * 0.001, s0)
      + g * 0.25 * noise1(t * 0.55 + d * 0.005, s0 + 7);
    const speed = Math.max(0, this.speed * gustFactor);
    const dirDeg = this.dir + g * 30 * noise1(t * 0.06 + d * 0.0012, s0 + 13);
    const r = (dirDeg * Math.PI) / 180;
    return { x: -speed * Math.sin(r), y: 0, z: speed * Math.cos(r), speed, dir: dirDeg };
  }
}

// Wind shear with height above ground (power law, neutral atmosphere).
export function shearFactor(heightAboveGround) {
  const h = Math.max(0.5, heightAboveGround);
  return Math.min(1.9, Math.pow(h / 3, 0.15));
}

export function clockString(dirDeg) {
  const d = ((dirDeg % 360) + 360) % 360;
  let totalMin = Math.round((d / 30) * 60 / 15) * 15; // nearest quarter hour
  let h = Math.floor(totalMin / 60) % 12, m = totalMin % 60;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')}`;
}
