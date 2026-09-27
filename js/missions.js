// Scenario definitions. wind.dir = where the wind comes FROM, clockwise from downrange (deg).
const walk = (speed, span, pause = 1.5) => ({ speed, span, pause });

export const MISSIONS = [
  {
    id: 'zero', name: 'Zero Check', rifle: '308', rounds: 6,
    env: { tempC: 15, altitude: 50, humidity: 0.5, wind: { speed: 0.5, dir: 90, gust: 0.1 }, rain: 0, latitude: 32, azimuth: 0, cant: 0, palette: 'grass', sky: 'clear' },
    terrain: { slope: 0, hills: 0.6 },
    targets: [
      { kind: 'plate', dist: 100, x: -1.5, size: 0.2 },
      { kind: 'plate', dist: 100, x: 0, size: 0.2 },
      { kind: 'plate', dist: 100, x: 1.5, size: 0.2 },
    ],
  },
  {
    id: 'kd', name: 'Known Distance', rifle: '308', rounds: 10,
    env: { tempC: 22, altitude: 200, humidity: 0.45, wind: { speed: 3, dir: 60, gust: 0.25 }, rain: 0, latitude: 32, azimuth: 20, cant: 0, palette: 'grass', sky: 'clear' },
    terrain: { slope: 0, hills: 1 },
    targets: [
      { kind: 'plate', dist: 300, x: -4, size: 0.4 },
      { kind: 'plate', dist: 500, x: 3, size: 0.5 },
      { kind: 'plate', dist: 700, x: -6, size: 0.6 },
      { kind: 'plate', dist: 900, x: 8, size: 0.6 },
    ],
  },
  {
    id: 'valley', name: 'Crosswind Valley', rifle: '65cm', rounds: 12,
    env: { tempC: 26, altitude: 400, humidity: 0.3, wind: { speed: 7, dir: 270, gust: 0.5 }, rain: 0, latitude: 31, azimuth: 110, cant: 1.5, palette: 'desert', sky: 'clear' },
    terrain: { slope: 0, hills: 1.4 },
    targets: [
      { kind: 'human', dist: 450, x: -10 },
      { kind: 'human', dist: 620, x: 12 },
      { kind: 'human', dist: 780, x: -18 },
      { kind: 'human', dist: 940, x: 20 },
    ],
  },
  {
    id: 'movers', name: 'Movers', rifle: '65cm', rounds: 14,
    env: { tempC: 18, altitude: 150, humidity: 0.55, wind: { speed: 2, dir: 30, gust: 0.3 }, rain: 0, latitude: 33, azimuth: 350, cant: 0, palette: 'grass', sky: 'clear' },
    terrain: { slope: 0, hills: 1 },
    targets: [
      { kind: 'human', dist: 350, x: 0, move: walk(1.4, 18) },
      { kind: 'human', dist: 500, x: -8, move: walk(1.4, 24, 2.5) },
      { kind: 'human', dist: 600, x: 10, move: walk(3.2, 30, 1) },
      { kind: 'human', dist: 720, x: -4, move: walk(1.2, 20, 3) },
    ],
  },
  {
    id: 'downhill', name: 'Mountain Downhill', rifle: '308', rounds: 10,
    env: { tempC: -8, altitude: 2800, humidity: 0.6, wind: { speed: 4, dir: 120, gust: 0.4 }, rain: 0, latitude: 42, azimuth: 200, cant: -2, palette: 'snow', sky: 'clear' },
    terrain: { slope: -0.38, hills: 1.6 },
    targets: [
      { kind: 'human', dist: 380, x: -6 },
      { kind: 'plate', dist: 560, x: 9, size: 0.5 },
      { kind: 'human', dist: 720, x: -12 },
      { kind: 'plate', dist: 850, x: 4, size: 0.6 },
    ],
  },
  {
    id: 'uphill', name: 'Ridge Line Uphill', rifle: '65cm', rounds: 10,
    env: { tempC: 8, altitude: 1600, humidity: 0.5, wind: { speed: 5, dir: 240, gust: 0.45 }, rain: 0, latitude: 46, azimuth: 30, cant: 2, palette: 'grass', sky: 'clear' },
    terrain: { slope: 0.3, hills: 1.5 },
    targets: [
      { kind: 'plate', dist: 400, x: 5, size: 0.4 },
      { kind: 'human', dist: 600, x: -9 },
      { kind: 'plate', dist: 780, x: 12, size: 0.6 },
      { kind: 'human', dist: 900, x: -3 },
    ],
  },
  {
    id: 'storm', name: 'Storm', rifle: '308', rounds: 12,
    env: { tempC: 9, altitude: 300, humidity: 1, wind: { speed: 6.5, dir: 130, gust: 0.75 }, rain: 0.85, latitude: 52, azimuth: 250, cant: 0, palette: 'wet', sky: 'storm' },
    terrain: { slope: 0, hills: 1 },
    targets: [
      { kind: 'human', dist: 350, x: 6 },
      { kind: 'human', dist: 480, x: -9, move: walk(1.3, 14, 2) },
      { kind: 'plate', dist: 620, x: 11, size: 0.6 },
      { kind: 'human', dist: 750, x: -2 },
    ],
  },
  {
    id: 'convoy', name: 'Convoy', rifle: '50', rounds: 10,
    env: { tempC: 30, altitude: 600, humidity: 0.2, wind: { speed: 3.5, dir: 300, gust: 0.35 }, rain: 0, latitude: 30, azimuth: 80, cant: 0, palette: 'desert', sky: 'clear' },
    terrain: { slope: 0, hills: 1.2 },
    targets: [
      { kind: 'vehicle', dist: 550, x: 0, move: walk(8, 160, 3) },
      { kind: 'vehicle', dist: 720, x: 20, move: walk(11, 200, 4) },
      { kind: 'vehicle', dist: 900, x: -15, move: walk(6, 180, 5) },
    ],
  },
  {
    id: 'elr', name: 'Extreme Range', rifle: '338', rounds: 14,
    env: { tempC: 31, altitude: 900, humidity: 0.25, wind: { speed: 4, dir: 300, gust: 0.3 }, rain: 0, latitude: 60, azimuth: 90, cant: 1, palette: 'desert', sky: 'clear' },
    terrain: { slope: 0, hills: 1.2 },
    targets: [
      { kind: 'plate', dist: 1200, x: -10, size: 0.8 },
      { kind: 'plate', dist: 1500, x: 14, size: 1.0 },
      { kind: 'plate', dist: 1800, x: -22, size: 1.2 },
      { kind: 'plate', dist: 2100, x: 30, size: 1.4 },
    ],
  },
];

export function customMission(c) {
  const n = Math.max(1, Math.round(c.count));
  const targets = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const dist = Math.round(c.minDist + (c.maxDist - c.minDist) * f);
    const x = (i % 2 ? 1 : -1) * (4 + i * 3);
    const t = { kind: c.kind, dist, x };
    if (c.kind === 'plate') t.size = Math.max(0.3, Math.round(dist / 1500 * 10) / 10);
    if (c.moveSpeed > 0) t.move = walk(c.moveSpeed, Math.max(12, c.moveSpeed * 10), 1.5);
    targets.push(t);
  }
  return {
    id: 'custom', name: 'Custom', rifle: c.rifle, rounds: n * 3,
    env: {
      tempC: c.tempC, altitude: c.altitude, humidity: c.rain > 0.3 ? 1 : c.humidity,
      wind: { speed: c.windSpeed, dir: c.windDir, gust: c.gust }, rain: c.rain,
      latitude: c.latitude, azimuth: c.azimuth, cant: c.cant,
      palette: c.tempC < 0 ? 'snow' : c.rain > 0.3 ? 'wet' : 'grass', sky: c.rain > 0.3 ? 'storm' : 'clear',
    },
    terrain: { slope: c.slope, hills: 1.2 },
    targets,
  };
}
