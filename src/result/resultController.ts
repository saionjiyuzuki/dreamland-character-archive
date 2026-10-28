import type { AppState } from '../core/types.js';
import { clearState, gaugeValue } from '../gameplay/lifeGauge.js';

export interface ResultControllerDeps {
  D: any;
  G: any;
  StateMachine: { state: AppState; transition: (next: AppState, ctx?: any) => boolean };
  APP_STATE: Record<AppState, AppState>;
  AudioEngine: any;
  setBest: (songId: string, score: number, grade?: string) => void;
  visiblePage: (id: string | null) => void;
  economy: { grantPlayRewards: (g:any)=>{coin:number;exp:number;levelUps:number;passUps:number;missionsCompleted?:string[];claimable?:number;premiumUnlocked?:boolean}; };
}

export interface ResultTimingStats { early: number; late: number; earlySum: number; lateSum: number; count: number; sum: number; }

/** Rounded Early/Late summary. Averages are null when there is nothing to average (e.g. AUTO play). */
export function summarizeTiming(stats: ResultTimingStats | null | undefined) {
  const s = stats || { early: 0, late: 0, earlySum: 0, lateSum: 0, count: 0, sum: 0 };
  const avg = (sum: number, n: number) => (n > 0 ? Math.round(sum / n) : null);
  const total = s.early + s.late;
  return {
    early: s.early,
    late: s.late,
    earlyAvg: avg(s.earlySum, s.early),
    lateAvg: avg(s.lateSum, s.late),
    mean: avg(s.sum, s.count),
    earlyPct: total > 0 ? (s.early / total) * 100 : 0,
    latePct: total > 0 ? (s.late / total) * 100 : 0,
  };
}

/** Owns result score/grade presentation and the retry/back actions. */
export class ResultController {
  constructor(private readonly d: ResultControllerDeps) {}

  show(): void {
    const G = this.d.G;
    const D = this.d.D;
    const total = G.pure + G.great + G.far + G.lost;
    const accuracy = total > 0 ? (G.pure + G.great * 0.75 + G.far * 0.5) / total : 0;
    let grade = 'C';
    if (accuracy >= 0.99) grade = 'SS';
    else if (accuracy >= 0.95) grade = 'S';
    else if (accuracy >= 0.88) grade = 'A';
    else if (accuracy >= 0.75) grade = 'B';

    const finalScore = Math.round(G.score);
    if (G.chart && !G.autoUsed) this.d.setBest(G.chart.id, finalScore, grade);
    const rewards = G.chart && !G.autoUsed ? this.d.economy.grantPlayRewards(G) : null;

    D.resultGrade.textContent = grade;
    D.resultGrade.className = 'result-grade ' + grade;
    D.resultSong.textContent = (G.chart ? G.chart.title : '曲目') + ' · ' + (G.chart?.difficulty ? G.chart.difficulty + ' ' : '') + 'LV.' + (G.chart ? G.chart.diff : '?');
    D.rPure.textContent = String(G.pure);
    D.rGreat.textContent = String(G.great);
    D.rFar.textContent = String(G.far);
    D.rLost.textContent = String(G.lost);
    D.rCombo.textContent = String(G.maxCombo);
    D.rScore.textContent = finalScore.toLocaleString();
    this.setText('rAccuracy', (accuracy * 100).toFixed(2) + '%');
    const clear = clearState(G);
    this.setText('rClear', `${clear} · LIFE ${Math.floor(gaugeValue(G))}`);
    document.getElementById('rClear')?.classList.toggle('failed', clear === 'FAILED');
    this.renderCharacter(G.char);
    this.renderTiming(G.timingStats);
    let rewardLine = document.getElementById('resultRewards');
    if (!rewardLine && typeof D.rScore.insertAdjacentElement === 'function') { rewardLine = document.createElement('div'); rewardLine.id = 'resultRewards'; rewardLine.className = 'result-rewards'; D.rScore.insertAdjacentElement('afterend', rewardLine); }
    if (rewardLine) {
      if (!rewards) rewardLine.textContent = 'AUTO 演奏不发放奖励';
      else {
        const lines = [`+${rewards.coin} Coin  ·  +${rewards.exp} EXP${rewards.levelUps ? `  ·  升级 ${rewards.levelUps} 级，获得 ${rewards.levelUps * 5} Crystal` : ''}${rewards.passUps ? `  ·  V-PASS +${rewards.passUps} 级` : ''}`];
        if (rewards.missionsCompleted?.length) lines.push(`每日任务完成：${rewards.missionsCompleted.join('、')}`);
        if (rewards.premiumUnlocked) lines.push('✦ 高级通行证已解锁');
        if (rewards.claimable) lines.push(`✦ ${rewards.claimable} 项奖励待领取 · 前往「通行证」`);
        rewardLine.textContent = lines.join('\n');
      }
    }

    G.playing = false;
    G.paused = false;
    D.gameplay.classList.remove('active');
    D.keysContainer.classList.remove('show');
    D.pauseBtn.classList.remove('show');
    D.autoBtn.classList.remove('show');
    D.pauseMask.classList.remove('show');
    this.d.visiblePage('pageResult');
    G.page = 'result';
  }

  private setText(id: string, value: string): void {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  /** Portrait of the character used for this play; characters without art fall back to their emoji. */
  private renderCharacter(char: { name?: string; emoji?: string; portrait?: string } | null | undefined): void {
    const img = document.getElementById('resultPortrait') as HTMLImageElement | null;
    const emoji = document.getElementById('resultCharEmoji');
    const portrait = char?.portrait || '';
    if (img) {
      if (portrait) { if (img.getAttribute?.('src') !== portrait) img.src = portrait; img.classList.remove('hidden'); }
      else img.classList.add('hidden');
    }
    if (emoji) {
      emoji.textContent = portrait ? '' : (char?.emoji || '');
      emoji.classList.toggle('hidden', !!portrait);
    }
    this.setText('resultCharName', char?.name ? `COMPANION · ${char.name}` : '');
  }

  /** Early/Late counts, their average offsets and the overall mean offset (ms). */
  private renderTiming(stats: ResultTimingStats | null | undefined): void {
    const t = summarizeTiming(stats);
    const fmt = (ms: number | null) => (ms === null ? '—' : `${ms > 0 ? '+' : ''}${ms}ms`);
    this.setText('rEarly', String(t.early));
    this.setText('rLate', String(t.late));
    this.setText('rEarlyAvg', '平均 ' + fmt(t.earlyAvg));
    this.setText('rLateAvg', '平均 ' + fmt(t.lateAvg));
    this.setText('rMeanOffset', t.mean === null ? '平均偏差 —' : `平均偏差 ${fmt(t.mean)}${t.mean < 0 ? ' · 整体偏早' : t.mean > 0 ? ' · 整体偏晚' : ''}`);
    const early = document.getElementById('rEarlyBar');
    const late = document.getElementById('rLateBar');
    if (early) early.style.width = `${t.earlyPct}%`;
    if (late) late.style.width = `${t.latePct}%`;
  }

  bindEvents(): void {
    document.getElementById('resultBackBtn')?.addEventListener('click', () => {
      if (this.d.StateMachine.state === this.d.APP_STATE.RESULT) {
        this.d.StateMachine.transition(this.d.APP_STATE.SELECT);
      }
    });
    document.getElementById('resultRetryBtn')?.addEventListener('click', () => {
      const G = this.d.G;
      if (this.d.StateMachine.state !== this.d.APP_STATE.RESULT || !G.chart) return;
      void this.d.AudioEngine.prime(G.chart.id);
      G.loadingToken++;
      this.d.StateMachine.transition(this.d.APP_STATE.LOADING, {
        scope: 'song', chart: G.chart, token: G.loadingToken,
      });
    });
  }
}
