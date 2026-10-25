import { sampleMultiHoldAt } from "../chart/holdPath.js";
const PALETTE = {
    waiting: { fillA: "rgba(102,237,255,0.08)", fillB: "rgba(125,130,255,0.20)", edge: "rgba(160,247,255,0.92)", core: "rgba(230,255,255,0.88)" },
    holding: { fillA: "rgba(87,255,226,0.16)", fillB: "rgba(110,138,255,0.30)", edge: "rgba(121,255,235,0.98)", core: "rgba(245,255,255,0.96)" },
    disconnected: { fillA: "rgba(165,177,198,0.06)", fillB: "rgba(112,123,155,0.15)", edge: "rgba(180,193,215,0.82)", core: "rgba(225,230,242,0.55)" },
    reconnected: { fillA: "rgba(174,126,255,0.18)", fillB: "rgba(93,236,255,0.28)", edge: "rgba(213,174,255,1)", core: "rgba(255,255,255,1)" },
    finished: { fillA: "rgba(125,211,252,0.03)", fillB: "rgba(125,211,252,0.05)", edge: "rgba(125,211,252,0.2)", core: "rgba(255,255,255,0.1)" }
};
/**
 * Projects a sampled lane-edge path at each sample's chart time. Track morph and perspective
 * are supplied by the host game through `projector`, so this renderer never caches pixel values.
 */
export class MultiHoldRenderer {
    draw(ctx, note, samples, projector, options) {
        const phase = options.phase ?? "waiting";
        const colors = PALETTE[phase];
        const equippedHoldColor = typeof getComputedStyle === "function" && typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--hold").trim() : "";
        const edgeColor = phase === "disconnected" ? colors.edge : (equippedHoldColor || colors.edge);
        if (samples.length < 2 || phase === "finished")
            return { sampleCount: 0, tickRibs: 0, phase };
        const alpha = Math.max(0, Math.min(1, options.alpha ?? 1));
        // Only draw the not-yet-passed portion of the ribbon. Older path samples would
        // otherwise collapse onto the judgement line and create a solid visual wedge.
        const elapsed = options.chartTimeMs - note.startTime;
        if (elapsed >= note.endTime - note.startTime)
            return { sampleCount: 0, tickRibs: 0, phase };
        const visibleSamples = elapsed > 0
            ? [sampleMultiHoldAt(samples, elapsed), ...samples.filter((sample) => sample.offsetMs > elapsed + 0.01)]
            : [...samples];
        if (visibleSamples.length < 2)
            return { sampleCount: visibleSamples.length, tickRibs: 0, phase };
        const alphaWithPhase = phase === "reconnected" ? alpha : alpha;
        const left = [];
        const right = [];
        for (const sample of visibleSamples) {
            const t = note.startTime + sample.offsetMs;
            left.push(projector(sample.leftLane, t));
            right.push(projector(sample.rightLane, t));
        }
        ctx.save();
        ctx.globalAlpha *= alphaWithPhase;
        ctx.beginPath();
        ctx.moveTo(left[0].x, left[0].y);
        for (let i = 1; i < left.length; i++)
            ctx.lineTo(left[i].x, left[i].y);
        for (let i = right.length - 1; i >= 0; i--)
            ctx.lineTo(right[i].x, right[i].y);
        ctx.closePath();
        // Translucent multi-hold: one flat tint, no glow, center line or gradient inside the body.
        const baseAlpha = ctx.globalAlpha;
        ctx.fillStyle = edgeColor;
        ctx.globalAlpha = baseAlpha * (phase === "holding" || phase === "reconnected" ? 0.32 : 0.24);
        ctx.fill();
        ctx.globalAlpha = baseAlpha;
        ctx.lineWidth = phase === "holding" ? 2.1 : 1.45;
        ctx.strokeStyle = edgeColor;
        ctx.shadowColor = edgeColor;
        ctx.shadowBlur = phase === "holding" || phase === "reconnected" ? 10 : 6;
        ctx.setLineDash(phase === "disconnected" ? [7, 5] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        // Cross ribs show the multi-lane width and visually reinforce that this is one object.
        let tickRibs = 0;
        if (options.drawTickRibs !== false) {
            const interval = Math.max(50, options.tickIntervalMs ?? note.tickIntervalMs ?? 500);
            for (let t = note.startTime + interval; t < note.endTime; t += interval) {
                if (t < options.chartTimeMs - 0.5)
                    continue;
                const offset = t - note.startTime;
                const sample = sampleMultiHoldAt(samples, offset);
                const a = projector(sample.leftLane, t);
                const b = projector(sample.rightLane, t);
                if (![a.x, a.y, b.x, b.y].every(Number.isFinite))
                    continue;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.lineWidth = 1;
                ctx.strokeStyle = edgeColor;
                const priorAlpha = ctx.globalAlpha;
                ctx.globalAlpha = priorAlpha * 0.72;
                ctx.stroke();
                ctx.globalAlpha = priorAlpha;
                tickRibs++;
            }
        }
        // Bright head bar at the start edge.
        const headSample = visibleSamples[0];
        const headLeft = projector(headSample.leftLane, note.startTime + headSample.offsetMs);
        const headRight = projector(headSample.rightLane, note.startTime + headSample.offsetMs);
        ctx.beginPath();
        ctx.moveTo(headLeft.x, headLeft.y);
        ctx.lineTo(headRight.x, headRight.y);
        ctx.lineWidth = 4;
        ctx.strokeStyle = colors.core;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.restore();
        return { sampleCount: visibleSamples.length, tickRibs, phase };
    }
}
