import { CHARTS } from './charts.js';
/**
 * Song catalog: one entry per track, with one chart per difficulty slot (chart ids song_{ez,hd,ex,dz}_<song>).
 * DZ (DIZZY) is the top difficulty and replaces the former SP slot.
 */
export const DIFFICULTIES = ['EZ', 'HD', 'EX', 'DZ'];
export const DIFFICULTY_META = {
    EZ: { name: 'EASY', desc: '4K · 重拍与长条，适合熟悉曲子', color: '#6ee7b7' },
    HD: { name: 'HARD', desc: '4K / 6K 变轨 · 八分节奏、双押与滑动长条', color: '#7dd3fc' },
    EX: { name: 'EXPERT', desc: '最高 8K 变轨 · 十六分交互、滑动长条与 Multi Hold', color: '#f9a8d4' },
    DZ: { name: 'DIZZY', desc: '4K → 6K → 8K 变轨 · 高密度交互、双手 Multi Hold', color: '#c4b5fd' },
};
const SONG_DEFS = [
    { id: 'last_dance', title: 'Last Dance', artist: 'Xomu', jacket: '✦', accent: '#f0abfc', price: 0 },
    { id: 'moonfall', title: 'Moonfall', artist: 'Xomu', jacket: '☾', accent: '#a5b4fc', price: 0, tag: 'NEW' },
    { id: 'lanterns', title: 'Lanterns', artist: 'Xomu', jacket: '◈', accent: '#fdba74', price: 12, tag: 'NEW' },
    { id: 'iron_princess', title: 'Iron Princess', artist: 'Xomu, Hyp3rLaps3', jacket: '♛', accent: '#fca5a5', price: 12, tag: 'NEW' },
];
const headTimes = (chart) => chart.notes.map(n => (Array.isArray(n) ? n[0] : n.startTime)).sort((a, b) => a - b);
function previewStart(chart) {
    const heads = headTimes(chart);
    const span = 15000, limit = Math.max(0, chart.duration * 1000 - span - 2000);
    let best = 0, at = 0;
    for (let i = 0, j = 0; i < heads.length; i++) {
        while (heads[j] < heads[i] - span)
            j++;
        if (i - j + 1 > best) {
            best = i - j + 1;
            at = heads[j];
        }
    }
    return Math.round(Math.min(limit, Math.max(0, at - 1000)));
}
export const SONGS = [];
for (const def of SONG_DEFS) {
    const charts = {};
    for (const key of DIFFICULTIES) {
        const id = `song_${key.toLowerCase()}_${def.id}`, chart = CHARTS[id];
        if (!chart)
            continue;
        Object.assign(chart, { songId: def.id, difficulty: key });
        charts[key] = id;
    }
    const top = CHARTS[charts.DZ || Object.values(charts)[0] || ''];
    if (!top)
        continue;
    SONGS.push({ id: def.id, title: def.title, artist: def.artist, jacket: def.jacket, accent: def.accent, bpm: top.bpm, duration: top.duration, price: def.price, tag: def.tag, charts, previewStartMs: previewStart(top) });
}
export const findSong = (id) => SONGS.find(s => s.id === id);
/** Song that owns a chart id; also resolves the retired SP chart ids (song_sp_<song>) of saves before V12.11. */
export function songOfChart(chartId) {
    const songId = CHARTS[chartId]?.songId || /^song_sp_(.+)$/.exec(chartId)?.[1];
    return songId ? findSong(songId) : undefined;
}
export function songChart(song, diff) {
    const id = song.charts[diff];
    return id ? CHARTS[id] : undefined;
}
export function noteCount(chart) { return chart.notes.length; }
/** Notes per second, overall and over the densest 8 seconds. */
export function chartDensity(chart) {
    const heads = headTimes(chart);
    if (heads.length < 2)
        return { avg: 0, peak: 0, count: heads.length };
    let peak = 0;
    for (let i = 0, j = 0; i < heads.length; i++) {
        while (heads[i] - heads[j] > 8000)
            j++;
        peak = Math.max(peak, (i - j + 1) / 8);
    }
    return { avg: heads.length / ((heads[heads.length - 1] - heads[0]) / 1000), peak, count: heads.length };
}
export function laneLabel(chart) {
    const ks = [...new Set((chart.laneSections || []).map(s => s[2]))];
    return ks.length > 1 ? ks.map(k => `${k}K`).join(' → ') : `${ks[0] || chart.lanes || 4}K`;
}
