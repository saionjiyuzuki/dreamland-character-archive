import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMultiHoldPath, sampleMultiHoldAt } from '../dist/chart/holdPath.js';
import { HoldPathCache } from '../dist/runtime/HoldPathCache.js';
import { MultiHoldPathRuntime } from '../dist/runtime/MultiHoldPathRuntime.js';

const movingNote = () => ({
  id: 'path-1', type: 'multiHold', lanes: [1, 2, 3], startTime: 1000, endTime: 3000,
  path: { points: [
    { time: 0, lanes: [1, 2] },
    { time: 900, lanes: [2, 4] },
    { time: 2000, lanes: [4, 5] }
  ] }
});

test('path sampler includes endpoints, remains within lane bounds and keeps positive width', () => {
  const samples = sampleMultiHoldPath(movingNote(), { laneCount: 8, sampleCount: 48 });
  assert.equal(samples.length, 49);
  assert.equal(samples[0].offsetMs, 0);
  assert.equal(samples.at(-1).offsetMs, 2000);
  for (const sample of samples) {
    assert.ok(sample.leftLane >= 0 && sample.leftLane < 8);
    assert.ok(sample.rightLane <= 8);
    assert.ok(sample.rightLane - sample.leftLane >= 1 - 1e-7);
  }
});

test('sampleMultiHoldAt interpolates smoothly between neighboring samples', () => {
  const samples = sampleMultiHoldPath(movingNote(), { laneCount: 8, sampleCount: 40 });
  const a = sampleMultiHoldAt(samples, 400);
  const b = sampleMultiHoldAt(samples, 420);
  assert.ok(Math.abs(b.leftLane - a.leftLane) < 0.25);
  assert.ok(b.offsetMs > a.offsetMs);
});

test('cache reuses identical sampling and invalidates on chart path changes', () => {
  const cache = new HoldPathCache();
  const note = movingNote();
  const first = cache.get(note, 8, 40);
  const second = cache.get(note, 8, 40);
  assert.equal(first, second);
  note.path.points[1].lanes = [3, 4, 5];
  const third = cache.get(note, 8, 40);
  assert.notEqual(first, third);
  assert.equal(cache.size, 1);
});

test('path runtime exposes the lanes covered at different path times', () => {
  const note = movingNote();
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 80 });
  const runtime = new MultiHoldPathRuntime(note, samples, 8);
  assert.ok(runtime.lanesAt(1000).includes(1));
  assert.ok(runtime.lanesAt(2600).includes(4));
  assert.equal(runtime.coversLane(7, 2600), false);
});

test('4K, 6K and 8K lane spaces clamp ordinary paths to visible boundaries', async (t) => {
  for (const laneCount of [4, 6, 8]) {
    await t.test(`${laneCount}K`, () => {
      const note = { id: `mode-${laneCount}`, type: 'multiHold', lanes: [laneCount - 2, laneCount - 1], startTime: 0, endTime: 1000 };
      const samples = sampleMultiHoldPath(note, { laneCount, sampleCount: 24 });
      assert.ok(samples.every((s) => s.leftLane >= 0 && s.rightLane <= laneCount));
      assert.ok(samples.every((s) => s.rightLane - s.leftLane >= 1 - 1e-7));
    });
  }
});

test('live lane count source supports a path that extends into a later wider lane section', () => {
  const note = movingNote();
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 80 });
  let liveLaneCount = 4;
  const runtime = new MultiHoldPathRuntime(note, samples, () => liveLaneCount);
  assert.equal(runtime.coversLane(6, 2600), false);
  liveLaneCount = 8;
  assert.equal(runtime.coversLane(4, 2600), true);
});

test('Multi Hold supports continuously variable width keyframes and clamps to track edges', () => {
  const note = {
    id: 'variable-width', type: 'multiHold', lanes: [1, 2], startTime: 0, endTime: 3000,
    path: { points: [
      { time: 0, centerLane: 2, width: 3 },
      { time: 1000, leftLane: 2.25, rightLane: 3.25 },
      { time: 2000, centerLane: 4, width: 2 },
      { time: 3000, lanes: [1, 2] }
    ] }
  };
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 60 });
  const atStart = samples[0];
  const atMiddle = sampleMultiHoldAt(samples, 1000);
  const atWide = sampleMultiHoldAt(samples, 2000);
  assert.ok(Math.abs((atStart.rightLane - atStart.leftLane) - 3) < 0.01);
  assert.ok(Math.abs((atMiddle.rightLane - atMiddle.leftLane) - 1) < 0.08);
  assert.ok(Math.abs((atWide.rightLane - atWide.leftLane) - 2) < 0.08);
  assert.ok(samples.every((sample) => sample.leftLane >= 0 && sample.rightLane <= 8 && sample.rightLane > sample.leftLane));
});
