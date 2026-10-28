import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { SONGS, DIFFICULTIES, DIFFICULTY_META, songChart, songOfChart, chartDensity } = await import('../dist/data/songs.js');
const { CHARTS } = await import('../dist/data/charts.js');
const { AUDIO_SOURCES_TEST } = await import('../dist/data/audioMap.js');
const { checkChart } = await import('../scripts/charts/playability.mjs');
const { sampleMultiHoldPath } = await import('../dist/chart/holdPath.js');

const SONG_IDS = ['last_dance', 'moonfall', 'lanterns', 'iron_princess'];
const LEVEL_RANGE = { EZ: [1, 10], HD: [10, 15], EX: [15, 20], DZ: [20, 25] };
const isMulti = n => !Array.isArray(n) && n?.type === 'multiHold';
const kinds = c => new Set(c.laneSections.map(s => s[2]));

test('the catalog is the four licensed songs, each with EZ / HD / EX / DZ charts', () => {
  assert.deepEqual(SONGS.map(s => s.id), SONG_IDS);
  assert.deepEqual(DIFFICULTIES, ['EZ', 'HD', 'EX', 'DZ']);
  assert.equal(DIFFICULTY_META.DZ.name, 'DIZZY');
  assert.deepEqual(Object.keys(CHARTS).sort(), SONG_IDS.flatMap(s => DIFFICULTIES.map(k => `song_${k.toLowerCase()}_${s}`)).sort());
  assert.ok(!Object.keys(CHARTS).some(id => id.startsWith('song_sp_')), 'the SP slot is gone');
});

test('levels sit in their difficulty band and rise with note density', () => {
  for (const song of SONGS) {
    const charts = DIFFICULTIES.map(k => songChart(song, k));
    assert.ok(charts.every(Boolean), `${song.id} has all four difficulties`);
    charts.forEach((c, i) => {
      const [lo, hi] = LEVEL_RANGE[DIFFICULTIES[i]];
      assert.ok(c.diff >= lo && c.diff <= hi, `${c.id} LV.${c.diff} in ${lo}-${hi}`);
      assert.equal(c.songId, song.id);
      assert.equal(c.difficulty, DIFFICULTIES[i]);
    });
    const nps = charts.map(c => chartDensity(c).avg);
    for (let i = 1; i < 4; i++) assert.ok(nps[i] > nps[i - 1], `${song.id} density rises: ${nps.map(v => v.toFixed(2))}`);
  }
});

test('every chart passes the playability rules', () => {
  for (const song of SONGS) for (const k of DIFFICULTIES) {
    const chart = songChart(song, k);
    const { violations, stats } = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
    assert.deepEqual(violations, [], chart.id);
    assert.ok(stats.maxActive <= 2, chart.id);
    assert.ok(chart.notes.every(n => (Array.isArray(n) ? n[0] : n.startTime) >= 600), `${chart.id} lead-in`);
  }
});

test('former SP features reach the lower difficulties: lane morphs, slide holds and Multi Holds', () => {
  for (const song of SONGS) {
    const [ez, hd, ex, dz] = DIFFICULTIES.map(k => songChart(song, k));
    assert.deepEqual([...kinds(ez)], [4], `${ez.id} stays on 4K`);
    assert.ok(ez.notes.some(n => Array.isArray(n) && n[1] === 'hold'), `${ez.id} has holds`);
    assert.ok(kinds(hd).has(6) && !kinds(hd).has(8), `${hd.id} morphs 4K <-> 6K`);
    assert.ok(hd.notes.some(n => Array.isArray(n) && n[1] === 'hold' && new Set(n[5].map(p => p[1])).size > 1), `${hd.id} has slide holds`);
    assert.ok(kinds(ex).has(8), `${ex.id} reaches 8K`);
    assert.ok(ex.notes.some(isMulti), `${ex.id} has Multi Holds`);
    assert.ok(kinds(dz).has(6) && kinds(dz).has(8), `${dz.id} uses 4K / 6K / 8K`);
    assert.ok(dz.notes.filter(isMulti).length >= 8, `${dz.id} Multi Holds`);
  }
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
  assert.equal(songChart(SONGS.find(s => s.id === 'iron_princess'), 'DZ').bpm, 220);
});

test('songOfChart resolves current and retired SP ids, but not removed songs', () => {
  assert.equal(songOfChart('song_dz_moonfall')?.id, 'moonfall');
  assert.equal(songOfChart('song_sp_last_dance')?.id, 'last_dance');
  for (const id of ['song_test_destroyer', 'song_sp_disorder', 'song_hd_je', 'song_test_multihold', 'nope']) assert.equal(songOfChart(id), undefined);
});
