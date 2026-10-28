import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.document = {
  documentElement: { style: { setProperty() {} } },
  addEventListener() {}, querySelectorAll() { return []; }, querySelector() { return null; }, getElementById() { return null; },
};

const { EconomyService } = await import('../dist/economy/economyService.js');
const { PASS_TIERS, PASS_MAX_TIER, PREMIUM_PASS_MISSIONS, passReward } = await import('../dist/economy/passSeason.js');
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
  assert.equal(PREMIUM_PASS_MISSIONS, 6);
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

test('premium pass unlocks after 6 completed daily missions and back-fills reached premium tiers', () => {
  const { eco, toasts } = fresh();
  eco.addPassExp(300);
  const crystals = eco.data.crystals;
  // play_3 is always among today's missions: three plays complete it.
  for (let i = 0; i < 3; i++) eco.grantPlayRewards(play());
  assert.ok(eco.data.missionsDone >= 1 && eco.data.missionsDone < 6);
  assert.equal(eco.data.premiumPass, false);
  assert.equal(eco.tierState('premium', 1), 'premiumLocked');
  // A fresh day with play_3 one play short: the next play completes the 6th mission.
  eco.data.missionsDone = 5;
  eco.data.daily = ensureDaily(null);
  eco.data.daily.progress.play_3 = 2;
  const r = eco.grantPlayRewards(play());
  assert.equal(r.premiumUnlocked, true);
  assert.equal(eco.data.premiumPass, true);
  assert.ok(toasts.some(t => t.includes('高级通行证已解锁')));
  assert.ok(eco.data.crystals >= crystals, 'no Crystal spent');
  assert.equal(eco.premiumMissionsLeft(), 0);
  assert.equal(eco.tierState('premium', 1), 'claimable');
  eco.claimAllPass();
  assert.ok(eco.owns('fx_nova'));
  assert.equal(eco.equip('hitEffect', 'fx_nova'), true);
  assert.equal(activeHitEffect().id, 'fx_nova');
  assert.equal(eco.equip('noteSkin', 'skin_prism'), false, 'cannot equip unowned premium skin');
  assert.equal(activeNoteSkin().id, 'skin_default');
});

test('mission count persists, older saves start from today, an earned count unlocks on load', () => {
  const { eco } = fresh();
  eco.data.missionsDone = 4; eco.save();
  assert.equal(fresh(JSON.parse(store.get(KEY))).eco.data.missionsDone, 4);
  const legacy = fresh({ version: 2, coins: 0 }).eco;
  assert.equal(legacy.data.missionsDone, 0);
  assert.equal(legacy.data.premiumPass, false);
  const earned = fresh({ version: 2, missionsDone: 6 }).eco;
  assert.equal(earned.data.premiumPass, true);
  assert.equal(fresh({ version: 2, premiumPass: true }).eco.data.premiumPass, true, 'bought passes stay active');
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

test('Last Dance and Moonfall are free for new and existing saves; Lanterns and Iron Princess cost Crystal', () => {
  assert.ok(fresh().eco.isSongUnlocked('song_dz_last_dance'));
  const { eco } = fresh({ version: 1, unlockedSongs: ['song_test_destroyer'] });
  assert.ok(eco.isSongUnlocked('song_dz_last_dance'));
  assert.ok(eco.isSongUnlocked('song_sp_last_dance'), 'retired SP id of an old save still resolves');
  assert.ok(eco.isSongUnlocked('moonfall'));
  for (const id of ['lanterns', 'iron_princess']) { assert.equal(eco.isSongUnlocked(id), false); assert.equal(eco.songPrice(id), 12); }
});

test('songs unlock as a whole; removed songs from old saves are ignored', () => {
  const { eco } = fresh({ version: 2, unlockedSongs: ['song_sp_disorder', 'je'] });
  for (const k of ['ez', 'hd', 'ex', 'dz']) assert.ok(eco.isSongUnlocked(`song_${k}_last_dance`));
  assert.equal(eco.buySong('last_dance'), false, 'already unlocked');
  assert.equal(eco.buySong('disorder'), false, 'removed song cannot be bought');
  assert.equal(eco.isSongUnlocked('song_sp_disorder'), true, 'stale id stays in the save but matches no song');
  assert.equal(eco.isSongUnlocked('disorder'), false);
});
