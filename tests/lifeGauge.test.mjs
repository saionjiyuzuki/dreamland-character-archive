import test from 'node:test';
import assert from 'node:assert/strict';
import { GAUGE, resetGauge, applyGauge, clearState, gaugeValue, liveAccuracy } from '../dist/gameplay/lifeGauge.js';
import { JudgeSystem } from '../dist/judge/judgeSystem.js';

test('gauge gains per grade, clamps to 0..100 and clears at 70', () => {
  const G = {}; resetGauge(G);
  assert.equal(gaugeValue(G), GAUGE.start);
  applyGauge(G, 'PURE'); applyGauge(G, 'GREAT'); applyGauge(G, 'FAR');
  assert.equal(G.hp, 51.9);
  assert.equal(clearState(G), 'FAILED'); // below 70
  applyGauge(G, 'PURE', 200);
  assert.equal(G.hp, 100);
  applyGauge(G, 'LOST', 10); // 100 - 30 = 70
  assert.equal(G.hp, 70);
  assert.equal(clearState(G), 'CLEAR');
  applyGauge(G, 'FAR', 0); applyGauge(G, 'UNKNOWN');
  assert.equal(G.hp, 70);
});

test('emptying the gauge locks FAILED even if later notes refill it', () => {
  const G = {}; resetGauge(G);
  applyGauge(G, 'LOST', 100);
  assert.equal(G.hp, 0); assert.equal(G.hpFailed, true);
  applyGauge(G, 'PURE', 500);
  assert.equal(G.hp, 0);
  assert.equal(clearState(G), 'FAILED');
});

test('live accuracy uses result-screen weights and starts at 100%', () => {
  assert.equal(liveAccuracy({ pure: 0, great: 0, far: 0, lost: 0 }), 1);
  assert.equal(liveAccuracy({ pure: 2, great: 1, far: 1, lost: 0 }), (2 + 0.75 + 0.5) / 4);
});

test('every judged unit moves the gauge; the song keeps going at 0', () => {
  let ended = 0;
  const G = { offset: 0, auto: false, totalNotes: 100, pure: 0, great: 0, far: 0, lost: 0, combo: 0, maxCombo: 0, score: 0, remaining: 100 };
  resetGauge(G);
  const J = new JudgeSystem({ G, D: {}, StateMachine: { state: 'PLAYING' }, APP_STATE: { PLAYING: 'PLAYING' },
    chart: { noteUnitCount: () => 1, holdLaneAtTime: () => 0 }, hold: {}, AudioEngine: { sfx() { return true; } },
    popEffect() {}, updateUI() {}, endGame() { ended++; } });
  J.applyUnitResult('PURE'); J.applyUnitResult('FAR');
  assert.equal(G.hp, 51.3);
  for (let i = 0; i < 20; i++) J.applyUnitResult('LOST');
  assert.equal(G.hp, 0); assert.equal(G.hpFailed, true);
  assert.equal(ended, 0, 'an empty gauge must not end the song');
  J.applyUnitResult('PURE');
  assert.equal(G.pure, 2, 'notes are still judged and scored after failing');
});
