// Plain-language shot feedback: what went wrong and what to change next.
import { MOA } from './ballistics.js';

const ZONES = { head: 'headshot', neck: 'neck', chest: 'chest', torso: 'torso', arm: 'arm', leg: 'leg', centre: 'centre', edge: 'edge' };
const cm = (m) => Math.round(Math.abs(m) * 100);
const f2 = (v) => Math.abs(v).toFixed(2);
const lr = (v) => (v >= 0 ? 'right' : 'left');

export function coachTips(r, rifle) {
  const R = r.range, p = r.pre;
  const mil = (m) => (m / R) * 1000;
  const tips = []; // { w: importance, text }

  if (r.missU == null) {
    return { title: 'Shot fell short', good: false, lines: ['The bullet hit the ground before the target. You need a lot more elevation — check the range with F and the data card with Tab.'] };
  }
  const missU = mil(r.missU), missV = mil(r.missV);
  const dist = Math.hypot(r.missU, r.missV);

  let title, good = r.points > 0;
  if (good) title = `Hit — ${ZONES[r.zone] || 'target'}, ${cm(dist)} cm from centre`;
  else if (r.hit && !r.hitIntended) title = 'You hit a different target';
  else title = `Miss — ${cm(r.missU)} cm ${lr(r.missU)}, ${cm(r.missV)} cm ${r.missV >= 0 ? 'high' : 'low'}`;

  // ---- left / right ----
  const lead = r.move != null ? mil(r.move) : 0;
  const drift = r.windH != null ? r.windH + r.spin + r.corH : 0;
  const windNeed = -mil(drift);
  const hadH = mil(p.aimU) + p.dialW;
  const needH = hadH - missU;
  const onLine = good || Math.abs(missU) <= 0.15;
  if (Math.abs(lead) > 0.15 && onLine) {
    tips.push({ w: 0.2, text: `Good lead: the target moved ${Math.abs(r.move).toFixed(1)} m while the bullet flew.` });
  } else if (Math.abs(lead) > 0.15) {
    tips.push({ w: Math.abs(lead) * (Math.abs(missU) > 0.15 ? 1.2 : 0.3), text: `The target moved ${Math.abs(r.move).toFixed(1)} m ${lr(r.move)} during the ${r.tof.toFixed(2)} s flight. Lead it by about ${f2(lead)} mil ${lr(lead)}.` });
  }
  if (Math.abs(windNeed) > 0.1 && onLine) {
    tips.push({ w: 0.15, text: `Good wind call: the wind moved the bullet ${cm(drift)} cm and you corrected for it.` });
  } else if (Math.abs(windNeed) > 0.1) {
    tips.push({ w: Math.abs(windNeed) * (Math.abs(missU) > 0.15 ? 1.1 : 0.3), text: `Wind carried the bullet ${cm(drift)} cm ${lr(drift)}. Hold or dial ${f2(windNeed)} mil ${lr(windNeed)} into the wind.` });
  }
  if (Math.abs(missU) > 0.12) {
    tips.push({ w: Math.abs(missU) + 0.05, text: `Left/right: you held ${f2(hadH)} mil ${lr(hadH)}, this shot needed ${f2(needH)} mil ${lr(needH)} → move ${f2(missU)} mil ${lr(-missU)}.` });
  }
  if (Math.abs(p.cant) >= 0.5) {
    const shift = mil(p.cantShiftM);
    tips.push({ w: Math.max(0.35, Math.abs(shift)), text: `The rifle was tilted ${Math.abs(p.cant).toFixed(1)}°, which alone pushed the shot ${cm(p.cantShiftM)} cm ${lr(shift)}. Center the bubble with Q / E.` });
  }

  // ---- up / down ----
  const hadV = p.dialE + mil(p.aimV);
  const needV = hadV - missV;
  if (Math.abs(missV) > (good ? 0.2 : 0.12)) {
    tips.push({ w: Math.abs(missV) + 0.05, text: `Elevation: you had ${hadV.toFixed(1)} mil, this shot needed ${needV.toFixed(1)} mil → ${missV > 0 ? 'down' : 'up'} ${f2(missV)} mil (${Math.round(Math.abs(missV) * 10)} clicks).` });
    if (Math.abs(p.slopeDeg) > 5 && Math.abs(missV) > 0.2) {
      tips.push({ w: Math.abs(missV) * 0.9, text: `You are shooting ${Math.abs(p.slopeDeg).toFixed(0)}° ${p.slopeDeg > 0 ? 'uphill' : 'downhill'}. Gravity only works over the horizontal distance — use laser distance × cos(angle) on the data card.` });
    }
    const slant = R / Math.cos((p.slopeDeg * Math.PI) / 180);
    const lased = p.lase && p.lase.age < 60 && p.lase.dist && Math.abs(p.lase.dist - slant) / slant < 0.05;
    if (!lased && Math.abs(missV) > 0.3) {
      tips.push({ w: Math.abs(missV) * 0.8, text: 'Range the target with F first — at this distance a small range error means a big miss high or low.' });
    }
    if (r.vel && r.vel < 400 && Math.abs(missV) > 0.3) {
      tips.push({ w: 0.3, text: `The bullet arrived at ${Math.round(r.vel)} m/s, close to the speed of sound — drag changes fast here, expect more spread.` });
    }
  }

  // ---- fundamentals ----
  if (!p.holding && p.amp > 0.5) {
    tips.push({ w: 0.45, text: 'You fired while breathing, so the crosshair was moving. Hold Shift (or Space) and fire within about 4 seconds.' });
  } else if (p.holding && p.held > 5.5) {
    tips.push({ w: 0.4, text: `You held your breath ${p.held.toFixed(0)} s and started to shake. Breathe, then hold again and fire sooner.` });
  }
  if (p.mouse > 250) tips.push({ w: 0.4, text: 'The rifle was moving when you fired. Let the crosshair settle, then press.' });
  if (p.heat > 60) tips.push({ w: 0.25, text: `The barrel is hot (${Math.round(p.heat + 20)}°C) and shots spread more. Slow down between shots.` });

  if (good && (r.zone === 'arm' || r.zone === 'leg')) tips.push({ w: 0.6, text: 'That was a limb hit. Aim for the center of the chest.' });
  if (good && r.zone === 'edge') tips.push({ w: 0.3, text: 'Edge hit — small corrections will center the group.' });

  const spread = (rifle.precisionMoa * MOA * 1000) / 2;
  if (!good && Math.hypot(missU, missV) < spread * 1.2 && tips.length === 0) {
    tips.push({ w: 1, text: `That was within the rifle's natural spread (±${spread.toFixed(2)} mil). Keep the same hold and fire again.` });
  }
  if (good && tips.length === 0) tips.push({ w: 1, text: 'Good fundamentals. Keep the same hold for a follow-up shot.' });

  tips.sort((a, b) => b.w - a.w);
  return { title, good, lines: tips.slice(0, 4).map((t) => t.text) };
}
