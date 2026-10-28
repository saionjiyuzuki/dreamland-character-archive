/**
 * Song preview for song select / shop: streams the file through an <audio> element (no full decode, starts
 * almost immediately) and loops one section with a fade in / fade out. When the AudioContext is available the
 * element is routed into the master bus, so the volume setting applies and iOS (which ignores
 * HTMLMediaElement.volume) still fades.
 */
interface PreviewEngine { ctx: AudioContext | null; master: GainNode | null; volumeValue: number; init(): boolean; resume(): Promise<boolean>; }

const FADE_IN_SEC = .9, FADE_OUT_SEC = 1.2, STOP_FADE_MS = 320, PEAK = .8, TICK_MS = 50;

export class PreviewPlayer {
  private el: HTMLAudioElement | null = null;
  private gain: GainNode | null = null;
  private routed = false;
  private url = '';
  private startSec = 0;
  private lengthSec = 20;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopAt = 0;
  private token = 0;
  private listeners = new Set<(url: string) => void>();

  constructor(private readonly engine: PreviewEngine) {}

  /** URL currently previewing (empty when stopped or fading out). */
  get current(): string { return this.stopAt ? '' : this.url; }
  onChange(fn: (url: string) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit() { for (const fn of this.listeners) fn(this.current); }

  private element(): HTMLAudioElement | null {
    if (this.el) return this.el;
    if (typeof Audio === 'undefined') return null;
    const el = new Audio();
    el.preload = 'auto';
    this.el = el;
    if (this.engine.init() && this.engine.ctx && this.engine.master) {
      try {
        const node = this.engine.ctx.createMediaElementSource(el);
        this.gain = this.engine.ctx.createGain();
        this.gain.gain.value = 0;
        node.connect(this.gain);
        this.gain.connect(this.engine.master);
        this.routed = true;
      } catch { this.routed = false; }
    }
    return el;
  }

  async play(url: string, startMs: number, lengthSec = 20): Promise<void> {
    if (url === this.url && !this.stopAt && this.timer) return;
    const el = this.element();
    if (!el) return;
    const token = ++this.token;
    this.url = url; this.startSec = Math.max(0, startMs / 1000); this.lengthSec = lengthSec; this.stopAt = 0;
    this.setLevel(0);
    if (this.routed) await this.engine.resume();
    if (token !== this.token) return;
    if (!el.src.endsWith(url.replace(/^\.\//, ''))) { el.src = url; el.load(); }
    const seek = () => { try { el.currentTime = this.startSec; } catch { /* seeking before metadata */ } };
    if (el.readyState >= 1) seek(); else el.addEventListener('loadedmetadata', seek, { once: true });
    try { await el.play(); } catch { if (token === this.token) this.reset(); return; }
    if (token !== this.token) return;
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  stop(): void {
    if (!this.url || this.stopAt) return;
    this.token++;
    this.stopAt = performance.now();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  private tick(): void {
    const el = this.el;
    if (!el) return;
    if (this.stopAt) {
      const k = 1 - (performance.now() - this.stopAt) / STOP_FADE_MS;
      if (k <= 0) { this.reset(); return; }
      this.setLevel(Math.min(this.level, k));
      return;
    }
    const pos = el.currentTime - this.startSec, end = Math.min(this.lengthSec, (el.duration || Infinity) - this.startSec - .05);
    if (pos >= end || pos < -.5 || el.ended) {
      try { el.currentTime = this.startSec; } catch { /* ignore */ }
      if (el.paused) void el.play().catch(() => this.reset());
      this.setLevel(0);
      return;
    }
    this.setLevel(Math.max(0, Math.min(1, pos / FADE_IN_SEC, (end - pos) / FADE_OUT_SEC)));
  }

  private level = 0;
  private setLevel(v: number): void {
    this.level = v;
    if (this.routed && this.gain && this.engine.ctx) this.gain.gain.setTargetAtTime(v * PEAK, this.engine.ctx.currentTime, .03);
    else if (this.el) this.el.volume = Math.max(0, Math.min(1, v * PEAK * this.engine.volumeValue / 100));
  }

  private reset(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.setLevel(0);
    this.el?.pause();
    this.url = ''; this.stopAt = 0;
    this.emit();
  }
}
