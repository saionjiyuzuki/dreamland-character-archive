import { MultiHoldRuntime } from "../runtime/MultiHoldRuntime.js";
import { HoldPathCache } from "../runtime/HoldPathCache.js";
import { MultiHoldRenderer } from "../render/MultiHoldRenderer.js";
import { mapMultiHoldRuntimeEvent } from "../judge/MultiHoldJudge.js";
/** Composition root for adding Multi Hold to a host ChartRuntime/Judge/Renderer loop. */
export class MultiHoldAdapter {
    note;
    runtime;
    renderer = new MultiHoldRenderer();
    constructor(note, options, cache = new HoldPathCache()) {
        this.note = note;
        this.options = options;
        this.runtime = new MultiHoldRuntime(note, options, cache);
    }
    options;
    canAcceptLane(lane, chartTimeMs) { return this.runtime.canAcceptLane(lane, chartTimeMs); }
    press(lane, chartTimeMs) {
        return this.dispatch(this.runtime.pressLane(lane, chartTimeMs));
    }
    moveLane(fromLane, toLane, chartTimeMs) {
        const events = this.runtime.moveLane(fromLane, toLane, chartTimeMs);
        // A pointer may move outside the ribbon and later re-enter from an unpressed lane.
        // In that case accept the destination through the same reconnect rules as a new press.
        if (!this.runtime.activePressedLanes.includes(toLane) && this.runtime.canAcceptLane(toLane, chartTimeMs)) {
            events.push(...this.runtime.pressLane(toLane, chartTimeMs));
        }
        return this.dispatch(events);
    }
    release(lane, chartTimeMs) { this.runtime.releaseLane(lane, chartTimeMs); }
    autoMaintain(chartTimeMs) { return this.dispatch(this.runtime.autoMaintain(chartTimeMs)); }
    update(chartTimeMs, autoConnected = false) { return this.dispatch(this.runtime.update(chartTimeMs, autoConnected)); }
    draw(ctx, projector, chartTimeMs, alpha = 1) {
        const phase = this.runtime.phase;
        const tickIntervalMs = this.options.tickIntervalMs ?? this.note.tickIntervalMs;
        return this.renderer.draw(ctx, this.note, this.runtime.samples, projector, {
            phase,
            chartTimeMs,
            laneCount: this.options.getLaneCount?.() ?? this.options.laneCount,
            ...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
            // In-game multi-holds are a plain translucent ribbon: no cross ribs inside the body.
            drawTickRibs: false,
            alpha
        });
    }
    dispatch(events) {
        for (const event of events)
            this.options.onJudgeEvent?.(mapMultiHoldRuntimeEvent(event, this.options.judgeWindows));
        return events;
    }
}
