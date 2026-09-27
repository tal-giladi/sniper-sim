// Sanity checks against published data. Run: node test/ballistics.test.mjs
import {
  RIFLES, atmosphere, zeroAngle, dopeTable, simulate, sampleAtRange, earthRotation, stability,
} from '../js/ballistics.js';

let fails = 0;
const check = (name, value, lo, hi) => {
  const ok = value >= lo && value <= hi;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value.toFixed(3)} (expected ${lo}..${hi})`);
};

const std = atmosphere(15, 1013.25, 0.5);
check('air density ISA', std.rho, 1.215, 1.226);

// .308 175 SMK @ 792 m/s, 100 m zero
{
  const r = RIFLES['308'];
  const z = zeroAngle(r, std, r.mv);
  const d = dopeTable(r, std, r.mv, z, [300, 600, 900, 1000]);
  const at = (R) => d.find((x) => x.range === R);
  check('.308 elev 300 m (mil)', at(300).elev, 1.4, 1.9);
  check('.308 elev 600 m (mil)', at(600).elev, 4.8, 5.8);
  check('.308 elev 900 m (mil)', at(900).elev, 10.0, 11.8);
  check('.308 wind 1 m/s @ 600 m (mil)', at(600).wind1, 0.28, 0.42);
  check('.308 velocity 1000 m (m/s)', at(1000).vel, 300, 360);
}

// 6.5 CM 140 ELD-M 823 m/s (Hornady: ~30 MOA at 1000 yd)
{
  const r = RIFLES['65cm'];
  const z = zeroAngle(r, std, r.mv);
  const d = dopeTable(r, std, r.mv, z, [1000, 914.4]);
  check('6.5CM elev 1000 m (mil)', d[0].elev, 9.4, 10.8);
  check('6.5CM elev 1000 yd (mil, Hornady ~8.7)', d[1].elev, 8.2, 9.2);
  check('6.5CM TOF 1000 m (s)', d[0].tof, 1.5, 1.8);
}

// Coriolis: shooting east at 45N lifts the bullet (Eötvös)
{
  const r = RIFLES['338'];
  const base = { bcG7: r.bcG7, atm: std, origin: [0, 0, 0], dir: [0, 0.01, -1], mv: r.mv, maxRange: 1600 };
  const a = sampleAtRange(simulate(base).path, 0, 0, 0, -1, 1500);
  const b = sampleAtRange(simulate({ ...base, omega: earthRotation(45, 90) }).path, 0, 0, 0, -1, 1500);
  check('Eötvös lift east 1500 m (cm)', (b.y - a.y) * 100, 5, 30);
  const n = sampleAtRange(simulate({ ...base, omega: earthRotation(45, 0) }).path, 0, 0, 0, -1, 1500);
  check('Coriolis right shooting north 1500 m (cm)', (n.x - a.x) * 100, 5, 30);
}

check('.308 Sg', stability(RIFLES['308'], 792, std), 1.5, 2.8);

if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('all passed');
