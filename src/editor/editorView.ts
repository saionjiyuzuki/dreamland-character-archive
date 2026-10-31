/**
 * Chart canvas: time runs upwards (notes fall towards the playhead like in the game), lanes span the lane area and
 * each lane section divides it into its own lane count. Draws grid, waveform, timing markers and notes, and maps
 * mouse positions back to ticks / lanes.
 */
import { TimingMap, formatPosition, type GridLine } from './timing.js';
import { lanesAt, noteEnd, noteStart, splineAt, type EditorNote, type EditorProject, type HoldNote, type MultiNote, type Section } from './chartModel.js';

export interface Marquee { x0: number; y0: number; x1: number; y1: number }
export interface ViewState {
  project: EditorProject; map: TimingMap; sections: Section[];
  timeMs: number; pxPerMs: number; snap: number;
  selected: Set<string>;
  /** Notes drawn instead of the project notes with the same id (drag preview), plus new notes being drawn. */
  overrides: Map<string, EditorNote>; ghosts: EditorNote[];
  marquee: Marquee | null;
  hoverTick: number | null; hoverLane: number | null;
  peaks: Float32Array; peakMs: number;
  /** Lanes currently flashing from playback hits: key "tick:lane" -> 0..1 */
  flashes: { ms: number; left: number; right: number; k: number }[];
}
export type HitPart = 'body' | 'head' | 'kf';
export interface Hit { note: EditorNote; part: HitPart; index: number; edge?: 'left' | 'right' | 'lane' }

/** Grid colours by subdivision: quarter white, 1/8 red, 1/12 purple, 1/16 yellow, 1/24 pink, 1/32 orange, finer grey. */
const SUB_COLORS: Record<number, string> = { 2: '#f87171', 3: '#c084fc', 4: '#facc15', 6: '#f472b6', 8: '#fb923c' };
const C = { bg: '#070712', laneA: '#0d0d1f', laneB: '#111127', tap: '#a78bfa', tapB: '#e0d5ff', hold: '#6ee7d6', multi: 'rgba(249,168,212,', sel: '#ffffff', play: '#7dd3fc' };

export class ChartView {
  w = 0; h = 0; L = 0; W = 0; playY = 0; dpr = 1;
  readonly gutterL = 96; readonly gutterR = 84;
  constructor(readonly canvas: HTMLCanvasElement) {}

  resize(): void {
    const r = this.canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr; this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.W = Math.max(160, Math.min(640, this.w - this.gutterL - this.gutterR - 24));
    this.L = this.gutterL + Math.max(0, (this.w - this.gutterL - this.gutterR - this.W) / 2);
    this.playY = Math.round(this.h * 0.82);
  }
  yOfMs(st: ViewState, ms: number): number { return this.playY - (ms - st.timeMs) * st.pxPerMs; }
  msOfY(st: ViewState, y: number): number { return st.timeMs + (this.playY - y) / st.pxPerMs; }
  xOfEdge(edge: number, k: number): number { return this.L + (edge / k) * this.W; }
  edgeOfX(x: number, k: number): number { return ((x - this.L) / this.W) * k; }
  laneW(k: number): number { return this.W / k; }
  inLanes(x: number): boolean { return x >= this.L && x <= this.L + this.W; }
  noteOf(st: ViewState, n: EditorNote): EditorNote { return st.overrides.get(n.id) || n; }

  draw(st: ViewState): void {
    const g = this.canvas.getContext('2d')!;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, this.w, this.h);
    const msTop = this.msOfY(st, 0), msBot = this.msOfY(st, this.h), map = st.map;
    const tTop = map.msToTick(msTop), tBot = Math.max(map.msToTick(msBot), -1e9);
    this.drawLanes(g, st, msBot, msTop);
    this.drawWave(g, st);
    const lines = map.gridLines(Math.max(tBot, map.msToTick(Math.min(msBot, msTop))), tTop, st.snap);
    this.drawGrid(g, st, lines);
    this.drawMarkers(g, st, msBot, msTop);
    for (const raw of st.project.notes) {
      const n = this.noteOf(st, raw);
      const a = map.tickToMs(noteStart(n)), b = map.tickToMs(noteEnd(n));
      if (b < msBot - 40 || a > msTop + 40) continue;
      this.drawNote(g, st, n, st.selected.has(n.id), 1);
    }
    for (const n of st.ghosts) this.drawNote(g, st, n, true, 0.55);
    this.drawHover(g, st);
    this.drawFlashes(g, st);
    this.drawPlayhead(g, st);
    if (st.marquee) {
      const m = st.marquee, x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
      g.fillStyle = 'rgba(125,211,252,.12)'; g.strokeStyle = 'rgba(125,211,252,.8)'; g.lineWidth = 1;
      g.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); g.strokeRect(x + .5, y + .5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0));
    }
  }

  /** Lane stripes per lane section, with the section's lane count written at its start. */
  private drawLanes(g: CanvasRenderingContext2D, st: ViewState, msBot: number, msTop: number): void {
    const secs = st.sections, map = st.map;
    for (let i = 0; i < secs.length; i++) {
      const a = i ? map.tickToMs(secs[i]!.tick) : -1e9, b = i + 1 < secs.length ? map.tickToMs(secs[i + 1]!.tick) : 1e12;
      if (b < msBot || a > msTop) continue;
      const yTop = Math.max(0, this.yOfMs(st, b)), yBot = Math.min(this.h, this.yOfMs(st, a)), k = secs[i]!.lanes;
      for (let l = 0; l < k; l++) {
        g.fillStyle = l % 2 ? C.laneB : C.laneA;
        g.fillRect(this.xOfEdge(l, k), yTop, this.laneW(k), yBot - yTop);
      }
      g.strokeStyle = 'rgba(125,211,252,.10)'; g.lineWidth = 1;
      for (let l = 1; l < k; l++) { const x = Math.round(this.xOfEdge(l, k)) + .5; g.beginPath(); g.moveTo(x, yTop); g.lineTo(x, yBot); g.stroke(); }
      // Half-way line between the hands
      const mid = Math.round(this.xOfEdge(k / 2, k)) + .5;
      g.strokeStyle = 'rgba(125,211,252,.22)'; g.beginPath(); g.moveTo(mid, yTop); g.lineTo(mid, yBot); g.stroke();
      if (i && a >= msBot && a <= msTop) {
        const y = Math.round(this.yOfMs(st, a)) + .5;
        g.strokeStyle = '#34d399'; g.lineWidth = 2; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(this.L - 6, y); g.lineTo(this.L + this.W + 6, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = '#34d399'; g.font = '600 11px Inter, system-ui, sans-serif'; g.textAlign = 'left';
        g.fillText(`${k}K`, this.L + this.W + 10, y - 4);
      }
    }
    g.strokeStyle = 'rgba(125,211,252,.35)'; g.lineWidth = 1;
    g.strokeRect(Math.round(this.L) + .5, -1, Math.round(this.W), this.h + 2);
  }

  /** Waveform (mirrored around the lane area's centre), behind the grid. */
  private drawWave(g: CanvasRenderingContext2D, st: ViewState): void {
    const peaks = st.peaks; if (!peaks.length) return;
    const cx = this.L + this.W / 2, half = this.W / 2;
    g.fillStyle = 'rgba(125,211,252,.13)';
    g.beginPath();
    for (let y = 0; y < this.h; y += 2) {
      const a = this.msOfY(st, y + 2), b = this.msOfY(st, y);
      let m = 0;
      for (let i = Math.max(0, Math.floor(a / st.peakMs)), e = Math.min(peaks.length - 1, Math.ceil(b / st.peakMs)); i <= e; i++) m = Math.max(m, peaks[i]!);
      if (m > 0.004) g.rect(cx - m * half, y, m * half * 2, 2);
    }
    g.fill();
  }

  private drawGrid(g: CanvasRenderingContext2D, st: ViewState, lines: GridLine[]): void {
    g.font = '600 12px Inter, system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    const beatPx = st.map.beatMsAt(st.map.msToTick(st.timeMs)) * st.pxPerMs;
    for (const ln of lines) {
      const y = Math.round(this.yOfMs(st, st.map.tickToMs(ln.tick))) + .5;
      if (y < -2 || y > this.h + 2) continue;
      if (ln.kind === 'bar') {
        g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(this.L - 14, y); g.lineTo(this.L + this.W, y); g.stroke();
        g.fillStyle = '#e5e7ff'; g.fillText(String(ln.bar + 1), this.L - 18, y);
      } else if (ln.kind === 'beat') {
        g.strokeStyle = 'rgba(255,255,255,.32)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(this.L - 6, y); g.lineTo(this.L + this.W, y); g.stroke();
      } else {
        // Skip subdivision lines that would be closer than 4px.
        if (beatPx / ln.denom < 4) continue;
        const col = SUB_COLORS[ln.denom] || '#6b7280';
        g.strokeStyle = col; g.globalAlpha = 0.38; g.lineWidth = 1;
        g.beginPath(); g.moveTo(this.L, y); g.lineTo(this.L + this.W, y); g.stroke(); g.globalAlpha = 1;
      }
    }
    g.textBaseline = 'alphabetic';
  }

  /** BPM changes (orange) and meter changes (blue) in the right gutter. */
  private drawMarkers(g: CanvasRenderingContext2D, st: ViewState, msBot: number, msTop: number): void {
    const map = st.map, x = this.L + this.W;
    g.font = '600 11px Inter, system-ui, sans-serif'; g.textAlign = 'left';
    for (const p of st.project.timing.bpms) {
      const ms = map.tickToMs(p.tick); if (ms < msBot - 20 || ms > msTop + 20) continue;
      const y = Math.round(this.yOfMs(st, ms)) + .5;
      g.strokeStyle = '#fb923c'; g.lineWidth = 1; g.beginPath(); g.moveTo(this.L, y); g.lineTo(x + 8, y); g.stroke();
      g.fillStyle = '#fb923c'; g.fillText(`♩=${+p.bpm.toFixed(3)}`, x + 10, y + 13);
    }
    for (const m of st.project.timing.meters) {
      const ms = map.tickToMs(map.barStart(m.bar)); if (ms < msBot - 20 || ms > msTop + 20) continue;
      const y = Math.round(this.yOfMs(st, ms)) + .5;
      g.fillStyle = '#60a5fa'; g.fillText(`${m.beats}/4`, x + 10, y + 26);
    }
    // Offset (bar 1, beat 1) and song end
    const end = st.project.meta.duration * 1000;
    if (end >= msBot && end <= msTop) {
      const y = Math.round(this.yOfMs(st, end)) + .5;
      g.strokeStyle = '#f87171'; g.lineWidth = 2; g.beginPath(); g.moveTo(this.L - 6, y); g.lineTo(x + 6, y); g.stroke();
      g.fillStyle = '#f87171'; g.fillText('END', x + 10, y - 4);
    }
  }

  /** Lane count a note is written in: the section its head falls in. */
  kOf(st: ViewState, n: EditorNote): number { return lanesAt(st.sections, noteStart(n)); }

  private drawNote(g: CanvasRenderingContext2D, st: ViewState, n: EditorNote, sel: boolean, alpha: number): void {
    const k = this.kOf(st, n), lw = this.laneW(k), map = st.map;
    g.globalAlpha = alpha;
    if (n.kind === 'tap') {
      const y = this.yOfMs(st, map.tickToMs(n.tick)), x = this.xOfEdge(n.lane, k);
      this.noteHead(g, x + 3, y, lw - 6, C.tap, C.tapB, sel);
    } else if (n.kind === 'hold') {
      this.drawHold(g, st, n, k, sel);
    } else {
      this.drawMulti(g, st, n, k, sel);
    }
    g.globalAlpha = 1;
  }
  private noteHead(g: CanvasRenderingContext2D, x: number, y: number, w: number, fill: string, edge: string, sel: boolean): void {
    const h = 10;
    g.fillStyle = fill; g.fillRect(x, y - h / 2, w, h);
    g.fillStyle = edge; g.fillRect(x, y - 1, w, 2);
    if (sel) { g.strokeStyle = C.sel; g.lineWidth = 2; g.strokeRect(x - 1.5, y - h / 2 - 1.5, w + 3, h + 3); }
  }
  /** Hold body follows the game's spline through its keyframes; keyframes are drawn as handles. */
  private drawHold(g: CanvasRenderingContext2D, st: ViewState, n: HoldNote, k: number, sel: boolean): void {
    const map = st.map, lw = this.laneW(k), pts = n.points, a = pts[0]!.tick, b = pts[pts.length - 1]!.tick;
    const yA = this.yOfMs(st, map.tickToMs(a)), yB = this.yOfMs(st, map.tickToMs(b));
    const steps = Math.max(8, Math.min(200, Math.ceil(Math.abs(yA - yB) / 4)));
    const laneAt = (t: number) => Math.max(0, Math.min(k - 1, splineAt(pts, t, p => p.tick, p => p.lane)));
    const left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = a + (b - a) * (i / steps), y = this.yOfMs(st, map.tickToMs(t)), x = this.xOfEdge(laneAt(t), k);
      left.push([x + lw * 0.2, y]); right.push([x + lw * 0.8, y]);
    }
    g.beginPath(); left.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i]![0], right[i]![1]); g.closePath();
    g.fillStyle = 'rgba(110,231,214,.45)'; g.fill();
    g.strokeStyle = sel ? C.sel : 'rgba(165,243,252,.9)'; g.lineWidth = sel ? 2 : 1; g.stroke();
    this.noteHead(g, this.xOfEdge(pts[0]!.lane, k) + 3, yA, lw - 6, C.hold, '#ecfeff', sel);
    const xe = this.xOfEdge(laneAt(b), k);
    g.fillStyle = 'rgba(165,243,252,.9)'; g.fillRect(xe + lw * 0.2, yB - 2, lw * 0.6, 4);
    if (sel) for (let i = 1; i < pts.length; i++) this.handle(g, this.xOfEdge(pts[i]!.lane, k) + lw / 2, this.yOfMs(st, map.tickToMs(pts[i]!.tick)), '#a5f3fc');
  }
  /** Multi Hold area between the left and right edge splines; selected notes show edge handles per keyframe. */
  private drawMulti(g: CanvasRenderingContext2D, st: ViewState, n: MultiNote, k: number, sel: boolean): void {
    const map = st.map, pts = n.points, a = pts[0]!.tick, b = pts[pts.length - 1]!.tick;
    const yA = this.yOfMs(st, map.tickToMs(a)), yB = this.yOfMs(st, map.tickToMs(b));
    const steps = Math.max(8, Math.min(240, Math.ceil(Math.abs(yA - yB) / 4)));
    const L: [number, number][] = [], R: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = a + (b - a) * (i / steps), y = this.yOfMs(st, map.tickToMs(t));
      let l = splineAt(pts, t, p => p.tick, p => p.left), r = splineAt(pts, t, p => p.tick, p => p.right);
      l = Math.max(0, Math.min(k - 1, l)); r = Math.max(l + 0.5, Math.min(k, r));
      L.push([this.xOfEdge(l, k), y]); R.push([this.xOfEdge(r, k), y]);
    }
    g.beginPath(); L.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i]![0], R[i]![1]); g.closePath();
    g.fillStyle = C.multi + '.30)'; g.fill();
    g.strokeStyle = sel ? C.sel : C.multi + '.95)'; g.lineWidth = sel ? 2 : 1.5; g.stroke();
    const p0 = pts[0]!;
    g.fillStyle = C.multi + '.95)'; g.fillRect(this.xOfEdge(p0.left, k) + 2, yA - 5, this.xOfEdge(p0.right, k) - this.xOfEdge(p0.left, k) - 4, 10);
    if (sel) for (const p of pts) {
      const y = this.yOfMs(st, map.tickToMs(p.tick));
      this.handle(g, this.xOfEdge(p.left, k), y, '#f9a8d4'); this.handle(g, this.xOfEdge(p.right, k), y, '#f9a8d4');
    }
  }
  private handle(g: CanvasRenderingContext2D, x: number, y: number, col: string): void {
    g.fillStyle = '#0b0b18'; g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  /** Snapped cursor position: a translucent note outline plus its bar:beat:tick label. */
  private drawHover(g: CanvasRenderingContext2D, st: ViewState): void {
    if (st.hoverTick == null) return;
    const ms = st.map.tickToMs(st.hoverTick), y = Math.round(this.yOfMs(st, ms)) + .5, k = lanesAt(st.sections, st.hoverTick);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(this.L - 6, y); g.lineTo(this.L + this.W + 6, y); g.stroke(); g.setLineDash([]);
    if (st.hoverLane != null) { g.strokeStyle = 'rgba(255,255,255,.65)'; g.strokeRect(this.xOfEdge(st.hoverLane, k) + 3, y - 5, this.laneW(k) - 6, 10); }
    g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '600 11px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'right';
    g.fillText(formatPosition(st.map.position(st.hoverTick)), this.L - 18, y - 10);
  }
  private drawFlashes(g: CanvasRenderingContext2D, st: ViewState): void {
    for (const f of st.flashes) {
      const age = st.timeMs - f.ms; if (age < 0 || age > 160) continue;
      g.fillStyle = `rgba(167,139,250,${0.45 * (1 - age / 160)})`;
      g.fillRect(this.xOfEdge(f.left, f.k), this.playY - 60, this.xOfEdge(f.right, f.k) - this.xOfEdge(f.left, f.k), 60);
    }
  }
  private drawPlayhead(g: CanvasRenderingContext2D, st: ViewState): void {
    const y = this.playY + .5;
    g.strokeStyle = C.play; g.lineWidth = 2; g.shadowColor = 'rgba(125,211,252,.8)'; g.shadowBlur = 8;
    g.beginPath(); g.moveTo(0, y); g.lineTo(this.w, y); g.stroke(); g.shadowBlur = 0;
    const tick = st.map.msToTick(st.timeMs);
    g.fillStyle = C.play; g.font = '700 12px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'left';
    g.fillText(formatPosition(st.map.position(Math.floor(tick))), 8, y - 8);
    const s = Math.max(0, st.timeMs) / 1000;
    g.fillStyle = 'rgba(125,211,252,.7)'; g.fillText(`${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`, 8, y + 18);
  }

  /**
   * Note under the cursor, topmost first: keyframe handles of selected notes, then heads, then hold / Multi Hold
   * bodies. `index` is the keyframe index (0 = head).
   */
  hitTest(st: ViewState, x: number, y: number): Hit | null {
    const map = st.map, notes = st.project.notes.map(n => this.noteOf(st, n));
    const near = (ax: number, ay: number) => Math.hypot(ax - x, ay - y) <= 8;
    for (const n of notes) {
      if (!st.selected.has(n.id) || n.kind === 'tap') continue;
      const k = this.kOf(st, n), lw = this.laneW(k);
      for (let i = n.points.length - 1; i >= 0; i--) {
        const yy = this.yOfMs(st, map.tickToMs(n.points[i]!.tick));
        if (n.kind === 'hold') { if (i > 0 && near(this.xOfEdge(n.points[i]!.lane, k) + lw / 2, yy)) return { note: n, part: 'kf', index: i, edge: 'lane' }; }
        else {
          const p = n.points[i]!;
          if (near(this.xOfEdge(p.left, k), yy)) return { note: n, part: 'kf', index: i, edge: 'left' };
          if (near(this.xOfEdge(p.right, k), yy)) return { note: n, part: 'kf', index: i, edge: 'right' };
        }
      }
    }
    for (let j = notes.length - 1; j >= 0; j--) {
      const n = notes[j]!, k = this.kOf(st, n), yy = this.yOfMs(st, map.tickToMs(noteStart(n)));
      if (Math.abs(yy - y) > 7) continue;
      const [l, r] = n.kind === 'tap' ? [n.lane, n.lane + 1] : n.kind === 'hold' ? [n.points[0]!.lane, n.points[0]!.lane + 1] : [n.points[0]!.left, n.points[0]!.right];
      if (x >= this.xOfEdge(l, k) && x <= this.xOfEdge(r, k)) return { note: n, part: 'head', index: 0 };
    }
    for (let j = notes.length - 1; j >= 0; j--) {
      const n = notes[j]!; if (n.kind === 'tap') continue;
      const k = this.kOf(st, n), ms = this.msOfY(st, y), t = map.msToTick(ms);
      if (t < noteStart(n) || t > noteEnd(n)) continue;
      const e = this.edgeOfX(x, k);
      if (n.kind === 'hold') { const c = splineAt(n.points, t, p => p.tick, p => p.lane); if (e >= c && e <= c + 1) return { note: n, part: 'body', index: 0 }; }
      else if (e >= splineAt(n.points, t, p => p.tick, p => p.left) && e <= splineAt(n.points, t, p => p.tick, p => p.right)) return { note: n, part: 'body', index: 0 };
    }
    return null;
  }

  /** Notes whose head lies inside a screen rectangle. */
  inRect(st: ViewState, m: Marquee): EditorNote[] {
    const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
    return st.project.notes.filter(n => {
      const k = this.kOf(st, n), y = this.yOfMs(st, st.map.tickToMs(noteStart(n)));
      const [l, r] = n.kind === 'tap' ? [n.lane, n.lane + 1] : n.kind === 'hold' ? [n.points[0]!.lane, n.points[0]!.lane + 1] : [n.points[0]!.left, n.points[0]!.right];
      return y >= y0 && y <= y1 && this.xOfEdge(r, k) >= x0 && this.xOfEdge(l, k) <= x1;
    });
  }
}
