// V12.9 daily missions. Pure data/logic so it can be unit-tested without a DOM.
// Missions refresh at local midnight; the set for a given day is deterministic (seeded by the date).
export const DAILY_MISSION_COUNT = 4;
export const DAILY_BONUS = { passExp: 60, coin: 100, crystal: 5 };
export const MISSION_POOL = [
    { id: 'play_3', title: '完成 3 首歌曲', target: 3, mode: 'sum', measure: () => 1, reward: { passExp: 60, coin: 40 } },
    { id: 'distinct_2', title: '游玩 2 首不同的歌曲', target: 2, mode: 'distinct', measure: () => 0, reward: { passExp: 60, coin: 50 } },
    { id: 'pure_300', title: '累计获得 300 个 EXCELLENT', target: 300, mode: 'sum', measure: s => s.pure, reward: { passExp: 80, coin: 60 } },
    { id: 'hit_500', title: '累计命中 500 个音符', target: 500, mode: 'sum', measure: s => s.pure + s.great + s.far, reward: { passExp: 80, coin: 60 } },
    { id: 'combo_150', title: '单曲达成 150 连击', target: 150, mode: 'max', measure: s => s.maxCombo, reward: { passExp: 80, crystal: 2 } },
    { id: 'acc_95', title: '单曲准确率达到 95%', target: 95, mode: 'max', measure: s => Math.floor(s.accuracy * 100), reward: { passExp: 100, crystal: 3 } },
    { id: 'score_900k', title: '单曲分数达到 900,000', target: 900000, mode: 'max', measure: s => Math.round(s.score), reward: { passExp: 100, crystal: 3 } },
    { id: 'full_combo', title: '无 LOST 完成一首歌曲', target: 1, mode: 'max', measure: s => (s.lost === 0 && s.pure + s.great + s.far > 0 ? 1 : 0), reward: { passExp: 120, crystal: 5 } },
];
const ALWAYS_ON = 'play_3';
export function findMission(id) { return MISSION_POOL.find(m => m.id === id); }
export function localDateKey(now = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function msUntilReset(now = new Date()) {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return Math.max(0, next.getTime() - now.getTime());
}
export function formatCountdown(ms) {
    const s = Math.floor(ms / 1000), p = (n) => String(n).padStart(2, '0');
    return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++)
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return () => {
        h += 0x6D2B79F5;
        let t = h;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function pickMissions(date) {
    const rand = seededRandom(`dreamland-daily-${date}`);
    const rest = MISSION_POOL.map(m => m.id).filter(id => id !== ALWAYS_ON);
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [ALWAYS_ON, ...rest.slice(0, DAILY_MISSION_COUNT - 1)];
}
export function freshDaily(date) {
    return { date, missions: pickMissions(date), progress: {}, claimed: [], bonusClaimed: false, songs: [] };
}
/** Returns today's state, resetting when the stored date is stale or the data is malformed. */
export function ensureDaily(raw, now = new Date()) {
    const date = localDateKey(now);
    if (!raw || typeof raw !== 'object')
        return freshDaily(date);
    const v = raw;
    if (v.date !== date)
        return freshDaily(date);
    const ids = Array.isArray(v.missions) ? v.missions.filter(id => typeof id === 'string' && !!findMission(id)) : [];
    const missions = new Set(ids).size === DAILY_MISSION_COUNT ? [...new Set(ids)] : pickMissions(date);
    const progress = {};
    for (const id of missions) {
        const n = v.progress?.[id];
        progress[id] = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    const strings = (x) => Array.isArray(x) ? [...new Set(x.filter((s) => typeof s === 'string' && s.length <= 160))] : [];
    return {
        date, missions, progress,
        claimed: strings(v.claimed).filter(id => missions.includes(id)),
        bonusClaimed: v.bonusClaimed === true,
        songs: strings(v.songs).slice(0, 64),
    };
}
export function missionStatus(state, id) {
    const def = findMission(id);
    const target = def?.target ?? 1;
    const value = Math.min(target, state.progress[id] || 0);
    const done = value >= target, claimed = state.claimed.includes(id);
    return { def, value, target, done, claimed, claimable: done && !claimed };
}
/** Applies one finished play; returns the ids of missions that became complete because of it. */
export function recordPlay(state, stats) {
    if (stats.songId && !state.songs.includes(stats.songId))
        state.songs.push(stats.songId);
    const completed = [];
    for (const id of state.missions) {
        const def = findMission(id);
        if (!def)
            continue;
        const before = state.progress[id] || 0;
        let next = before;
        if (def.mode === 'sum')
            next = before + Math.max(0, def.measure(stats));
        else if (def.mode === 'max')
            next = Math.max(before, def.measure(stats));
        else
            next = state.songs.length;
        state.progress[id] = Math.min(def.target, next);
        if (before < def.target && state.progress[id] >= def.target)
            completed.push(id);
    }
    return completed;
}
export function dailyBonusReady(state) {
    return !state.bonusClaimed && state.missions.every(id => state.claimed.includes(id));
}
