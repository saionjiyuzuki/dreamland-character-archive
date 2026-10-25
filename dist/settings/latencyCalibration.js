/** Tap-along audio latency calibration: measures where the player taps relative to audible beats. */
export const CALIB_BEATS = 20;
export const CALIB_COUNT_IN = 4;
export const CALIB_INTERVAL_SEC = 0.5;
export const CALIB_MIN_TAPS = 8;
export const CALIB_MAX_SPREAD_MS = 35;
export const OFFSET_LIMIT_MS = 200;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/**
 * Taps and beats are audio-context times in seconds. Count-in beats are ignored, each beat accepts one tap,
 * and taps further than 45% of a beat interval from any beat are discarded. Median error is robust to stray taps.
 */
export function analyzeTaps(taps, beats, countIn = CALIB_COUNT_IN) {
    if (beats.length <= countIn)
        return null;
    const interval = beats.length > 1 ? beats[1] - beats[0] : CALIB_INTERVAL_SEC;
    const used = new Set();
    const errors = [];
    for (const tap of taps) {
        let best = -1, bestAbs = Infinity;
        for (let i = 0; i < beats.length; i++) {
            const a = Math.abs(tap - beats[i]);
            if (a < bestAbs) {
                bestAbs = a;
                best = i;
            }
        }
        if (best < countIn || used.has(best) || bestAbs > interval * 0.45)
            continue;
        used.add(best);
        errors.push((tap - beats[best]) * 1000);
    }
    if (errors.length < CALIB_MIN_TAPS)
        return null;
    const offsetMs = median(errors);
    return { offsetMs, spreadMs: median(errors.map(e => Math.abs(e - offsetMs))), count: errors.length };
}
/** Event.timeStamp is usually on the performance.now() clock; some older engines report epoch ms. */
const toPerfMs = (ts) => (ts > 1e12 ? ts - performance.timeOrigin : ts);
export class LatencyCalibration {
    d;
    run = null;
    constructor(d) {
        this.d = d;
    }
    el(id) { return document.getElementById(id); }
    text(id, value) { const e = this.el(id); if (e)
        e.textContent = value; }
    bind() {
        this.el('calibStart')?.addEventListener('click', () => { if (this.run)
            this.cancel('已取消');
        else
            void this.start(); });
        this.el('calibStage')?.addEventListener('pointerdown', (e) => { if (!this.run)
            return; e.preventDefault(); this.tap(e.timeStamp); });
        document.addEventListener('keydown', (e) => {
            if (!this.run || e.repeat)
                return;
            e.preventDefault();
            if (e.key === 'Escape')
                this.cancel('已取消');
            else
                this.tap(e.timeStamp);
        });
    }
    async start() {
        if (this.run)
            return;
        if (!(await this.d.AudioEngine.resume())) {
            this.text('calibResult', '音频无法启动');
            return;
        }
        const clicks = this.d.AudioEngine.scheduleClicks(CALIB_BEATS, CALIB_INTERVAL_SEC);
        if (!clicks) {
            this.text('calibResult', '音频无法启动');
            return;
        }
        // Keep Space/Enter from re-activating the focused button while the player taps.
        document.activeElement?.blur?.();
        this.run = { ...clicks, taps: [], raf: 0, endAt: clicks.times[clicks.times.length - 1] + 0.6 };
        this.el('calibStage')?.classList.remove('hidden');
        this.text('calibStart', '取消校准');
        this.text('calibHint', `前 ${CALIB_COUNT_IN} 拍仅聆听，之后跟随节拍点击此处或按任意键 · 光圈与节拍不同步时调整「画面偏移」`);
        this.text('calibResult', '');
        this.frame();
    }
    tap(timeStamp) {
        const r = this.run;
        if (!r)
            return;
        const t = this.d.AudioEngine.heardContextTimeAt(toPerfMs(timeStamp));
        if (t == null)
            return;
        r.taps.push(t);
        this.text('calibResult', `已记录 ${r.taps.length} 次`);
    }
    frame = () => {
        const r = this.run;
        if (!r)
            return;
        if (this.el('pageSettings')?.classList.contains('hidden')) {
            this.cancel('');
            return;
        }
        const now = this.d.AudioEngine.heardContextTime();
        if (now == null) {
            this.cancel('');
            return;
        }
        if (now >= r.endAt) {
            this.finish();
            return;
        }
        // The ring is drawn with the same visual offset as gameplay notes, so it doubles as a visual-offset check.
        const vt = now + this.d.visualOffsetMs() / 1000;
        let since = Infinity;
        for (const b of r.times) {
            if (b <= vt)
                since = vt - b;
            else
                break;
        }
        const p = Number.isFinite(since) ? Math.exp(-since * 12) : 0;
        const ring = this.el('calibRing');
        if (ring) {
            ring.style.opacity = String(0.25 + 0.75 * p);
            ring.style.transform = `scale(${0.8 + 0.35 * p})`;
        }
        r.raf = requestAnimationFrame(this.frame);
    };
    finish() {
        const r = this.run;
        if (!r)
            return;
        this.stop();
        const res = analyzeTaps(r.taps, r.times);
        if (!res) {
            this.text('calibResult', '有效点击不足，请跟随节拍重试');
            return;
        }
        if (res.spreadMs > CALIB_MAX_SPREAD_MS) {
            this.text('calibResult', `点击不够稳定（±${Math.round(res.spreadMs)}ms），请重试`);
            return;
        }
        const ms = Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(res.offsetMs)));
        this.d.apply(ms);
        this.text('calibResult', `判定偏移已设为 ${ms > 0 ? '+' : ''}${ms}ms · 稳定度 ±${Math.round(res.spreadMs)}ms`);
    }
    cancel(message) {
        this.run?.cancel();
        this.stop();
        this.text('calibResult', message);
    }
    stop() {
        if (this.run?.raf)
            cancelAnimationFrame(this.run.raf);
        this.run = null;
        this.el('calibStage')?.classList.add('hidden');
        this.text('calibStart', '延迟校准');
        this.text('calibHint', '再次点击「延迟校准」可重新测试');
        const ring = this.el('calibRing');
        if (ring) {
            ring.style.opacity = '';
            ring.style.transform = '';
        }
    }
}
