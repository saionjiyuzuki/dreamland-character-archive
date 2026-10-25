import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.window = { addEventListener() {} };
const els = new Map();
globalThis.document = { getElementById(id) { if (!els.has(id)) els.set(id, { value: '', textContent: '', addEventListener() {} }); return els.get(id); } };

const { analyzeTaps, CALIB_COUNT_IN, OFFSET_LIMIT_MS } = await import('../dist/settings/latencyCalibration.js');
const { SettingsController, VISUAL_OFFSET_LIMIT_MS } = await import('../dist/settings/settingsController.js');

const beats = Array.from({ length: 20 }, (_, i) => 100 + i * 0.5);

test('measures a consistent late tap bias and ignores the count-in', () => {
  const taps = beats.map((b, i) => b + (i < CALIB_COUNT_IN ? 0.2 : 0.032 + (i % 2 ? 0.004 : -0.004)));
  const r = analyzeTaps(taps, beats);
  assert.ok(r); assert.equal(r.count, 16);
  assert.ok(Math.abs(r.offsetMs - 32) < 0.01, String(r.offsetMs));
  assert.ok(r.spreadMs <= 4.01);
});

test('early taps give a negative offset; stray and double taps are ignored', () => {
  const taps = beats.slice(CALIB_COUNT_IN).map(b => b - 0.02);
  taps.push(beats[10] - 0.019, beats[12] + 0.24); // double tap on one beat, tap far between beats
  const r = analyzeTaps(taps, beats);
  assert.equal(r.count, 16);
  assert.ok(Math.abs(r.offsetMs + 20) < 0.01);
});

test('too few taps returns null', () => {
  assert.equal(analyzeTaps(beats.slice(CALIB_COUNT_IN, CALIB_COUNT_IN + 5), beats), null);
});

test('visual offset persists and both offsets are clamped', () => {
  const G = { speed: 5, offset: 0, visualOffset: 0, volume: 70, keyMap: [], laneMode: 4 };
  const s = new SettingsController({ G, D: {}, AudioEngine: {}, toast() {}, updateLaneUI() {}, computeFallTime: v => v, renderLanes() {} });
  s.applyOffset(999.6);
  assert.equal(G.offset, OFFSET_LIMIT_MS);
  assert.equal(document.getElementById('noffset').value, String(OFFSET_LIMIT_MS));
  G.visualOffset = -42; s.saveSettings();
  const G2 = { ...G, offset: 0, visualOffset: 0 };
  new SettingsController({ G: G2, D: {}, AudioEngine: {}, toast() {}, updateLaneUI() {}, computeFallTime: v => v, renderLanes() {} }).load();
  assert.equal(G2.visualOffset, -42); assert.equal(G2.offset, OFFSET_LIMIT_MS);
  store.set('dreamland_settings', JSON.stringify({ visualOffset: 9999 }));
  new SettingsController({ G: G2, D: {}, AudioEngine: {}, toast() {}, updateLaneUI() {}, computeFallTime: v => v, renderLanes() {} }).load();
  assert.equal(G2.visualOffset, VISUAL_OFFSET_LIMIT_MS);
});
