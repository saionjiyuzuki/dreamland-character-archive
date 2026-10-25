import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { CHARTS } = await import('../dist/data/charts.js');
const { AUDIO_SOURCES_TEST } = await import('../dist/data/audioMap.js');
const { sampleMultiHoldPath } = await import('../dist/chart/holdPath.js');
const { checkChart } = await import('../scripts/charts/playability.mjs');
const { backdropShapes } = await import('../dist/render/trackBackdrop.js');

const chart = CHARTS.song_sp_last_dance;

test('Last Dance SP20 is in the song list with its audio', () => {
  assert.ok(chart, 'chart registered');
  assert.equal(chart.diff, 20);
  assert.equal(chart.bpm, 175);
  const url = AUDIO_SOURCES_TEST.song_sp_last_dance;
  assert.ok(url && fs.existsSync(new URL('../' + url.replace('./', ''), import.meta.url)), 'audio file exists');
});

test('Last Dance SP20 uses every performance form', () => {
  const kinds = new Set(chart.laneSections.map(s => s[2]));
  for (const k of [4, 6, 8]) assert.ok(kinds.has(k), `${k}K section`);
  const holds = chart.notes.filter(n => Array.isArray(n) && n[1] === 'hold');
  assert.ok(holds.length >= 10, 'holds');
  assert.ok(holds.some(h => new Set(h[5].map(p => p[1])).size > 1), 'sliding holds');
  assert.ok(chart.notes.filter(n => !Array.isArray(n) && n.type === 'multiHold').length >= 8, 'multi holds');
});

test('Last Dance SP20 passes the playability rules (no awkward hand patterns)', () => {
  const { violations, stats } = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
  assert.deepEqual(violations, []);
  assert.ok(stats.maxActive <= 2);
  assert.ok(stats.notes > 900);
});

test('track backdrop is visual only, faint and beat-synced', () => {
  const view = { w: 800, cx: 400, horizonY: 60, judgeY: 500, fallTime: 1500 };
  const cfg = { kind: 'geometry', bpm: 175, firstBeatMs: 338 };
  assert.deepEqual(backdropShapes(1000, null, view), []);
  // Same moment, only the beat phase differs (positions depend on time alone), so the pulse is isolated.
  const BEAT = 60000 / 175, tm = 338 + BEAT * 10 + 1;
  const onBeat = backdropShapes(tm, cfg, view), offBeat = backdropShapes(tm, { ...cfg, firstBeatMs: 338 + BEAT * 0.3 }, view);
  assert.ok(onBeat.length > 0);
  assert.equal(onBeat.length, offBeat.length);
  for (const s of [...onBeat, ...offBeat]) { assert.ok(s.alpha <= 0.32); assert.ok(s.y >= view.horizonY && s.y <= view.judgeY); }
  onBeat.forEach((s, i) => { assert.equal(s.y, offBeat[i].y); assert.ok(s.alpha >= offBeat[i].alpha && s.size > offBeat[i].size, 'pulses on the beat'); });
  const later = backdropShapes(338 + 342.857 * 10 + 200, cfg, view);
  assert.notDeepEqual(later.map(s => s.y), onBeat.map(s => s.y), 'shapes slide');
});
