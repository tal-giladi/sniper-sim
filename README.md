# Sniper Sim

A browser-based long-range shooting simulator. No story, no characters — just the physics of a hard shot.

**Play:** https://tal-giladi.github.io/sniper-sim/

## What the simulation models

| Effect | How |
|---|---|
| Drag | 3-DOF point-mass integration (RK2, 1 ms step) with the standard **G7** drag table and real bullet BCs |
| Atmosphere | Air density from temperature, station pressure (altitude) and humidity; speed of sound from temperature → Mach-dependent drag, transonic zone |
| Powder temperature | Muzzle velocity shifts with ambient temperature; shot-to-shot MV spread (SD) |
| Wind | Field that varies **along the range and over time** (gusts, direction shifts), with height shear (stronger aloft). Your Kestrel only reads the wind at your position — read the flags downrange |
| Aerodynamic jump | Vertical deflection from crosswind at the muzzle (Litz) |
| Spin drift | Gyroscopic drift from Miller stability factor (Litz) |
| Coriolis & Eötvös | Full Earth-rotation vector from latitude and shooting azimuth |
| Incline | Real 3D trajectory — uphill/downhill shots hit high/low relative to level-fire data |
| Moving targets | Targets keep moving during the bullet's time of flight; you must lead |
| Rain | Raindrop strikes randomly perturb the bullet, fog cuts visibility and laser rangefinder range |
| Rifle | Mechanical precision (MOA), barrel heat, cant error (keep the bubble level), recoil and bolt cycle |
| Shooter | Breathing sway, heartbeat, hold-breath with tremor as oxygen runs out, trigger jerk if you fire while moving the mouse |
| Optics | First-focal-plane MIL reticle with Christmas-tree holds, 5–25× zoom, 0.1 mil turret clicks |

Rifles: 6.5 Creedmoor 140 ELD-M, .308 Win 175 SMK, .338 Lapua 250 Scenar, .50 BMG 750 A-MAX.

After every shot a report breaks down gravity drop, wind drift, spin drift, Coriolis and target movement, plus the correction needed. Press **Tab** for a data card computed for the current atmosphere.

## Controls

| Key | Action |
|---|---|
| Mouse | Aim |
| Left click | Fire |
| Right click / Z | Scope in/out |
| Wheel | Magnification |
| ↑ ↓ | Elevation turret, 0.1 mil (Ctrl = 1 mil) |
| ← → | Windage turret, 0.1 mil |
| X | Turrets back to zero |
| Shift / Space | Hold breath |
| Q / E | Level the rifle (cant) |
| F | Laser rangefinder (distance and angle) |
| Tab | Ballistic data card |
| Esc | Pause |

## Run locally

No build step. Serve the folder with any static server:

```bash
npx http-server . -p 8123
```

Physics sanity tests (compare against published drop data):

```bash
node test/ballistics.test.mjs
```

## Code

- `js/ballistics.js` — drag, atmosphere, integrator, zeroing, data card, Coriolis
- `js/wind.js` — wind field
- `js/terrain.js` — terrain height function and meshes
- `js/targets.js` — plates, silhouettes, vehicles, motion and hit zones
- `js/missions.js` — scenarios
- `js/scope.js` — reticle and scope overlay
- `js/main.js` — game loop, input, HUD
