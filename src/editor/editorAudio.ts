/**
 * Editor audio: song playback at 25-100% speed, hit sounds and metronome clicks scheduled on the audio clock (so
 * they line up with the music sample-accurately), and waveform peaks. Without a song loaded it still runs a silent
 * clock so the metronome and note preview work.
 */
export type ClickKind = 'hit' | 'bar' | 'beat';
export interface ScheduledClick { ms: number; kind: ClickKind }
const PEAK_MS = 5;
const LOOKAHEAD_SEC = 0.12;

export class EditorAudio {
  ctx: AudioContext | null = null;
  buffer: AudioBuffer | null = null;
  /** max |sample| per PEAK_MS window, 0..1 */
  peaks: Float32Array = new Float32Array(0);
  readonly peakMs = PEAK_MS;
  rate = 1;
  musicVolume = 0.8;
  hitVolume = 0.6;
  private music: GainNode | null = null;
  private clicks: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private clickNodes: AudioScheduledSourceNode[] = [];
  private playing = false;
  /** Song position (s) at context time startAt. */
  private offsetSec = 0;
  private startAt = 0;
  private scheduledUntilMs = -Infinity;

  private ensure(): AudioContext {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.music = this.ctx.createGain(); this.music.gain.value = this.musicVolume; this.music.connect(this.ctx.destination);
    this.clicks = this.ctx.createGain(); this.clicks.gain.value = this.hitVolume; this.clicks.connect(this.ctx.destination);
    return this.ctx;
  }
  async unlock(): Promise<void> { const c = this.ensure(); if (c.state !== 'running') await c.resume().catch(() => undefined); }

  async load(data: ArrayBuffer): Promise<void> {
    const c = this.ensure();
    const buffer = await c.decodeAudioData(data);
    this.stop();
    this.buffer = buffer;
    this.peaks = computePeaks(buffer, PEAK_MS);
  }
  get duration(): number { return this.buffer?.duration ?? 0; }
  get isPlaying(): boolean { return this.playing; }

  /** Seconds between scheduling a sample and hearing it. */
  private latencySec(): number {
    const c = this.ctx; if (!c) return 0;
    const out = Number.isFinite(c.outputLatency) ? c.outputLatency : 0, base = Number.isFinite(c.baseLatency) ? c.baseLatency : 0;
    return Math.max(0, out + base);
  }
  /** Song position (ms) being heard now; while paused, the paused position. */
  positionMs(): number {
    if (!this.playing || !this.ctx) return this.offsetSec * 1000;
    return (this.offsetSec + (this.ctx.currentTime - this.latencySec() - this.startAt) * this.rate) * 1000;
  }
  private ctxTimeOf(ms: number): number { return this.startAt + (ms / 1000 - this.offsetSec) / this.rate; }

  async play(fromMs: number): Promise<void> {
    await this.unlock();
    const c = this.ensure();
    this.stop(fromMs);
    this.offsetSec = fromMs / 1000;
    this.startAt = c.currentTime + 0.03;
    if (this.buffer && this.offsetSec < this.buffer.duration) {
      const src = c.createBufferSource();
      src.buffer = this.buffer; src.playbackRate.value = this.rate; src.connect(this.music!);
      // Before the song starts (negative position) start the buffer later instead of seeking.
      const wait = Math.max(0, -this.offsetSec) / this.rate;
      src.start(this.startAt + wait, Math.max(0, this.offsetSec));
      this.source = src;
    }
    this.scheduledUntilMs = fromMs - 1;
    this.playing = true;
  }
  /** Stops playback and keeps (or sets) the paused position. */
  stop(atMs?: number): void {
    const pos = atMs ?? this.positionMs();
    if (this.source) { try { this.source.stop(); } catch { /* already stopped */ } this.source.disconnect(); this.source = null; }
    for (const n of this.clickNodes) { try { n.stop(); } catch { /* done */ } }
    this.clickNodes = [];
    this.playing = false;
    this.offsetSec = pos / 1000;
  }
  setRate(rate: number): void { const was = this.playing, pos = this.positionMs(); this.rate = rate; if (was) void this.play(pos); }
  setVolumes(music: number, hits: number): void {
    this.musicVolume = music; this.hitVolume = hits;
    if (this.music) this.music.gain.value = music;
    if (this.clicks) this.clicks.gain.value = hits;
  }

  /**
   * Schedules clicks due in the next LOOKAHEAD_SEC. `events(fromMs, toMs)` returns song-time clicks in (fromMs, toMs].
   * Call once per frame while playing.
   */
  pump(events: (fromMs: number, toMs: number) => ScheduledClick[]): void {
    if (!this.playing || !this.ctx) return;
    const c = this.ctx, untilMs = (this.offsetSec + (c.currentTime + LOOKAHEAD_SEC - this.startAt) * this.rate) * 1000;
    if (untilMs <= this.scheduledUntilMs) return;
    for (const e of events(this.scheduledUntilMs, untilMs)) this.click(this.ctxTimeOf(e.ms), e.kind);
    this.scheduledUntilMs = untilMs;
    this.clickNodes = this.clickNodes.filter(n => (n as unknown as { _end: number })._end > c.currentTime);
  }
  private click(at: number, kind: ClickKind): void {
    const c = this.ctx!, t = Math.max(at, c.currentTime);
    const o = c.createOscillator(), g = c.createGain();
    o.type = kind === 'hit' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(kind === 'hit' ? 1900 : kind === 'bar' ? 1760 : 1180, t);
    if (kind === 'hit') o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const peak = kind === 'hit' ? 0.5 : kind === 'bar' ? 0.35 : 0.22;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g); g.connect(this.clicks!);
    o.start(t); o.stop(t + 0.06);
    (o as unknown as { _end: number })._end = t + 0.06;
    o.onended = () => { o.disconnect(); g.disconnect(); };
    this.clickNodes.push(o);
  }
}

export function computePeaks(buffer: AudioBuffer, windowMs: number): Float32Array {
  const per = Math.max(1, Math.round(buffer.sampleRate * windowMs / 1000)), n = Math.ceil(buffer.length / per), out = new Float32Array(n);
  for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = out[i]!;
      for (let j = i * per, end = Math.min(data.length, j + per); j < end; j++) { const v = data[j]!; if (v > m) m = v; else if (-v > m) m = -v; }
      out[i] = m;
    }
  }
  return out;
}
