// 2D overlay: first-focal-plane MIL reticle, scope tube mask, level bubble, rain streaks.

const drops = [];
const lensDrops = [];

function updateRain(W, H, dt, rain, crossWind, scoped) {
  const target = Math.round(rain * (scoped ? 90 : 260));
  while (drops.length < target) drops.push({ x: Math.random() * W, y: Math.random() * H, s: 0.6 + Math.random() * 0.8 });
  drops.length = Math.min(drops.length, target);
  const fall = H * (scoped ? 4 : 2.2);
  for (const d of drops) {
    d.y += fall * d.s * dt;
    d.x += -crossWind * 40 * d.s * dt * (scoped ? 3 : 1);
    if (d.y > H + 40) { d.y = -40; d.x = Math.random() * W; }
    if (d.x < -40) d.x = W + 30; else if (d.x > W + 40) d.x = -30;
  }
  const lensTarget = scoped ? Math.round(rain * 14) : 0;
  while (lensDrops.length < lensTarget) lensDrops.push({ x: Math.random(), y: Math.random(), r: 4 + Math.random() * 14, life: 2 + Math.random() * 6 });
  for (let i = lensDrops.length - 1; i >= 0; i--) {
    lensDrops[i].life -= dt;
    lensDrops[i].y += dt * 0.004;
    if (lensDrops[i].life <= 0 || lensDrops.length > lensTarget) lensDrops.splice(i, 1);
  }
}

function drawRain(ctx, W, H, crossWind, scoped, dpr) {
  ctx.save();
  ctx.strokeStyle = scoped ? 'rgba(210,220,235,0.18)' : 'rgba(200,210,225,0.35)';
  ctx.lineWidth = (scoped ? 3 : 1) * dpr;
  const len = (scoped ? 90 : 26) * dpr;
  const slant = -crossWind * 0.06 * (scoped ? 3 : 1);
  ctx.beginPath();
  for (const d of drops) {
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x + slant * len, d.y + len * d.s);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawOverlay(ctx, W, H, st, dt) {
  const dpr = st.dpr;
  ctx.clearRect(0, 0, W, H);
  updateRain(W, H, dt, st.rain, st.crossWind, st.scoped);
  if (st.rain > 0) drawRain(ctx, W, H, st.crossWind, st.scoped, dpr);
  const cx = W / 2, cy = H / 2;
  if (!st.scoped) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2); ctx.fill();
    return;
  }
  const R = st.R, k = st.pxPerMil;

  // lens rain drops
  for (const d of lensDrops) {
    const x = cx + (d.x - 0.5) * 2 * R, y = cy + (d.y - 0.5) * 2 * R;
    const g = ctx.createRadialGradient(x, y, 0, x, y, d.r * dpr);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, d.r * dpr, 0, Math.PI * 2); ctx.fill();
  }

  // reticle
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate((st.cant * Math.PI) / 180);
  ctx.strokeStyle = '#0b0b0b';
  ctx.fillStyle = '#0b0b0b';
  const lw = Math.max(1, 0.012 * k) ;
  ctx.lineWidth = Math.min(lw, 2.2 * dpr);

  // thick posts beyond 10 mil
  const post = 0.12 * k;
  ctx.fillRect(10 * k, -post / 2, R * 2, post);
  ctx.fillRect(-10 * k - R * 2, -post / 2, R * 2, post);
  ctx.fillRect(-post / 2, 12 * k, post, R * 2);
  ctx.fillRect(-post / 2, -6 * k - R * 2, post, R * 2);

  ctx.beginPath();
  ctx.moveTo(-10 * k, 0); ctx.lineTo(-0.05 * k, 0);
  ctx.moveTo(0.05 * k, 0); ctx.lineTo(10 * k, 0);
  ctx.moveTo(0, -6 * k); ctx.lineTo(0, -0.05 * k);
  ctx.moveTo(0, 0.05 * k); ctx.lineTo(0, 12 * k);
  const tick = (m, horizontal) => {
    const f = Math.round(m * 10);
    const len = f % 10 === 0 ? 0.3 : f % 5 === 0 ? 0.18 : 0.09;
    if (horizontal) { ctx.moveTo(m * k, -len * k); ctx.lineTo(m * k, len * k); }
    else { ctx.moveTo(-len * k, m * k); ctx.lineTo(len * k, m * k); }
  };
  for (let i = -100; i <= 100; i += (Math.abs(i) <= 30 ? 2 : 5)) if (i) tick(i / 10, true);
  for (let i = -60; i <= 120; i += (Math.abs(i) <= 30 ? 2 : 5)) if (i) tick(i / 10, false);
  ctx.stroke();

  // christmas-tree hold dots below the crosshair
  const dotR = Math.max(0.8 * dpr, 0.035 * k);
  for (let row = 2; row <= 11; row++) {
    const w = Math.min(row, 7);
    for (let c = -w; c <= w; c++) {
      if (c === 0) continue;
      ctx.beginPath(); ctx.arc(c * k, row * k, dotR, 0, Math.PI * 2); ctx.fill();
    }
  }
  // center dot
  ctx.beginPath(); ctx.arc(0, 0, Math.max(0.7 * dpr, 0.025 * k), 0, Math.PI * 2); ctx.fill();

  // numbers
  if (k > 18 * dpr) {
    ctx.font = `${Math.round(Math.min(0.28 * k, 14 * dpr))}px ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const m of [2, 4, 6, 8, 10]) {
      ctx.fillText(String(m), m * k, 0.4 * k);
      ctx.fillText(String(m), -m * k, 0.4 * k);
      ctx.fillText(String(m), 0.55 * k, m * k - 0.15 * k);
    }
  }
  ctx.restore();

  // tube mask + vignette
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  const vg = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = vg;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // anti-cant bubble level
  const bw = 110 * dpr, bh = 16 * dpr, by = cy + R + 26 * dpr;
  const onScreen = by + bh < H;
  const lx = cx - bw / 2, ly = onScreen ? by : cy + R - 60 * dpr;
  ctx.save();
  ctx.fillStyle = 'rgba(20,30,20,0.9)';
  ctx.strokeStyle = 'rgba(160,200,160,0.9)';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.roundRect(lx, ly, bw, bh, bh / 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 9 * dpr, ly); ctx.lineTo(cx - 9 * dpr, ly + bh); ctx.moveTo(cx + 9 * dpr, ly); ctx.lineTo(cx + 9 * dpr, ly + bh); ctx.stroke();
  const off = Math.max(-1, Math.min(1, -st.cant / 3)) * (bw / 2 - bh / 2);
  ctx.fillStyle = Math.abs(st.cant) < 0.3 ? '#8f8' : '#fd6';
  ctx.beginPath(); ctx.arc(cx + off, ly + bh / 2, bh / 2 - 2 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // laser rangefinder readout
  if (st.lrf) {
    ctx.save();
    ctx.font = `${Math.round(15 * dpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,70,50,0.95)';
    ctx.fillText(st.lrf, cx, cy + R * 0.72);
    ctx.restore();
  }
}
