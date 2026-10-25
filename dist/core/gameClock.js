export function createGameClock() {
    let phase = 'paused';
    let started = false;
    let gameMs = 0;
    let lastPerf = 0;
    let correctionRemaining = 0;
    let correctionRate = 0;
    const ensureStarted = () => { if (!started)
        throw new Error('GameClock.now(): clock has not been started'); };
    const applyElapsed = () => { if (phase !== 'running')
        return; const p = performance.now(); const dt = Math.max(0, p - lastPerf); lastPerf = p; gameMs += dt; if (Math.abs(correctionRemaining) > 0.0001) {
        const step = Math.sign(correctionRemaining) * Math.min(Math.abs(correctionRemaining), Math.abs(correctionRate * dt));
        gameMs += step;
        correctionRemaining -= step;
        if (Math.abs(correctionRemaining) < 0.0001) {
            correctionRemaining = 0;
            correctionRate = 0;
        }
    } };
    return {
        isRunning: () => phase === 'running', isPaused: () => phase === 'paused', hasStarted: () => started,
        start(initialMs = 0) { if (started)
            return; if (phase !== 'paused')
            throw new Error('GameClock.start(): clock must be paused'); gameMs = Number(initialMs) || 0; correctionRemaining = 0; correctionRate = 0; started = true; phase = 'running'; lastPerf = performance.now(); },
        pause() { if (phase === 'paused')
            return; applyElapsed(); phase = 'paused'; lastPerf = 0; },
        resume() { if (!started)
            throw new Error('GameClock.resume(): clock has not been started'); if (phase === 'running')
            return; phase = 'running'; lastPerf = performance.now(); },
        reset() { if (phase !== 'paused')
            throw new Error('GameClock.reset(): reset is only valid while paused'); gameMs = 0; correctionRemaining = 0; correctionRate = 0; started = false; lastPerf = 0; },
        now() { ensureStarted(); applyElapsed(); return gameMs; },
        softCorrect(targetMs, durationMs = 600) { ensureStarted(); if (phase !== 'running')
            return; const target = Number(targetMs) || 0; const current = (() => { applyElapsed(); return gameMs; })(); correctionRemaining = target - current; correctionRate = correctionRemaining / Math.max(1, durationMs); },
        hardAlign(targetMs) { ensureStarted(); gameMs = Number(targetMs) || 0; correctionRemaining = 0; correctionRate = 0; lastPerf = performance.now(); }
    };
}
export const GameClock = createGameClock();
