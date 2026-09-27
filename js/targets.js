import * as THREE from 'three';

// Target kinds and their scoring zones in target-local coords:
// u = metres to the right (as seen by the shooter), v = metres above the target base.
const KINDS = {
  plate: { center: 1.0 },
  silhouette: { center: 1.05 },
  vehicle: { center: 1.0 },
};

const mat = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });
const HOLE_MAT = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide });

export class Target {
  // def: { kind, dist, x, size, move: { speed, span, pause } }
  constructor(def, height, rng, id) {
    this.def = def;
    this.id = id;
    this.kind = def.kind;
    this.height = height;
    this.x0 = def.x || 0;
    this.z0 = -def.dist;
    this.size = def.size || (this.kind === 'plate' ? 0.5 : 1);
    this.move = def.move || null;
    this.phase = rng() * 100;
    this.hits = 0;
    this.down = false;
    this.downAt = 0;
    this.downPos = null;
    this.swing = 0;
    this.swingT = -10;
    this.facing = 1;
    this.group = new THREE.Group();
    this.build();
  }

  get center() { return this.kind === 'plate' ? 0.8 + this.size / 2 : KINDS[this.kind].center; }

  build() {
    const g = this.group;
    if (this.kind === 'plate') {
      const r = this.size / 2, c = this.center;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, c + r + 0.1, 0.07), mat(0x3a3a3a));
      post.position.set(0, (c + r + 0.1) / 2, -0.12);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(r * 2 + 0.3, 0.06, 0.06), mat(0x3a3a3a));
      bar.position.set(0, c + r + 0.1, -0.12);
      this.pivot = new THREE.Group();
      this.pivot.position.set(0, c + r + 0.05, 0);
      this.face = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat(0xf2f2ee, { side: THREE.DoubleSide }));
      this.face.position.y = -r - 0.05;
      this.pivot.add(this.face);
      g.add(post, bar, this.pivot);
      this.faceOffsetV = c;
    } else if (this.kind === 'silhouette') {
      this.pivot = new THREE.Group();
      this.pivot.position.y = 0.55;
      const board = mat(0x9c8660, { side: THREE.DoubleSide });
      const torsoShape = new THREE.Shape();
      torsoShape.moveTo(-0.23, 0);
      torsoShape.lineTo(0.23, 0);
      torsoShape.lineTo(0.23, 0.62);
      torsoShape.quadraticCurveTo(0.23, 0.75, 0.1, 0.75);
      torsoShape.lineTo(-0.1, 0.75);
      torsoShape.quadraticCurveTo(-0.23, 0.75, -0.23, 0.62);
      torsoShape.lineTo(-0.23, 0);
      const torso = new THREE.Mesh(new THREE.ShapeGeometry(torsoShape), board);
      const head = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), board);
      head.position.y = 0.87;
      this.face = new THREE.Group();
      this.face.add(torso, head);
      this.pivot.add(this.face);
      const legMat = mat(0x4b3a28);
      for (const s of [-0.15, 0.15]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04), legMat);
        leg.position.set(s, 0.28, -0.02);
        g.add(leg);
      }
      g.add(this.pivot);
      this.faceOffsetV = 0.55;
    } else if (this.kind === 'vehicle') {
      this.pivot = new THREE.Group();
      const paint = mat(0x5d6150);
      const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 1.8), paint);
      body.position.y = 0.9;
      this.cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.6), paint);
      this.cabin.position.set(0.5, 1.8, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.4, 1.4), mat(0x1c2630));
      glass.position.set(0.5, 1.85, 0);
      this.glass = glass;
      const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
      wheelGeo.rotateX(Math.PI / 2);
      for (const wx of [-1.4, 1.4]) for (const wz of [-0.85, 0.85]) {
        const w = new THREE.Mesh(wheelGeo, mat(0x151515));
        w.position.set(wx, 0.42, wz);
        this.pivot.add(w);
      }
      this.pivot.add(body, this.cabin, glass);
      this.face = this.pivot;
      g.add(this.pivot);
      this.faceOffsetV = 0;
    }
    g.traverse((o) => { if (o.isMesh) o.userData.target = this; });
  }

  // Deterministic position at game time t (moving targets pace back and forth).
  posAt(t) {
    if (this.down && this.downPos && t >= this.downAt) return this.downPos;
    let x = this.x0;
    const m = this.move;
    if (m && m.speed > 0) {
      const leg = m.span / m.speed, pause = m.pause ?? 1.5;
      const period = 2 * (leg + pause);
      const ph = (((t + this.phase) % period) + period) % period;
      const a = this.x0 - m.span / 2;
      if (ph < pause) x = a;
      else if (ph < pause + leg) x = a + (ph - pause) * m.speed;
      else if (ph < 2 * pause + leg) x = a + m.span;
      else x = a + m.span - (ph - 2 * pause - leg) * m.speed;
    }
    const z = this.z0;
    return { x, y: this.height(x, z), z };
  }

  velocityAt(t) {
    const a = this.posAt(t - 0.05), b = this.posAt(t + 0.05);
    return (b.x - a.x) / 0.1;
  }

  // Score for local coords, 0 = outside the target.
  score(u, v) {
    if (this.kind === 'plate') {
      const r = this.size / 2, dv = v - this.center, d = Math.hypot(u, dv);
      if (d > r) return 0;
      return d < r / 3 ? 10 : 7;
    }
    if (this.kind === 'silhouette') {
      const dv = v - 0.55;
      if (Math.hypot(u, dv - 0.87) < 0.09) return 10;
      if (Math.abs(u) <= 0.23 && dv >= 0 && dv <= 0.75) {
        return Math.hypot(u, v - this.center) < 0.11 ? 10 : 5;
      }
      return 0;
    }
    if (this.kind === 'vehicle') {
      const cu = 0.5 * this.facing;
      if (Math.abs(u - cu) <= 0.9 && v >= 1.45 && v <= 2.15) return 10;
      if (Math.abs(u) <= 2.1 && v >= 0.1 && v <= 1.45) return 5;
      return 0;
    }
    return 0;
  }

  blocks(u, v, t) {
    if (this.kind === 'silhouette' && this.down && t >= this.downAt) return false;
    return this.score(u, v) > 0;
  }

  // Test a bullet path segment against the target plane (facing the shooter at the origin).
  testSegment(p0, p1, tAbs) {
    const c = this.posAt(tAbs);
    if (Math.abs(p1.z - c.z) > 25 && Math.abs(p0.z - c.z) > 25) return null;
    const l = Math.hypot(c.x, c.z);
    const nx = -c.x / l, nz = -c.z / l;
    const d0 = (p0.x - c.x) * nx + (p0.z - c.z) * nz;
    const d1 = (p1.x - c.x) * nx + (p1.z - c.z) * nz;
    if (!(d0 > 0 && d1 <= 0)) return null;
    const f = d0 / (d0 - d1);
    const x = p0.x + (p1.x - p0.x) * f, y = p0.y + (p1.y - p0.y) * f, z = p0.z + (p1.z - p0.z) * f;
    const u = (x - c.x) * nz - (z - c.z) * nx;
    const v = y - c.y;
    const t = p0.t + (p1.t - p0.t) * f;
    const inside = this.blocks(u, v, tAbs);
    const points = inside && !this.down ? this.score(u, v) : 0;
    return { u, v, x, y, z, t, inside, points, target: this };
  }

  onHit(u, v, points, t) {
    this.addHole(u, v);
    if (this.kind === 'plate') {
      this.swing = 0.25 + Math.min(0.5, points / 20);
      this.swingT = t;
    }
    if (points > 0 && !this.down) {
      this.hits++;
      if (this.kind !== 'plate') {
        this.downPos = this.posAt(t);
        this.down = true;
        this.downAt = t;
      } else {
        this.down = true;
        this.downAt = t;
        this.face.material = this.face.material.clone();
        this.face.material.color.setHex(0xd8b07a);
      }
    }
  }

  addHole(u, v) {
    const hole = new THREE.Mesh(new THREE.CircleGeometry(this.kind === 'vehicle' ? 0.05 : 0.025, 10), HOLE_MAT);
    if (this.kind === 'plate') {
      hole.position.set(u, v - this.center, 0.004);
      this.face.add(hole);
    } else if (this.kind === 'silhouette') {
      hole.position.set(u, v - 0.55, 0.004);
      this.face.add(hole);
    } else {
      const g = this.group;
      hole.position.set(u, v, 0.92);
      g.add(hole);
      hole.userData.worldHole = true;
    }
  }

  update(t) {
    const p = this.posAt(t);
    this.group.position.set(p.x, p.y, p.z);
    const l = Math.hypot(p.x, p.z);
    this.group.rotation.y = Math.atan2(-p.x / l, -p.z / l);
    if (this.kind === 'vehicle') {
      const vx = this.move ? this.velocityAt(t) : 0;
      if (Math.abs(vx) > 0.1 && !this.down) this.facing = Math.sign(vx);
      this.cabin.position.x = 0.5 * this.facing;
      this.glass.position.x = 0.5 * this.facing;
      if (this.down) this.pivot.rotation.z = 0;
    }
    if (this.kind === 'plate') {
      const dt = t - this.swingT;
      this.pivot.rotation.x = dt >= 0 && dt < 6 ? -this.swing * Math.exp(-dt * 1.2) * Math.sin(dt * 7.5) : 0;
    }
    if (this.kind === 'silhouette') {
      const dt = this.down ? t - this.downAt : -1;
      this.pivot.rotation.x = dt > 0 ? -(Math.min(1, dt / 0.45) ** 2) * (Math.PI / 2) : 0;
    }
  }
}
