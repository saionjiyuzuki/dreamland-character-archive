import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiHoldRuntime } from '../dist/runtime/MultiHoldRuntime.js';
import { mapMultiHoldRuntimeEvent } from '../dist/judge/MultiHoldJudge.js';

function makeRuntime(options = {}) {
  const note = { id: 'runtime-mh', type: 'multiHold', lanes: [1, 2, 3], startTime: 1000, endTime: 3000, tickIntervalMs: 500 };
  return new MultiHoldRuntime(note, { laneCount: 8, headWindowMs: 120, reconnectWindowMs: 500, ...options });
}

test('any lane covered by the head starts the multi hold exactly once', () => {
  const runtime = makeRuntime();
  const events = runtime.pressLane(2, 1000);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'head');
  assert.equal(runtime.phase, 'holding');
  assert.equal(runtime.pressLane(3, 1010).length, 0);
});

test('held lane produces PURE tick, releasing before next tick produces LOST', () => {
  const runtime = makeRuntime();
  runtime.pressLane(2, 1000);
  assert.equal(runtime.update(1500).find((event) => event.type === 'tick').grade, 'PURE');
  runtime.releaseLane(2, 1550);
  assert.equal(runtime.update(2000).find((event) => event.type === 'tick').grade, 'LOST');
});

test('re-press within reconnect window reconnects before the next tick', () => {
  const runtime = makeRuntime();
  runtime.pressLane(2, 1000);
  runtime.update(1500);
  runtime.releaseLane(2, 1550);
  const reconnect = runtime.pressLane(2, 1800);
  assert.equal(reconnect[0].type, 'reconnect');
  assert.equal(runtime.update(2000).find((event) => event.type === 'tick').grade, 'PURE');
});

test('reconnect outside the configured window is rejected', () => {
  const runtime = makeRuntime({ reconnectWindowMs: 200 });
  runtime.pressLane(2, 1000);
  runtime.releaseLane(2, 1100);
  assert.equal(runtime.pressLane(2, 1400).length, 0);
  assert.equal(runtime.phase, 'disconnected');
});

test('finished hold emits finish once and ignores additional input', () => {
  const runtime = makeRuntime();
  runtime.pressLane(2, 1000);
  const events = runtime.update(3000);
  assert.equal(events.filter((event) => event.type === 'finish').length, 1);
  assert.equal(runtime.update(3200).length, 0);
  assert.equal(runtime.pressLane(2, 3100).length, 0);
  assert.equal(runtime.phase, 'finished');
});

test('runtime events map into one combo unit per head/tick, never per lane', () => {
  const runtime = makeRuntime();
  const head = runtime.pressLane(1, 1000)[0];
  assert.equal(mapMultiHoldRuntimeEvent(head).grade, 'PURE');
  const mapped = mapMultiHoldRuntimeEvent({ noteId: 'runtime-mh', type: 'reconnect', time: 1800, lane: 2 });
  assert.equal(mapped.comboUnit, false);
});
