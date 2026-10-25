import type { AppState, Chart } from '../core/types.js';

export interface SongSelectDeps {
  D: any;
  G: any;
  CHARTS: Record<string, Chart>;
  StateMachine: { state: AppState };
  APP_STATE: Record<AppState, AppState>;
  AudioEngine: any;
  startGame: (chart: Chart) => void;
  economy: { isSongUnlocked:(id:string)=>boolean; open:(view?:'pass'|'shop')=>void; renderModal:(view:string)=>void; };
}

/** Owns song list rendering, Best Score persistence, and song-card selection. */
export class SongSelectController {
  constructor(private readonly d: SongSelectDeps) {}

  getBest(id: string): number {
    try { return Number.parseInt(localStorage.getItem('dl_best_' + id) || '0', 10) || 0; }
    catch { return 0; }
  }

  setBest(id: string, value: number): void {
    try {
      if (value > this.getBest(id)) localStorage.setItem('dl_best_' + id, String(value));
    } catch { /* best scores are optional when storage is unavailable */ }
  }

  render(): void {
    const list = this.d.D.songList as HTMLElement | null;
    if (!list) return;
    const songs = Object.values(this.d.CHARTS);
    const count = document.getElementById('selectTrackCount');
    if (count) count.textContent = String(songs.length).padStart(2, '0');
    list.innerHTML = songs.map((song: any) => {
      const best = this.getBest(song.id);
      const unlocked = this.d.economy.isSongUnlocked(song.id);
      const price = Math.max(3, Math.min(18, Math.round((Number((song as any).diff)||8)*1.25)));
      return `<div class="song-card ${unlocked?'':'song-locked'}" data-song="${song.id}" aria-label="${unlocked?'开始演奏':'需要 Crystal 解锁'}">
        <div class="song-jacket">${song.jacket}</div>
        <div class="song-info">
          <div class="song-title">${song.title}</div>
          <div class="song-artist">${song.artist}</div>
        </div>
        <div class="song-diff ${song.diff >= 9 ? 'hard' : ''}">SP ${song.diff}</div><div class="song-lanes">4K → 6K → 8K</div>
        <div class="song-best">${unlocked ? (best ? 'BEST ' + best.toLocaleString() : '—') : `🔒 ${price} CRYSTAL`}</div>
      </div>`;
    }).join('');
  }

  select(songId: string): void {
    if (this.d.StateMachine.state !== this.d.APP_STATE.SELECT) return;
    const chart = this.d.CHARTS[songId];
    if (!chart) return;
    if (!this.d.economy.isSongUnlocked(songId)) { this.d.economy.open('shop'); this.d.economy.renderModal?.('songs'); return; }
    void this.d.AudioEngine.prime(chart.id);
    this.d.startGame(chart);
  }

  bindEvents(): void {
    this.d.D.songList?.addEventListener('click', (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const songEl = target?.closest('[data-song]') as HTMLElement | null;
      if (!songEl?.dataset.song) return;
      this.select(songEl.dataset.song);
    });
  }
}
