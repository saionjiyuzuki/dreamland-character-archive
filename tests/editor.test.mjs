import test from 'node:test';
import assert from 'node:assert/strict';

const { TimingMap, TICKS_PER_BEAT, formatPosition, parsePosition } = await import('../dist/editor/timing.js');
const { importChart, exportChart, exportChartWithTiming, parseProjectJSON, playtestChart, emptyProject, PLAYTEST_CHART_ID } = await import('../dist/editor/chartModel.js');
const { History, addNote, makeTap, makeHold, makeMulti, mirrored, shifted, quantized, pasteNotes, checkProject, withKeyframe, insertKeyframe } = await import('../dist/editor/editOps.js');
const { CHARTS } = await import('../dist/data/charts.js');
const { checkChart } = await import('../scripts/charts/playability.mjs');
const { sampleMultiHoldPath } = await import('../dist/chart/holdPath.js');

const B = TICKS_PER_BEAT;
const timing = { offsetMs: 100, bpms: [{ tick: 0, bpm: 120 }, { tick: 8 * B, bpm: 240 }], meters: [{ bar: 0, beats: 4 }, { bar: 2, beats: 3 }] };

test('timing: BPM and meter changes give exact milliseconds and bar positions', () => {
  const m = new TimingMap(timing);
  assert.equal(m.tickToMs(0), 100);
  assert.equal(m.tickToMs(4 * B), 2100);              // 4 beats at 120 BPM
  assert.equal(m.tickToMs(9 * B), 100 + 4000 + 250);  // 8 beats at 120 + 1 at 240
  assert.ok(Math.abs(m.msToTick(m.tickToMs(1234)) - 1234) < 1e-9);
  assert.equal(m.barStart(2), 8 * B);
  assert.equal(m.barStart(3), 11 * B);                // bar 3 (1-based) is 3/4
  assert.equal(formatPosition(m.position(11 * B + 2 * B + 96)), '4:3:096');
  assert.equal(parsePosition('4:3:096', m), 11 * B + 2 * B + 96);
  assert.equal(parsePosition('3:4', m), null);        // bar 3 has only 3 beats
});

test('timing: snapping restarts on every bar line and step never sticks', () => {
  const m = new TimingMap(timing);
  assert.equal(m.snap(B * 0.26, 16), B * 0.25);
  assert.equal(m.snap(11 * B + 1, 3), 11 * B);        // 1/3 grid inside a 3/4 bar starts on the bar line
  let t = 0; for (let i = 0; i < 16; i++) t = m.step(t, 16, 1);
  assert.equal(t, 4 * B);
  assert.equal(m.step(t, 16, -1), 4 * B - B / 4);
});

test('every built-in chart round-trips through the editor without moving a note', () => {
  for (const [id, chart] of Object.entries(CHARTS)) {
    const { project, report } = importChart(structuredClone(chart));
    assert.equal(report.offGrid, 0, id);
    const out = exportChart(project);
    assert.equal(out.notes.length, chart.notes.length, id);
    const t = n => (Array.isArray(n) ? n[0] : n.startTime);
    const a = chart.notes.map(t).sort((x, y) => x - y), b = out.notes.map(t).sort((x, y) => x - y);
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) <= 1, `${id} note ${i}: ${v} vs ${b[i]}`));
    assert.deepEqual(out.laneSections.map(s => s[2]), chart.laneSections.map(s => s[2]), id);
    assert.deepEqual(checkProject(project), [], id);
  }
});

test('exported charts keep their timing and pass the game playability check', () => {
  const p = emptyProject(); p.timing = timing; p.meta.duration = 30;
  addNote(p, makeTap(0, 0)); addNote(p, makeHold(B, 3 * B, 1, 2)); addNote(p, makeMulti(4 * B, 6 * B, 0, 2)); addNote(p, makeTap(9 * B, 3));
  const chart = exportChartWithTiming(p);
  assert.equal(chart.notes.length, 4);
  assert.equal(chart.notes[3][0], 100 + 4000 + 250);
  // Structural checks of the game's own validator: no lanes out of range, holds inside their section.
  const { violations } = checkChart(chart, { sampleMultiHold: sampleMultiHoldPath });
  assert.deepEqual(violations.filter(v => /does not exist|section|lane change/.test(v)), [], violations.join('\n'));
  const back = parseProjectJSON(JSON.parse(JSON.stringify(chart))).project;
  assert.deepEqual(back.timing, timing);
  assert.deepEqual(back.notes.map(n => n.kind), ['tap', 'hold', 'multi', 'tap']);
});

test('edit operations: duplicates replaced, mirror, shift, quantize, paste, keyframes', () => {
  const p = emptyProject(), m = new TimingMap(p.timing), secs = p.sections;
  addNote(p, makeTap(0, 1)); addNote(p, makeTap(0, 1));
  assert.equal(p.notes.length, 1);
  assert.equal(mirrored(makeTap(0, 0), secs).lane, 3);
  const mm = mirrored(makeMulti(0, B, 0, 1.5), secs);
  assert.deepEqual([mm.points[0].left, mm.points[0].right], [2.5, 4]);
  assert.equal(shifted(makeTap(0, 3), 0, 5, secs).lane, 3);     // clamped to the 4K lanes
  assert.equal(quantized(makeTap(B / 4 + 7, 0), m, 16).tick, B / 4);
  const pasted = pasteNotes(p, [makeTap(10, 2), makeTap(10 + B, 3)], 4 * B);
  assert.deepEqual(pasted.map(n => n.tick), [4 * B, 5 * B]);
  const h = insertKeyframe(makeHold(0, 2 * B, 0, 0), B);
  assert.equal(h.points.length, 3);
  assert.equal(withKeyframe(h, 1, 5 * B, 2, 'lane', 4).points[1].tick, 2 * B - 1);  // stays before the tail
});

test('checks flag notes the game would reject', () => {
  const p = emptyProject(); p.meta.duration = 10;
  p.sections = [{ tick: 0, lanes: 8 }, { tick: 8 * B, lanes: 4 }];
  addNote(p, makeTap(9 * B, 6));                 // lane 7 in a 4K section
  addNote(p, makeHold(6 * B, 10 * B, 0));        // crosses the lane change
  addNote(p, makeTap(40 * B, 0));                // after the END (10 s)
  addNote(p, makeHold(12 * B, 14 * B, 1)); addNote(p, makeTap(13 * B, 1)); // tap on a hold
  const msgs = checkProject(p).map(i => i.msg).join('|');
  for (const s of ['不在 4K', '跨越了变轨点', 'END', '压在长条上']) assert.ok(msgs.includes(s), s);
});

test('undo / redo restore whole project states', () => {
  const h = new History(), p = emptyProject();
  h.push(structuredClone(p)); addNote(p, makeTap(0, 0));
  const undone = h.undo(p); assert.equal(undone.notes.length, 0);
  const redone = h.redo(undone); assert.equal(redone.notes.length, 1);
  assert.equal(h.canRedo, false);
});

test('playtest chart starts at the chosen bar with times shifted to zero', () => {
  const { project } = importChart(structuredClone(CHARTS.song_dz_last_dance));
  const m = new TimingMap(project.timing), start = m.tickToMs(m.barStart(16));
  const c = playtestChart(project, start);
  assert.equal(c.id, PLAYTEST_CHART_ID); assert.equal(c.playtest, true);
  const times = c.notes.map(n => (Array.isArray(n) ? n[0] : n.startTime));
  assert.ok(times.length > 0 && Math.min(...times) >= 0);
  assert.equal(c.laneSections[0][0], 0);
  assert.ok(Math.abs(c.duration - (CHARTS.song_dz_last_dance.duration - start / 1000)) < 0.01);
});

test('project files are rebuilt from plain values, so markup in numeric fields cannot reach the page', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const { project } = parseProjectJSON({
    format: 'dreamland-chart-project', version: 1,
    meta: { id: 'x', title: 't', diff: evil, duration: evil, extra: 'bad' },
    timing: { offsetMs: evil, bpms: [{ tick: 0, bpm: 150 }], meters: [{ bar: 0, beats: 4 }] },
    sections: [{ tick: 0, lanes: 6 }, { tick: evil, lanes: 4 }],
    notes: [
      { id: 'a', kind: 'tap', tick: 0, lane: 1 },
      { id: 'b', kind: 'tap', tick: evil, lane: 0 },
      { id: 'c', kind: 'hold', points: [{ tick: 0, lane: 0 }, { tick: 192, lane: evil }, { tick: 384, lane: 2 }] },
      { id: 'd', kind: 'multi', points: [{ tick: 0, left: 0, right: 2 }, { tick: 192, left: 1, right: 3 }], tickIntervalMs: evil },
      { id: 'e', kind: 'multi', points: [{ tick: 0, left: evil, right: 2 }, { tick: 192, left: 1, right: 3 }] },
      { kind: 'script', tick: 0 },
    ],
    audioUrl: './music/a.mp3', extraTop: evil,
  });
  const byId = new Map(project.notes.map(n => [n.id, n]));
  assert.deepEqual([...byId.keys()].sort(), ['a', 'c', 'd']);
  assert.deepEqual(byId.get('c').points.map(p => p.lane), [0, 2]);
  assert.equal(byId.get('d').tickIntervalMs, undefined);
  assert.equal(project.meta.diff, 10);
  assert.equal(project.meta.duration, 120);
  assert.deepEqual(project.meta.extra, {});
  assert.equal(project.timing.offsetMs, 0);
  assert.deepEqual(project.sections, [{ tick: 0, lanes: 6 }]);
  assert.equal(project.audioUrl, './music/a.mp3');
  assert.equal('extraTop' in project, false);
  assert.ok(!JSON.stringify(project).includes('onerror'));
});
