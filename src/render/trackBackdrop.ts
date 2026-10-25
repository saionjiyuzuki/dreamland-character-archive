/**
 * Decorative geometry that slides down the track with the same perspective as the notes.
 * Visual only: it never touches judging, and it is drawn under every note at low alpha.
 */
export interface TrackBackdropConfig { kind: 'geometry'; bpm: number; firstBeatMs: number; }
export interface BackdropView { w: number; cx: number; horizonY: number; judgeY: number; fallTime: number; }
export interface BackdropShape { x: number; y: number; size: number; rot: number; sides: number; alpha: number; hue: number; }

const SHAPES = 18;
const MAX_ALPHA = 0.32;
// Each shape has a fixed lane coordinate (0..1 = judge line width, outside values run along the track edges).
const LANE_U = [-0.32, 1.32, 0.18, 0.82, -0.12, 1.12, 0.5, -0.38, 1.38, 0.3, 0.7, -0.2, 1.2, 0.08, 0.92, -0.28, 1.28, 0.5];
const SIDES = [3, 4, 6, 0, 3, 4, 6, 3, 0, 4, 3, 6, 4, 0, 3, 6, 4, 3]; // 0 = ring

export function backdropShapes(tMs: number, cfg: TrackBackdropConfig | null | undefined, view: BackdropView): BackdropShape[] {
  if (!cfg || cfg.kind !== 'geometry' || !(cfg.bpm > 0) || !Number.isFinite(tMs)) return [];
  const beat = 60000 / cfg.bpm, beats = (tMs - cfg.firstBeatMs) / beat;
  // Beat pulse: 1 on the beat, decaying over the beat (nothing before the first beat).
  const pulse = beats < 0 ? 0 : Math.exp(-4 * (beats - Math.floor(beats)));
  const T = Math.max(1, view.fallTime) / 4, travel = beat * 8, depth = view.fallTime * 1.15;
  const out: BackdropShape[] = [];
  for (let i = 0; i < SHAPES; i++) {
    // Phase in [0,1): 0 = at the horizon, 1 = at the judge line.
    const phase = (((tMs / travel + i / SHAPES) % 1) + 1) % 1;
    const dt = (1 - phase) * depth;
    const k = 1 / (1 + dt / T);
    const u = LANE_U[i]!, inside = u > 0 && u < 1;
    const xJudge = view.w * u;
    const fadeIn = Math.min(1, phase * 5), fadeOut = Math.min(1, (1 - phase) * 6);
    const base = inside ? 0.10 : 0.22;
    const alpha = Math.min(MAX_ALPHA, (base + 0.10 * pulse) * fadeIn * fadeOut);
    if (alpha <= 0.004) continue;
    out.push({
      x: view.cx + (xJudge - view.cx) * k,
      y: view.horizonY + (view.judgeY - view.horizonY) * k,
      size: view.w * (inside ? 0.035 : 0.06) * k * (1 + 0.18 * pulse),
      rot: (tMs / 1000) * (i % 2 ? 0.9 : -0.7) + i,
      sides: SIDES[i]!,
      alpha,
      hue: (200 + i * 23 + beats * 1.5) % 360,
    });
  }
  return out;
}

export function drawTrackBackdrop(c: CanvasRenderingContext2D, shapes: readonly BackdropShape[]): void {
  if (!shapes.length) return;
  c.save();
  c.lineWidth = 1.5;
  for (const s of shapes) {
    c.globalAlpha = s.alpha;
    c.strokeStyle = `hsl(${s.hue.toFixed(0)},85%,70%)`;
    c.fillStyle = `hsla(${s.hue.toFixed(0)},85%,60%,0.18)`;
    c.beginPath();
    if (s.sides === 0) c.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    else for (let j = 0; j <= s.sides; j++) {
      const a = s.rot + (j / s.sides) * Math.PI * 2, px = s.x + Math.cos(a) * s.size, py = s.y + Math.sin(a) * s.size;
      if (j === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.fill();
    c.stroke();
  }
  c.restore();
}
