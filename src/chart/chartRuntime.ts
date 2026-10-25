import type { Chart, ChartNote, HoldPathPoint, RawNote } from '../core/types.js';
import type { MultiHoldNote } from './multiHoldSchema.js';
import type { MultiHoldAdapter } from '../integration/MultiHoldAdapter.js';

export interface RuntimeNote {
  id?: string;
  type: 'tap' | 'hold' | 'multiHold';
  time: number;
  dur: number;
  lane: number;
  laneCount: number;
  isHold: boolean;
  isMultiHold?: boolean;
  judged: boolean;
  holding: boolean;
  holdId: string | number | null;
  dead: boolean;
  autoComplete: boolean;
  finished: boolean;
  density: number;
  path: any;
  fadeEndTime: number;
  fadeDuration: number;
  gray: boolean;
  pathSamples: HoldPathCache | null;
  tickUs: number[] | null;
  _pathCache: HoldPathCache | null;
  _laneCache: unknown;
  _started?: boolean;
  autoHold?: boolean;
  holdBroken?: boolean;
  lastHoldT?: number;
  lastLane?: number;
  lastMoveT?: number;
  totalTicks?: number;
  ticksDone?: number;
  missedTicks?: number;
  nextTickIndex?: number;
  headScored?: boolean;
  lanes?: number[];
  tickIntervalMs?: number;
  multiHoldData?: MultiHoldNote;
  multiHoldAdapter?: MultiHoldAdapter;
  multiHoldUnitsDone?: number;
  multiHoldFinishedAt?: number;
}
export interface HoldPathRawPoint { dt: number; lane: number; }
export interface HoldPathSample { u: number; lane: number; }
export interface HoldPathCache { raw: HoldPathRawPoint[]; samples: HoldPathSample[]; steps: number; }
export interface ChartRuntimeDeps {
  G: any;
  laneCountAtTime: (ms: number) => number;
  createMultiHoldAdapter?: (note: MultiHoldNote, runtimeNote: RuntimeNote) => MultiHoldAdapter;
}

type NormalizedNote = {
  id?: string;
  type: 'tap' | 'hold' | 'multiHold';
  time: number;
  dur: number;
  lane: number;
  density: number;
  path: any;
  lanes?: number[];
  tickIntervalMs?: number;
  multiHoldNote?: MultiHoldNote;
};

export class ChartRuntime {
  constructor(private readonly d: ChartRuntimeDeps) {}

  load(chart: Chart): void {
    const G = this.d.G;
    const notes: NormalizedNote[] = (chart.notes as ChartNote[]).map((raw, index) => {
      if (Array.isArray(raw)) {
        const n = raw as RawNote;
        return {
          id: `${chart.id}:note:${index}`,
          time: Number(n[0]) || 0,
          type: n[1],
          lane: Number(n[2]) || 0,
          dur: Number(n[3]) || 0,
          density: Number(n[4]) || 0,
          path: n[5] || null
        };
      }
      const n = raw as MultiHoldNote;
      const startTime = Math.max(0, Number(n.startTime) || 0);
      const endTime = Math.max(startTime, Number(n.endTime) || startTime);
      const sectionMax = (chart.laneSections || []).reduce((max, section) => Math.max(max, Number(section[2]) || 1), Number(chart.lanes) || 4);
      const pathMax = (n.path?.points || []).reduce((max, point) => Math.max(max, ...((point.lanes || []).map((lane) => (Number(lane) || 0) + 1))), sectionMax);
      const declaredMax = Math.max(sectionMax, ...((n.lanes || []).map((lane) => (Number(lane) || 0) + 1)), pathMax);
      const lanes = normalizeLanes(n.lanes, Math.max(1, Math.min(8, declaredMax)));
      const tickIntervalMs = Math.max(50, Number(n.tickIntervalMs) || 500);
      const normalized: MultiHoldNote = {
        ...n,
        id: String(n.id || `${chart.id}:multiHold:${index}`),
        type: 'multiHold',
        lanes,
        startTime,
        endTime,
        tickIntervalMs
      };
      return {
        id: normalized.id,
        type: 'multiHold' as const,
        time: startTime,
        dur: endTime - startTime,
        lane: (lanes[0]! + lanes[lanes.length - 1]!) / 2,
        lanes,
        density: Math.floor((endTime - startTime) / tickIntervalMs),
        path: null,
        tickIntervalMs,
        multiHoldNote: normalized
      };
    }).sort((a, b) => a.time - b.time);

    G.pending = notes;
    G.pendingIndex = 0;
    G.active = [];
    G.multiHoldPointers?.clear?.();
    G.totalNotes = notes.reduce((sum, n) => sum + this.noteUnitCount(n), 0);
    G.remaining = G.totalNotes;
    G.songEnd = notes.reduce((max, n) => Math.max(max, n.time + n.dur), 0);
  }

  reset(): void {
    const G = this.d.G;
    G.pending = [];
    G.pendingIndex = 0;
    G.active = [];
    G.multiHoldPointers?.clear?.();
    G.totalNotes = 0;
    G.remaining = 0;
    G.songEnd = 0;
  }

  holdTickCount(n: any): number { return Math.max(0, Math.floor(Number(n?.density) || 0)); }

  noteUnitCount(n: any): number {
    if (n?.isMultiHold || n?.type === 'multiHold') {
      const dur = Math.max(0, Number(n?.dur ?? (Number(n?.endTime) - Number(n?.startTime))) || 0);
      const interval = Math.max(50, Number(n?.tickIntervalMs ?? n?.multiHoldNote?.tickIntervalMs) || 500);
      return 1 + Math.floor(dur / interval);
    }
    return n?.type === 'hold' || n?.isHold ? 1 + this.holdTickCount(n) : 1;
  }

  updateSpawn(t: number): void {
    const G = this.d.G;
    const visible = (G.fallTime || 1500) + 80;
    while (G.pendingIndex < G.pending.length) {
      const n = G.pending[G.pendingIndex];
      if (n.time - t <= visible) {
        G.pendingIndex++;
        this.createNote(n);
      } else break;
    }
  }

  createNote(n: any): RuntimeNote {
    const note: RuntimeNote = {
      id: n.id,
      type: n.type,
      time: Number(n.time) || 0,
      dur: Number(n.dur) || 0,
      lane: Number(n.lane) || 0,
      laneCount: this.d.laneCountAtTime(Number(n.time) || 0),
      isHold: n.type === 'hold',
      isMultiHold: n.type === 'multiHold',
      judged: false,
      holding: false,
      holdId: null,
      dead: false,
      autoComplete: false,
      finished: false,
      density: Number(n.density) || 0,
      path: n.path || null,
      fadeEndTime: 0,
      fadeDuration: 0,
      gray: false,
      pathSamples: null,
      tickUs: null,
      _pathCache: null,
      _laneCache: null,
      lanes: n.lanes,
      tickIntervalMs: n.tickIntervalMs
    };

    if (note.isMultiHold && n.multiHoldNote) {
      const offset = Number(this.d.G.offset) || 0;
      const adjustedNote: MultiHoldNote = {
        ...n.multiHoldNote,
        startTime: n.multiHoldNote.startTime + offset,
        endTime: n.multiHoldNote.endTime + offset
      };
      note.multiHoldData = adjustedNote;
      note.multiHoldAdapter = this.d.createMultiHoldAdapter?.(adjustedNote, note);
    } else if (note.isHold) {
      note.pathSamples = this.buildHoldPathCache(note);
      note._pathCache = note.pathSamples;
      const count = this.holdTickCount(note);
      note.tickUs = new Array(count);
      for (let i = 0; i < count; i++) note.tickUs[i] = (i + 1) / (count + 1);
    }

    this.d.G.active.push(note);
    return note;
  }

  holdPathSamples(n: any): HoldPathRawPoint[] {
    const raw = Array.isArray(n.path) && n.path.length ? n.path : [[0, n.lane], [n.dur, n.lane]];
    const laneMax = Math.max(0, this.noteLaneCount(n) - 1);
    const pts = raw.map((p: any) => ({
      dt: clamp(Number(p[0]) || 0, 0, Math.max(0, Number(n.dur) || 0)),
      lane: clamp(Number(p[1]) || 0, 0, laneMax)
    })).sort((a: HoldPathRawPoint, b: HoldPathRawPoint) => a.dt - b.dt);
    if (!pts.length) return [{ dt: 0, lane: clamp(Number(n.lane) || 0, 0, laneMax) }];
    if (pts[0]!.dt !== 0) pts.unshift({ dt: 0, lane: clamp(Number(n.lane) || 0, 0, laneMax) });
    if (pts[pts.length - 1]!.dt !== Number(n.dur || 0)) pts.push({ dt: Number(n.dur || 0), lane: pts[pts.length - 1]!.lane });
    return pts;
  }

  noteLaneCount(n: any): number { return Number(n?.laneCount) || this.d.laneCountAtTime(Number(n?.time) || 0) || 1; }

  pathLaneAt(path: HoldPathRawPoint[], dt: number, lc = 1): number {
    if (!path.length) return 0;
    if (dt <= path[0]!.dt) return path[0]!.lane;
    if (dt >= path[path.length - 1]!.dt) return path[path.length - 1]!.lane;
    let i = 1;
    while (i < path.length && dt > path[i]!.dt) i++;
    const p0 = path[Math.max(0, i - 2)]!, p1 = path[i - 1]!, p2 = path[i]!, p3 = path[Math.min(path.length - 1, i + 1)]!;
    const q = (dt - p1.dt) / Math.max(1, p2.dt - p1.dt), q2 = q * q, q3 = q2 * q;
    const lane = .5 * ((2 * p1.lane) + (-p0.lane + p2.lane) * q + (2 * p0.lane - 5 * p1.lane + 4 * p2.lane - p3.lane) * q2 + (-p0.lane + 3 * p1.lane - 3 * p2.lane + p3.lane) * q3);
    return clamp(lane, 0, Math.max(0, lc - 1));
  }

  buildHoldPathCache(n: RuntimeNote): HoldPathCache {
    const raw = this.holdPathSamples(n), steps = clamp(Math.max(24, raw.length * 8, Math.ceil(n.dur / 48)), 24, 96), samples: HoldPathSample[] = new Array(steps + 1);
    for (let i = 0; i <= steps; i++) { const u = i / steps; samples[i] = { u, lane: this.pathLaneAt(raw, u * n.dur, this.noteLaneCount(n)) }; }
    return { raw, samples, steps };
  }

  curveLaneAt(cache: HoldPathCache | null, u: number): number {
    if (!cache?.samples?.length) return 0;
    const s = cache.samples, cl = clamp(u, 0, 1);
    if (cl <= s[0]!.u) return s[0]!.lane;
    const last = s[s.length - 1]!;
    if (cl >= last.u) return last.lane;
    const pos = cl * cache.steps, i = Math.min(cache.steps - 1, Math.max(0, Math.floor(pos))), a = s[i]!, b = s[i + 1]!, q = (cl - a.u) / Math.max(1e-6, b.u - a.u);
    return a.lane + (b.lane - a.lane) * q;
  }

  makeCurvePath(n: RuntimeNote): HoldPathCache { if (n._pathCache) return n._pathCache; n._pathCache = n.pathSamples || (n.pathSamples = this.buildHoldPathCache(n)); return n._pathCache; }
  holdLaneAtTime(n: RuntimeNote, t: number): number { const c = this.makeCurvePath(n), u = clamp(t - (n.time + Number(this.d.G.offset || 0)), 0, n.dur) / Math.max(1, n.dur); return this.curveLaneAt(c, u); }
}

function normalizeLanes(lanes: number[], laneCount: number): number[] {
  const max = Math.max(0, laneCount - 1);
  const out = [...new Set((Array.isArray(lanes) ? lanes : []).map((lane) => clamp(Math.floor(Number(lane) || 0), 0, max)))].sort((a, b) => a - b);
  return out.length ? out : [0];
}
function clamp(v: number, a: number, b: number) { return v < a ? a : v > b ? b : v; }
