/**
 * Musical timing for the chart editor. Positions are integer ticks (TICKS_PER_BEAT per quarter-note beat) so every
 * note sits exactly on a bar / beat / subdivision; milliseconds are derived from BPM changes, meter changes and the
 * offset (time of bar 0). Bar 0 is displayed as bar 1.
 */
export const TICKS_PER_BEAT = 192;
/** Note values a grid can snap to: 1/4 = quarter notes (one beat), 1/16 = sixteenths, 1/12 = eighth triplets ... */
export const SNAP_DIVISORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export interface BpmPoint { tick: number; bpm: number }
export interface MeterPoint { bar: number; beats: number }
export interface TimingData { offsetMs: number; bpms: BpmPoint[]; meters: MeterPoint[] }
export interface BarPosition { bar: number; beat: number; tick: number; beats: number }
export type GridKind = 'bar' | 'beat' | 'sub';
/** denom: the line is on a 1/(4*denom) grid inside its beat (1 = beat, 2 = 1/8, 3 = 1/12, 4 = 1/16 ...). */
export interface GridLine { tick: number; kind: GridKind; bar: number; denom: number }

export const divisorTicks = (div: number) => (4 * TICKS_PER_BEAT) / div;
const EPS = 1e-6;
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function normalizeTiming(data: TimingData): TimingData {
  const byTick = new Map<number, number>();
  for (const p of data?.bpms || []) {
    const tick = Math.round(Number(p?.tick)), bpm = Number(p?.bpm);
    if (Number.isFinite(tick) && Number.isFinite(bpm) && bpm > 0) byTick.set(tick, Math.min(2000, bpm));
  }
  const bpms = [...byTick].map(([tick, bpm]) => ({ tick, bpm })).sort((a, b) => a.tick - b.tick);
  if (!bpms.length) bpms.push({ tick: 0, bpm: 120 });
  bpms[0]!.tick = 0;
  const byBar = new Map<number, number>();
  for (const m of data?.meters || []) {
    const bar = Math.round(Number(m?.bar)), beats = Math.round(Number(m?.beats));
    if (Number.isFinite(bar) && Number.isFinite(beats)) byBar.set(bar, Math.max(1, Math.min(32, beats)));
  }
  const meters = [...byBar].map(([bar, beats]) => ({ bar, beats })).sort((a, b) => a.bar - b.bar);
  if (!meters.length) meters.push({ bar: 0, beats: 4 });
  meters[0]!.bar = 0;
  const offsetMs = Number(data?.offsetMs);
  return { offsetMs: Number.isFinite(offsetMs) ? offsetMs : 0, bpms, meters };
}

export class TimingMap {
  readonly data: TimingData;
  private readonly segs: { tick: number; ms: number; mpt: number; bpm: number }[] = [];
  private readonly bars: { bar: number; tick: number; beats: number }[] = [];

  constructor(data: TimingData) {
    this.data = normalizeTiming(data);
    let ms = this.data.offsetMs;
    this.data.bpms.forEach((p, i) => {
      const prev = this.segs[i - 1];
      if (prev) ms += (p.tick - prev.tick) * prev.mpt;
      this.segs.push({ tick: p.tick, ms, mpt: 60000 / p.bpm / TICKS_PER_BEAT, bpm: p.bpm });
    });
    let tick = 0;
    this.data.meters.forEach((m, i) => {
      const prev = this.data.meters[i - 1];
      if (prev) tick += (m.bar - prev.bar) * prev.beats * TICKS_PER_BEAT;
      this.bars.push({ bar: m.bar, tick, beats: m.beats });
    });
  }

  private last<T>(list: T[], key: (v: T) => number, x: number): T {
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (key(list[mid]!) <= x + EPS) lo = mid; else hi = mid - 1; }
    return list[lo]!;
  }
  private segByTick(tick: number) { return this.last(this.segs, s => s.tick, tick); }
  private meterByTick(tick: number) { return this.last(this.bars, m => m.tick, tick); }
  private meterByBar(bar: number) { return this.last(this.bars, m => m.bar, bar); }

  tickToMs(tick: number): number { const s = this.segByTick(tick); return s.ms + (tick - s.tick) * s.mpt; }
  msToTick(ms: number): number { const s = this.last(this.segs, v => v.ms, ms); return s.tick + (ms - s.ms) / s.mpt; }
  bpmAt(tick: number): number { return this.segByTick(tick).bpm; }
  beatMsAt(tick: number): number { return 60000 / this.bpmAt(tick); }
  barStart(bar: number): number { const m = this.meterByBar(bar); return m.tick + (bar - m.bar) * m.beats * TICKS_PER_BEAT; }
  barOf(tick: number): number { const m = this.meterByTick(tick); return m.bar + Math.floor((tick - m.tick) / (m.beats * TICKS_PER_BEAT) + EPS); }
  beatsInBar(bar: number): number { return this.meterByBar(bar).beats; }

  position(tick: number): BarPosition {
    const t = Math.round(tick), bar = this.barOf(t), rel = t - this.barStart(bar), beat = Math.floor(rel / TICKS_PER_BEAT);
    return { bar, beat, tick: rel - beat * TICKS_PER_BEAT, beats: this.beatsInBar(bar) };
  }

  /** Nearest / previous / next grid point of a 1/div grid; grids restart on every bar line. */
  snap(tick: number, div: number, mode: 'round' | 'floor' | 'ceil' = 'round'): number {
    const bar = this.barOf(tick), base = this.barStart(bar), next = this.barStart(bar + 1), step = divisorTicks(div);
    const lo = base + Math.floor((tick - base) / step + EPS) * step, hi = Math.min(next, lo + step);
    if (mode === 'floor') return lo;
    if (mode === 'ceil') return tick - lo < EPS ? lo : hi;
    return tick - lo <= hi - tick ? lo : hi;
  }
  /** The grid point strictly after (dir 1) or before (dir -1) the tick. */
  step(tick: number, div: number, dir: 1 | -1): number {
    // Ticks are integers on the grid; half a tick moves safely past the current point without skipping the next one.
    return dir > 0 ? this.snap(tick + 0.5, div, 'ceil') : this.snap(tick - 0.5, div, 'floor');
  }

  /** Bar, beat and 1/div lines between two ticks (inclusive), for drawing the grid. */
  gridLines(fromTick: number, toTick: number, div: number, max = 4000): GridLine[] {
    const out: GridLine[] = [], step = divisorTicks(div);
    for (let bar = this.barOf(fromTick); bar <= this.barOf(toTick) && out.length < max; bar++) {
      const base = this.barStart(bar), next = this.barStart(bar + 1), ticks = new Set<number>();
      for (let t = base; t < next - EPS; t += TICKS_PER_BEAT) ticks.add(t);
      if (step < TICKS_PER_BEAT * this.beatsInBar(bar)) for (let t = base; t < next - EPS; t += step) ticks.add(t);
      for (const t of [...ticks].sort((a, b) => a - b)) {
        if (t < fromTick - EPS || t > toTick + EPS) continue;
        const rel = t - base, inBeat = rel % TICKS_PER_BEAT;
        const denom = inBeat ? TICKS_PER_BEAT / gcd(inBeat, TICKS_PER_BEAT) : 1;
        out.push({ tick: t, kind: rel === 0 ? 'bar' : inBeat === 0 ? 'beat' : 'sub', bar, denom });
      }
    }
    return out;
  }
}

/** "bar:beat:tick", bar and beat counted from 1, tick 0..191 inside the beat. */
export function formatPosition(p: BarPosition): string {
  return `${p.bar + 1}:${p.beat + 1}:${String(Math.round(p.tick)).padStart(3, '0')}`;
}

/** Parses "bar", "bar:beat" or "bar:beat:tick" (also "." or spaces as separators). Returns null when invalid. */
export function parsePosition(text: string, map: TimingMap): number | null {
  const parts = String(text).trim().split(/[:.\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 3 || parts.some(p => !/^-?\d+$/.test(p))) return null;
  const [bar1, beat1 = 1, tick = 0] = parts.map(Number) as [number, number?, number?];
  const bar = bar1 - 1, beats = map.beatsInBar(bar);
  if (beat1 < 1 || beat1 > beats || tick < 0 || tick >= TICKS_PER_BEAT) return null;
  return map.barStart(bar) + (beat1 - 1) * TICKS_PER_BEAT + tick;
}
