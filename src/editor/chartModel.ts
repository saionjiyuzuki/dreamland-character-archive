/**
 * Editor-side chart model. Notes live on integer ticks (see timing.ts) and are converted to the game's Chart format
 * (milliseconds) only on export, so moving a BPM marker or the offset moves every note with the music.
 */
import type { Chart, ChartNote, LaneSection, RawNote } from '../core/types.js';
import type { MultiHoldNote, MultiHoldPathPoint } from '../chart/multiHoldSchema.js';
import { TimingMap, normalizeTiming, type TimingData } from './timing.js';

export const LANE_OPTIONS = [4, 6, 8] as const;
export interface TapNote { id: string; kind: 'tap'; tick: number; lane: number }
export interface HoldPoint { tick: number; lane: number }
/** points[0] is the head, the last point the tail; the game interpolates the lanes with a Catmull-Rom spline. */
export interface HoldNote { id: string; kind: 'hold'; points: HoldPoint[] }
/** Lane-boundary coordinates: a lane l spans [l, l + 1]. */
export interface AreaPoint { tick: number; left: number; right: number }
export interface MultiNote { id: string; kind: 'multi'; points: AreaPoint[]; tickIntervalMs?: number }
export type EditorNote = TapNote | HoldNote | MultiNote;
/** Lane count from `tick` on; sections[0] also covers everything before it. */
export interface Section { tick: number; lanes: number }
export interface ChartMeta {
  id: string; title: string; artist: string; diff: number; jacket: string;
  songId?: string; difficulty?: string; sourceAudio?: string;
  /** Song length in seconds (the end of the last lane section). */
  duration: number;
  /** Keep the decorative geometry backdrop; its beat follows the timing offset. */
  backdrop: boolean;
  /** Chart fields the editor does not edit (design notes etc.), written back unchanged. */
  extra: Record<string, unknown>;
}
export interface EditorProject {
  format: 'dreamland-chart-project'; version: 1;
  meta: ChartMeta; timing: TimingData; sections: Section[]; notes: EditorNote[];
  /** Built-in audio URL; local files are not stored and must be loaded again. */
  audioUrl?: string; audioName?: string;
}
export interface ImportReport { notes: number; offGrid: number }

export const noteStart = (n: EditorNote) => (n.kind === 'tap' ? n.tick : n.points[0]!.tick);
export const noteEnd = (n: EditorNote) => (n.kind === 'tap' ? n.tick : n.points[n.points.length - 1]!.tick);
export const sortNotes = (notes: EditorNote[]) => notes.sort((a, b) => noteStart(a) - noteStart(b) || laneOf(a) - laneOf(b));
/** Leftmost lane a note starts on (for sorting and labels). */
export const laneOf = (n: EditorNote) => (n.kind === 'tap' ? n.lane : n.kind === 'hold' ? n.points[0]!.lane : n.points[0]!.left);

let idSeq = 0;
export const newId = (prefix = 'n') => `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export function sortSections(sections: Section[]): Section[] {
  const list = sections.filter(s => LANE_OPTIONS.includes(s.lanes as 4)).sort((a, b) => a.tick - b.tick);
  return list.length ? list : [{ tick: 0, lanes: 4 }];
}
export function lanesAt(sections: Section[], tick: number): number {
  let k = sections[0]?.lanes ?? 4;
  for (let i = 1; i < sections.length; i++) if (tick >= sections[i]!.tick) k = sections[i]!.lanes;
  return k;
}
/** Index of the section a tick falls in. */
export function sectionIndex(sections: Section[], tick: number): number {
  let idx = 0;
  for (let i = 1; i < sections.length; i++) if (tick >= sections[i]!.tick) idx = i;
  return idx;
}

/** Same spline the game uses for hold paths and Multi Hold edges (chartRuntime.ts / holdPath.ts). */
export function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** Interpolates keyframes by key at x (keyframes sorted by x). */
export function splineAt<T>(pts: T[], x: number, key: (p: T) => number, val: (p: T) => number): number {
  if (x <= key(pts[0]!)) return val(pts[0]!);
  const last = pts[pts.length - 1]!;
  if (x >= key(last)) return val(last);
  let i = 0;
  while (i < pts.length - 2 && x > key(pts[i + 1]!)) i++;
  const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(pts.length - 1, i + 2)]!;
  const u = Math.max(0, Math.min(1, (x - key(p1)) / Math.max(1e-6, key(p2) - key(p1))));
  return catmull(val(p0), val(p1), val(p2), val(p3), u);
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const msOf = (map: TimingMap, tick: number) => Math.round(map.tickToMs(tick));

/** Game Chart for the current project. Taps / holds become RawNote arrays, Multi Holds MultiHoldNote objects. */
export function exportChart(p: EditorProject): Chart {
  const map = new TimingMap(p.timing), sections = sortSections(p.sections), duration = Math.max(1, p.meta.duration);
  const notes: ChartNote[] = [];
  let mh = 0;
  for (const n of sortNotes([...p.notes])) {
    if (n.kind === 'tap') { notes.push([msOf(map, n.tick), 'tap', n.lane, 0, 0]); continue; }
    const start = msOf(map, noteStart(n)), end = msOf(map, noteEnd(n)), dur = Math.max(0, end - start);
    // Hold ticks / Multi Hold judge ticks: one per eighth note at the head's tempo, like the generated charts.
    const halfBeat = map.beatMsAt(noteStart(n)) / 2;
    if (n.kind === 'hold') {
      const lane = n.points[0]!.lane;
      const path = n.points.map(pt => [Math.max(0, msOf(map, pt.tick) - start), r3(pt.lane)] as [number, number]);
      const raw: RawNote = [start, 'hold', lane, dur, Math.max(1, Math.round(dur / halfBeat)), path];
      notes.push(raw);
      continue;
    }
    const first = n.points[0]!, lanes: number[] = [];
    for (let l = Math.floor(first.left + 1e-6); l < Math.ceil(first.right - 1e-6); l++) lanes.push(l);
    const points: MultiHoldPathPoint[] = n.points.map(pt => ({ time: Math.max(0, msOf(map, pt.tick) - start), leftLane: r3(pt.left), rightLane: r3(pt.right) }));
    const note: MultiHoldNote = { id: `${p.meta.id}-mh-${String(++mh).padStart(2, '0')}`, type: 'multiHold', lanes, startTime: start, endTime: end,
      tickIntervalMs: Math.round(n.tickIntervalMs || halfBeat), path: { points } };
    notes.push(note);
  }
  const bounds = sections.map((s, i) => (i ? map.tickToMs(s.tick) / 1000 : 0));
  const laneSections: LaneSection[] = sections.map((s, i) => [r3(bounds[i]!), r3(i + 1 < sections.length ? bounds[i + 1]! : duration), s.lanes]);
  const m = p.meta;
  const chart: Chart = {
    ...m.extra, id: m.id, title: m.title, artist: m.artist, bpm: r3(map.bpmAt(0)), diff: m.diff, jacket: m.jacket,
    lanes: sections[0]!.lanes, duration: r3(duration), laneSections, notes,
  } as Chart;
  if (m.sourceAudio) chart.sourceAudio = m.sourceAudio;
  if (m.backdrop) chart.backdrop = { kind: 'geometry', firstBeatMs: Math.round(p.timing.offsetMs) };
  if (m.songId) chart.songId = m.songId;
  if (m.difficulty) chart.difficulty = m.difficulty as Chart['difficulty'];
  return chart;
}

/**
 * Converts milliseconds to ticks: snaps to the nearest 1/48 or 1/64 grid point when that is within 1.5 ms (the game
 * charts store rounded milliseconds), otherwise keeps the nearest tick and counts the note as off-grid.
 */
function tickFinder(map: TimingMap) {
  let offGrid = 0;
  const find = (ms: number, count = true): number => {
    const raw = map.msToTick(ms);
    let best = Math.round(raw), err = Infinity;
    for (const div of [48, 64]) {
      const t = map.snap(raw, div), e = Math.abs(map.tickToMs(t) - ms);
      if (e < err) { err = e; best = t; }
    }
    if (err <= 1.5) return best;
    if (count) offGrid++;
    return Math.round(raw);
  };
  return { find, offGrid: () => offGrid };
}

function multiEdges(pt: MultiHoldPathPoint): { left: number; right: number } | null {
  if (Number.isFinite(pt.leftLane) && Number.isFinite(pt.rightLane)) return { left: Number(pt.leftLane), right: Number(pt.rightLane) };
  if (Number.isFinite(pt.centerLane) && Number.isFinite(pt.width)) return { left: Number(pt.centerLane) - Number(pt.width) / 2, right: Number(pt.centerLane) + Number(pt.width) / 2 };
  if (Array.isArray(pt.lanes) && pt.lanes.length) return { left: Math.min(...pt.lanes), right: Math.max(...pt.lanes) + 1 };
  return null;
}

const KNOWN_KEYS = new Set(['id', 'title', 'artist', 'bpm', 'diff', 'jacket', 'lanes', 'duration', 'notes', 'laneSections', 'backdrop',
  'sourceAudio', 'songId', 'difficulty', 'editorTiming', '_multiHoldConflictReport', 'playtest', 'startAtMs']);

/** Chart field written by exportChart so BPM / meter changes survive a round trip through the game format. */
type ChartWithTiming = Chart & { editorTiming?: TimingData };

/** Builds a project from a game chart. Timing: the chart's editorTiming, else its BPM and backdrop beat (bar 0). */
export function importChart(chart: Chart, timing?: TimingData): { project: EditorProject; report: ImportReport } {
  const c = chart as ChartWithTiming;
  const t = normalizeTiming(timing || c.editorTiming || { offsetMs: Number(c.backdrop?.firstBeatMs) || 0, bpms: [{ tick: 0, bpm: Number(c.bpm) || 120 }], meters: [{ bar: 0, beats: 4 }] });
  const map = new TimingMap(t), tf = tickFinder(map), notes: EditorNote[] = [];
  for (const raw of (c.notes || []) as ChartNote[]) {
    if (Array.isArray(raw)) {
      const [ms, kind, lane, dur, , path] = raw;
      const start = Number(ms) || 0, l = Number(lane) || 0;
      if (kind !== 'hold' || !(Number(dur) > 0)) { notes.push({ id: newId(), kind: 'tap', tick: tf.find(start), lane: l }); continue; }
      const src = path?.length ? path : [[0, l], [Number(dur), l]];
      const pts = src.map(([off, pl]) => ({ tick: tf.find(start + Number(off)), lane: Number(pl) })).sort((a, b) => a.tick - b.tick);
      pts[0] = { tick: tf.find(start, false), lane: pts[0]!.tick === tf.find(start, false) ? pts[0]!.lane : l };
      const endTick = tf.find(start + Number(dur), false);
      if (pts[pts.length - 1]!.tick < endTick) pts.push({ tick: endTick, lane: pts[pts.length - 1]!.lane });
      notes.push({ id: newId(), kind: 'hold', points: dedupe(pts) });
      continue;
    }
    if ((raw as MultiHoldNote)?.type !== 'multiHold') continue;
    const n = raw as MultiHoldNote, start = Number(n.startTime) || 0, end = Math.max(start, Number(n.endTime) || start);
    const fallback = { left: Math.min(...(n.lanes?.length ? n.lanes : [0])), right: Math.max(...(n.lanes?.length ? n.lanes : [0])) + 1 };
    const src = n.path?.points?.length ? n.path.points : [{ time: 0, lanes: n.lanes }, { time: end - start, lanes: n.lanes }];
    const pts = src.map(pt => ({ tick: tf.find(start + Number(pt.time)), ...(multiEdges(pt) || fallback) })).sort((a, b) => a.tick - b.tick);
    const startTick = tf.find(start, false), endTick = tf.find(end, false);
    if (pts[0]!.tick > startTick) pts.unshift({ ...pts[0]!, tick: startTick });
    if (pts[pts.length - 1]!.tick < endTick) pts.push({ ...pts[pts.length - 1]!, tick: endTick });
    const note: MultiNote = { id: newId(), kind: 'multi', points: dedupe(pts) };
    const halfBeat = map.beatMsAt(startTick) / 2;
    if (Number.isFinite(n.tickIntervalMs) && Math.abs(Number(n.tickIntervalMs) - halfBeat) > 1) note.tickIntervalMs = Number(n.tickIntervalMs);
    notes.push(note);
  }
  const secs = c.laneSections?.length ? c.laneSections : [[0, Number(c.duration) || 0, Number(c.lanes) || 4] as LaneSection];
  const sections = sortSections(secs.map(([s, , k], i) => ({ tick: i ? tf.find(Number(s) * 1000, false) : 0, lanes: Number(k) })));
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (!KNOWN_KEYS.has(k)) extra[k] = v;
  const meta: ChartMeta = {
    id: String(c.id || 'custom_chart'), title: String(c.title || ''), artist: String(c.artist || ''), diff: Number(c.diff) || 1, jacket: String(c.jacket || '♪'),
    songId: c.songId, difficulty: c.difficulty, sourceAudio: c.sourceAudio, duration: Number(c.duration) || 0, backdrop: !!c.backdrop, extra,
  };
  return { project: { format: 'dreamland-chart-project', version: 1, meta, timing: t, sections, notes: sortNotes(notes) }, report: { notes: notes.length, offGrid: tf.offGrid() } };
}

/** Drops keyframes on the same tick (the later one wins), keeping at least head and tail. */
function dedupe<T extends { tick: number }>(pts: T[]): T[] {
  const out: T[] = [];
  for (const p of pts) { if (out.length && out[out.length - 1]!.tick === p.tick) out[out.length - 1] = p; else out.push(p); }
  if (out.length === 1) out.push({ ...out[0]!, tick: out[0]!.tick + 1 });
  return out;
}

export function emptyProject(): EditorProject {
  return {
    format: 'dreamland-chart-project', version: 1,
    meta: { id: 'custom_chart', title: '新谱面', artist: '', diff: 10, jacket: '♪', duration: 120, backdrop: true, extra: {} },
    timing: { offsetMs: 0, bpms: [{ tick: 0, bpm: 120 }], meters: [{ bar: 0, beats: 4 }] }, sections: [{ tick: 0, lanes: 4 }], notes: [],
  };
}

/** Accepts a saved project or a game chart (as parsed JSON). Project files are untrusted: every field is rebuilt. */
export function parseProjectJSON(value: unknown): { project: EditorProject; report?: ImportReport } {
  const v = value as Partial<EditorProject> & Partial<Chart>;
  if (v && v.format === 'dreamland-chart-project' && v.meta && v.timing && Array.isArray(v.notes) && Array.isArray(v.sections)) {
    const base = emptyProject(), m = v.meta as Partial<ChartMeta>;
    const str = (x: unknown, d: string) => (x == null ? d : String(x));
    const opt = (x: unknown) => (x == null ? undefined : String(x));
    const meta: ChartMeta = {
      id: str(m.id, base.meta.id), title: str(m.title, base.meta.title), artist: str(m.artist, ''), jacket: str(m.jacket, base.meta.jacket),
      diff: Math.round(num(m.diff, base.meta.diff)), duration: Math.max(0, num(m.duration, base.meta.duration)), backdrop: !!m.backdrop,
      songId: opt(m.songId), difficulty: opt(m.difficulty), sourceAudio: opt(m.sourceAudio),
      extra: m.extra && typeof m.extra === 'object' && !Array.isArray(m.extra) ? { ...m.extra } : {},
    };
    const sections = sortSections((v.sections as unknown[]).map(s => ({ tick: Math.round(num((s as Section)?.tick, NaN)), lanes: num((s as Section)?.lanes, NaN) })).filter(s => Number.isFinite(s.tick)));
    const notes = (v.notes as unknown[]).map(cleanNote).filter((n): n is EditorNote => !!n);
    const project: EditorProject = { format: 'dreamland-chart-project', version: 1, meta, timing: normalizeTiming(v.timing), sections, notes: sortNotes(notes) };
    if (v.audioUrl != null) project.audioUrl = String(v.audioUrl);
    if (v.audioName != null) project.audioName = String(v.audioName);
    return { project };
  }
  if (v && Array.isArray(v.notes)) return importChart(v as Chart);
  throw new Error('不是 DREAMLAND 谱面或编辑器工程文件');
}
/** Finite number or the fallback. */
const num = (x: unknown, d: number) => { const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : NaN; return Number.isFinite(n) ? n : d; };
/** A note from a project file rebuilt with numeric fields only, or null if it is not a usable note. */
function cleanNote(x: unknown): EditorNote | null {
  const n = x as Partial<EditorNote> | null;
  if (!n || typeof n !== 'object') return null;
  const id = n.id == null ? newId() : String(n.id), tick = (p: { tick?: unknown }) => Math.round(num(p?.tick, NaN));
  if (n.kind === 'tap') {
    const t = tick(n as TapNote), lane = Math.round(num((n as TapNote).lane, NaN));
    return Number.isFinite(t) && Number.isFinite(lane) ? { id, kind: 'tap', tick: t, lane } : null;
  }
  if ((n.kind !== 'hold' && n.kind !== 'multi') || !Array.isArray(n.points)) return null;
  if (n.kind === 'hold') {
    const points = (n.points as unknown[]).map(p => ({ tick: tick(p as HoldPoint), lane: num((p as HoldPoint)?.lane, NaN) }))
      .filter(p => Number.isFinite(p.tick) && Number.isFinite(p.lane)).sort((a, b) => a.tick - b.tick);
    return points.length >= 2 ? { id, kind: 'hold', points: dedupe(points) } : null;
  }
  const points = (n.points as unknown[]).map(p => ({ tick: tick(p as AreaPoint), left: num((p as AreaPoint)?.left, NaN), right: num((p as AreaPoint)?.right, NaN) }))
    .filter(p => Number.isFinite(p.tick) && Number.isFinite(p.left) && Number.isFinite(p.right) && p.right > p.left).sort((a, b) => a.tick - b.tick);
  if (points.length < 2) return null;
  const out: MultiNote = { id, kind: 'multi', points: dedupe(points) };
  const iv = num((n as MultiNote).tickIntervalMs, NaN);
  if (iv > 0) out.tickIntervalMs = iv;
  return out;
}

/** Chart JSON for the game, with the editor timing attached so the file can be re-imported losslessly. */
export function exportChartWithTiming(p: EditorProject): Chart {
  return { ...exportChart(p), editorTiming: normalizeTiming(p.timing) } as Chart;
}

/** Id of the chart the editor hands to the game for a playtest. */
export const PLAYTEST_CHART_ID = 'editor_playtest';
/**
 * Game chart for a playtest starting at `startMs`: notes that start earlier are dropped and everything is shifted so
 * `startMs` becomes 0 (the audio is trimmed the same way).
 */
export function playtestChart(p: EditorProject, startMs: number): Chart {
  const c = exportChart(p), s = Math.max(0, startMs), sec = s / 1000;
  const notes: ChartNote[] = [];
  for (const n of c.notes) {
    if (Array.isArray(n)) { if (n[0] >= s) notes.push([n[0] - s, ...n.slice(1)] as RawNote); continue; }
    const m = n as MultiHoldNote;
    if (m.startTime >= s) notes.push({ ...m, startTime: m.startTime - s, endTime: m.endTime - s });
  }
  const laneSections = (c.laneSections || []).filter(x => x[1] > sec).map(x => [r3(Math.max(0, x[0] - sec)), r3(x[1] - sec), x[2]] as LaneSection);
  const out: Chart = { ...c, id: PLAYTEST_CHART_ID, title: `${c.title} · 试玩`, notes, laneSections, duration: r3(Math.max(1, c.duration - sec)), lanes: laneSections[0]?.[2] ?? c.lanes } as Chart;
  if (c.backdrop) out.backdrop = { ...c.backdrop, firstBeatMs: Math.round(c.backdrop.firstBeatMs - s) };
  (out as Chart & { playtest?: boolean }).playtest = true;
  return out;
}
