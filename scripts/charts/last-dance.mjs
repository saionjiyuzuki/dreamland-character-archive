/**
 * Generates the SP20 chart for Xomu - Last Dance (src/data/lastDanceChart.ts).
 * Run after `npm run build`:  node scripts/charts/last-dance.mjs
 *
 * Timing was measured from the FLAC: 175.00 BPM, first audible beat at 338ms (bar 0 downbeat = 338 - 1 beat).
 * last-dance.onsets.json holds per-bar 16th-note onset strengths (low / mid+high / air bands, ". : o O #"),
 * so notes are only placed where the music actually has something.
 * Every note goes through the hand model below and the result is verified by playability.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChart, RULES } from './playability.mjs';
import { sampleMultiHoldPath } from '../../dist/chart/holdPath.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ON = JSON.parse(fs.readFileSync(path.join(here, 'last-dance.onsets.json'), 'utf8'));
const BPM = 175, BEAT = 60000 / BPM, S16 = BEAT / 4, BAR = BEAT * 4, FIRST_BEAT_MS = 338, T0 = FIRST_BEAT_MS - BEAT;
const DURATION = 205.357;
const t = (m, s = 0) => Math.round(T0 + m * BAR + s * S16);
const lv = (m, s, band) => (m < ON.length ? '.:oO#'.indexOf(ON[m][band][s]) : 0); // band 0 low, 1 mid/high, 2 air
const S = (m, s) => Math.max(lv(m, s, 0), lv(m, s, 1), lv(m, s, 2));

// Lane morphs happen three beats before the section's downbeat. The renderer lays out every visible note with
// the current lane count, so the quiet window covers the 720ms morph animation; pickups resume on the last 16ths.
const SECTIONS = [[0, 4], [24, 6], [32, 8], [72, 6], [90, 4], [97, 6], [106, 8], [129, 6], [138, 8]];
const MORPHS = SECTIONS.slice(1).map(([m]) => Math.round(t(m) - 3 * BEAT));
const K_AT = ms => { let k = SECTIONS[0][1]; MORPHS.forEach((x, i) => { if (ms >= x) k = SECTIONS[i + 1][1]; }); return k; };
const quietOk = (a, b) => MORPHS.every(x => !(b > x - RULES.morphQuietBeforeMs && a < x + RULES.morphQuietAfterMs));
const sameSection = (a, b) => K_AT(a) === K_AT(b) && MORPHS.every(x => !(a < x && b >= x));

const notes = [];
const hand = [{ end: -1e9, lane: null, K: 0 }, { end: -1e9, lane: null, K: 0 }];
const cur = [0, 0];
let lastHand = 1, mhCount = 0;
const free = (h, tm) => tm - hand[h].end >= RULES.handGapMs;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const side = (K, h) => (h ? [K / 2, K - 1] : [0, K / 2 - 1]);

const SEQ = {
  bounce: (i, n) => { const p = Math.max(1, 2 * (n - 1)), r = i % p; return r < n ? r : p - r; },
  zig: (i, n) => [[0], [0, 1], [0, 2, 1], [0, 2, 1, 3]][n - 1][i % n],
  trill: (i, n) => Math.max(0, n - 2) + (i % 2),
  center: (i, n) => Math.min(n - 1, i % 2),
};
// rel 0 = lane next to the centre for 'mirror'; 'parallel' moves both hands the same way (double helix).
const absLane = (h, r, geom, n) => (h ? n + r : geom === 'mirror' ? n - 1 - r : r);
function fitLane(h, tm, lane, K) {
  const [lo, hi] = side(K, h), st = hand[h];
  lane = clamp(lane, lo, hi);
  if (st.lane !== null && st.K === K && tm - st.end < RULES.jumpWindowMs) lane = clamp(lane, st.lane - RULES.maxJump, st.lane + RULES.maxJump);
  return lane;
}
const RESERVED = []; // [hand, start, end] of every scheduled hold / multi hold
const reserved = (h, tm) => RESERVED.some(([rh, a, b]) => (rh === h || rh === 'both') && tm > a - RULES.handGapMs && tm < b + RULES.handGapMs);
function tapAt(tm, h, r, geom) {
  const K = K_AT(tm), n = K / 2;
  if (tm < 600 || !free(h, tm) || reserved(h, tm) || !quietOk(tm, tm)) return false;
  const lane = fitLane(h, tm, absLane(h, r, geom, n), K);
  notes.push([tm, 'tap', lane, 0, 0]);
  hand[h] = { end: tm, lane, K };
  return true;
}
function single(tm, o) {
  const order = o.only !== undefined ? [o.only] : [1 - lastHand, lastHand];
  const n = K_AT(tm) / 2;
  for (const h of order) if (tapAt(tm, h, SEQ[o.seq](cur[h], n), o.geom)) { cur[h]++; lastHand = h; return true; }
  return false;
}
function chord(tm, o) {
  const n = K_AT(tm) / 2;
  if (o.only !== undefined || !free(0, tm) || !free(1, tm)) return single(tm, o);
  const r = SEQ[o.seq](cur[0], n);
  tapAt(tm, 0, r, o.geom); tapAt(tm, 1, r, o.geom);
  cur[0]++; cur[1] = cur[0];
  return true;
}
/** Plays one bar; pick(m, s) returns 0 (rest), 1 (single) or 2 (chord). */
function bar(m, o) {
  const opt = { seq: 'bounce', geom: 'mirror', ...o };
  for (let s = 0; s < 16; s++) { const c = opt.pick(m, s); if (c >= 2) chord(t(m, s), opt); else if (c === 1) single(t(m, s), opt); }
}
/** Single hold; rel/slide are relative to the hand side (rel 0 = centre). The path slides at most one lane. */
function hold(tm, h, slots, rel, slide, shape = 'arc') {
  const K = K_AT(tm), n = K / 2, dur = Math.round(slots * S16);
  if (!free(h, tm) || !quietOk(tm, tm + dur) || !sameSection(tm, tm + dur)) return false;
  rel = clamp(rel, 0, n - 1); if (rel + slide > n - 1 || rel + slide < 0) slide = -slide;
  const a = absLane(h, rel, 'mirror', n), b = absLane(h, rel + slide, 'mirror', n), [lo, hi] = side(K, h);
  const lane = fitLane(h, tm, a, K); let end = lane + (b - a);
  if (end < lo || end > hi) end = lane - (b - a);
  const p = shape === 'arc' ? [[0, lane], [Math.round(dur / 2), end], [dur, lane]] : [[0, lane], [dur, end]];
  notes.push([tm, 'hold', lane, dur, Math.max(1, Math.round(dur / (BEAT / 2))), p]);
  hand[h] = { end: tm + dur, lane: p[p.length - 1][1], K };
  return true;
}
/**
 * Multi Hold; h = 0/1 (one hand, other hand keeps playing) or 'both'. kf = [[slot, leftEdge, rightEdge], ...]
 * in lane-boundary coordinates of the current section.
 */
function multi(tm, h, slots, kf) {
  const dur = Math.round(slots * S16), hands = h === 'both' ? [0, 1] : [h];
  if (!hands.every(x => free(x, tm)) || !quietOk(tm, tm + dur) || !sameSection(tm, tm + dur)) return false;
  // The game interpolates keyframes with a Catmull-Rom spline, which overshoots at turning points. Pull the
  // keyframes towards the hand side's centre until the sampled path stays on that side (or inside the lanes).
  const K = K_AT(tm), lo = h === 1 ? K / 2 : 0, hi = h === 0 ? K / 2 : K, mid = (lo + hi) / 2;
  const make = f => ({ id: `ld-mh-${String(mhCount + 1).padStart(2, '0')}`, type: 'multiHold', lanes: [], startTime: tm, endTime: tm + dur, tickIntervalMs: Math.round(BEAT / 2),
    path: { points: kf.map(([sl, l, r]) => ({ time: Math.round(sl * S16), leftLane: +(mid + (l - mid) * f).toFixed(3), rightLane: +(mid + (r - mid) * f).toFixed(3) })) } });
  let note = make(1);
  for (let f = 1; f > 0.5; f -= 0.02) {
    note = make(f);
    const sm = sampleMultiHoldPath(note, { laneCount: 8 });
    if (sm.every(x => x.leftLane >= lo - 1e-6 && x.rightLane <= hi + 1e-6)) break;
  }
  const p0 = note.path.points[0];
  for (let l = Math.floor(p0.leftLane + 1e-6); l < Math.ceil(p0.rightLane - 1e-6); l++) note.lanes.push(l);
  mhCount++;
  notes.push(note);
  for (const x of hands) hand[x] = { end: tm + dur, lane: null, K: K_AT(tm) };
  return true;
}

/* ── Event queue: everything is placed in time order so the hand model sees notes as they come. ── */
const EV = [];
const onBars = (m0, m1, o) => { for (let m = m0; m <= m1; m++) for (let s = 0; s < 16; s++) EV.push({ tm: t(m, s), prio: 1, run: () => { const c = o.pick(m, s); const opt = { seq: 'bounce', geom: 'mirror', ...o }; if (c >= 2) chord(t(m, s), opt); else if (c === 1) single(t(m, s), opt); } }); };
const failed = [];
const H = (m, s, h, slots, rel, slide, shape) => { RESERVED.push([h, t(m, s), t(m, s) + slots * S16]); EV.push({ tm: t(m, s), prio: 0, run: () => hold(t(m, s), h, slots, rel, slide, shape) || failed.push(`hold bar ${m}`) }); };
const M = (m, s, h, slots, kf) => { RESERVED.push([h, t(m, s), t(m, s) + slots * S16]); EV.push({ tm: t(m, s), prio: 0, run: () => multi(t(m, s), h, slots, kf) || failed.push(`multiHold bar ${m}`) }); };

const P = {
  intro: (m, s) => (s % 2 === 0 && S(m, s) >= 2 ? 1 : 0),
  build: (m, s) => (s === 0 && lv(m, s, 0) >= 3 ? 2 : s % 2 === 0 && S(m, s) >= 2 ? 1 : 0),
  verse: (m, s) => (s % 4 === 2 && lv(m, s, 0) >= 3 ? 2 : s % 2 === 0 && S(m, s) >= 1 ? 1 : S(m, s) >= 3 ? 1 : 0),
  chorus: (m, s) => (s % 4 === 0 && lv(m, s, 2) >= 4 ? 2 : s % 2 === 0 && S(m, s) >= 1 ? 1 : S(m, s) >= 2 ? 1 : 0),
  stream: () => 1,
  bridge: (m, s) => (lv(m, s, 0) >= 4 ? 2 : s % 2 === 0 && S(m, s) >= 2 ? 1 : 0),
  calm: (m, s) => (s % 4 === 0 && S(m, s) >= 1 ? 1 : 0),
  eighths: (m, s) => (s % 2 === 0 && S(m, s) >= 1 ? 1 : 0),
};

// ── 4K intro / build (bars 0-23)
onBars(0, 7, { pick: P.intro, seq: 'center' });
H(2, 0, 0, 8, 0, 1); H(6, 0, 1, 8, 0, 1);
onBars(8, 15, { pick: P.build });
H(12, 0, 0, 6, 1, -1, 'line'); H(14, 8, 1, 6, 1, -1, 'line');
onBars(16, 23, { pick: P.verse, seq: 'zig' });
M(20, 0, 'both', 12, [[0, 1, 3], [6, 0, 2], [12, 1, 3]]);
// ── 6K verse (bars 24-31): right-hand Multi Hold sweep while the left hand keeps the rhythm
onBars(24, 31, { pick: P.verse });
M(28, 0, 1, 32, [[0, 3, 5], [8, 4, 6], [16, 3, 5], [24, 4, 6], [32, 3.5, 5.5]]);
// ── 8K chorus 1 (bars 32-71)
onBars(32, 46, { pick: P.chorus });
onBars(47, 47, { pick: P.stream, seq: 'zig' });
onBars(48, 62, { pick: P.chorus, geom: 'parallel' });
onBars(63, 63, { pick: P.stream, seq: 'zig', geom: 'parallel' });
onBars(64, 71, { pick: P.chorus });
H(36, 0, 0, 8, 0, 1); H(44, 0, 1, 8, 0, 1);
M(40, 0, 0, 32, [[0, 0, 2], [8, 2, 4], [16, 1, 3], [24, 2, 4], [32, 0, 2]]);
H(52, 0, 1, 8, 1, -1); H(60, 0, 0, 8, 1, -1);
M(56, 0, 1, 32, [[0, 6, 8], [8, 4, 6], [16, 5, 7], [24, 4, 6], [32, 6, 8]]);
M(68, 0, 0, 16, [[0, 2, 4], [8, 0, 2], [16, 1, 3]]);
// ── breakdown: one wide Multi Hold across the silence, then the 6K bridge (bars 72-89)
M(72, 0, 'both', 28, [[0, 2, 4], [8, 1, 5], [16, 2, 4], [28, 2.5, 3.5]]);
onBars(74, 89, { pick: P.bridge });
H(78, 0, 1, 6, 0, 1); H(82, 0, 0, 6, 0, 1); H(86, 0, 1, 6, 1, -1);
// ── 4K calm (bars 90-96)
M(90, 0, 'both', 32, [[0, 0, 2], [8, 1, 3], [16, 2, 4], [24, 1, 3], [32, 0, 2]]);
onBars(92, 96, { pick: P.calm, seq: 'center' });
M(94, 0, 0, 24, [[0, 0, 1], [8, 1, 2], [16, 0, 1], [24, 0.5, 1.5]]);
// ── 6K build (bars 97-105)
onBars(97, 103, { pick: P.verse });
onBars(104, 105, { pick: P.eighths, seq: 'zig' });
H(100, 0, 0, 8, 0, 1);
// ── 8K chorus 2 (bars 106-128)
onBars(106, 120, { pick: P.chorus, geom: 'parallel' });
onBars(121, 121, { pick: P.stream, seq: 'zig' });
onBars(122, 128, { pick: P.chorus });
H(110, 0, 1, 8, 0, 1); H(118, 0, 0, 8, 0, 1); H(126, 0, 1, 8, 1, -1);
M(114, 0, 0, 32, [[0, 0, 2], [8, 2, 4], [16, 0, 2], [24, 1, 3], [32, 2, 4]]);
M(122, 0, 1, 24, [[0, 4, 6], [8, 6, 8], [16, 5, 7], [24, 4, 6]]);
// ── 6K interlude (bars 129-137)
onBars(129, 137, { pick: P.eighths, seq: 'zig' });
H(130, 0, 0, 8, 0, 1); H(134, 0, 1, 8, 0, 1);
// ── 8K final chorus (bars 138-145)
onBars(138, 142, { pick: P.chorus });
onBars(143, 143, { pick: P.stream, seq: 'zig' });
onBars(144, 144, { pick: P.chorus });
M(140, 0, 1, 16, [[0, 4, 6], [8, 6, 8], [16, 5, 7]]);
M(145, 0, 'both', 16, [[0, 2, 6], [8, 1, 7], [16, 3, 5]]);

EV.sort((a, b) => a.tm - b.tm || a.prio - b.prio).forEach(e => e.run());
const noteTime = n => (Array.isArray(n) ? n[0] : n.startTime);
notes.sort((a, b) => noteTime(a) - noteTime(b));

const laneSections = SECTIONS.map(([, k], i) => [i ? MORPHS[i - 1] / 1000 : 0, i < MORPHS.length ? MORPHS[i] / 1000 : DURATION, k]);
const chart = {
  id: 'song_sp_last_dance', title: 'Last Dance', artist: 'Xomu', bpm: BPM, diff: 20, jacket: '✦', lanes: 4,
  sourceAudio: 'Last Dance-Xomu.flac', duration: DURATION, laneSections,
  backdrop: { kind: 'geometry', firstBeatMs: FIRST_BEAT_MS },
  spRevision: 'SP20-LAST-DANCE-V1',
  designNotes: [
    `175 BPM, first beat ${FIRST_BEAT_MS}ms, measured from the source FLAC; notes sit on 16th-note onsets of the track.`,
    `Generated by scripts/charts/last-dance.mjs and verified by scripts/charts/playability.mjs (hand gap ≥ ${RULES.handGapMs}ms, jumps ≤ ${RULES.maxJump} lanes, no tap under a hold, quiet window around every lane morph).`,
  ],
  gimmickPlan: ['4K 序章 + 双手 Multi Hold 摆动', '6K 单手 Multi Hold 扫轨 + 另一手打拍', '8K 镜像 / 双螺旋交互 + 16 分接力', '断奏宽幅 Multi Hold', '4K 呼吸段', '8K 二段副歌', '8K 终段全宽收束'],
  notes,
};
const report = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
if (failed.length) report.violations.push(...failed.map(f => `could not place ${f}`));
console.log(JSON.stringify(report.stats));
if (report.violations.length) { console.error(report.violations.slice(0, 40).join('\n')); process.exit(1); }
const body = JSON.stringify(chart).replace(/\],\[/g, '],\n[').replace(/\},\{"id"/g, '},\n{"id"');
fs.writeFileSync(path.join(here, '../../src/data/lastDanceChart.ts'),
  `// Generated by scripts/charts/last-dance.mjs — edit the generator, not this file.\nimport type { Chart } from '../core/types.js';\nexport const LAST_DANCE_SP20 = ${body} as unknown as Chart;\n`);
console.log('wrote src/data/lastDanceChart.ts');
