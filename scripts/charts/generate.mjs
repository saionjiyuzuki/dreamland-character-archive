/**
 * Generates the EZ / HD / EX / DZ charts of every song from its audio analysis (src/data/songCharts.ts).
 * Run after `npm run build`:  node scripts/charts/generate.mjs
 *
 * analysis/<song>.json comes from analyze-audio.mjs: grid BPM, time of bar 0, and per bar the 16th-note onset
 * strengths of three bands (low / mid / air, digits 0-9), plus the loudness of every bar. Strengths are ranked
 * within each song and band (LEVEL_SHARE), so loud and quiet masters chart alike.
 * The song is cut into 8-bar phrases, each phrase is classed quiet / calm / drive / peak by loudness, and every
 * difficulty maps those classes to a lane count, a note pattern and its holds / slide holds / Multi Holds.
 * Every chart goes through the hand model in builder.mjs and must pass playability.mjs with zero violations.
 * Last Dance keeps its hand-written DZ chart (last-dance.mjs); only its EZ / HD / EX come from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkChart } from './playability.mjs';
import { createBuilder } from './builder.mjs';
import { sampleMultiHoldPath } from '../../dist/chart/holdPath.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SONGS = [
  { id: 'last_dance', title: 'Last Dance', artist: 'Xomu', jacket: '✦', audio: 'last-dance.flac', firstBeatMs: 338 - 60000 / 175, keepDZ: true },
  { id: 'moonfall', title: 'Moonfall', artist: 'Xomu', jacket: '☾', audio: 'moonfall.flac' },
  { id: 'lanterns', title: 'Lanterns', artist: 'Xomu', jacket: '◈', audio: 'lanterns.flac' },
  // The track runs at 220 BPM over a half-time groove; it is analysed on the 110 BPM grid, whose 16ths are the
  // 8ths of 220, so the patterns read every slot at double speed (slotScale 2).
  { id: 'iron_princess', title: 'Iron Princess', artist: 'Xomu, Hyp3rLaps3', jacket: '♛', audio: 'iron-princess.mp3', displayBpm: 220, slotScale: 2 },
];

/* ── difficulty design ──
 * lanes: lane count per phrase class. pick: note pattern per class, (lv, m, s) -> 0 rest / 1 note / 2 chord, where
 * lv(band) is the onset strength 0-4 of that 16th (band 'S' = strongest of the three).
 * holds: one hold every `every` bars (slide = sliding / curved holds), multi: Multi Hold plan per class.
 * level: [min, max] and the density (rating) that maps to them.
 */
const even = s => s % 2 === 0, beat = s => s % 4 === 0, half = s => s % 8 === 0;
const DIFFS = {
  EZ: {
    lanes: { quiet: 4, calm: 4, drive: 4, peak: 4 },
    pick: {
      quiet: (lv, m, s) => (half(s) && lv('S') >= 2 ? 1 : 0),
      calm: (lv, m, s) => ((half(s) && lv('S') >= 1) || (beat(s) && lv('S') >= 4) ? 1 : 0),
      drive: (lv, m, s) => ((half(s) && lv('S') >= 1) || (beat(s) && lv('S') >= 4) ? 1 : 0),
      peak: (lv, m, s) => (s === 0 && m % 4 === 0 && lv('low') >= 3 ? 2 : (half(s) && lv('S') >= 1) || (beat(s) && lv('S') >= 3) ? 1 : 0),
    },
    holds: { quiet: { every: 4, slots: 12 }, calm: { every: 4, slots: 8 }, drive: { every: 8, slots: 8 }, peak: { every: 8, slots: 8 } },
    slide: false, multi: {}, minSection: 999, level: [1, 10], rating: [1, 3.25],
  },
  HD: {
    lanes: { quiet: 4, calm: 4, drive: 6, peak: 6 },
    pick: {
      quiet: (lv, m, s) => (beat(s) && lv('S') >= 2 ? 1 : 0),
      calm: (lv, m, s) => ((beat(s) && lv('S') >= 2) || (half(s) && lv('S') >= 1) ? 1 : 0),
      drive: (lv, m, s) => (half(s) && lv('low') >= 4 ? 2 : (beat(s) && lv('S') >= 1) || (even(s) && lv('S') >= 4) ? 1 : 0),
      peak: (lv, m, s) => (half(s) && lv('low') >= 3 ? 2 : (beat(s) && lv('S') >= 1) || (even(s) && lv('S') >= 3) ? 1 : 0),
    },
    holds: { quiet: { every: 2, slots: 12 }, calm: { every: 2, slots: 8 }, drive: { every: 4, slots: 8 }, peak: { every: 4, slots: 6 } },
    slide: true, multi: {}, minSection: 16, level: [10, 15], rating: [2.4, 5.4],
  },
  EX: {
    lanes: { quiet: 4, calm: 4, drive: 6, peak: 8 },
    pick: {
      quiet: (lv, m, s) => (even(s) && lv('S') >= 2 ? 1 : 0),
      calm: (lv, m, s) => ((beat(s) && lv('S') >= 1) || (even(s) && lv('S') >= 2) ? 1 : 0),
      drive: (lv, m, s) => (beat(s) && lv('low') >= 4 ? 2 : (beat(s) && lv('S') >= 1) || (even(s) && lv('S') >= 2) ? 1 : 0),
      peak: (lv, m, s) => (beat(s) && (lv('low') >= 3 || lv('air') >= 4) ? 2 : (beat(s) && lv('S') >= 1) || (even(s) && lv('S') >= 2) || lv('S') >= 4 ? 1 : 0),
    },
    holds: { quiet: { every: 2, slots: 12 }, calm: { every: 2, slots: 8 }, drive: { every: 2, slots: 8 }, peak: { every: 4, slots: 6 } },
    slide: true, fill: 'beforePeak', minSection: 12,
    multi: { quiet: { hand: 'one', slots: 24, every: 4 }, calm: { hand: 'one', slots: 16, every: 8 }, peak: { hand: 'one', slots: 16, every: 8, at: 4 } },
    level: [15, 20], rating: [3.8, 7.4],
  },
  DZ: {
    lanes: { quiet: 4, calm: 6, drive: 6, peak: 8 },
    pick: {
      quiet: (lv, m, s) => ((even(s) && lv('S') >= 1) || lv('S') >= 3 ? 1 : 0),
      calm: (lv, m, s) => (beat(s) && lv('low') >= 4 ? 2 : (even(s) && lv('S') >= 1) || lv('S') >= 2 ? 1 : 0),
      drive: (lv, m, s) => (beat(s) && lv('low') >= 3 ? 2 : even(s) || lv('S') >= 2 ? 1 : 0),
      peak: (lv, m, s) => (even(s) && lv('S') >= 3 ? 2 : even(s) || lv('S') >= 1 ? 1 : 0),
    },
    holds: { quiet: { every: 2, slots: 12 }, calm: { every: 2, slots: 8 }, drive: { every: 2, slots: 6 }, peak: { every: 4, slots: 6 } },
    slide: true, fill: 'peakEnd', minSection: 8,
    multi: { quiet: { hand: 'both', slots: 24, every: 8 }, calm: { hand: 'one', slots: 32, every: 8 }, drive: { hand: 'one', slots: 16, every: 8, at: 4 }, peak: { hand: 'one', slots: 16, every: 8, at: 4 } },
    level: [20, 25], rating: [5.5, 9.85],
  },
};

/** Share of all 16ths of a band that reach onset level 1 / 2 / 3 / 4. */
const LEVEL_SHARE = [.32, .18, .09, .03];
function levelTable(bars) {
  return [0, 1, 2].map(band => {
    const vals = bars.flatMap(b => [...b[band]].map(Number)).sort((x, y) => y - x);
    const thr = LEVEL_SHARE.map(q => Math.max(1, vals[Math.min(vals.length - 1, Math.floor(q * vals.length))]));
    return bars.map(b => [...b[band]].map(c => thr.reduce((l, x) => l + (Number(c) >= x ? 1 : 0), 0)));
  });
}

/* ── phrase analysis ── */
function phrases(energy, density) {
  const n = energy.length;
  const avg = (arr, a, b) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(n, b); i++) { s += arr[i]; c++; } return c ? s / c : 0; };
  // Novelty of a boundary before bar b: how much loudness and note density change across it.
  const nov = b => Math.abs(avg(energy, b, b + 2) - avg(energy, b - 2, b)) + Math.abs(avg(density, b, b + 2) - avg(density, b - 2, b)) * .6;
  // Best segmentation into phrases of 4-16 bars; 8 and 16 bar phrases get a small bonus.
  const LEN = { 4: -.12, 6: -.1, 7: -.1, 8: .04, 9: -.1, 10: -.1, 12: -.03, 16: .03 };
  const best = new Array(n + 1).fill(-Infinity), from = new Array(n + 1).fill(-1);
  best[0] = 0;
  for (let b = 1; b <= n; b++) for (const [L, bonus] of Object.entries(LEN)) {
    const a = b - Number(L);
    if (a < 0 || best[a] === -Infinity) continue;
    const v = best[a] + bonus + (b < n ? nov(b) : 0);
    if (v > best[b]) { best[b] = v; from[b] = a; }
  }
  let end = n; while (end > 0 && best[end] === -Infinity) end--;
  const cuts = []; for (let b = end; b > 0; b = from[b]) cuts.unshift(from[b]);
  const blocks = cuts.map((a, i) => ({ a, b: (cuts[i + 1] ?? n) - 1, e: avg(energy, a, cuts[i + 1] ?? n) }));
  if (end < n) blocks[blocks.length - 1].b = n - 1;
  const loud = blocks.filter(x => x.e >= .45).map(x => x.e).sort((x, y) => x - y);
  const rank = e => (loud.length > 1 ? loud.indexOf(e) / (loud.length - 1) : 1);
  for (const x of blocks) x.cls = x.e < .45 ? 'quiet' : rank(x.e) >= .6 ? 'peak' : rank(x.e) >= .3 ? 'drive' : 'calm';
  return blocks;
}

// Small deterministic hash so pattern variety does not depend on run order.
const hash = (...xs) => { let h = 2166136261; for (const c of xs.join('|')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

function generate(song, A, key) {
  const D = DIFFS[key], L = levelTable(A.bars);
  const dens = L[0].map((bar, m) => bar.reduce((t, v, i) => t + v + L[1][m][i] + L[2][m][i], 0)), dMax = Math.max(...dens);
  const blocks = phrases(A.energy, dens.map(d => d / dMax));
  const lvAt = (m, s, band) => (m >= 0 && m < A.bars.length ? L[band][m][s] : 0);
  const BANDS = { low: 0, mid: 1, air: 2 };
  const lv = (m, s) => b => (b === 'S' ? Math.max(lvAt(m, s, 0), lvAt(m, s, 1), lvAt(m, s, 2)) : lvAt(m, s, BANDS[b]));

  // Lane sections: the intro stays on 4K and every later lane count lasts at least D.minSection bars; a section
  // that is too short takes the lane count of its wider neighbour, so a chorus stays on its widest field.
  let sections = blocks.map((x, i) => [x.a, i === 0 ? 4 : D.lanes[x.cls]]);
  const merge = () => { sections = sections.filter((x, i) => i === 0 || x[1] !== sections[i - 1][1]); };
  merge();
  for (let guard = 0; guard < 50; guard++) {
    const len = i => (sections[i + 1]?.[0] ?? A.bars.length) - sections[i][0];
    const i = sections.findIndex((x, j) => j > 0 && len(j) < D.minSection);
    if (i < 0) break;
    const nb = [sections[i - 1]?.[1], sections[i + 1]?.[1]].filter(k => k !== undefined && (i - 1 > 0 || k !== sections[0][1] || sections.length === 2));
    sections[i][1] = nb.length ? Math.max(...nb) : sections[i - 1][1];
    merge();
  }
  const B = createBuilder({ bpm: A.bpm, firstBeatMs: song.firstBeatMs ?? A.firstBeatMs, duration: A.duration, sections, idPrefix: `${song.id}-${key.toLowerCase()}` });

  const SEQS = ['bounce', 'zig', 'trill', 'bounce', 'zig'], GEOMS = ['mirror', 'parallel'];
  const busy = [-1, -1]; // bar up to which a hand already has a hold / Multi Hold scheduled
  let holdCount = 0, mhCount = 0;
  blocks.forEach((x, bi) => {
    const r = hash(song.id, key, bi), next = blocks[bi + 1], scale = song.slotScale || 1;
    const pick = D.pick[x.cls];
    const opt = { seq: x.cls === 'quiet' ? 'center' : SEQS[r % SEQS.length], geom: GEOMS[(r >> 3) % 2] };
    const fill = (D.fill === 'beforePeak' && next?.cls === 'peak' && x.cls !== 'peak') || (D.fill === 'peakEnd' && x.cls === 'peak');
    const body = fill && x.b - x.a >= 3 ? x.b - 1 : x.b;
    B.onBars(x.a, body, { ...opt, pick: (m, s) => pick(lv(m, s), m, (s * scale) % 16) });
    if (body < x.b) B.onBars(x.b, x.b, { ...opt, seq: 'zig', pick: (m, s) => (key === 'DZ' || even(s) || lv(m, s)('S') >= 1 ? 1 : 0) });

    // Multi Holds first (they need a free hand for a long time), then holds on the remaining space.
    const mp = D.multi[x.cls];
    if (mp) for (let m = x.a + (mp.at || 0); m <= x.b; m += mp.every) {
      const lenBars = Math.ceil(mp.slots / 16), K = B.K_AT(B.t(m));
      if (m + lenBars > x.b + 1) break;
      const h = mp.hand === 'both' ? 'both' : (mhCount + r) % 2;
      const hs = h === 'both' ? [0, 1] : [h];
      if (hs.some(z => busy[z] >= m)) continue;
      B.M(m, 0, h, mp.slots, multiPath(K, h, mp.slots, mhCount + r));
      for (const z of hs) busy[z] = m + lenBars - 1;
      mhCount++;
    }
    const hp = D.holds[x.cls];
    for (let m = x.a + 1; m <= body; m += hp.every) {
      const s = lv(m, 0)('S') >= 2 ? 0 : lv(m, 8)('S') >= 2 ? 8 : -1;
      if (s < 0 || (s + hp.slots) > 16 * (body - m + 1)) continue;
      const h = (holdCount + r) % 2, endBar = m + Math.floor((s + hp.slots - 1) / 16);
      if (busy[h] >= m) continue;
      const k = holdCount % 3, slide = D.slide ? [1, -1, 0][k] : 0;
      B.H(m, s, h, hp.slots, k === 1 ? 1 : 0, slide, holdCount % 2 ? 'line' : 'arc');
      busy[h] = endBar;
      holdCount++;
    }
  });

  const { notes, laneSections } = B.build();
  const chart = {
    id: `song_${key.toLowerCase()}_${song.id}`, title: song.title, artist: song.artist, bpm: song.displayBpm || A.bpm, diff: 0, jacket: song.jacket, lanes: laneSections[0][2],
    sourceAudio: song.audio, duration: A.duration, laneSections, backdrop: { kind: 'geometry', firstBeatMs: Math.round(song.firstBeatMs ?? A.firstBeatMs) },
    songId: song.id, difficulty: key, notes,
  };
  const report = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
  chart.diff = rateLevel(report.stats, chart, D);
  return { chart, report };
}

/** Multi Hold keyframes in lane-boundary coordinates: one hand sweeps its side, 'both' sways around the centre. */
function multiPath(K, h, slots, variant) {
  const pts = [];
  if (h === 'both') {
    const w = K === 8 ? 4 : 2, c = K / 2, shifts = [0, -1, 0, 1];
    for (let sl = 0, i = variant % 2; sl <= slots; sl += 8, i++) { const d = shifts[i % 4]; pts.push([Math.min(sl, slots), c - w / 2 + d, c + w / 2 + d]); }
  } else {
    const n = K / 2, lo = h ? n : 0, w = n >= 3 ? 2 : 1, span = n - w;
    for (let sl = 0, i = variant % (span + 1); sl <= slots; sl += 8, i++) { const p = 2 * span ? i % (2 * span) : 0, q = p <= span ? p : 2 * span - p; pts.push([Math.min(sl, slots), lo + q, lo + q + w]); }
  }
  if (pts[pts.length - 1][0] !== slots) pts.push([slots, pts[pts.length - 1][1], pts[pts.length - 1][2]]);
  return pts;
}

/** Density (notes per second, overall and densest 8s) plus wider fields, mapped linearly onto the level band. */
function rateLevel(stats, chart, D) {
  const heads = chart.notes.map(n => (Array.isArray(n) ? n[0] : n.startTime)).sort((a, b) => a - b);
  let peak8 = 0; for (let i = 0, j = 0; i < heads.length; i++) { while (heads[i] - heads[j] > 8000) j++; peak8 = Math.max(peak8, (i - j + 1) / 8); }
  const maxK = Math.max(...chart.laneSections.map(s => s[2]));
  const rating = .55 * stats.avgNps + .45 * peak8 + (maxK - 4) * .12 + stats.multiHolds * .01;
  const [lo, hi] = D.level, [r0, r1] = D.rating;
  return Math.max(lo, Math.min(hi, Math.round(lo + (rating - r0) / (r1 - r0) * (hi - lo))));
}

const out = {};
let failedAny = false;
for (const song of SONGS) {
  const A = JSON.parse(fs.readFileSync(path.join(here, 'analysis', `${song.id}.json`), 'utf8'));
  for (const key of Object.keys(DIFFS)) {
    if (key === 'DZ' && song.keepDZ) continue;
    const { chart, report } = generate(song, A, key);
    const ks = [...new Set(chart.laneSections.map(s => s[2]))].join('/');
    console.log(`${chart.id.padEnd(26)} LV.${String(chart.diff).padStart(2)}  ${ks.padEnd(6)} ${JSON.stringify(report.stats)}`);
    if (report.violations.length) { failedAny = true; console.error(report.violations.slice(0, 20).join('\n')); }
    out[chart.id] = chart;
  }
}
if (failedAny) process.exit(1);
if (process.argv.includes('--dry')) process.exit(0);
const body = JSON.stringify(out).replace(/\],\[/g, '],\n[').replace(/\},\{"id"/g, '},\n{"id"').replace(/\],"song_/g, '],\n"song_');
fs.writeFileSync(path.join(here, '../../src/data/songCharts.ts'),
  `// Generated by scripts/charts/generate.mjs — edit the generator, not this file.\nimport type { Chart } from '../core/types.js';\nexport const SONG_CHARTS = ${body} as unknown as Record<string, Chart>;\n`);
console.log('wrote src/data/songCharts.ts');
