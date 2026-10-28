/**
 * Shared chart builder: the hand model from the Last Dance chart, usable for any song / difficulty.
 * Everything is placed through an event queue in time order so the hand model sees notes as they come; holds and
 * Multi Holds reserve their hand when scheduled so taps on that hand stay out of the way.
 * The result is checked by playability.mjs (hand gap, jumps, slide width, quiet windows around lane morphs).
 */
import { RULES } from './playability.mjs';
import { sampleMultiHoldPath } from '../../dist/chart/holdPath.js';

export const SEQ = {
  bounce: (i, n) => { const p = Math.max(1, 2 * (n - 1)), r = i % p; return r < n ? r : p - r; },
  zig: (i, n) => [[0], [0, 1], [0, 2, 1], [0, 2, 1, 3]][n - 1][i % n],
  trill: (i, n) => Math.max(0, n - 2) + (i % 2),
  center: (i, n) => Math.min(n - 1, i % 2),
};

/**
 * @param cfg.bpm grid BPM (one bar = 16 slots), cfg.firstBeatMs time of bar 0, cfg.duration seconds,
 *   cfg.sections [[bar, K], ...] lane count from that bar on (first entry must be bar 0), cfg.idPrefix for Multi Holds.
 */
export function createBuilder(cfg) {
  const BEAT = 60000 / cfg.bpm, S16 = BEAT / 4, BAR = BEAT * 4, T0 = cfg.firstBeatMs;
  const t = (m, s = 0) => Math.round(T0 + m * BAR + s * S16);
  // Lane morphs happen three beats before the section's downbeat, so the 720ms morph animation sits in a quiet window.
  const SECTIONS = cfg.sections;
  const MORPHS = SECTIONS.slice(1).map(([m]) => Math.round(t(m) - 3 * BEAT));
  const K_AT = ms => { let k = SECTIONS[0][1]; MORPHS.forEach((x, i) => { if (ms >= x) k = SECTIONS[i + 1][1]; }); return k; };
  const quietOk = (a, b) => MORPHS.every(x => !(b > x - RULES.morphQuietBeforeMs && a < x + RULES.morphQuietAfterMs));
  const sameSection = (a, b) => K_AT(a) === K_AT(b) && MORPHS.every(x => !(a < x && b >= x));
  const endMs = cfg.duration * 1000 - 400;

  const notes = [];
  const hand = [{ end: -1e9, lane: null, K: 0 }, { end: -1e9, lane: null, K: 0 }];
  const cur = [0, 0];
  let lastHand = 1, mhCount = 0;
  const free = (h, tm) => tm - hand[h].end >= RULES.handGapMs;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const side = (K, h) => (h ? [K / 2, K - 1] : [0, K / 2 - 1]);
  // rel 0 = lane next to the centre for 'mirror'; 'parallel' moves both hands the same way (double helix).
  const absLane = (h, r, geom, n) => (h ? n + r : geom === 'mirror' ? n - 1 - r : r);
  function fitLane(h, tm, lane, K) {
    const [lo, hi] = side(K, h), st = hand[h];
    lane = clamp(lane, lo, hi);
    if (st.lane !== null && st.K === K && tm - st.end < RULES.jumpWindowMs) lane = clamp(lane, st.lane - RULES.maxJump, st.lane + RULES.maxJump);
    return lane;
  }
  const RESERVED = new Set(); // {h, a, b} of every scheduled hold / multi hold
  const reserved = (h, tm) => [...RESERVED].some(r => (r.h === h || r.h === 'both') && tm > r.a - RULES.handGapMs && tm < r.b + RULES.handGapMs);
  const placeable = tm => tm >= 600 && tm <= endMs && quietOk(tm, tm);

  function tapAt(tm, h, r, geom) {
    const K = K_AT(tm), n = K / 2;
    if (!placeable(tm) || !free(h, tm) || reserved(h, tm)) return false;
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
    if (o.only !== undefined || !free(0, tm) || !free(1, tm) || reserved(0, tm) || reserved(1, tm)) return single(tm, o);
    const r = SEQ[o.seq](cur[0], n);
    tapAt(tm, 0, r, o.geom); tapAt(tm, 1, r, o.geom);
    cur[0]++; cur[1] = cur[0];
    return true;
  }
  /** Single hold; rel/slide are relative to the hand side (rel 0 = centre). The path slides at most one lane. */
  function hold(tm, h, slots, rel, slide, shape = 'arc') {
    const K = K_AT(tm), n = K / 2, dur = Math.round(slots * S16);
    if (!placeable(tm) || tm + dur > endMs || !free(h, tm) || !quietOk(tm, tm + dur) || !sameSection(tm, tm + dur)) return false;
    rel = clamp(rel, 0, n - 1); if (rel + slide > n - 1 || rel + slide < 0) slide = -slide;
    const a = absLane(h, rel, 'mirror', n), b = absLane(h, rel + slide, 'mirror', n), [lo, hi] = side(K, h);
    const lane = fitLane(h, tm, a, K); let end = lane + (b - a);
    if (end < lo || end > hi) end = lane - (b - a);
    const p = end === lane ? [[0, lane], [dur, lane]] : shape === 'arc' ? [[0, lane], [Math.round(dur / 2), end], [dur, lane]] : [[0, lane], [dur, end]];
    notes.push([tm, 'hold', lane, dur, Math.max(1, Math.round(dur / (BEAT / 2))), p]);
    hand[h] = { end: tm + dur, lane: p[p.length - 1][1], K };
    return true;
  }
  /**
   * Multi Hold; h = 0/1 (one hand, the other keeps playing) or 'both'. kf = [[slot, leftEdge, rightEdge], ...]
   * in lane-boundary coordinates of the current section.
   */
  function multi(tm, h, slots, kf) {
    const dur = Math.round(slots * S16), hands = h === 'both' ? [0, 1] : [h];
    if (!placeable(tm) || tm + dur > endMs || !hands.every(x => free(x, tm)) || !quietOk(tm, tm + dur) || !sameSection(tm, tm + dur)) return false;
    // The game interpolates keyframes with a Catmull-Rom spline, which overshoots at turning points. Pull the
    // keyframes towards the hand side's centre until the sampled path stays on that side (or inside the lanes).
    const K = K_AT(tm), lo = h === 1 ? K / 2 : 0, hi = h === 0 ? K / 2 : K, mid = (lo + hi) / 2;
    const make = f => ({ id: `${cfg.idPrefix}-mh-${String(mhCount + 1).padStart(2, '0')}`, type: 'multiHold', lanes: [], startTime: tm, endTime: tm + dur, tickIntervalMs: Math.round(BEAT / 2),
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
    for (const x of hands) hand[x] = { end: tm + dur, lane: null, K };
    return true;
  }

  const EV = [];
  /** Plays bars m0..m1; o.pick(m, s) returns 0 (rest), 1 (single) or 2 (chord). */
  const onBars = (m0, m1, o) => {
    const opt = { seq: 'bounce', geom: 'mirror', ...o };
    for (let m = m0; m <= m1; m++) for (let s = 0; s < 16; s++) EV.push({ tm: t(m, s), prio: 1, run: () => { const c = opt.pick(m, s); if (c >= 2) chord(t(m, s), opt); else if (c === 1) single(t(m, s), opt); } });
  };
  // Scheduled holds reserve their hand; a hold that cannot be placed gives the reservation back.
  const schedule = (h, a, b, place) => { const r = { h, a, b }; RESERVED.add(r); EV.push({ tm: a, prio: 0, run: () => { if (!place()) RESERVED.delete(r); } }); };
  const H = (m, s, h, slots, rel, slide, shape) => schedule(h, t(m, s), t(m, s) + slots * S16, () => hold(t(m, s), h, slots, rel, slide, shape));
  const M = (m, s, h, slots, kf) => schedule(h, t(m, s), t(m, s) + slots * S16, () => multi(t(m, s), h, slots, kf));

  function build() {
    EV.sort((a, b) => a.tm - b.tm || a.prio - b.prio).forEach(e => e.run());
    const noteTime = n => (Array.isArray(n) ? n[0] : n.startTime);
    notes.sort((a, b) => noteTime(a) - noteTime(b));
    const laneSections = SECTIONS.map(([, k], i) => [i ? MORPHS[i - 1] / 1000 : 0, i < MORPHS.length ? MORPHS[i] / 1000 : cfg.duration, k]);
    return { notes, laneSections };
  }
  return { t, BEAT, S16, BAR, K_AT, onBars, H, M, build };
}
