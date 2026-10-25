/**
 * Playability rules ("不卡手") for DREAMLAND charts, checked independently of how a chart was written.
 * Hands: lanes [0, K/2) belong to the left hand, [K/2, K) to the right hand (K = lane count of the section).
 *  1. lanes exist in the current section; every note (incl. hold/multi-hold bodies) stays inside one section
 *  2. no note around a lane morph: quiet window [X - before, X + after]
 *  3. each hand is free for at least handGapMs between two of its notes (one 8th at 175 BPM); a hold or
 *     multi-hold occupies its hand for its whole length, so at most one note per hand at any time
 *  4. a hand never jumps more than maxJump lanes between notes closer than jumpWindowMs
 *  5. single holds slide at most holdSlideMax lanes from their head (keyboard can follow) and stay on one side
 *  6. multi-holds stay on one side (or nothing else is played around them), and their covered lanes keep
 *     overlapping over overlapWindowMs so a keyboard player can walk them key by key
 *  7. the game's load-time conflict sanitizer would not move or remove anything
 */
export const RULES = { handGapMs: 170, jumpWindowMs: 260, maxJump: 2, morphQuietBeforeMs: 170, morphQuietAfterMs: 760, holdSlideMax: 1, overlapWindowMs: 250 };

function catmullLane(path, dt) {
  const pts = path.map(p => ({ dt: p[0], lane: p[1] })).sort((a, b) => a.dt - b.dt);
  if (dt <= pts[0].dt) return pts[0].lane;
  if (dt >= pts[pts.length - 1].dt) return pts[pts.length - 1].lane;
  let i = 1; while (i < pts.length && dt > pts[i].dt) i++;
  const p0 = pts[Math.max(0, i - 2)], p1 = pts[i - 1], p2 = pts[i], p3 = pts[Math.min(pts.length - 1, i + 1)];
  const q = (dt - p1.dt) / Math.max(1, p2.dt - p1.dt), q2 = q * q, q3 = q2 * q;
  return .5 * ((2 * p1.lane) + (-p0.lane + p2.lane) * q + (2 * p0.lane - 5 * p1.lane + 4 * p2.lane - p3.lane) * q2 + (-p0.lane + 3 * p1.lane - 3 * p2.lane + p3.lane) * q3);
}
const covered = (left, right, K) => { const out = []; for (let l = 0; l < K; l++) if (l + 1 > left + 1e-6 && l < right - 1e-6) out.push(l); return out; };

/** @param sampleMultiHold dist/chart/holdPath.js sampleMultiHoldPath (the game's own path sampler). */
export function checkChart(chart, { sampleMultiHold }) {
  const v = [], R = RULES, secs = chart.laneSections || [[0, chart.duration, chart.lanes]];
  const secIndex = ms => { const s = ms / 1000; for (let i = 0; i < secs.length; i++) if (s >= secs[i][0] && s < secs[i][1]) return i; return secs.length - 1; };
  const lanesAt = ms => secs[secIndex(ms)][2];
  const items = [];
  chart.notes.forEach((n, index) => {
    if (Array.isArray(n)) {
      const [t, kind, lane, dur, , path] = n, K = lanesAt(t);
      const p = kind === 'hold' ? (path?.length ? path : [[0, lane], [dur, lane]]) : null;
      const laneAt = dt => p ? catmullLane(p, dt) : lane;
      items.push({ index, kind, start: t, end: t + (kind === 'hold' ? dur : 0), K, hand: lane < K / 2 ? 0 : 1, headLane: lane, endLane: p ? p[p.length - 1][1] : lane, laneAt, dur });
      if (kind === 'hold') {
        let maxDev = 0, lo = Infinity, hi = -Infinity;
        for (let dt = 0; dt <= dur; dt += 10) { const l = laneAt(dt); maxDev = Math.max(maxDev, Math.abs(l - lane)); lo = Math.min(lo, l); hi = Math.max(hi, l); }
        if (maxDev > R.holdSlideMax + 0.05) v.push(`hold@${t}: slides ${maxDev.toFixed(2)} lanes from its head`);
        const side = lane < K / 2 ? [0, K / 2 - 1] : [K / 2, K - 1];
        if (lo < side[0] - 0.05 || hi > side[1] + 0.05) v.push(`hold@${t}: path leaves its hand side`);
      }
    } else if (n?.type === 'multiHold') {
      const K = lanesAt(n.startTime), samples = sampleMultiHold(n, { laneCount: 8 });
      const sets = samples.map(s => ({ t: n.startTime + s.offsetMs, lanes: covered(s.leftLane, s.rightLane, K), left: s.leftLane, right: s.rightLane }));
      const all = new Set(sets.flatMap(s => s.lanes));
      const left = [...all].every(l => l < K / 2), right = [...all].every(l => l >= K / 2);
      if ([...all].some(l => l >= K)) v.push(`multiHold ${n.id}: covers a lane that does not exist`);
      for (const a of sets) { const b = sets.find(s => s.t >= a.t + R.overlapWindowMs); if (b && !a.lanes.some(l => b.lanes.includes(l))) { v.push(`multiHold ${n.id}: covered lanes jump at ${Math.round(a.t)}`); break; } }
      const first = sets[0].lanes, last = sets[sets.length - 1].lanes;
      items.push({ index, kind: 'multiHold', id: n.id, start: n.startTime, end: n.endTime, K, hand: left ? 0 : right ? 1 : 'both', headLane: first[0], endLane: last[0], ranges: sets, samples, note: n });
    }
  });
  items.sort((a, b) => a.start - b.start);
  // 1 + 2: lanes, sections, morph quiet windows
  for (const it of items) {
    if (it.kind !== 'multiHold' && (it.headLane < 0 || it.headLane >= it.K)) v.push(`${it.kind}@${it.start}: lane ${it.headLane} not in ${it.K}K`);
    if (secIndex(it.start) !== secIndex(it.end)) v.push(`${it.kind}@${it.start}: crosses a lane morph`);
  }
  for (let i = 1; i < secs.length; i++) {
    const X = secs[i][0] * 1000;
    for (const it of items) if (it.end > X - R.morphQuietBeforeMs && it.start < X + R.morphQuietAfterMs) v.push(`${it.kind}@${it.start}: inside the quiet window of the morph at ${Math.round(X)}`);
  }
  // 3 + 4: per-hand spacing and jumps
  for (const hand of [0, 1]) {
    const mine = items.filter(it => it.hand === hand || it.hand === 'both');
    for (let i = 1; i < mine.length; i++) {
      const a = mine[i - 1], b = mine[i], gap = b.start - a.end;
      if (gap < R.handGapMs) v.push(`${hand ? 'right' : 'left'} hand: ${a.kind}@${a.start} -> ${b.kind}@${b.start} only ${Math.round(gap)}ms apart`);
      else if (gap < R.jumpWindowMs && a.kind !== 'multiHold' && b.kind !== 'multiHold' && Math.abs(b.headLane - a.endLane) > R.maxJump) v.push(`${hand ? 'right' : 'left'} hand: jump ${a.endLane}->${b.headLane} in ${Math.round(gap)}ms at ${b.start}`);
    }
  }
  // 7: what the load-time sanitizers in legacyGame.ts would change
  const taps = items.filter(it => it.kind === 'tap'), holds = items.filter(it => it.kind === 'hold'), mhs = items.filter(it => it.kind === 'multiHold');
  for (const tap of taps) {
    for (const h of holds) { const rel = tap.start - h.start; if (rel >= -70 && rel <= h.dur + 70 && Math.abs(tap.headLane - h.laneAt(Math.min(Math.max(rel, 0), h.dur))) < .6) v.push(`tap@${tap.start} lane ${tap.headLane} would be removed by hold@${h.start}`); }
    for (const m of mhs) for (let i = 0; i < m.samples.length - 1; i++) {
      const a = m.samples[i], b = m.samples[i + 1], s = m.start + a.offsetMs, e = m.start + b.offsetMs;
      if (tap.start >= s - 1e-6 && tap.start <= e + 1e-6 && tap.headLane < Math.max(a.rightLane, b.rightLane) - 1e-6 && Math.min(a.leftLane, b.leftLane) < tap.headLane + 1 - 1e-6) { v.push(`tap@${tap.start} lane ${tap.headLane} sits under multiHold ${m.id}`); break; }
    }
  }
  for (const h of holds) for (const m of mhs) if (h.start <= m.end && m.start <= h.end) {
    const lanes = [h.headLane, h.endLane]; if (m.ranges.some(r => r.t >= h.start && r.t <= h.end && lanes.some(l => l + 1 > r.left && l < r.right))) v.push(`hold@${h.start} overlaps multiHold ${m.id}`);
  }
  // stats
  const heads = items.map(it => it.start).sort((a, b) => a - b);
  let maxNps = 0; for (let i = 0, j = 0; i < heads.length; i++) { while (heads[i] - heads[j] >= 1000) j++; maxNps = Math.max(maxNps, i - j + 1); }
  let maxActive = 0; for (const it of items) maxActive = Math.max(maxActive, items.filter(o => o.start <= it.start + 1 && o.end >= it.start - 1).length);
  if (maxActive > 2) v.push(`up to ${maxActive} notes need to be held/pressed at once`);
  const span = (heads[heads.length - 1] - heads[0]) / 1000;
  return { violations: v, stats: { notes: items.length, taps: taps.length, holds: holds.length, multiHolds: mhs.length, maxNps, avgNps: +(items.length / span).toFixed(2), maxActive } };
}
