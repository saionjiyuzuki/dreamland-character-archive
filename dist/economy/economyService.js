import { DEFAULT_HIT_EFFECT, DEFAULT_NOTE_SKIN, HIT_EFFECTS, NOTE_SKINS, findHitEffect, findNoteSkin, gradeLabel, setActiveCosmetics } from '../cosmetics/catalog.js';
import { PASS_EXP_PER_TIER, PASS_MAX_TIER, PASS_SEASON, PASS_TIERS, PREMIUM_PASS_MISSIONS, cosmeticSource, isCosmeticReward, passReward, rewardLabel } from './passSeason.js';
import { DAILY_BONUS, dailyBonusReady, ensureDaily, findMission, formatCountdown, localDateKey, missionStatus, msUntilReset, recordPlay } from './dailyMissions.js';
import { CosmeticPreview } from '../render/cosmeticPreview.js';
import { escapeHTML, pad2 } from '../ui/html.js';
import { DIFFICULTIES, SONGS, findSong, songChart, songOfChart } from '../data/songs.js';
const KEY = 'dreamland_economy_v1';
const SAVE_VERSION = 2;
/** Validate localStorage data because it can be stale, malformed, or manually edited. */
export function normalizeSaveData(raw, base) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return { ...base, daily: ensureDaily(null) };
    const value = raw;
    const integer = (input, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => typeof input === 'number' && Number.isFinite(input)
        ? Math.max(min, Math.min(max, Math.floor(input))) : fallback;
    const stringList = (input, fallback) => Array.isArray(input)
        ? [...new Set(input.filter((item) => typeof item === 'string' && item.length <= 160))]
        : [...fallback];
    const tierList = (input, fallback) => Array.isArray(input)
        ? [...new Set(input.filter((n) => Number.isInteger(n) && n >= 1 && n <= PASS_MAX_TIER))]
        : [...fallback];
    // V12.8 saves auto-granted free-track currency into `claimedPass`; keep those tiers claimed
    // and hand out any cosmetic that now sits on them so no reward is lost or paid twice.
    const legacy = integer(value.version, 1) < SAVE_VERSION;
    const claimedFree = tierList(value.claimedFree ?? (legacy ? value.claimedPass : undefined), base.claimedFree);
    const ownedCosmetics = stringList(value.ownedCosmetics, base.ownedCosmetics);
    if (legacy)
        for (const tier of claimedFree) {
            const r = passReward('free', tier);
            if (r && isCosmeticReward(r) && !ownedCosmetics.includes(r.id))
                ownedCosmetics.push(r.id);
        }
    const daily = ensureDaily(value.daily);
    return {
        version: SAVE_VERSION,
        coins: integer(value.coins, base.coins),
        crystals: integer(value.crystals, base.crystals),
        exp: integer(value.exp, base.exp),
        level: integer(value.level, base.level, 1),
        passExp: integer(value.passExp, base.passExp, 0, PASS_EXP_PER_TIER - 1),
        passLevel: integer(value.passLevel, base.passLevel, 1, PASS_MAX_TIER + 1),
        premiumPass: value.premiumPass === true,
        claimedFree,
        claimedPremium: tierList(value.claimedPremium, base.claimedPremium),
        unlockedSongs: stringList(value.unlockedSongs, base.unlockedSongs),
        ownedCosmetics,
        equippedCosmetic: typeof value.equippedCosmetic === 'string' ? value.equippedCosmetic : base.equippedCosmetic,
        equippedNoteSkin: typeof value.equippedNoteSkin === 'string' ? value.equippedNoteSkin : base.equippedNoteSkin,
        equippedHitEffect: typeof value.equippedHitEffect === 'string' ? value.equippedHitEffect : base.equippedHitEffect,
        daily,
        plays: integer(value.plays, base.plays),
        // Saves before V12.12 did not count missions; start from what today's missions already show as done.
        missionsDone: integer(value.missionsDone, daily.missions.filter(id => missionStatus(daily, id).done).length),
    };
}
const PASS_VIEWS = ['pass', 'missions', 'loadout'], SHOP_VIEWS = ['songs', 'cosmetics'];
const toView = (v) => v === 'shop' ? 'songs' : [...PASS_VIEWS, ...SHOP_VIEWS].includes(v) ? v : 'pass';
const COSMETICS = [
    { id: 'aura_aurora', name: '极光轨迹', desc: '判定与长条边缘呈现极光青紫色', price: 250, accent: '#7cf5e5' },
    { id: 'aura_rose', name: '星云玫瑰', desc: '粉紫色梦境主题', price: 400, accent: '#f5a7ff' },
    { id: 'aura_gold', name: '晨曦金辉', desc: '金色发光主题', price: 650, accent: '#ffd98a' },
    { id: 'aura_void', name: '虚空棱镜', desc: '冷白与蓝紫主题', price: 900, accent: '#b9c7ff' }
];
function summarize(rewards, extra = { passExp: 0 }) {
    let coin = extra.coin || 0, crystal = extra.crystal || 0;
    const items = [];
    for (const r of rewards) {
        if (r.kind === 'coin')
            coin += r.amount;
        else if (r.kind === 'crystal')
            crystal += r.amount;
        else
            items.push(rewardLabel(r));
    }
    return [extra.passExp ? `+${extra.passExp} 通行证 EXP` : '', crystal ? `✧ ${crystal} Crystal` : '', coin ? `◉ ${coin} Coin` : '', ...items].filter(Boolean).join(' · ');
}
export class EconomyService {
    toast;
    opts;
    data;
    charts;
    view = 'pass';
    passView = 'pass';
    shopView = 'songs';
    page = '';
    focusSong = '';
    preview = new CosmeticPreview();
    previewPick = { skin: DEFAULT_NOTE_SKIN, fx: DEFAULT_HIT_EFFECT };
    timer = null;
    constructor(charts, toast, opts = {}) {
        this.toast = toast;
        this.opts = opts;
        this.charts = charts;
        const base = { version: SAVE_VERSION, coins: 0, crystals: 0, exp: 0, level: 1, passExp: 0, passLevel: 1, premiumPass: false, claimedFree: [], claimedPremium: [], unlockedSongs: [], ownedCosmetics: [], equippedCosmetic: 'default', equippedNoteSkin: DEFAULT_NOTE_SKIN, equippedHitEffect: DEFAULT_HIT_EFFECT, daily: ensureDaily(null), plays: 0, missionsDone: 0 };
        try {
            this.data = normalizeSaveData(JSON.parse(localStorage.getItem(KEY) || 'null'), base);
        }
        catch {
            this.data = { ...base };
        }
        // V12.9 unlocked single charts; a purchased chart now unlocks its whole song (every difficulty).
        this.data.unlockedSongs = [...new Set(this.data.unlockedSongs.map(id => songOfChart(id)?.id || id))];
        if (!this.owns(this.data.equippedNoteSkin) || !findNoteSkin(this.data.equippedNoteSkin))
            this.data.equippedNoteSkin = DEFAULT_NOTE_SKIN;
        if (!this.owns(this.data.equippedHitEffect) || !findHitEffect(this.data.equippedHitEffect))
            this.data.equippedHitEffect = DEFAULT_HIT_EFFECT;
        if (this.unlockPremiumIfEarned())
            this.save();
        this.applyCosmetic();
        this.bindEvents();
        this.refresh();
    }
    save() { try {
        localStorage.setItem(KEY, JSON.stringify(this.data));
    }
    catch { } this.refresh(); }
    setOptions(opts) { this.opts = { ...this.opts, ...opts }; this.opts.preview?.onChange(() => this.syncShopPreview()); }
    /** Accepts a song id or any chart id of the song. */
    isSongUnlocked(id) { const song = findSong(id) || songOfChart(id); if (!song)
        return this.data.unlockedSongs.includes(id); return song.price <= 0 || this.data.unlockedSongs.includes(song.id); }
    songPrice(id) { return (findSong(id) || songOfChart(id))?.price || 0; }
    grantPlayRewards(g) {
        const pure = Number(g.pure) || 0, great = Number(g.great) || 0, far = Number(g.far) || 0, lost = Number(g.lost) || 0;
        const total = Math.max(1, pure + great + far + lost);
        const accuracy = (pure + great * .75 + far * .5) / total;
        const coin = Math.round(18 + accuracy * 22 + Math.min(12, (Number(g.chart?.diff) || 1)));
        const exp = Math.round(45 + accuracy * 35 + Math.min(30, (Number(g.chart?.diff) || 1) * 2));
        this.data.coins += coin;
        this.data.exp += exp;
        this.data.plays++;
        let levelUps = 0;
        while (this.data.exp >= this.expForNextLevel(this.data.level)) {
            this.data.exp -= this.expForNextLevel(this.data.level);
            this.data.level++;
            this.data.crystals += 5;
            levelUps++;
        }
        const passUps = this.addPassExp(exp);
        const completed = recordPlay(this.daily(), { songId: String(g.chart?.songId || g.chart?.id || ''), pure, great, far, lost, maxCombo: Number(g.maxCombo) || 0, score: Number(g.score) || 0, accuracy });
        this.data.missionsDone += completed.length;
        const premiumUnlocked = this.unlockPremiumIfEarned();
        this.save();
        return { coin, exp, levelUps, passUps, crystals: this.data.crystals, coins: this.data.coins, missionsCompleted: completed.map(id => findMission(id)?.title || id), claimable: this.claimableCount(), premiumUnlocked };
    }
    expForNextLevel(level) { return 100 + (Math.max(1, level) - 1) * 25; }
    /* ── V-PASS ── */
    /** Highest tier whose rewards are unlocked (0 before the first tier-up). */
    reachedTier() { return Math.min(PASS_MAX_TIER, this.data.passLevel - 1); }
    addPassExp(amount) {
        if (this.data.passLevel > PASS_MAX_TIER) {
            this.data.passExp = 0;
            return 0;
        }
        this.data.passExp += Math.max(0, Math.floor(amount));
        let ups = 0;
        while (this.data.passExp >= PASS_EXP_PER_TIER && this.data.passLevel <= PASS_MAX_TIER) {
            this.data.passExp -= PASS_EXP_PER_TIER;
            this.data.passLevel++;
            ups++;
        }
        if (this.data.passLevel > PASS_MAX_TIER)
            this.data.passExp = 0;
        return ups;
    }
    tierState(track, tier) {
        if ((track === 'free' ? this.data.claimedFree : this.data.claimedPremium).includes(tier))
            return 'claimed';
        if (tier > this.reachedTier())
            return 'locked';
        if (track === 'premium' && !this.data.premiumPass)
            return 'premiumLocked';
        return 'claimable';
    }
    passClaimableCount() { let n = 0; for (const row of PASS_TIERS) {
        if (this.tierState('free', row.tier) === 'claimable')
            n++;
        if (this.tierState('premium', row.tier) === 'claimable')
            n++;
    } return n; }
    missionClaimableCount() { const d = this.daily(); return d.missions.filter(id => missionStatus(d, id).claimable).length + (dailyBonusReady(d) ? 1 : 0); }
    claimableCount() { return this.passClaimableCount() + this.missionClaimableCount(); }
    grantReward(r) {
        if (r.kind === 'coin')
            this.data.coins += r.amount;
        else if (r.kind === 'crystal')
            this.data.crystals += r.amount;
        else if (!this.data.ownedCosmetics.includes(r.id))
            this.data.ownedCosmetics.push(r.id);
    }
    takeTier(track, tier) {
        const r = passReward(track, tier);
        if (!r || this.tierState(track, tier) !== 'claimable')
            return null;
        (track === 'free' ? this.data.claimedFree : this.data.claimedPremium).push(tier);
        this.grantReward(r);
        return r;
    }
    claimTier(track, tier) {
        const r = this.takeTier(track, tier);
        if (!r)
            return false;
        this.save();
        this.toast(`已领取 TIER ${pad2(tier)}：${rewardLabel(r)}`);
        this.rerender();
        return true;
    }
    claimAllPass() {
        const got = [];
        for (const row of PASS_TIERS)
            for (const track of ['free', 'premium']) {
                const r = this.takeTier(track, row.tier);
                if (r)
                    got.push(r);
            }
        if (!got.length) {
            this.toast('暂无可领取的奖励');
            return 0;
        }
        this.save();
        this.toast(`已领取 ${got.length} 项奖励：${summarize(got)}`);
        this.rerender();
        return got.length;
    }
    /** Missions still needed for the premium track (0 once it is active). */
    premiumMissionsLeft() { return this.data.premiumPass ? 0 : Math.max(0, PREMIUM_PASS_MISSIONS - this.data.missionsDone); }
    /** Activates the premium track once enough daily missions are complete; true when it just unlocked. */
    unlockPremiumIfEarned() {
        if (this.data.premiumPass || this.data.missionsDone < PREMIUM_PASS_MISSIONS)
            return false;
        this.data.premiumPass = true;
        const pending = PASS_TIERS.filter(row => this.tierState('premium', row.tier) === 'claimable').length;
        this.toast(`完成 ${PREMIUM_PASS_MISSIONS} 个每日任务，高级通行证已解锁${pending ? `，${pending} 项高级奖励可领取` : ''}`);
        return true;
    }
    premiumProgress() {
        const done = Math.min(PREMIUM_PASS_MISSIONS, this.data.missionsDone);
        return `<button type="button" class="vp-buy" data-economy-open="missions"><b>完成 ${PREMIUM_PASS_MISSIONS} 个每日任务解锁高级通行证 · ${done} / ${PREMIUM_PASS_MISSIONS}</b><div class="eco-progress"><i style="width:${done / PREMIUM_PASS_MISSIONS * 100}%"></i></div><small>任务达成即计入，解锁后可补领已达成等级的高级奖励 · 前往每日任务 ›</small></button>`;
    }
    /* ── 每日任务 ── */
    daily() { if (this.data.daily.date !== localDateKey())
        this.data.daily = ensureDaily(null); return this.data.daily; }
    grantMissionReward(r) {
        this.data.coins += r.coin || 0;
        this.data.crystals += r.crystal || 0;
        const ups = this.addPassExp(r.passExp);
        return ups ? ` · V-PASS 升至 LV.${pad2(this.reachedTier())}` : '';
    }
    claimMission(id) {
        const d = this.daily(), st = missionStatus(d, id);
        if (!st.def || !st.claimable)
            return false;
        d.claimed.push(id);
        const up = this.grantMissionReward(st.def.reward);
        this.save();
        this.toast(`任务完成：${summarize([], st.def.reward)}${up}`);
        this.rerender();
        return true;
    }
    claimDailyBonus() {
        const d = this.daily();
        if (!dailyBonusReady(d))
            return false;
        d.bonusClaimed = true;
        const up = this.grantMissionReward(DAILY_BONUS);
        this.save();
        this.toast(`每日全勤奖励：${summarize([], DAILY_BONUS)}${up}`);
        this.rerender();
        return true;
    }
    /* ── 装扮 ── */
    owns(id) { const def = findNoteSkin(id) || findHitEffect(id); return def?.grade === 'default' || this.data.ownedCosmetics.includes(id); }
    equip(kind, id) {
        const def = kind === 'noteSkin' ? findNoteSkin(id) : findHitEffect(id);
        if (!def)
            return false;
        if (!this.owns(id)) {
            this.toast(`尚未获得「${def.name}」：${cosmeticSource(id) || 'V-PASS 奖励'}`);
            return false;
        }
        if (kind === 'noteSkin')
            this.data.equippedNoteSkin = id;
        else
            this.data.equippedHitEffect = id;
        this.previewPick = kind === 'noteSkin' ? { ...this.previewPick, skin: id } : { ...this.previewPick, fx: id };
        this.applyCosmetic();
        this.save();
        this.toast(`已装备${kind === 'noteSkin' ? '音符' : '打击特效'}「${def.name}」`);
        this.rerender();
        return true;
    }
    buySong(id) {
        const song = findSong(id) || songOfChart(id);
        if (!song)
            return false;
        if (this.isSongUnlocked(song.id)) {
            this.toast('这首歌已经解锁');
            return false;
        }
        if (this.data.crystals < song.price) {
            this.toast(`Crystal 不足：需要 ${song.price}，可通过升级、V-PASS 与每日任务获得`);
            return false;
        }
        this.data.crystals -= song.price;
        this.data.unlockedSongs.push(song.id);
        this.save();
        this.toast(`已解锁《${song.title}》全部难度`);
        this.rerender();
        return true;
    }
    buyCosmetic(id) { const item = COSMETICS.find(x => x.id === id); if (!item)
        return; if (this.data.ownedCosmetics.includes(id)) {
        this.data.equippedCosmetic = id;
        this.applyCosmetic();
        this.save();
        this.toast(`已装备「${item.name}」`);
        this.rerender();
        return;
    } if (this.data.coins < item.price) {
        this.toast(`Coin 不足：需要 ${item.price}`);
        return;
    } this.data.coins -= item.price; this.data.ownedCosmetics.push(id); this.data.equippedCosmetic = id; this.applyCosmetic(); this.save(); this.toast(`购买并装备「${item.name}」`); this.rerender(); }
    applyCosmetic() {
        const item = COSMETICS.find(x => x.id === this.data.equippedCosmetic);
        document.documentElement.style.setProperty('--hold', item?.accent || '#6ee7d6');
        document.documentElement.style.setProperty('--holdb', item?.accent || '#a5f3fc');
        setActiveCosmetics(this.data.equippedNoteSkin, this.data.equippedHitEffect);
    }
    refresh() {
        const lv = this.data.level, exp = this.data.exp, next = this.expForNextLevel(lv), pct = Math.min(100, exp / next * 100);
        document.querySelectorAll('.dream-level strong').forEach(e => { e.textContent = `LV. ${String(lv).padStart(2, '0')}`; });
        document.querySelectorAll('.dream-level small').forEach(e => { e.textContent = `${exp} / ${next} EXP`; });
        document.querySelectorAll('.select-player small').forEach(e => { e.textContent = `LV. ${String(lv).padStart(2, '0')} · ${exp} / ${next} EXP`; });
        document.querySelectorAll('.dream-profile-level').forEach(e => { e.innerHTML = `Lv. ${String(lv).padStart(2, '0')} <span>旅程等级</span>`; });
        document.querySelectorAll('.dream-exp i,.select-exp i,.dream-profile-progress i').forEach(e => { e.style.width = pct + '%'; });
        const resources = Array.from(document.querySelectorAll('.dream-resource'));
        if (resources[0]) {
            const el = resources[0].querySelector('strong');
            if (el)
                el.textContent = String(this.data.crystals);
        }
        if (resources[1]) {
            const el = resources[1].querySelector('strong');
            if (el)
                el.textContent = String(this.data.coins);
        }
        document.querySelectorAll('[data-wallet]').forEach(el => { el.innerHTML = `<span class="w-crystal">✧ <b>${this.data.crystals}</b><small>CRYSTAL</small></span><span class="w-coin">◉ <b>${this.data.coins}</b><small>COIN</small></span>`; });
        // Red-dot badges on every entry point that leads to claimable rewards.
        const pass = this.passClaimableCount(), missions = this.missionClaimableCount();
        const badges = { pass: pass + missions, missions, 'tab-pass': pass, 'tab-missions': missions };
        document.querySelectorAll('[data-economy-open],[data-eco-tab]').forEach(el => {
            const n = (el.dataset.ecoTab ? badges['tab-' + el.dataset.ecoTab] : badges[el.dataset.economyOpen || '']) || 0;
            if (n > 0)
                el.dataset.badge = String(n);
            else
                delete el.dataset.badge;
        });
    }
    /* ── Pages: V-PASS (pass / missions / loadout) and Shop (songs / cosmetics) ── */
    /** Opens the page that owns `view`; `focus` highlights a song in the shop. */
    open(view = 'pass', focus = '') {
        const v = toView(view);
        if (PASS_VIEWS.includes(v))
            this.passView = v;
        else
            this.shopView = v;
        this.focusSong = focus;
        const page = PASS_VIEWS.includes(v) ? 'pass' : 'shop';
        if (this.opts.navigate)
            this.opts.navigate(page);
        else
            this.showPage(page);
    }
    /** Called by the UI controller whenever a menu page becomes visible. */
    showPage(page) {
        if (page !== 'pass' && page !== 'shop') {
            this.hidePages();
            return;
        }
        if (page !== this.page) {
            this.opts.preview?.stop();
            this.preview.stop();
        }
        this.page = page;
        this.previewPick = { skin: this.data.equippedNoteSkin, fx: this.data.equippedHitEffect };
        this.render(page === 'pass' ? this.passView : this.shopView, true);
        if (!this.timer)
            this.timer = setInterval(() => this.tick(), 1000);
    }
    hidePages() {
        if (!this.page)
            return;
        this.page = '';
        this.preview.stop();
        this.opts.preview?.stop();
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    pageVisible() { const el = document.getElementById(this.page === 'shop' ? 'pageShop' : 'pagePass'); return !!this.page && !!el && !el.classList.contains('hidden'); }
    tick() {
        if (!this.pageVisible()) {
            this.hidePages();
            return;
        }
        if (this.data.daily.date !== localDateKey()) {
            this.daily();
            this.save();
            if (this.view === 'missions')
                this.rerender();
        }
        const el = document.querySelector('[data-daily-countdown]');
        if (el)
            el.textContent = formatCountdown(msUntilReset());
    }
    rerender() { if (this.pageVisible())
        this.render(this.view); }
    /** @param fresh re-centre the V-PASS track instead of keeping its scroll position. */
    render(view, fresh = false) {
        const v = toView(view), shop = SHOP_VIEWS.includes(v);
        const body = document.getElementById(shop ? 'shopBody' : 'passBody');
        if (!body)
            return;
        const prevView = this.view;
        this.view = v;
        if (shop)
            this.shopView = v;
        else
            this.passView = v;
        if (v === 'loadout' && prevView !== 'loadout')
            this.previewPick = { skin: this.data.equippedNoteSkin, fx: this.data.equippedHitEffect };
        const track = body.querySelector('.vp-track'), keepScroll = !fresh && prevView === v && track ? track.scrollLeft : null;
        this.preview.stop();
        if (shop)
            body.innerHTML = this.shopHTML();
        else
            body.innerHTML = `${this.progressionTabs()}${v === 'pass' ? this.passHTML() : v === 'missions' ? this.missionsHTML() : this.loadoutHTML()}`;
        this.refresh();
        const canvas = body.querySelector('[data-cosmetic-preview]');
        if (canvas) {
            this.preview.set(this.previewPick.skin, this.previewPick.fx);
            this.preview.attach(canvas);
        }
        const nextTrack = body.querySelector('.vp-track');
        if (nextTrack) {
            if (keepScroll !== null)
                nextTrack.scrollLeft = keepScroll;
            else {
                const cur = nextTrack.querySelector('.vp-col.current') || nextTrack.querySelector('.vp-col:last-child');
                if (cur)
                    nextTrack.scrollLeft = Math.max(0, cur.offsetLeft - nextTrack.clientWidth / 2 + cur.offsetWidth / 2);
            }
        }
        if (shop && this.focusSong) {
            const card = body.querySelector(`[data-shop-song="${CSS.escape(this.focusSong)}"]`);
            card?.classList.add('focus');
            card?.scrollIntoView?.({ block: 'center' });
            this.focusSong = '';
        }
        this.syncShopPreview();
    }
    shopHTML() {
        const tab = (id, label, sub) => `<button data-eco-tab="${id}" class="${this.view === id ? 'active' : ''}">${label}<small>${sub}</small></button>`;
        const tabs = `<div class="eco-tabs hub-tabs">${tab('songs', '曲目', 'SONGS · CRYSTAL')}${tab('cosmetics', '主题', 'THEMES · COIN')}</div>`;
        if (this.view === 'cosmetics') {
            const items = COSMETICS.map(x => { const owned = this.data.ownedCosmetics.includes(x.id), equipped = this.data.equippedCosmetic === x.id; return `<article class="shop-card theme${equipped ? ' equipped' : ''}"><div class="shop-art" style="--accent:${x.accent}">✧</div><div class="shop-info"><strong>${escapeHTML(x.name)}</strong><small>${escapeHTML(x.desc)}</small></div><div class="shop-buy"><span>${owned ? (equipped ? '使用中' : '已拥有') : `◉ ${x.price}`}</span><button type="button" data-buy-cosmetic="${x.id}" ${equipped ? 'disabled' : ''}>${equipped ? '已装备' : owned ? '装备' : '购买'}</button></div></article>`; }).join('');
            return `${tabs}<p class="shop-lead">长条与判定的主题色，使用打歌获得的 Coin 购买。音符样式与打击特效来自 <button type="button" class="shop-link" data-economy-open="loadout">V-PASS · 装扮</button>。</p><div class="shop-grid">${items}</div>`;
        }
        const cards = SONGS.map(song => this.shopSongCard(song)).join('');
        const promo = this.data.premiumPass ? '' : `<button type="button" class="shop-promo" data-economy-open="pass"><small>V-PASS ${PASS_SEASON.code}</small><strong>高级通行证 · 6 款高级音符与打击特效</strong><span>完成 ${PREMIUM_PASS_MISSIONS} 个每日任务免费解锁 · ${Math.min(PREMIUM_PASS_MISSIONS, this.data.missionsDone)} / ${PREMIUM_PASS_MISSIONS} ›</span></button>`;
        return `${tabs}${promo}<p class="shop-lead">使用 Crystal 解锁曲目，一次解锁包含 EZ / HD / EX / DZ 全部难度。Crystal 来自等级提升、V-PASS 里程碑与每日任务。</p><div class="shop-grid songs">${cards}</div>`;
    }
    shopSongCard(song) {
        const owned = this.isSongUnlocked(song.id);
        const levels = DIFFICULTIES.map(k => { const c = songChart(song, k); return c ? `<i class="pip ${k.toLowerCase()}"><small>${k}</small>${c.diff}</i>` : ''; }).join('');
        const action = owned ? `<button type="button" class="ghost" data-shop-play="${escapeHTML(song.id)}">去演奏 ›</button>` : `<button type="button" data-buy-song="${escapeHTML(song.id)}">解锁 · ✧ ${song.price}</button>`;
        return `<article class="shop-card song${owned ? ' owned' : ''}" data-shop-song="${escapeHTML(song.id)}" style="--accent:${song.accent}"><div class="shop-art">${escapeHTML(song.jacket)}<button type="button" class="shop-listen" data-shop-preview="${escapeHTML(song.id)}" aria-label="试听">▶</button></div><div class="shop-info"><strong>${escapeHTML(song.title)}${song.tag ? `<em class="sel-tag ${song.tag.toLowerCase()}">${song.tag}</em>` : ''}</strong><small>${escapeHTML(song.artist)} · BPM ${Math.round(song.bpm)}</small><span class="shop-levels">${levels}</span></div><div class="shop-buy"><span>${owned ? (song.price ? '已拥有' : '免费') : `✧ ${song.price}`}</span>${action}</div></article>`;
    }
    toggleShopPreview(id) {
        const song = findSong(id), p = this.opts.preview;
        if (!song || !p)
            return;
        const url = this.opts.audioUrl?.(song.charts.DZ || Object.values(song.charts)[0] || '');
        if (!url)
            return;
        if (p.current === url)
            p.stop();
        else
            void p.play(url, song.previewStartMs);
    }
    syncShopPreview() {
        const url = this.opts.preview?.current || '';
        document.querySelectorAll('[data-shop-preview]').forEach(btn => {
            const song = findSong(btn.dataset.shopPreview || ''), mine = !!song && !!url && this.opts.audioUrl?.(song.charts.DZ || Object.values(song.charts)[0] || '') === url;
            btn.textContent = mine ? '❚❚' : '▶';
            btn.closest('.shop-card')?.classList.toggle('listening', mine);
        });
    }
    progressionTabs() {
        const tab = (id, label, sub) => `<button data-eco-tab="${id}" class="${this.view === id ? 'active' : ''}">${label}<small>${sub}</small></button>`;
        return `<div class="eco-tabs hub-tabs">${tab('pass', '通行证', 'V-PASS')}${tab('missions', '每日任务', 'DAILY')}${tab('loadout', '装扮 · 特效', 'LOADOUT')}</div>`;
    }
    rewardIcon(r) {
        if (r.kind === 'coin')
            return `<span class="vp-icon coin">◉</span>`;
        if (r.kind === 'crystal')
            return `<span class="vp-icon crystal">✧</span>`;
        if (r.kind === 'noteSkin')
            return `<span class="vp-icon skin" style="--accent:${findNoteSkin(r.id)?.accent || '#c4b5fd'}"><i class="vp-skin-swatch"></i></span>`;
        return `<span class="vp-icon fx" style="--accent:${findHitEffect(r.id)?.color || '#e0e7ff'}">✺</span>`;
    }
    passCell(track, tier) {
        const r = passReward(track, tier);
        if (!r)
            return '';
        const st = this.tierState(track, tier);
        const cosmetic = isCosmeticReward(r) ? (r.kind === 'noteSkin' ? findNoteSkin(r.id) : findHitEffect(r.id)) : undefined;
        const title = r.kind === 'coin' ? `${r.amount}<small> Coin</small>` : r.kind === 'crystal' ? `${r.amount}<small> Crystal</small>` : escapeHTML(cosmetic?.name || '');
        const tag = cosmetic ? `<em class="grade-tag ${cosmetic.grade}">${gradeLabel(cosmetic.grade)}${r.kind === 'noteSkin' ? '音符' : '特效'}</em>` : '';
        const status = st === 'claimed' ? '✓ 已领取' : st === 'claimable' ? '领取' : st === 'premiumLocked' ? '🔒 高级' : `LV.${pad2(tier)}`;
        return `<button type="button" class="vp-cell ${track} ${st}${cosmetic ? ' cosmetic' : ''}" data-pass-claim="${track}:${tier}">${this.rewardIcon(r)}<strong>${title}</strong>${tag}<small>${status}</small></button>`;
    }
    featuredPick() {
        const firstPremium = (kind) => { for (const row of PASS_TIERS) {
            const r = row.premium;
            if (isCosmeticReward(r) && r.kind === kind && !this.owns(r.id))
                return r.id;
        } return kind === 'noteSkin' ? 'skin_prism' : 'fx_nova'; };
        return { skin: firstPremium('noteSkin'), fx: firstPremium('hitEffect') };
    }
    passHTML() {
        const reached = this.reachedTier(), maxed = this.data.passLevel > PASS_MAX_TIER, premium = this.data.premiumPass;
        const claimable = this.passClaimableCount(), pct = maxed ? 100 : this.data.passExp / PASS_EXP_PER_TIER * 100;
        if (this.previewPick.skin === this.data.equippedNoteSkin && this.previewPick.fx === this.data.equippedHitEffect)
            this.previewPick = this.featuredPick();
        const cols = PASS_TIERS.map(row => `<div class="vp-col${reached >= row.tier ? ' reached' : ''}${row.tier === reached + 1 ? ' current' : ''}${row.tier % 5 === 0 ? ' milestone' : ''}"><div class="vp-tier-num">${pad2(row.tier)}</div>${this.passCell('free', row.tier)}${this.passCell('premium', row.tier)}</div>`).join('');
        return `<section class="vp-hero${premium ? ' is-premium' : ''}">
      <div class="vp-hero-copy"><div class="vpass-brand">V-PASS</div><div class="vpass-season">${PASS_SEASON.code} · DREAMLAND / ${PASS_SEASON.name}</div>
        <div class="vp-level"><b>${pad2(reached)}</b><span>/ ${PASS_MAX_TIER}</span><em class="${premium ? 'premium' : ''}">${premium ? 'PREMIUM' : 'FREE'}</em></div>
        <div class="vp-xp"><small><span>${maxed ? '赛季已满级' : `距离 TIER ${pad2(reached + 1)}`}</span><span>${maxed ? 'MAX' : `${this.data.passExp} / ${PASS_EXP_PER_TIER} EXP`}</span></small><div class="eco-progress"><i style="width:${pct}%"></i></div></div>
        <p>演奏歌曲与完成每日任务获得 V-PASS EXP。每 5 级里程碑奖励 Crystal，初级音符与打击特效在免费轨道，高级款式在高级轨道。</p></div>
      <div class="vp-showcase"><canvas class="cosmetic-preview" data-cosmetic-preview></canvas><div class="vp-showcase-copy"><small>REWARD PREVIEW</small><strong data-preview-label>${this.previewLabel()}</strong><span>点击轨道中的音符 / 特效奖励即可预览</span></div></div>
    </section>
    <div class="vp-actions"><button type="button" class="vp-claim-all" data-pass-claim-all ${claimable ? '' : 'disabled'}>一键领取${claimable ? ` · ${claimable}` : ''}</button>${premium ? '<span class="vp-premium-owned">✦ 高级通行证已激活</span>' : this.premiumProgress()}</div>
    <div class="vp-board"><div class="vp-rail-labels"><span class="lbl-tier">TIER</span><span class="lbl-free">免费<small>FREE</small></span><span class="lbl-premium">高级<small>PREMIUM</small></span></div><div class="vp-track">${cols}</div></div>
    <p class="eco-note">奖励需手动领取，达到满级后不会过期。高级通行证完成任意 6 个每日任务即可解锁，不消耗 Crystal；免费轨道共 110 Crystal，高级轨道共 122 Crystal。</p>`;
    }
    previewLabel() { return `${escapeHTML(findNoteSkin(this.previewPick.skin)?.name || '')} × ${escapeHTML(findHitEffect(this.previewPick.fx)?.name || '')}`; }
    setPreview(kind, id) {
        this.previewPick = kind === 'noteSkin' ? { ...this.previewPick, skin: id } : { ...this.previewPick, fx: id };
        this.preview.set(this.previewPick.skin, this.previewPick.fx);
        document.querySelectorAll('[data-preview-label]').forEach(el => { el.innerHTML = this.previewLabel(); });
        document.querySelectorAll(`[data-loadout-preview^="${kind}:"]`).forEach(el => el.classList.toggle('previewing', el.dataset.loadoutPreview === `${kind}:${id}`));
    }
    missionsHTML() {
        const d = this.daily(), fmt = (id, n) => id === 'acc_95' ? `${n}%` : n.toLocaleString();
        const chips = (r) => `<span class="chip exp">+${r.passExp} EXP</span>${r.coin ? `<span class="chip coin">◉ ${r.coin}</span>` : ''}${r.crystal ? `<span class="chip crystal">✧ ${r.crystal}</span>` : ''}`;
        const cards = d.missions.map(id => {
            const st = missionStatus(d, id);
            if (!st.def)
                return '';
            const pct = Math.min(100, st.value / st.target * 100);
            return `<article class="daily-card${st.claimable ? ' ready' : ''}${st.claimed ? ' claimed' : ''}"><div class="daily-info"><strong>${escapeHTML(st.def.title)}</strong><div class="daily-bar"><i style="width:${pct}%"></i></div><small>${fmt(id, st.value)} / ${fmt(id, st.target)}</small></div><div class="daily-rewards">${chips(st.def.reward)}</div><button type="button" data-daily-claim="${id}" ${st.claimable ? '' : 'disabled'}>${st.claimed ? '已领取' : st.claimable ? '领取' : '进行中'}</button></article>`;
        }).join('');
        const done = d.missions.filter(id => d.claimed.includes(id)).length, ready = dailyBonusReady(d);
        return `<section class="daily-head"><div><small>DAILY MISSIONS · ${d.date}</small><h3>每日任务</h3><p>完成任务获得 V-PASS EXP、Coin 与 Crystal，AUTO 演奏不计入进度。${this.data.premiumPass ? '' : `累计完成 ${PREMIUM_PASS_MISSIONS} 个任务解锁高级通行证 · ${Math.min(PREMIUM_PASS_MISSIONS, this.data.missionsDone)} / ${PREMIUM_PASS_MISSIONS}`}</p></div><div class="daily-reset"><small>距离刷新</small><b data-daily-countdown>${formatCountdown(msUntilReset())}</b></div></section>
    <div class="daily-list">${cards}</div>
    <div class="daily-bonus${ready ? ' ready' : ''}${d.bonusClaimed ? ' claimed' : ''}"><div><strong>全部完成奖励</strong><small>领取今日全部 ${d.missions.length} 个任务后解锁 · ${done} / ${d.missions.length}</small><div class="daily-bar"><i style="width:${done / Math.max(1, d.missions.length) * 100}%"></i></div></div><div class="daily-rewards">${chips(DAILY_BONUS)}</div><button type="button" data-daily-bonus ${ready ? '' : 'disabled'}>${d.bonusClaimed ? '已领取' : ready ? '领取' : '未完成'}</button></div>`;
    }
    loadoutHTML() {
        const card = (kind, def, accent) => {
            const owned = this.owns(def.id), equipped = (kind === 'noteSkin' ? this.data.equippedNoteSkin : this.data.equippedHitEffect) === def.id;
            const previewing = (kind === 'noteSkin' ? this.previewPick.skin : this.previewPick.fx) === def.id;
            const art = kind === 'noteSkin' ? '<i class="vp-skin-swatch"></i>' : '✺';
            return `<article class="loadout-card ${def.grade}${equipped ? ' equipped' : ''}${owned ? '' : ' locked'}${previewing ? ' previewing' : ''}" data-loadout-preview="${kind}:${def.id}"><span class="loadout-art" style="--accent:${accent}">${art}</span><div class="loadout-info"><strong>${escapeHTML(def.name)} <em class="grade-tag ${def.grade}">${gradeLabel(def.grade)}</em></strong><small>${escapeHTML(def.desc)}</small>${owned ? '' : `<span class="loadout-source">🔒 ${escapeHTML(cosmeticSource(def.id))}</span>`}</div><button type="button" data-loadout-equip="${kind}:${def.id}" ${owned && !equipped ? '' : 'disabled'}>${equipped ? '已装备' : owned ? '装备' : '未获得'}</button></article>`;
        };
        const skinName = findNoteSkin(this.data.equippedNoteSkin)?.name || '', fxName = findHitEffect(this.data.equippedHitEffect)?.name || '';
        return `<section class="loadout-stage"><canvas class="cosmetic-preview" data-cosmetic-preview></canvas><div class="loadout-current"><small>CURRENT LOADOUT</small><strong>音符 · ${escapeHTML(skinName)}</strong><strong>特效 · ${escapeHTML(fxName)}</strong><span>预览：<b data-preview-label>${this.previewLabel()}</b></span><span>点击卡片预览；未获得的款式同样可以试看。</span></div></section>
    <h4 class="loadout-title">音符样式 <small>NOTE SKIN</small></h4><div class="loadout-grid">${NOTE_SKINS.map(s => card('noteSkin', s, s.accent)).join('')}</div>
    <h4 class="loadout-title">打击特效 <small>HIT EFFECT</small></h4><div class="loadout-grid">${HIT_EFFECTS.map(e => card('hitEffect', e, e.color)).join('')}</div>`;
    }
    bindEvents() {
        document.addEventListener('click', (ev) => {
            const t = ev.target instanceof Element ? ev.target : null;
            if (!t)
                return;
            const opener = t.closest('[data-economy-open]');
            if (opener) {
                this.open(opener.dataset.economyOpen || 'pass');
                return;
            }
            const tab = t.closest('[data-eco-tab]');
            if (tab) {
                this.render(tab.dataset.ecoTab || 'pass', true);
                return;
            }
            const song = t.closest('[data-buy-song]');
            if (song?.dataset.buySong) {
                this.buySong(song.dataset.buySong);
                return;
            }
            const listen = t.closest('[data-shop-preview]');
            if (listen?.dataset.shopPreview) {
                this.toggleShopPreview(listen.dataset.shopPreview);
                return;
            }
            const play = t.closest('[data-shop-play]');
            if (play?.dataset.shopPlay) {
                this.opts.selectSong?.(play.dataset.shopPlay);
                this.opts.navigate?.('songSelect');
                return;
            }
            const cosmetic = t.closest('[data-buy-cosmetic]');
            if (cosmetic?.dataset.buyCosmetic) {
                this.buyCosmetic(cosmetic.dataset.buyCosmetic);
                return;
            }
            if (t.closest('[data-pass-claim-all]')) {
                this.claimAllPass();
                return;
            }
            const cell = t.closest('[data-pass-claim]');
            if (cell?.dataset.passClaim) {
                const [track, tierText] = cell.dataset.passClaim.split(':'), tier = Number(tierText);
                if ((track === 'free' || track === 'premium') && Number.isInteger(tier)) {
                    const r = passReward(track, tier);
                    if (this.tierState(track, tier) === 'claimable')
                        this.claimTier(track, tier);
                    else if (r && isCosmeticReward(r))
                        this.setPreview(r.kind, r.id);
                    else if (this.tierState(track, tier) === 'premiumLocked')
                        this.toast(`再完成 ${this.premiumMissionsLeft()} 个每日任务即可解锁高级通行证`);
                }
                return;
            }
            const mission = t.closest('[data-daily-claim]');
            if (mission?.dataset.dailyClaim) {
                this.claimMission(mission.dataset.dailyClaim);
                return;
            }
            if (t.closest('[data-daily-bonus]')) {
                this.claimDailyBonus();
                return;
            }
            const equip = t.closest('[data-loadout-equip]');
            if (equip?.dataset.loadoutEquip) {
                const [kind, id] = equip.dataset.loadoutEquip.split(':');
                if (kind === 'noteSkin' || kind === 'hitEffect')
                    this.equip(kind, id);
                return;
            }
            const pick = t.closest('[data-loadout-preview]');
            if (pick?.dataset.loadoutPreview) {
                const [kind, id] = pick.dataset.loadoutPreview.split(':');
                if (kind === 'noteSkin' || kind === 'hitEffect')
                    this.setPreview(kind, id);
                return;
            }
        });
    }
}
