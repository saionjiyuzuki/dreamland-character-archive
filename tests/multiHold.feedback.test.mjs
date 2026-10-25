import test from 'node:test';
import assert from 'node:assert/strict';
import { HoldVisualEffectManager } from '../dist/render/HoldVisualEffect.js';

test('hold tick feedback expires and throttles repeated PURE labels', () => {
  const effects = new HoldVisualEffectManager(420, 250);
  const first = effects.addTick('h', 'PURE', 1000, 10, 20);
  assert.equal(first.text, 'PERFECT');
  assert.equal(effects.addTick('h', 'PURE', 1100, 10, 20), null);
  assert.equal(effects.addTick('h', 'LOST', 1150, 10, 20).text, 'LOST');
  assert.equal(effects.activeAt(1200).length, 2);
  assert.equal(effects.activeAt(1600).length, 0);
});
