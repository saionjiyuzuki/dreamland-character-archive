export class GameplaySession {
    d;
    constructor(d) {
        this.d = d;
    }
    computePreludeMs() { return Math.min(2500, Math.max(900, this.d.G.fallTime || 1500)); }
    enterPlaying(ctx) {
        const chart = ctx?.chart;
        if (!chart && !ctx?.resumeFromPause)
            throw new Error('PLAYING requires a chart');
        if (ctx?.resumeFromPause) {
            this.resumeExisting();
            return;
        }
        this.startNew(chart, !!ctx.resourceReady);
    }
    startNew(chart, _resourceReady) {
        const G = this.d.G, D = this.d.D;
        G.waitingKey = null;
        this.d.renderKeybinds();
        this.d.Layout.update();
        this.d.renderer.resize();
        if (this.d.GameClock.isRunning())
            this.d.GameClock.pause();
        this.d.GameClock.reset();
        G.chart = chart;
        G.selectedSongId = chart.id;
        G.laneCount = this.d.laneCountAtTime(0);
        G.visualLaneCount = G.laneCount;
        const prof = this.d.perspectiveProfile(G.laneCount);
        G.visualPerspectiveCx = this.d.Layout.w * prof.cxRatio;
        G.visualHorizonY = this.d.Layout.h * prof.horizonRatio;
        G.visualJudgeY = this.d.Layout.h * prof.judgeRatio;
        this.d.updateLaneUI(G.laneCount);
        G.fallTime = this.d.computeFallTime(G.speed);
        G.autoUsed = false;
        G.auto = false;
        D.autoBtn.classList.remove('active');
        G.score = 0;
        G.combo = 0;
        G.maxCombo = 0;
        G.pure = 0;
        G.great = 0;
        G.far = 0;
        G.lost = 0;
        G.timingStats = { early: 0, late: 0, earlySum: 0, lateSum: 0, count: 0, sum: 0 };
        G.active = [];
        G.holding.clear();
        G.multiHoldPointers?.clear?.();
        G.lastScore = '';
        G.lastCombo = '';
        this.d.loadChart(chart);
        G.audioStarted = false;
        G.preludeMs = this.computePreludeMs();
        if (G.audioStartTimer) {
            clearTimeout(G.audioStartTimer);
            G.audioStartTimer = null;
        }
        D.gameplay.classList.add('active');
        D.keysContainer.classList.add('show');
        D.pauseBtn.classList.add('show');
        D.autoBtn.classList.add('show');
        D.autoBtn.classList.toggle('active', G.auto);
        D.pauseMask.classList.remove('show', 'user-mode', 'visibility-mode', 'system-mode');
        this.d.renderer.resize();
        this.d.renderer.clear();
        D.judgments.innerHTML = '';
        D.combo.textContent = '0';
        D.combo.classList.remove('show');
        D.combo.style.transform = 'translate(-50%,-50%) scale(1)';
        D.score.textContent = '0000000';
        D.hudSpeed.textContent = G.speed.toFixed(1);
        D.progressFill.style.width = '0%';
        this.d.visiblePage(null);
        this.d.renderLanes();
        this.d.GameClock.start(-G.preludeMs);
        if (G.rafId)
            cancelAnimationFrame(G.rafId);
        G.rafId = requestAnimationFrame(() => this.loop());
        this.startAudioFromClock();
    }
    startAudioFromClock() {
        const G = this.d.G;
        G.audioStartTimer = null;
        if (this.d.StateMachine.state !== this.d.APP_STATE.PLAYING || !G.chart)
            return;
        // Pass a getter: game time is read when playback is actually scheduled, after async decode/resume.
        this.d.AudioEngine.start(G.chart.id, () => this.d.GameClock.now()).then((audio) => {
            if (this.d.StateMachine.state !== this.d.APP_STATE.PLAYING)
                return;
            if (!audio) {
                this.pause(this.d.PAUSE_REASON.SYSTEM);
                return;
            }
            G.audioStarted = true;
            this.d.AudioSync.start();
            this.d.AudioSync.immediate();
        });
    }
    resumeExisting() {
        const G = this.d.G, D = this.d.D;
        this.d.AudioSync.stop();
        D.pauseMask.classList.remove('show', 'user-mode', 'visibility-mode', 'system-mode');
        if (!this.d.GameClock.hasStarted())
            throw new Error('PLAYING resume requires a started GameClock');
        this.d.GameClock.resume();
        if (G.audioStartTimer) {
            clearTimeout(G.audioStartTimer);
            G.audioStartTimer = null;
        }
        G.audioStarted = false;
        this.d.AudioEngine.resumeAtGameTime(G.chart.id, () => this.d.GameClock.now()).then((audio) => {
            if (this.d.StateMachine.state !== this.d.APP_STATE.PLAYING)
                return;
            if (!audio) {
                this.pause(this.d.PAUSE_REASON.SYSTEM);
                return;
            }
            G.audioStarted = true;
            this.d.AudioSync.start();
            this.d.AudioSync.immediate();
        });
        if (G.rafId)
            cancelAnimationFrame(G.rafId);
        G.rafId = requestAnimationFrame(() => this.loop());
    }
    pause(reason = this.d.PAUSE_REASON.USER) { if (this.d.StateMachine.state === this.d.APP_STATE.PLAYING)
        this.d.StateMachine.transition(this.d.APP_STATE.PAUSED, { reason }); }
    enterPaused(ctx) {
        const G = this.d.G, D = this.d.D;
        this.d.AudioSync.stop();
        if (G.audioStartTimer) {
            clearTimeout(G.audioStartTimer);
            G.audioStartTimer = null;
        }
        const pauseAt = this.d.GameClock.hasStarted() ? this.d.GameClock.now() : 0;
        if (G.multiHoldPointers instanceof Map) {
            for (const binding of G.multiHoldPointers.values())
                binding?.note?.multiHoldAdapter?.release(binding.lane, pauseAt);
            G.multiHoldPointers.clear();
        }
        this.d.AudioEngine.pause();
        G.audioStarted = false;
        if (this.d.GameClock.hasStarted())
            this.d.GameClock.pause();
        D.pauseMask.classList.remove('user-mode', 'visibility-mode', 'system-mode');
        const reason = ctx?.reason || this.d.PAUSE_REASON.USER;
        if (reason === this.d.PAUSE_REASON.USER) {
            D.pauseMask.classList.add('user-mode');
            D.pauseTitle.textContent = 'Paused';
            D.pauseHint.textContent = '';
            D.pauseMask.classList.add('show');
            this.d.AudioEngine.sfx('pause');
        }
        else if (reason === this.d.PAUSE_REASON.VISIBILITY) {
            D.pauseMask.classList.add('visibility-mode');
            D.pauseTitle.textContent = '游戏已暂停';
            D.pauseHint.textContent = '点击继续';
            D.pauseMask.classList.add('show');
        }
        else {
            D.pauseMask.classList.add('system-mode');
            D.pauseTitle.textContent = '系统暂停';
            D.pauseHint.textContent = '系统暂停 · 点击继续';
            D.pauseMask.classList.add('show');
        }
    }
    resume() {
        if (this.d.StateMachine.state !== this.d.APP_STATE.PAUSED)
            return;
        const reason = this.d.StateMachine.context?.reason || this.d.PAUSE_REASON.USER;
        if (reason === this.d.PAUSE_REASON.SYSTEM)
            return this.systemResume();
        this.d.StateMachine.transition(this.d.APP_STATE.PLAYING, { chart: this.d.G.chart, resourceReady: true, resumeFromPause: true, reason });
    }
    systemResume() { if (this.d.StateMachine.state === this.d.APP_STATE.PAUSED && this.d.StateMachine.context?.reason === this.d.PAUSE_REASON.SYSTEM)
        this.d.StateMachine.transition(this.d.APP_STATE.PLAYING, { chart: this.d.G.chart, resourceReady: true, resumeFromPause: true, reason: this.d.PAUSE_REASON.SYSTEM }); }
    enterResult() {
        const G = this.d.G;
        this.d.AudioSync.stop();
        if (G.audioStartTimer) {
            clearTimeout(G.audioStartTimer);
            G.audioStartTimer = null;
        }
        G.audioStarted = false;
        if (this.d.GameClock.hasStarted())
            this.d.GameClock.pause();
        this.d.AudioEngine.stop();
        this.d.showResult();
    }
    finish() { if (this.d.StateMachine.state === this.d.APP_STATE.PLAYING)
        this.d.StateMachine.transition(this.d.APP_STATE.RESULT, {}); }
    stopGameplayForMenu() {
        const G = this.d.G, D = this.d.D;
        this.d.AudioSync.stop();
        this.d.AudioEngine.stop();
        if (G.audioStartTimer) {
            clearTimeout(G.audioStartTimer);
            G.audioStartTimer = null;
        }
        G.audioStarted = false;
        if (this.d.GameClock.hasStarted() && this.d.GameClock.isRunning())
            this.d.GameClock.pause();
        G.playing = false;
        G.paused = false;
        G.active = [];
        G.pending = [];
        G.pendingIndex = 0;
        G.holding.clear();
        G.multiHoldPointers?.clear?.();
        this.d.renderer.clear();
        D.judgments.innerHTML = '';
        D.gameplay.classList.remove('active');
        D.keysContainer.classList.remove('show');
        D.pauseBtn.classList.remove('show');
        D.autoBtn.classList.remove('show');
        D.pauseMask.classList.remove('show');
    }
    stopGameplayHard() { this.stopGameplayForMenu(); if (this.d.G.rafId) {
        cancelAnimationFrame(this.d.G.rafId);
        this.d.G.rafId = null;
    } }
    systemPauseIfNeeded() { if (this.d.StateMachine.state === this.d.APP_STATE.PLAYING)
        this.pause(this.d.PAUSE_REASON.SYSTEM); }
    loop() {
        const G = this.d.G;
        if (!G.playing)
            return;
        if (G.paused || this.d.StateMachine.state !== this.d.APP_STATE.PLAYING || !this.d.GameClock.hasStarted()) {
            G.rafId = requestAnimationFrame(() => this.loop());
            return;
        }
        const t = this.d.GameClock.now();
        const mode = this.d.laneCountAtTime(t);
        if (mode !== G.laneMode) {
            const prev = G.laneMode;
            G.laneCount = mode;
            this.d.updateLaneUI(mode);
            this.d.triggerLaneTransition(prev, mode);
        }
        this.d.updateSpawn(t);
        this.d.updateNotes(t);
        this.d.updateAuto(t);
        this.d.updateMiss(t);
        this.d.updateHolds(t);
        this.d.updateProgress(t);
        this.d.checkEnd(t);
        G.rafId = requestAnimationFrame(() => this.loop());
    }
}
