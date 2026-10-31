/**
 * Pure editing operations on an EditorProject (no DOM), plus undo history and chart checks. Everything that changes
 * notes goes through here so it is testable in node.
 */
import { TimingMap } from './timing.js';
import { lanesAt, newId, noteEnd, noteStart, sectionIndex, sortNotes, sortSections, splineAt, type EditorNote, type EditorProject, type Section } from './chartModel.js';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class History {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  constructor(private readonly limit = 300) {}
  /** Call with the state *before* a change. */
  push(p: EditorProject): void {
    this.undoStack.push(JSON.stringify(p));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: EditorProject): EditorProject | null {
    const prev = this.undoStack.pop(); if (!prev) return null;
    this.redoStack.push(JSON.stringify(current));
    return JSON.parse(prev) as EditorProject;
  }
  redo(current: EditorProject): EditorProject | null {
    const next = this.redoStack.pop(); if (!next) return null;
    this.undoStack.push(JSON.stringify(current));
    return JSON.parse(next) as EditorProject;
  }
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}

/** Lane range [left, right) a note covers at its head. */
export function headRange(n: EditorNote): [number, number] {
  if (n.kind === 'tap') return [n.lane, n.lane + 1];
  if (n.kind === 'hold') return [n.points[0]!.lane, n.points[0]!.lane + 1];
  return [n.points[0]!.left, n.points[0]!.right];
}

/** Note with the same head tick and the same lane as a tap / hold head (exact duplicates are never wanted). */
export function findAt(p: EditorProject, tick: number, lane: number): EditorNote | undefined {
  return p.notes.find(n => n.kind !== 'multi' && noteStart(n) === tick && headRange(n)[0] === lane);
}

export function addNote(p: EditorProject, n: EditorNote): EditorNote {
  if (n.kind !== 'multi') {
    const dup = findAt(p, noteStart(n), headRange(n)[0]);
    if (dup) p.notes.splice(p.notes.indexOf(dup), 1);
  }
  p.notes.push(n); sortNotes(p.notes);
  return n;
}
export const makeTap = (tick: number, lane: number): EditorNote => ({ id: newId(), kind: 'tap', tick, lane });
export function makeHold(a: number, b: number, lane: number, endLane = lane): EditorNote {
  const [s, e] = a <= b ? [a, b] : [b, a];
  return { id: newId(), kind: 'hold', points: [{ tick: s, lane }, { tick: e, lane: endLane }] };
}
export function makeMulti(a: number, b: number, left: number, right: number): EditorNote {
  const [s, e] = a <= b ? [a, b] : [b, a], [l, r] = left <= right ? [left, right] : [right, left];
  return { id: newId(), kind: 'multi', points: [{ tick: s, left: l, right: Math.max(l + 1, r) }, { tick: e, left: l, right: Math.max(l + 1, r) }] };
}

export function removeNotes(p: EditorProject, ids: Set<string>): number {
  const before = p.notes.length; p.notes = p.notes.filter(n => !ids.has(n.id)); return before - p.notes.length;
}

/** Shifts every point of a note by dTick and dLane, keeping it inside the lane count at its new head. */
export function shifted(n: EditorNote, dTick: number, dLane: number, sections: Section[]): EditorNote {
  const c = clone(n);
  const k = lanesAt(sections, noteStart(n) + dTick);
  if (c.kind === 'tap') { c.tick += dTick; c.lane = clamp(c.lane + dLane, 0, k - 1); return c; }
  if (c.kind === 'hold') {
    const lo = Math.min(...c.points.map(q => q.lane)), hi = Math.max(...c.points.map(q => q.lane));
    const d = clamp(dLane, -lo, k - 1 - hi);
    c.points.forEach(q => { q.tick += dTick; q.lane = clamp(q.lane + d, 0, k - 1); });
    return c;
  }
  const lo = Math.min(...c.points.map(q => q.left)), hi = Math.max(...c.points.map(q => q.right));
  const d = clamp(dLane, -lo, k - hi);
  c.points.forEach(q => { q.tick += dTick; q.left += d; q.right += d; });
  return c;
}

/** Replaces notes by id (e.g. after a drag). */
export function replaceNotes(p: EditorProject, next: EditorNote[]): void {
  const by = new Map(next.map(n => [n.id, n]));
  p.notes = p.notes.map(n => by.get(n.id) || n); sortNotes(p.notes);
}

/** Mirrors notes left-right inside the lane count of their section. */
export function mirrored(n: EditorNote, sections: Section[]): EditorNote {
  const c = clone(n), k = lanesAt(sections, noteStart(n));
  if (c.kind === 'tap') c.lane = k - 1 - c.lane;
  else if (c.kind === 'hold') c.points.forEach(q => { q.lane = k - 1 - q.lane; });
  else c.points.forEach(q => { const l = q.left; q.left = k - q.right; q.right = k - l; });
  return c;
}

/** Moves every point of a note to the nearest point of a 1/div grid; holds keep at least one grid step of length. */
export function quantized(n: EditorNote, map: TimingMap, div: number): EditorNote {
  const c = clone(n);
  if (c.kind === 'tap') { c.tick = map.snap(c.tick, div); return c; }
  const pts = c.points as { tick: number }[];
  pts.forEach(q => { q.tick = map.snap(q.tick, div); });
  for (let i = 1; i < pts.length; i++) if (pts[i]!.tick <= pts[i - 1]!.tick) pts[i]!.tick = map.step(pts[i - 1]!.tick, div, 1);
  return c;
}

/** Copied notes relative to the earliest head, pasted so that head lands on `atTick`. */
export function pasteNotes(p: EditorProject, clip: EditorNote[], atTick: number): EditorNote[] {
  if (!clip.length) return [];
  const base = Math.min(...clip.map(noteStart));
  const sections = sortSections(p.sections);
  const out = clip.map(n => ({ ...shifted(n, atTick - base, 0, sections), id: newId() }) as EditorNote);
  for (const n of out) addNote(p, n);
  return out;
}

/** Sets one keyframe of a hold (lane) or Multi Hold (an edge), keeping ticks ordered between its neighbours. */
export function withKeyframe(n: EditorNote, index: number, tick: number, value: number, edge: 'lane' | 'left' | 'right', k: number): EditorNote {
  const c = clone(n); if (c.kind === 'tap') return c;
  const pts = c.points as { tick: number }[];
  const lo = index > 0 ? pts[index - 1]!.tick + 1 : -Infinity, hi = index < pts.length - 1 ? pts[index + 1]!.tick - 1 : Infinity;
  if (index > 0) pts[index]!.tick = clamp(tick, lo, hi);
  if (c.kind === 'hold') c.points[index]!.lane = clamp(Math.round(value), 0, k - 1);
  else {
    const q = c.points[index]!;
    if (edge === 'left') q.left = clamp(value, 0, q.right - 1);
    else q.right = clamp(value, q.left + 1, k);
  }
  return c;
}
/** Inserts a keyframe on the body at `tick` with the currently interpolated lane / edges. */
export function insertKeyframe(n: EditorNote, tick: number): EditorNote {
  const c = clone(n); if (c.kind === 'tap' || tick <= noteStart(c) || tick >= noteEnd(c)) return c;
  if (c.kind === 'hold') {
    const lane = Math.round(splineAt(c.points, tick, q => q.tick, q => q.lane));
    if (c.points.some(q => q.tick === tick)) return c;
    c.points.push({ tick, lane }); c.points.sort((a, b) => a.tick - b.tick);
  } else {
    const left = Math.round(splineAt(c.points, tick, q => q.tick, q => q.left) * 4) / 4, right = Math.round(splineAt(c.points, tick, q => q.tick, q => q.right) * 4) / 4;
    if (c.points.some(q => q.tick === tick)) return c;
    c.points.push({ tick, left, right: Math.max(left + 1, right) }); c.points.sort((a, b) => a.tick - b.tick);
  }
  return c;
}
/** Removes an inner keyframe (head and tail stay). */
export function withoutKeyframe(n: EditorNote, index: number): EditorNote {
  const c = clone(n); if (c.kind === 'tap' || index <= 0 || index >= c.points.length - 1) return c;
  (c.points as unknown[]).splice(index, 1); return c;
}
/** Sets the tail of a hold / Multi Hold, keeping it after the last inner keyframe. */
export function withEnd(n: EditorNote, tick: number): EditorNote {
  const c = clone(n); if (c.kind === 'tap') return c;
  const pts = c.points as { tick: number }[];
  pts[pts.length - 1]!.tick = Math.max(tick, pts[pts.length - 2]!.tick + 1);
  return c;
}

/** Inserts or replaces a lane section at a tick. */
export function setSection(p: EditorProject, tick: number, lanes: number): void {
  const secs = p.sections.filter(s => s.tick !== tick); secs.push({ tick, lanes }); p.sections = sortSections(secs);
  if (p.sections[0]!.tick !== 0) p.sections[0]!.tick = 0;
}

export interface Issue { tick: number; level: 'error' | 'warn'; msg: string; ids: string[] }
/** Lane-change animation needs a quiet stretch around the section boundary (see scripts/charts/playability.mjs). */
const MORPH_QUIET_BEFORE_MS = 170, MORPH_QUIET_AFTER_MS = 760;

/** Structural chart checks: lanes, lane sections, overlaps, END, keyframe order. */
export function checkProject(p: EditorProject): Issue[] {
  const map = new TimingMap(p.timing), secs = sortSections(p.sections), out: Issue[] = [], endMs = p.meta.duration * 1000;
  const ms = (t: number) => map.tickToMs(t);
  for (const n of p.notes) {
    const a = noteStart(n), b = noteEnd(n), k = lanesAt(secs, a), ids = [n.id];
    if (ms(a) < 0) out.push({ tick: a, level: 'error', msg: '音符在 0 秒之前', ids });
    if (ms(b) > endMs) out.push({ tick: a, level: 'error', msg: '音符超出歌曲结尾 (END)', ids });
    if (sectionIndex(secs, a) !== sectionIndex(secs, b)) out.push({ tick: a, level: 'error', msg: '长条跨越了变轨点', ids });
    if (n.kind === 'tap' && (n.lane < 0 || n.lane >= k)) out.push({ tick: a, level: 'error', msg: `轨道 ${n.lane + 1} 不在 ${k}K 中`, ids });
    if (n.kind === 'hold' && n.points.some(q => q.lane < 0 || q.lane >= k)) out.push({ tick: a, level: 'error', msg: `长条路径超出 ${k}K`, ids });
    if (n.kind === 'multi' && n.points.some(q => q.left < 0 || q.right > k || q.right - q.left < 1)) out.push({ tick: a, level: 'error', msg: `Multi Hold 范围超出 ${k}K 或窄于 1 轨`, ids });
    if (n.kind !== 'tap') {
      const pts = n.points as { tick: number }[];
      if (pts.some((q, i) => i && q.tick <= pts[i - 1]!.tick)) out.push({ tick: a, level: 'error', msg: '关键帧顺序错误', ids });
      if (b - a < 24) out.push({ tick: a, level: 'warn', msg: '长条短于 1/32 拍', ids });
    }
    for (let i = 1; i < secs.length; i++) {
      const x = ms(secs[i]!.tick);
      if (ms(b) > x - MORPH_QUIET_BEFORE_MS && ms(a) < x + MORPH_QUIET_AFTER_MS) { out.push({ tick: a, level: 'warn', msg: '离变轨点太近 (变轨动画期间不应有音符)', ids }); break; }
    }
  }
  // Taps inside a hold / Multi Hold on the same lane: the game's load-time sanitizer moves or removes them.
  const longs = p.notes.filter(n => n.kind !== 'tap');
  for (const t of p.notes) {
    if (t.kind !== 'tap') continue;
    for (const h of longs) {
      if (t.tick < noteStart(h) || t.tick > noteEnd(h)) continue;
      const hit = h.kind === 'hold' ? Math.abs(splineAt(h.points, t.tick, q => q.tick, q => q.lane) - t.lane) < 0.6
        : t.lane + 1 > splineAt(h.points, t.tick, q => q.tick, q => q.left) + 1e-6 && t.lane < splineAt(h.points, t.tick, q => q.tick, q => q.right) - 1e-6;
      if (hit) { out.push({ tick: t.tick, level: 'error', msg: 'Tap 压在长条上 (游戏会移走或删除它)', ids: [t.id, h.id] }); break; }
    }
  }
  // Two notes on the same tick and lane
  const seen = new Map<string, string>();
  for (const n of p.notes) {
    if (n.kind === 'multi') continue;
    const key = `${noteStart(n)}:${headRange(n)[0]}`, other = seen.get(key);
    if (other) out.push({ tick: noteStart(n), level: 'error', msg: '同一位置有重复音符', ids: [other, n.id] }); else seen.set(key, n.id);
  }
  return out.sort((x, y) => x.tick - y.tick);
}
