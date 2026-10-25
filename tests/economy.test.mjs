import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document = {
  documentElement: { style: { setProperty() {} } },
  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, getElementById() { return null; },
};

const { EconomyService } = await import('../dist/economy/economyService.js');
const { PASS_TIERS, PASS_MAX_TIER, PREMIUM_PASS_PRICE, passReward } = await import('../dist/economy/passSeason.js');
const { ensureDaily, pickMissions, recordPlay, missionStatus, localDateKey, MISSION_POOL } = await import('../dist/economy/dailyMissions.js');
const { NOTE_SKINS, HIT_EFFECTS, activeNoteSkin, activeHitEffect } = await import('../dist/cosmetics/catalog.js');

const KEY = 'dreamland_economy_v1';
const fresh = (saved) => { store.clear(); if (saved) store.set(KEY, JSON.stringify(saved)); const toasts = []; const eco = new EconomyService({}, s => toasts.push(s)); return { eco, toasts }; };
const play = (over = {}) => ({ pure: 200, great: 10, far: 5, lost: 0, maxCombo: 215, score: 960000, chart: { id: 'song_a', diff: 10 }, ...over });

test('season table: 30 tiers, Crystal milestones every 5 free tiers, basic vs premium cosmetics', () => {
  assert.equal(PASS_TIERS.length, PASS_MAX_TIER);
  for (let t = 5; t <= 30; t += 5) assert.equal(passReward('free', t).kind, 'crystal');
  const grades = (track) => PASS_TIERS.map(r => r[track]).filter(r => r.id).map(r => (NOTE_SKINS.find(s => s.id === r.id) || HIT_EFFECTS.find(e => e.id === r.id)).grade);
  assert.ok(grades('free').length >= 4 && grades('free').every(g => g === 'basic'));
  assert.ok(grades('premium').length >= 6 && grades('premium').every(g => g === 'premium'));
  const premiumCrystal = PASS_TIERS.reduce((n, r) => n + (r.premium.kind === 'crystal' ? r.premium.amount : 0), 0);
  assert.ok(premiumCrystal > PREMIUM_PASS_PRICE, 'premium track should pay back its unlock price');
});

test('tier-ups unlock rewards that must be claimed; claims are idempotent', () => {
  const { eco } = fresh();
  eco.addPassExp(500);
  assert.equal(eco.reachedTier(), 5);
  assert.equal(eco.tierState('free', 5), 'claimable');
  assert.equal(eco.tierState('free', 6), 'locked');
  assert.equal(eco.tierState('premium', 1), 'premiumLocked');
  const before = eco.data.crystals;
  assert.equal(eco.claimTier('free', 5), true);
  assert.equal(eco.data.crystals, before + 10);
  assert.equal(eco.claimTier('free', 5), false);
  assert.equal(eco.claimTier('free', 6), false);
  assert.equal(eco.claimAllPass(), 4);
  assert.ok(eco.owns('fx_ripple'), 'tier 3 basic hit effect granted');
});

test('premium unlock costs Crystal and back-fills reached premium tiers', () => {
  const { eco } = fresh();
  eco.addPassExp(300);
  assert.equal(eco.buyPremium(), false);
  eco.data.crystals = PREMIUM_PASS_PRICE + 1;
  assert.equal(eco.buyPremium(), true);
  assert.equal(eco.data.crystals, 1);
  assert.equal(eco.tierState('premium', 1), 'claimable');
  eco.claimAllPass();
  assert.ok(eco.owns('fx_nova'));
  assert.equal(eco.equip('hitEffect', 'fx_nova'), true);
  assert.equal(activeHitEffect().id, 'fx_nova');
  assert.equal(eco.equip('noteSkin', 'skin_prism'), false, 'cannot equip unowned premium skin');
  assert.equal(activeNoteSkin().id, 'skin_default');
});

test('pass progression caps at tier 30', () => {
  const { eco } = fresh();
  eco.addPassExp(100 * 40);
  assert.equal(eco.reachedTier(), 30);
  assert.equal(eco.data.passExp, 0);
  assert.equal(eco.addPassExp(500), 0);
});

test('legacy V12.8 saves keep auto-granted tiers claimed and receive their cosmetics', () => {
  const { eco } = fresh({ coins: 50, crystals: 7, passLevel: 9, passExp: 40, claimedPass: [1, 2, 3, 4, 5, 6, 7, 8], equippedNoteSkin: 'skin_prism' });
  assert.equal(eco.tierState('free', 5), 'claimed');
  assert.ok(eco.owns('fx_ripple') && eco.owns('skin_frost'));
  assert.equal(eco.data.equippedNoteSkin, 'skin_default', 'unowned equipped skin falls back to default');
  assert.equal(eco.passClaimableCount(), 0);
});

test('daily missions are deterministic per day and track a play', () => {
  const date = '2026-10-25';
  assert.deepEqual(pickMissions(date), pickMissions(date));
  assert.equal(new Set(pickMissions(date)).size, 4);
  assert.equal(pickMissions(date)[0], 'play_3');
  const state = ensureDaily(null);
  assert.equal(state.date, localDateKey());
  state.missions = MISSION_POOL.slice(0, 4).map(m => m.id);
  const done = recordPlay(state, { songId: 'a', pure: 320, great: 0, far: 0, lost: 0, maxCombo: 320, score: 1e6, accuracy: 1 });
  assert.ok(done.includes('pure_300'));
  assert.equal(missionStatus(state, 'play_3').value, 1);
  recordPlay(state, { songId: 'a', pure: 1, great: 0, far: 0, lost: 0, maxCombo: 1, score: 1, accuracy: 1 });
  assert.equal(missionStatus(state, 'distinct_2').value, 1, 'same song counted once');
  assert.equal(ensureDaily({ ...state, date: '2000-01-01' }).progress.play_3 ?? 0, 0, 'stale day resets');
});

test('grantPlayRewards feeds daily missions; claiming grants pass EXP once', () => {
  const { eco } = fresh();
  const d = eco.daily();
  d.missions = ['play_3', 'full_combo', 'acc_95', 'combo_150'];
  const r = eco.grantPlayRewards(play());
  assert.ok(r.missionsCompleted.length >= 3);
  assert.ok(r.claimable >= 3);
  const passExp = eco.data.passExp + eco.reachedTier() * 100;
  assert.equal(eco.claimMission('full_combo'), true);
  assert.equal(eco.claimMission('full_combo'), false);
  assert.equal(eco.data.passExp + eco.reachedTier() * 100, passExp + 120);
  assert.equal(eco.claimMission('play_3'), false, 'unfinished mission cannot be claimed');
  assert.equal(eco.claimDailyBonus(), false);
});

test('Last Dance SP20 is free for new and existing saves', () => {
  assert.ok(fresh().eco.isSongUnlocked('song_sp_last_dance'));
  const { eco } = fresh({ version: 1, unlockedSongs: ['song_test_destroyer'] });
  assert.ok(eco.isSongUnlocked('song_sp_last_dance'));
});
