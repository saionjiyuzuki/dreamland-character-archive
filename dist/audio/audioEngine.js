import { GameClock } from '../core/gameClock.js';
import { AUDIO_SOURCES_TEST } from '../data/audioMap.js';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const FADE_SEC = .008; // de-click ramp for pause / resume / stop
const MAX_CACHED_BUFFERS = 2; // decoded PCM is tens of MB per song; keep mobile memory bounded
const SFX_MERGE_SEC = .012; // identical hit sounds closer than this (chords) are merged instead of stacked
const MAX_EXTRAPOLATE_SEC = .1; // cap for extrapolating a stale getOutputTimestamp()
const AUDIO_URL = (id) => AUDIO_SOURCES_TEST[id];
export const AudioEngine = {
    ctx: null, master: null, sfxBus: null, bgmBus: null,
    ready: false, volumeValue: 70,
    // Keyed by URL so charts sharing one file share one decoded buffer. Map order = LRU order.
    buffers: new Map(), decodeJobs: new Map(), active: null,
    _token: 0, hooks: {}, _lastSfx: new Map(),
    _sfxPresets: { pure: { type: 'sine', freqStart: 940, freqEnd: 1420, freqRamp: .05, peak: .13, release: .09, stop: .1 }, pause: { type: 'sine', freqStart: 520, freqEnd: 390, freqRamp: .09, peak: .08, release: .12, stop: .13 }, far: { type: 'triangle', freqStart: 700, freqEnd: 880, freqRamp: .04, peak: .1, release: .08, stop: .09 }, lost: { type: 'sawtooth', freqStart: 220, freqEnd: 140, freqRamp: .1, peak: .08, release: .14, stop: .15 } },
    setHooks(h) { this.hooks = h; },
    init() {
        if (this.ctx)
            return true;
        const AC = window.AudioContext || (window.webkitAudioContext);
        if (!AC)
            return false;
        // iOS/iPadOS Safari: play like a native game even when the ring/silent switch is on.
        try {
            const s = navigator.audioSession;
            if (s)
                s.type = 'playback';
        }
        catch { }
        try {
            this.ctx = new AC({ latencyHint: 'interactive' });
            this.master = this.ctx.createGain();
            this.sfxBus = this.ctx.createGain();
            this.bgmBus = this.ctx.createGain();
            this.bgmBus.connect(this.master);
            this.sfxBus.connect(this.master);
            this.master.connect(this.ctx.destination);
            this.master.gain.value = this.volumeValue / 100;
            this.sfxBus.gain.value = .85;
            this.bgmBus.gain.value = 1;
            this.ready = true;
            this.ctx.addEventListener('statechange', () => this._onStateChange());
            return true;
        }
        catch (e) {
            this.ready = false;
            this.ctx = null;
            return false;
        }
    },
    async resume() { if (!this.init())
        return false; if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
        try {
            await this.ctx.resume();
        }
        catch {
            return false;
        }
    } return this.ctx.state === 'running'; },
    _cache(url, buffer) { this.buffers.delete(url); this.buffers.set(url, buffer); const keep = this.active?.url; for (const k of this.buffers.keys()) {
        if (this.buffers.size <= MAX_CACHED_BUFFERS)
            break;
        if (k !== url && k !== keep)
            this.buffers.delete(k);
    } },
    async prepare(songId) { const url = AUDIO_URL(songId); if (!url)
        throw new Error('找不到歌曲音频资源'); const cached = this.buffers.get(url); if (cached) {
        this._cache(url, cached);
        return cached;
    } const pending = this.decodeJobs.get(url); if (pending)
        return pending; const job = (async () => { if (!(await this.resume()))
        throw new Error('AudioContext 无法启动'); const res = await fetch(url); if (!res.ok)
        throw new Error(`音频请求失败：${res.status}`); const data = await res.arrayBuffer(); const buffer = await this.ctx.decodeAudioData(data); if (!buffer.duration)
        throw new Error('音频解码失败'); this._cache(url, buffer); return buffer; })().finally(() => { if (this.decodeJobs.get(url) === job)
        this.decodeJobs.delete(url); }); this.decodeJobs.set(url, job); return job; },
    isReady(songId) { const url = AUDIO_URL(songId); return !!url && this.buffers.has(url); },
    setVolume(v) { const n = Number(v); this.volumeValue = Number.isFinite(n) ? clamp(n, 0, 100) : 70; if (this.master && this.ctx)
        this.master.gain.setTargetAtTime(this.volumeValue / 100, this.ctx.currentTime, .02); },
    /** Context time of the sample reaching the speakers right now (includes device/Bluetooth output latency). */
    _heardContextTime() {
        const c = this.ctx;
        if (typeof c.getOutputTimestamp === 'function') {
            const ts = c.getOutputTimestamp();
            const ct = Number(ts?.contextTime), pt = Number(ts?.performanceTime);
            if (Number.isFinite(ct) && ct > 0 && Number.isFinite(pt) && pt > 0) {
                const ahead = c.state === 'running' ? clamp((performance.now() - pt) / 1000, 0, MAX_EXTRAPOLATE_SEC) : 0;
                return Math.min(c.currentTime, ct + ahead);
            }
        }
        const out = Number.isFinite(c.outputLatency) ? c.outputLatency : 0, base = Number.isFinite(c.baseLatency) ? c.baseLatency : 0;
        return Math.max(0, c.currentTime - Math.max(0, out + base));
    },
    /** Seconds between scheduling a sample and hearing it. */
    outputLatencySec() { return this.ctx ? Math.max(0, this.ctx.currentTime - this._heardContextTime()) : 0; },
    getOutputLatencyMs() { return this.outputLatencySec() * 1000; },
    heardContextTime() { return this.ctx?.state === 'running' ? this._heardContextTime() : null; },
    /** Context time that was audible at `perfMs` (an input event timestamp on the performance.now() clock). */
    heardContextTimeAt(perfMs) { if (this.ctx?.state !== 'running')
        return null; const age = clamp(performance.now() - perfMs, 0, 120) / 1000; return this._heardContextTime() - age; },
    /** Schedule metronome clicks on the audio clock. Each returned time is heard when heardContextTime() reaches it. */
    scheduleClicks(count, intervalSec, leadSec = .6) {
        if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running')
            return null;
        const c = this.ctx, t0 = c.currentTime + Math.max(0, leadSec), times = [], nodes = [];
        for (let i = 0; i < count; i++) {
            const t = t0 + i * intervalSec, o = c.createOscillator(), g = c.createGain();
            o.frequency.value = i % 4 === 0 ? 1760 : 1320;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(.3, t + .001);
            g.gain.exponentialRampToValueAtTime(.0001, t + .05);
            o.connect(g);
            g.connect(this.sfxBus);
            o.onended = () => { try {
                o.disconnect();
                g.disconnect();
            }
            catch { } };
            o.start(t);
            o.stop(t + .06);
            times.push(t);
            nodes.push(o);
        }
        return { times, cancel: () => { for (const o of nodes) {
                try {
                    o.stop();
                }
                catch { }
            } } };
    },
    _voice(spec = {}) { if (!this.ctx || !this.sfxBus || this.ctx.state !== 'running')
        return null; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(); const type = spec.type || 'sine', fs = Math.max(.001, Number(spec.freqStart ?? 440)), fe = spec.freqEnd == null ? null : Math.max(.001, Number(spec.freqEnd)), fr = Math.max(0, Number(spec.freqRamp ?? 0)), peak = Math.max(.000001, Number(spec.peak ?? .08)), relLevel = Math.max(.000001, Number(spec.releaseLevel ?? .0001)), rel = Math.max(.001, Number(spec.release ?? .1)), stop = Math.max(rel + .01, Number(spec.stop ?? rel + .01)); o.type = type; o.connect(g); g.connect(this.sfxBus); o.frequency.setValueAtTime(fs, t); if (fe != null && fr > 0)
        o.frequency.exponentialRampToValueAtTime(fe, t + fr); g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(relLevel, t + rel); o.onended = () => { try {
        o.disconnect();
        g.disconnect();
    }
    catch { } }; o.start(t); o.stop(t + stop); return { oscillator: o, gain: g, startTime: t, stopTime: t + stop }; },
    sfx(kind) { const key = this._sfxPresets[kind] ? kind : 'lost'; const t = this.ctx?.currentTime; const last = this._lastSfx.get(key); if (t != null && last != null && t >= last && t - last < SFX_MERGE_SEC)
        return true; const v = this._voice(this._sfxPresets[key]); if (v)
        this._lastSfx.set(key, v.startTime); return !!v; },
    /** Song position (s) currently audible; consistent with start() scheduling, so it can drive the GameClock directly. */
    currentPositionSec(songId) { const a = this.active; if (!a || a.songId !== songId || !this.ctx)
        return null; if (a.paused)
        return a.offsetSec; return clamp(a.offsetSec + (this._heardContextTime() - a.startAtContext) * a.playbackRate, 0, a.duration); },
    async start(songId, gameMs = 0) {
        const buffer = await this.prepare(songId).catch(() => null);
        if (!buffer || !(await this.resume()))
            return null;
        this.stop();
        const c = this.ctx, url = AUDIO_URL(songId);
        const raw = typeof gameMs === 'function' ? gameMs() : Number(gameMs);
        const gs = Number.isFinite(raw) ? raw / 1000 : 0;
        // Latency compensation: what is rendered now is heard `lat` later, so render song time (gs+lat) now.
        // Before the song starts (gs+lat<0) the start is scheduled sample-accurately in the future instead.
        const lat = this.outputLatencySec(), target = gs + lat, now = c.currentTime;
        const offset = clamp(Math.max(0, target), 0, Math.max(0, buffer.duration - .001)), startAt = now + Math.max(0, -target);
        const source = c.createBufferSource(), gain = c.createGain(), token = ++this._token;
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(this.bgmBus);
        if (offset > 0) {
            gain.gain.setValueAtTime(0, startAt);
            gain.gain.linearRampToValueAtTime(1, startAt + FADE_SEC);
        }
        const active = { songId, url, source, gain, buffer, duration: buffer.duration, offsetSec: offset, startAtContext: startAt, playbackRate: 1, paused: false, token };
        this.active = active;
        source.onended = () => { try {
            source.disconnect();
            gain.disconnect();
        }
        catch { } if (this.active?.token !== token)
            return; this.active = null; if (GLOBAL_GAME_PLAYING() && this.hooks.onEndedUnexpected)
            this.hooks.onEndedUnexpected(); };
        try {
            source.start(startAt, offset);
        }
        catch {
            this.active = null;
            return null;
        }
        return active;
    },
    /** Fade out and stop a playback node without an audible click. */
    _release(a) { if (!a.source || !this.ctx)
        return; const t = this.ctx.currentTime, src = a.source, g = a.gain; try {
        if (g) {
            g.gain.cancelScheduledValues(t);
            g.gain.setValueAtTime(g.gain.value, t);
            g.gain.linearRampToValueAtTime(0, t + FADE_SEC);
        }
        src.stop(t + FADE_SEC + .002);
    }
    catch {
        try {
            src.stop();
        }
        catch { }
    } },
    pause() { const a = this.active; if (!a || !this.ctx)
        return; const pos = this.currentPositionSec(a.songId) ?? a.offsetSec; ++this._token; this._release(a); this.active = { ...a, source: null, gain: null, offsetSec: pos, paused: true, token: this._token }; },
    resumeAtGameTime(songId, gameMs) { return this.start(songId, gameMs); },
    stop() { const a = this.active; if (!a)
        return; this.active = null; ++this._token; this._release(a); },
    abort(songId) { const url = AUDIO_URL(songId); if (url)
        this.decodeJobs.delete(url); if (this.active?.songId === songId)
        this.stop(); },
    async prime(songId) { const ok = await this.resume(); if (ok)
        this.prepare(songId).catch(() => null); return ok; },
    // 'interrupted' is iOS Safari's state for calls, Siri, alarms, etc.
    _onStateChange() { const s = this.ctx?.state; if ((s === 'suspended' || s === 'interrupted') && GLOBAL_GAME_PLAYING())
        this.hooks.onSystemInterrupt?.(); }
};
// Installed by legacy gameplay bridge at boot to avoid a circular import.
let GAME_PLAYING = false;
export const setAudioGamePlaying = (v) => { GAME_PLAYING = v; };
const GLOBAL_GAME_PLAYING = () => GAME_PLAYING;
