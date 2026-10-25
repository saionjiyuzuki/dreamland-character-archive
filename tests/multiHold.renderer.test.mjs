import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMultiHoldPath } from '../dist/chart/holdPath.js';
import { MultiHoldRenderer } from '../dist/render/MultiHoldRenderer.js';

function mockContext() {
  const calls = [];
  const gradient = { addColorStop: (...args) => calls.push(['addColorStop', ...args]) };
  const ctx = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, shadowColor: '', shadowBlur: 0,
    save: () => calls.push(['save']), restore: () => calls.push(['restore']),
    createLinearGradient: (...args) => { calls.push(['gradient', ...args]); return gradient; },
    beginPath: () => calls.push(['beginPath']), moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]), closePath: () => calls.push(['closePath']),
    fill: () => calls.push(['fill']), stroke: () => calls.push(['stroke']),
    setLineDash: (...args) => calls.push(['dash', ...args])
  };
  return { ctx, calls };
}

test('Canvas renderer draws path body, core, tick ribs and head without caching pixel coordinates', () => {
  const note = { id: 'render-mh', type: 'multiHold', lanes: [1,2,3], startTime: 1000, endTime: 3000, tickIntervalMs: 500 };
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 30 });
  const { ctx, calls } = mockContext();
  const renderer = new MultiHoldRenderer();
  const stats = renderer.draw(ctx, note, samples, (lane, time) => ({ x: 80 + lane * 18 + time * 0.001, y: 400 - (time - 1000) * 0.05 }), {
    phase: 'holding', chartTimeMs: 1600, laneCount: 8
  });
  assert.ok(stats.sampleCount > 1 && stats.sampleCount < samples.length, 'renderer should clip the already-passed path samples');
  assert.equal(stats.tickRibs, 2, 'past tick ribs should not be redrawn after passing the judgement line');
  assert.ok(calls.some((call) => call[0] === 'fill'));
  assert.ok(calls.some((call) => call[0] === 'stroke'));
  assert.deepEqual(calls.at(-1), ['restore']);
});

test('multi-hold body is a flat translucent fill with nothing drawn inside', () => {
  const note = { id: 'flat-mh', type: 'multiHold', lanes: [1,2], startTime: 1000, endTime: 3000, tickIntervalMs: 500 };
  const samples = sampleMultiHoldPath(note, { laneCount: 8, sampleCount: 30 });
  const { ctx, calls } = mockContext();
  const fills = [];
  const fill = ctx.fill; ctx.fill = () => { fills.push({ style: ctx.fillStyle, alpha: ctx.globalAlpha }); fill(); };
  const stats = new MultiHoldRenderer().draw(ctx, note, samples, (lane, time) => ({ x: 80 + lane * 18, y: 400 - (time - 1000) * 0.05 }), {
    phase: 'waiting', chartTimeMs: 900, laneCount: 8, drawTickRibs: false
  });
  assert.equal(stats.tickRibs, 0);
  assert.equal(fills.length, 1);
  assert.equal(typeof fills[0].style, 'string', 'body fill should be a plain colour, not a gradient');
  assert.ok(fills[0].alpha > 0 && fills[0].alpha < 0.5, 'body should be translucent');
  assert.equal(calls.filter(c => c[0] === 'gradient').length, 0);
  // Body outline + head bar only: no center line or ribs.
  assert.equal(calls.filter(c => c[0] === 'stroke').length, 2);
});
