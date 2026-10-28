import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { SONGS, DIFFICULTIES, songChart, songOfChart } = await import('../dist/data/songs.js');
const { CHARTS } = await import('../dist/data/charts.js');
const { AUDIO_SOURCES_TEST } = await import('../dist/data/audioMap.js');
const { deriveChart, chartDensity } = await import('../dist/chart/difficultyDerive.js');
const { checkChart } = await import('../scripts/charts/playability.mjs');
const { sampleMultiHoldPath } = await import('../dist/chart/holdPath.js');

const full = SONGS.filter(s => s.tag !== 'LAB');

test('every regular song has EZ / HD / EX / SP charts with rising levels and density', () => {
  assert.equal(full.length, 1);
  for (const song of full) {
    const charts = DIFFICULTIES.map(k => songChart(song, k));
    assert.ok(charts.every(Boolean), `${song.id} has all four difficulties`);
    const levels = charts.map(c => c.diff), nps = charts.map(c => chartDensity(c).avg);
    for (let i = 1; i < 4; i++) {
      assert.ok(levels[i] > levels[i - 1], `${song.id} levels rise: ${levels}`);
      assert.ok(nps[i] > nps[i - 1], `${song.id} density rises: ${nps}`);
    }
    charts.forEach((c, i) => { assert.equal(c.songId, song.id); assert.equal(c.difficulty, DIFFICULTIES[i]); });
  }
});

test('generated charts pass the playability rules and stay on 4K', () => {
  for (const song of full) for (const k of ['EZ', 'HD', 'EX']) {
    const chart = songChart(song, k);
    const { violations, stats } = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
    assert.deepEqual(violations, [], `${chart.id}`);
    assert.ok(stats.maxActive <= 2);
    assert.equal(chart.lanes, 4);
    assert.ok(chart.notes.every(n => Array.isArray(n) && n[2] >= 0 && n[2] < 4 && n[0] >= 600));
    assert.ok(chart.notes.some(n => n[1] === 'hold'), `${chart.id} has holds`);
  }
});

test('derivation is deterministic', () => {
  const sp = CHARTS.song_sp_last_dance;
  assert.deepEqual(deriveChart(sp, 'HD', 'x').notes, deriveChart(sp, 'HD', 'x').notes);
});

test('every chart of every song has its audio file, and previews start inside the song', () => {
  for (const song of SONGS) {
    for (const id of Object.values(song.charts)) {
      const url = AUDIO_SOURCES_TEST[id];
      assert.ok(url, `${id} audio`);
      assert.ok(fs.existsSync(new URL('../' + url.replace('./', ''), import.meta.url)), `${url} exists`);
    }
    assert.ok(song.previewStartMs >= 0 && song.previewStartMs < song.duration * 1000 - 15000, `${song.id} preview`);
  }
});

test('only Last Dance is listed; removed songs and charts are gone', () => {
  assert.deepEqual(SONGS.map(s => s.id), ['last_dance']);
  assert.deepEqual(Object.keys(CHARTS).sort(), ['song_ex_last_dance', 'song_ez_last_dance', 'song_hd_last_dance', 'song_sp_last_dance']);
  assert.deepEqual(Object.keys(AUDIO_SOURCES_TEST).filter(id => !id.endsWith('_last_dance')), []);
  for (const id of ['song_test_destroyer', 'song_sp_disorder', 'song_hd_je', 'song_test_multihold', 'nope']) assert.equal(songOfChart(id), undefined);
});
