import type { Chart, ChartNote, DifficultyKey } from '../core/types.js';
import { CHARTS } from './charts.js';
import { deriveChart, chartDensity, type DeriveKey } from '../chart/difficultyDerive.js';

/**
 * Song catalog: one entry per track, with one chart per difficulty slot.
 * Importing this module also registers the generated EZ / HD / EX charts in CHARTS (ids song_ez_* / song_hd_* /
 * song_ex_*), derived from each song's SP chart by src/chart/difficultyDerive.ts.
 */
export const DIFFICULTIES: DifficultyKey[] = ['EZ', 'HD', 'EX', 'SP'];
export const DIFFICULTY_META: Record<DifficultyKey, { name: string; desc: string; color: string }> = {
  EZ: { name: 'EASY', desc: '4K · 只在重拍上落键，适合熟悉曲子', color: '#6ee7b7' },
  HD: { name: 'HARD', desc: '4K · 跟随旋律的八分节奏与少量双押', color: '#7dd3fc' },
  EX: { name: 'EXPERT', desc: '4K · 十六分交互、滑动长条与双押', color: '#f9a8d4' },
  SP: { name: 'SPECIAL', desc: '4K → 6K → 8K 变轨 · Multi Hold 特殊谱面', color: '#c4b5fd' },
};

export interface SongEntry {
  id: string; title: string; artist: string; jacket: string; accent: string;
  bpm: number; duration: number;
  /** Crystal price; 0 = free. Unlocking a song unlocks every difficulty. */
  price: number;
  tag?: 'NEW' | 'LAB';
  charts: Partial<Record<DifficultyKey, string>>;
  /** Where the song-select preview loops from: the densest stretch of the SP chart (usually the chorus). */
  previewStartMs: number;
}

interface SongDef { id: string; sp: string; title: string; artist: string; jacket: string; accent: string; price: number; tag?: SongEntry['tag']; derive: boolean }
const SONG_DEFS: SongDef[] = [
  { id: 'last_dance', sp: 'song_sp_last_dance', title: 'Last Dance', artist: 'Xomu', jacket: '✦', accent: '#f0abfc', price: 0, tag: 'NEW', derive: true },
];
const DERIVED: DeriveKey[] = ['EZ', 'HD', 'EX'];

function previewStart(chart: Chart): number {
  const heads = (chart.notes as ChartNote[]).map(n => (Array.isArray(n) ? n[0] : n.startTime)).sort((a, b) => a - b);
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
  const sp = CHARTS[def.sp] as Chart | undefined;
  if (!sp) continue;
  Object.assign(sp, { songId: def.id, difficulty: 'SP' as const });
  const charts: SongEntry['charts'] = { SP: sp.id };
  if (def.derive) for (const key of DERIVED) {
    const id = `song_${key.toLowerCase()}_${def.id}`;
    const chart = deriveChart({ ...sp, title: def.title, artist: def.artist, jacket: def.jacket }, key, id);
    (CHARTS as Record<string, Chart>)[id] = chart;
    charts[key] = id;
  }
  SONGS.push({ id: def.id, title: def.title, artist: def.artist, jacket: def.jacket, accent: def.accent, bpm: sp.bpm, duration: sp.duration, price: def.price, tag: def.tag, charts, previewStartMs: previewStart(sp) });
}

export const findSong = (id: string) => SONGS.find(s => s.id === id);
/** Song that owns a chart id. */
export function songOfChart(chartId: string): SongEntry | undefined {
  const songId = (CHARTS as Record<string, Chart>)[chartId]?.songId;
  return songId ? findSong(songId) : undefined;
}
export function songChart(song: SongEntry, diff: DifficultyKey): Chart | undefined {
  const id = song.charts[diff];
  return id ? (CHARTS as Record<string, Chart>)[id] : undefined;
}
export function noteCount(chart: Chart): number { return chartDensity(chart).count; }
export function laneLabel(chart: Chart): string {
  const ks = [...new Set((chart.laneSections || []).map(s => s[2]))];
  return ks.length > 1 ? ks.map(k => `${k}K`).join(' → ') : `${ks[0] || chart.lanes || 4}K`;
}
