// V12.9 hit-effect layer: short-lived judge-line bursts drawn on the note canvas after notes.
// Visual only — timing uses performance.now() and never touches judgement or the game clock.
import type { HitEffect, HitEffectStyle } from '../cosmetics/catalog.js';

export type HitGrade = 'PURE' | 'GREAT' | 'FAR';

interface Particle { a:number; v:number; s:number; spin:number }
interface Burst {
  x:number; y:number; size:number; born:number; dur:number;
  color:string; secondary:string; style:HitEffectStyle; particles:Particle[];
}

const GRADE_COLORS: Record<Exclude<HitGrade,'PURE'>, [string,string]> = {
  GREAT: ['#fde68a', '#f8e38b'],
  FAR: ['#bae6fd', '#7dd3fc'],
};
const PARTICLE_COUNT: Partial<Record<HitEffectStyle, number>> = { ripple:8, stardust:12, nova:16, lotus:8, rift:8 };
const MAX_BURSTS = 48;
const TAU = Math.PI * 2;

export class HitEffectLayer {
  private bursts: Burst[] = [];

  spawn(x:number, y:number, laneW:number, grade:HitGrade, effect:HitEffect, now = performance.now()):void {
    const [color, secondary] = grade === 'PURE' ? [effect.color, effect.secondary] : GRADE_COLORS[grade];
    const count = PARTICLE_COUNT[effect.style] || 0;
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const spread = effect.style === 'stardust' ? -Math.PI * (.1 + .8 * Math.random()) : (i / count) * TAU + Math.random() * .3;
      particles.push({ a: spread, v: .55 + Math.random() * .6, s: .6 + Math.random() * .8, spin: Math.random() * TAU });
    }
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({
      x, y, size: Math.max(18, laneW * .62) * (grade === 'FAR' ? .8 : 1), born: now,
      dur: effect.durationMs, color, secondary, style: effect.style, particles,
    });
  }

  clear():void { this.bursts.length = 0; }
  get size():number { return this.bursts.length; }

  draw(c:CanvasRenderingContext2D, now = performance.now()):void {
    if (!this.bursts.length) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.shadowBlur = 0;
    c.lineCap = 'round';
    let write = 0;
    for (const b of this.bursts) {
      const p = (now - b.born) / b.dur;
      if (p >= 1) continue;
      this.bursts[write++] = b;
      if (p >= 0) drawBurst(c, b, p);
    }
    this.bursts.length = write;
    c.restore();
  }
}

const easeOut = (t:number) => 1 - Math.pow(1 - t, 3);

function ring(c:CanvasRenderingContext2D, x:number, y:number, r:number, width:number, color:string, alpha:number):void {
  if (alpha <= 0 || r <= 0) return;
  c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = Math.max(.5, width);
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
}

function glow(c:CanvasRenderingContext2D, x:number, y:number, r:number, color:string, alpha:number):void {
  if (alpha <= 0 || r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.globalAlpha = alpha; c.fillStyle = g;
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}

function rays(c:CanvasRenderingContext2D, b:Burst, r0:number, r1:number, width:number, color:string, alpha:number):void {
  c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width;
  c.beginPath();
  b.particles.forEach((pt, i) => {
    const len = i % 2 ? 1 : .62;
    c.moveTo(b.x + Math.cos(pt.a) * r0, b.y + Math.sin(pt.a) * r0);
    c.lineTo(b.x + Math.cos(pt.a) * (r0 + (r1 - r0) * len), b.y + Math.sin(pt.a) * (r0 + (r1 - r0) * len));
  });
  c.stroke();
}

function drawBurst(c:CanvasRenderingContext2D, b:Burst, p:number):void {
  const e = easeOut(p), fade = 1 - p, { x, y, size } = b;
  switch (b.style) {
    case 'halo':
      glow(c, x, y, size * .55, b.secondary, fade * .35);
      ring(c, x, y, size * (.28 + .5 * e), 3 * fade, b.color, fade);
      break;
    case 'ripple': {
      ring(c, x, y, size * (.25 + .6 * e), 2.6 * fade, b.color, fade);
      const q = Math.max(0, (p - .18) / .82);
      if (q > 0) ring(c, x, y, size * (.2 + .85 * easeOut(q)), 1.6 * (1 - q), b.secondary, (1 - q) * .8);
      rays(c, b, size * (.3 + .35 * e), size * (.45 + .55 * e), 1.4, b.color, fade * .8);
      break;
    }
    case 'stardust':
      glow(c, x, y, size * .5 * (1 - p * .4), b.color, fade * .4);
      ring(c, x, y, size * (.22 + .3 * e), 1.8 * fade, b.secondary, fade * .9);
      c.fillStyle = b.color;
      for (const pt of b.particles) {
        const d = size * pt.v * e * 1.15;
        const px = x + Math.cos(pt.a) * d, py = y + Math.sin(pt.a) * d + size * .5 * p * p;
        star(c, px, py, 2.4 * pt.s * (1 - p * .6), pt.spin + p * 4, fade);
      }
      break;
    case 'nova': {
      // Lane light pillar first so the burst sits on top of it.
      const pillarH = size * 4.2 * (1 - p * .3), pillarW = size * .7 * (1 - p * .5);
      const g = c.createLinearGradient(0, y, 0, y - pillarH);
      g.addColorStop(0, b.secondary); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = fade * .45; c.fillStyle = g; c.fillRect(x - pillarW / 2, y - pillarH, pillarW, pillarH);
      glow(c, x, y, size * (.75 - .25 * p), b.color, Math.pow(fade, 2));
      ring(c, x, y, size * (.3 + .75 * e), 3.2 * fade, b.secondary, fade);
      rays(c, b, size * (.2 + .2 * e), size * (.55 + .85 * e), 1.8 * fade + .4, b.color, fade);
      break;
    }
    case 'lotus': {
      glow(c, x, y, size * .6, b.secondary, fade * .35);
      c.fillStyle = b.color;
      const petals = 6, dist = size * .42 * e, rot = p * .9;
      for (let i = 0; i < petals; i++) {
        const a = rot + i * TAU / petals;
        c.globalAlpha = fade * .75;
        c.beginPath();
        c.ellipse(x + Math.cos(a) * dist, y + Math.sin(a) * dist, size * .3 * (1 - p * .3), size * .11, a, 0, TAU);
        c.fill();
      }
      ring(c, x, y, size * (.35 + .55 * e), 1.6 * fade, b.secondary, fade);
      c.fillStyle = b.secondary;
      for (const pt of b.particles) {
        const d = size * (.5 + pt.v * .9) * e;
        c.globalAlpha = fade * .85;
        c.beginPath();
        c.ellipse(x + Math.cos(pt.a) * d, y + Math.sin(pt.a) * d + size * .6 * p * p, 2.8 * pt.s, 1.4 * pt.s, pt.spin + p * 5, 0, TAU);
        c.fill();
      }
      break;
    }
    case 'rift': {
      const r = size * (.3 + .7 * e), off = 2.5 * (1 - p);
      ring(c, x - off, y, r, 2.2 * fade, b.color, fade);
      ring(c, x + off, y, r, 2.2 * fade, b.secondary, fade);
      const s = size * (.25 + .9 * e);
      c.globalAlpha = fade * .8; c.strokeStyle = '#ffffff'; c.lineWidth = 1.4 * fade + .3;
      c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath(); c.stroke();
      c.fillStyle = b.color;
      for (const pt of b.particles) {
        const d = size * (.35 + pt.v) * e, px = x + Math.cos(pt.a) * d, py = y + Math.sin(pt.a) * d, k = 3.2 * pt.s * fade;
        c.globalAlpha = fade;
        c.beginPath(); c.moveTo(px + Math.cos(pt.a) * k * 1.8, py + Math.sin(pt.a) * k * 1.8);
        c.lineTo(px + Math.cos(pt.a + 2.4) * k, py + Math.sin(pt.a + 2.4) * k);
        c.lineTo(px + Math.cos(pt.a - 2.4) * k, py + Math.sin(pt.a - 2.4) * k); c.closePath(); c.fill();
      }
      break;
    }
  }
  c.globalAlpha = 1;
}

function star(c:CanvasRenderingContext2D, x:number, y:number, r:number, rot:number, alpha:number):void {
  if (r <= 0 || alpha <= 0) return;
  c.globalAlpha = alpha;
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot + i * Math.PI / 4, rr = i % 2 ? r * .38 : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath(); c.fill();
}
