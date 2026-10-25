// V12.9 looping mini-stage that previews a note skin + hit effect pair in the economy modal.
import { findHitEffect, findNoteSkin, HIT_EFFECTS, NOTE_SKINS } from '../cosmetics/catalog.js';
import { paintTap } from './noteSkins.js';
import { HitEffectLayer } from './hitEffects.js';

const LANES = 3;
const FALL_MS = 1100;
const SPACING_MS = 420;

export class CosmeticPreview {
  private raf = 0;
  private fx = new HitEffectLayer();
  private skin = NOTE_SKINS[0];
  private effect = HIT_EFFECTS[0];
  private canvas:HTMLCanvasElement | null = null;
  private ctx:CanvasRenderingContext2D | null = null;
  private t0 = 0;
  private lastHit = -1;
  private w = 0; private h = 0;

  set(skinId:string, effectId:string):void {
    this.skin = findNoteSkin(skinId) || NOTE_SKINS[0];
    this.effect = findHitEffect(effectId) || HIT_EFFECTS[0];
    this.fx.clear();
  }

  attach(canvas:HTMLCanvasElement | null):void {
    this.stop();
    this.canvas = canvas;
    this.ctx = canvas?.getContext('2d') || null;
    if (!canvas || !this.ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, canvas.clientWidth); this.h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.floor(this.w * dpr); canvas.height = Math.floor(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.t0 = performance.now(); this.lastHit = -1;
    const loop = (now:number) => {
      if (!this.canvas?.isConnected) { this.stop(); return; }
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop():void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0; this.fx.clear();
  }

  private frame(now:number):void {
    const c = this.ctx; if (!c) return;
    const { w, h } = this, judgeY = h * .78, laneW = w / LANES, t = now - this.t0;
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < LANES; i++) {
      c.fillStyle = i % 2 ? 'rgba(16,16,34,.9)' : 'rgba(9,9,20,.9)';
      c.fillRect(i * laneW, 0, laneW, h);
    }
    c.strokeStyle = 'rgba(125,211,252,.75)'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, judgeY); c.lineTo(w, judgeY); c.stroke();

    // Note n reaches the judge line at n*SPACING_MS; draw the ones currently on screen.
    const first = Math.max(0, Math.floor(t / SPACING_MS) - 1), last = Math.floor((t + FALL_MS) / SPACING_MS);
    c.save();
    c.shadowColor = this.skin.glow; c.shadowBlur = 10;
    for (let n = first; n <= last; n++) {
      const dt = n * SPACING_MS - t;
      if (dt < 0 || dt > FALL_MS) continue;
      const lane = [1, 0, 2, 1, 2, 0][n % 6];
      const y = judgeY - (dt / FALL_MS) * judgeY;
      paintTap(c, { x:(lane + .5) * laneW, y, w:laneW * .62, h:Math.max(5, laneW * .15), hot:dt < 120 }, this.skin, now);
    }
    c.restore();
    const hitIndex = Math.floor(t / SPACING_MS);
    if (hitIndex > this.lastHit) {
      this.lastHit = hitIndex;
      const lane = [1, 0, 2, 1, 2, 0][hitIndex % 6];
      this.fx.spawn((lane + .5) * laneW, judgeY, laneW, hitIndex % 7 === 6 ? 'GREAT' : 'PURE', this.effect, now);
    }
    this.fx.draw(c, now);
  }
}
