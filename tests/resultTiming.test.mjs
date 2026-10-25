import test from 'node:test';
import assert from 'node:assert/strict';

const els = new Map();
const mk = () => ({ textContent: '', src: '', style: {}, _cls: new Set(),
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), toggle: (c, f) => (f ? s.add(c) : s.delete(c)), contains: c => s.has(c) }; },
  getAttribute(n) { return n === 'src' ? this.src || null : null; }, addEventListener() {} });
globalThis.document = { getElementById(id) { if (!els.has(id)) els.set(id, mk()); return els.get(id); }, createElement: mk };
const el = id => document.getElementById(id);

const { JudgeSystem } = await import('../dist/judge/judgeSystem.js');
const { ResultController, summarizeTiming } = await import('../dist/result/resultController.js');

function judge(G) {
  return new JudgeSystem({ G, D: {}, StateMachine: { state: 'PLAYING' }, APP_STATE: { PLAYING: 'PLAYING' },
    chart: { noteUnitCount: () => 1, holdLaneAtTime: () => 0 }, hold: {}, AudioEngine: { sfx() { return true; } },
    popEffect() {}, updateUI() {}, endGame() {} });
}
const freshG = () => ({ offset: 0, auto: false, totalNotes: 10, pure: 0, great: 0, far: 0, lost: 0, combo: 0, maxCombo: 0, score: 0, remaining: 10,
  timingStats: { early: 0, late: 0, earlySum: 0, lateSum: 0, count: 0, sum: 0 } });

test('judged taps record early/late; LOST and AUTO are not counted', () => {
  const G = freshG(), J = judge(G);
  J.judgeNote({ time: 1000 }, 'PURE', 980);  // early 20
  J.judgeNote({ time: 2000 }, 'GREAT', 2060); // late 60
  J.judgeNote({ time: 3000 }, 'PURE', 3030);  // late 30
  J.judgeNote({ time: 4000 }, 'LOST', 4200);  // miss: ignored
  G.auto = true; J.judgeNote({ time: 5000 }, 'PURE', 4900); // auto: ignored
  assert.deepEqual(G.timingStats, { early: 1, late: 2, earlySum: -20, lateSum: 90, count: 3, sum: 70 });
  const s = summarizeTiming(G.timingStats);
  assert.equal(s.earlyAvg, -20); assert.equal(s.lateAvg, 45); assert.equal(s.mean, 23);
  assert.ok(Math.abs(s.earlyPct - 100 / 3) < 1e-9);
});

test('judge offset is applied before computing early/late', () => {
  const G = freshG(); G.offset = 40; const J = judge(G);
  J.judgeNote({ time: 1000 }, 'PURE', 1030); // target 1040 -> early 10
  assert.equal(G.timingStats.early, 1); assert.equal(G.timingStats.earlySum, -10);
});

test('result page shows portrait, accuracy and early/late numbers', () => {
  const D = {}; for (const k of ['resultGrade','resultSong','rPure','rGreat','rFar','rLost','rCombo','rScore']) D[k] = mk();
  for (const k of ['gameplay','keysContainer','pauseBtn','autoBtn','pauseMask']) D[k] = mk();
  const G = { pure: 8, great: 1, far: 1, lost: 0, score: 912345, maxCombo: 10, autoUsed: true, chart: { id: 'x', title: 'T', diff: 7 },
    char: { name: '梦灵', emoji: '🌙', portrait: './public/assets/characters/lumina.webp' },
    timingStats: { early: 3, late: 1, earlySum: -36, lateSum: 8, count: 6, sum: -28 } };
  const R = new ResultController({ D, G, StateMachine: { state: 'RESULT', transition() { return true; } }, APP_STATE: {}, AudioEngine: {}, setBest() {}, visiblePage() {}, economy: { grantPlayRewards() { return null; } } });
  R.show();
  assert.equal(D.resultGrade.textContent, 'A');
  assert.equal(el('rAccuracy').textContent, '92.50%');
  assert.equal(el('resultPortrait').src, './public/assets/characters/lumina.webp');
  assert.ok(el('resultCharEmoji').classList.contains('hidden'));
  assert.equal(el('rEarly').textContent, '3'); assert.equal(el('rLate').textContent, '1');
  assert.equal(el('rEarlyAvg').textContent, '平均 -12ms'); assert.equal(el('rLateAvg').textContent, '平均 +8ms');
  assert.equal(el('rMeanOffset').textContent, '平均偏差 -5ms · 整体偏早');
  assert.equal(el('rEarlyBar').style.width, '75%');
  // Character without art falls back to its emoji.
  G.char = { name: '星使', emoji: '⭐' }; G.timingStats = null; R.show();
  assert.ok(el('resultPortrait').classList.contains('hidden'));
  assert.equal(el('resultCharEmoji').textContent, '⭐');
  assert.equal(el('rMeanOffset').textContent, '平均偏差 —');
});
