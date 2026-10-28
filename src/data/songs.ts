import type { Chart, ChartNote, DifficultyKey } from '../core/types.js';
import { CHARTS } from './charts.js';

/**
 * Song catalog: one entry per track, with one chart per difficulty slot (chart ids song_{ez,hd,ex,dz}_<song>).
 * DZ (DIZZY) is the top difficulty and replaces the former SP slot.
 */
export const DIFFICULTIES: DifficultyKey[] = ['EZ', 'HD', 'EX', 'DZ'];
export const DIFFICULTY_META: Record<DifficultyKey, { name: string; desc: string; color: string }> = {
  EZ: { name: 'EASY', desc: '4K · 重拍与长条，适合熟悉曲子', color: '#6ee7b7' },
  HD: { name: 'HARD', desc: '4K / 6K 变轨 · 八分节奏、双押与滑动长条', color: '#7dd3fc' },
  EX: { name: 'EXPERT', desc: '最高 8K 变轨 · 十六分交互、滑动长条与 Multi Hold', color: '#f9a8d4' },
  DZ: { name: 'DIZZY', desc: '4K → 6K → 8K 变轨 · 高密度交互、双手 Multi Hold', color: '#c4b5fd' },
};

export interface SongEntry {
  id: string; title: string; artist: string; jacket: string; accent: string;
  bpm: number; duration: number;
  /** Crystal price; 0 = free. Unlocking a song unlocks every difficulty. */
  price: number;
  tag?: 'NEW' | 'LAB';
  charts: Partial<Record<DifficultyKey, string>>;
  /** Where the song-select preview loops from: the densest stretch of the DZ chart (usually the chorus). */
  previewStartMs: number;
}

interface SongDef { id: string; title: string; artist: string; jacket: string; accent: string; price: number; tag?: SongEntry['tag'] }
const SONG_DEFS: SongDef[] = [
  { id: 'last_dance', title: 'Last Dance', artist: 'Xomu', jacket: '✦', accent: '#f0abfc', price: 0 },
  { id: 'moonfall', title: 'Moonfall', artist: 'Xomu', jacket: '☾', accent: '#a5b4fc', price: 0, tag: 'NEW' },
  { id: 'lanterns', title: 'Lanterns', artist: 'Xomu', jacket: '◈', accent: '#fdba74', price: 12, tag: 'NEW' },
  { id: 'iron_princess', title: 'Iron Princess', artist: 'Xomu, Hyp3rLaps3', jacket: '♛', accent: '#fca5a5', price: 12, tag: 'NEW' },
];

const headTimes = (chart: Chart) => (chart.notes as ChartNote[]).map(n => (Array.isArray(n) ? n[0] : n.startTime)).sort((a, b) => a - b);
function previewStart(chart: Chart): number {
  const heads = headTimes(chart);
  const span = 15000, limit = Math.max(0, chart.duration * 1000 - span - 2000);
  let best = 0, at = 0;
  for (let i = 0, j = 0; i < heads.length; i++) {
    while (heads[j] < heads[i] - span) j++;
    if (i - j + 1 > best) { best = i - j + 1; at = heads[j]; }
  }
  return Math.round(Math.min(limit, Math.max(0, at - 1000)));
}

export const SONGS: SongEntry[] = [];
for (const def of SONG_DEFS) {
  const charts: SongEntry['charts'] = {};
  for (const key of DIFFICULTIES) {
    const id = `song_${key.toLowerCase()}_${def.id}`, chart = CHARTS[id];
    if (!chart) continue;
    Object.assign(chart, { songId: def.id, difficulty: key });
    charts[key] = id;
  }
  const top = CHARTS[charts.DZ || Object.values(charts)[0] || ''];
  if (!top) continue;
  SONGS.push({ id: def.id, title: def.title, artist: def.artist, jacket: def.jacket, accent: def.accent, bpm: top.bpm, duration: top.duration, price: def.price, tag: def.tag, charts, previewStartMs: previewStart(top) });
}

export const findSong = (id: string) => SONGS.find(s => s.id === id);
/** Song that owns a chart id; also resolves the retired SP chart ids (song_sp_<song>) of saves before V12.11. */
export function songOfChart(chartId: string): SongEntry | undefined {
  const songId = (CHARTS as Record<string, Chart>)[chartId]?.songId || /^song_sp_(.+)$/.exec(chartId)?.[1];
  return songId ? findSong(songId) : undefined;
}
export function songChart(song: SongEntry, diff: DifficultyKey): Chart | undefined {
  const id = song.charts[diff];
  return id ? (CHARTS as Record<string, Chart>)[id] : undefined;
}
export function noteCount(chart: Chart): number { return chart.notes.length; }
/** Notes per second, overall and over the densest 8 seconds. */
export function chartDensity(chart: Chart): { avg: number; peak: number; count: number } {
  const heads = headTimes(chart);
  if (heads.length < 2) return { avg: 0, peak: 0, count: heads.length };
  let peak = 0;
  for (let i = 0, j = 0; i < heads.length; i++) { while (heads[i] - heads[j] > 8000) j++; peak = Math.max(peak, (i - j + 1) / 8); }
  return { avg: heads.length / ((heads[heads.length - 1] - heads[0]) / 1000), peak, count: heads.length };
}
export function laneLabel(chart: Chart): string {
  const ks = [...new Set((chart.laneSections || []).map(s => s[2]))];
  return ks.length > 1 ? ks.map(k => `${k}K`).join(' → ') : `${ks[0] || chart.lanes || 4}K`;
}
