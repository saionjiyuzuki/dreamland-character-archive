/**
 * Life gauge (血条), 0–100. Every judged unit (tap, hold head / tick, Multi Hold head / tick) moves it by GAUGE.gain.
 * Reaching 0 does not stop the song: the gauge locks at 0 and the play is FAILED, even if later notes are hit.
 * A play is CLEAR when the gauge never emptied and ends at or above GAUGE.clearAt.
 */
export const GAUGE = {
    start: 50,
    max: 100,
    clearAt: 70,
    /** Danger tint below this value (visual only). */
    dangerBelow: 30,
    gain: { PURE: 1, GREAT: 0.6, FAR: 0.3, LOST: -3 },
};
export function resetGauge(G) { G.hp = GAUGE.start; G.hpFailed = false; }
export function gaugeValue(G) { return Number.isFinite(G.hp) ? Number(G.hp) : GAUGE.start; }
/** Apply `count` results of the same grade. Unknown grades leave the gauge unchanged. */
export function applyGauge(G, result, count = 1) {
    if (G.hpFailed)
        return;
    const delta = (GAUGE.gain[result] ?? 0) * count;
    const next = Math.min(GAUGE.max, Math.max(0, gaugeValue(G) + delta));
    G.hp = Math.round(next * 1e6) / 1e6; // keep 0.6 / 0.3 steps from drifting below the clear line
    if (G.hp <= 0)
        G.hpFailed = true;
}
export function clearState(G) {
    return !G.hpFailed && gaugeValue(G) >= GAUGE.clearAt ? 'CLEAR' : 'FAILED';
}
/** Accuracy over the units judged so far (same weights as the result screen); 1 before anything is judged. */
export function liveAccuracy(G) {
    const pure = Number(G.pure) || 0, great = Number(G.great) || 0, far = Number(G.far) || 0, lost = Number(G.lost) || 0;
    const n = pure + great + far + lost;
    return n > 0 ? (pure + great * 0.75 + far * 0.5) / n : 1;
}
