import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMultiHoldPath } from '../dist/chart/holdPath.js';
import { buildMultiHoldOccupations, occupationsOverlap, isTapConflicted, resolveMultiHoldConflicts } from '../dist/runtime/LaneOccupation.js';

function setup(lanes = [1, 2, 3]) {
  const note = { id: 'mh', type: 'multiHold', lanes, startTime: 1000, endTime: 3000 };
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 40 });
  return { note, occupations: buildMultiHoldOccupations(note, samples) };
}

test('same-time tap within occupied lane conflicts', () => {
  const { occupations } = setup([1, 2, 3]);
  assert.equal(isTapConflicted({ id: 'tap', lane: 2, time: 1800 }, occupations), true);
});

test('tap in an adjacent non-covered lane is preserved', () => {
  const { occupations } = setup([1, 2, 3]);
  assert.equal(isTapConflicted({ id: 'tap', lane: 5, time: 1800 }, occupations), false);
});

test('visual lifetime overlap detects notes even when hit times differ', () => {
  const { occupations } = setup([2, 3, 4]);
  const tap = { id: 'late-tap', lane: 3, time: 3400, visualStartTime: 2400, visualEndTime: 3600 };
  assert.equal(isTapConflicted(tap, occupations), true);
});

test('non-overlapping time intervals do not conflict', () => {
  const { occupations } = setup([2, 3, 4]);
  const tap = { id: 'later', lane: 3, time: 5000, visualStartTime: 4000, visualEndTime: 5200 };
  assert.equal(isTapConflicted(tap, occupations), false);
});

test('occupation overlap includes both time and lane dimensions', () => {
  assert.equal(occupationsOverlap(
    { laneStart: 1, laneEnd: 3, startTime: 10, endTime: 20, sourceId: 'a', kind: 'multiHold' },
    { laneStart: 2, laneEnd: 4, startTime: 15, endTime: 25, sourceId: 'b', kind: 'hold' }
  ), true);
  assert.equal(occupationsOverlap(
    { laneStart: 1, laneEnd: 2, startTime: 10, endTime: 20, sourceId: 'a', kind: 'multiHold' },
    { laneStart: 2, laneEnd: 3, startTime: 15, endTime: 25, sourceId: 'b', kind: 'hold' }
  ), false);
});

test('resolver shifts a conflicting tap to the nearest free lane', () => {
  const { occupations } = setup([1, 2, 3]);
  const result = resolveMultiHoldConflicts(occupations, [{ id: 'tap', lane: 2, time: 1800 }], [], 8);
  assert.equal(result.movedTaps.length, 1);
  assert.equal(result.removedTaps.length, 0);
  assert.notEqual(result.keptTaps[0].lane, 2);
});

test('resolver removes a tap when all lanes are occupied and detects hold conflicts', () => {
  const note = { id: 'wide', type: 'multiHold', lanes: [0,1,2,3], startTime: 100, endTime: 900 };
  const occ = buildMultiHoldOccupations(note, sampleMultiHoldPath(note, { laneCount: 4, sampleCount: 24 }));
  const result = resolveMultiHoldConflicts(occ, [{ id: 'tap', lane: 1, time: 500 }], [
    { id: 'hold-ok?', laneStart: 2, laneEnd: 3, startTime: 400, endTime: 700 }
  ], 4);
  assert.deepEqual(result.removedTaps, ['tap']);
  assert.equal(result.holdConflicts.length, 1);
});
