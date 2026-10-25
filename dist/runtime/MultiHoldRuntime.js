import { HoldPathCache } from "./HoldPathCache.js";
import { MultiHoldPathRuntime } from "./MultiHoldPathRuntime.js";
export class MultiHoldRuntime {
    note;
    pathRuntime;
    tickIntervalMs;
    headWindowMs;
    reconnectWindowMs;
    pressedLanes = new Set();
    nextTickTime;
    nextTickIndex = 1;
    phaseValue = "waiting";
    lostAtValue = null;
    headResolved = false;
    finishedEventSent = false;
    constructor(note, options, cache = new HoldPathCache()) {
        this.note = note;
        if (!note.id)
            throw new Error("Multi Hold requires a stable id");
        if (!(note.endTime > note.startTime))
            throw new Error(`Multi Hold ${note.id} has invalid duration`);
        this.tickIntervalMs = Math.max(50, options.tickIntervalMs ?? note.tickIntervalMs ?? 500);
        this.headWindowMs = Math.max(0, options.headWindowMs ?? 120);
        this.reconnectWindowMs = Math.max(0, options.reconnectWindowMs ?? 500);
        const coordinateLaneCount = options.coordinateLaneCount ?? options.laneCount;
        const samples = cache.get(note, coordinateLaneCount, options.sampleCount);
        this.pathRuntime = new MultiHoldPathRuntime(note, samples, options.getLaneCount ?? options.laneCount);
        this.nextTickTime = note.startTime + this.tickIntervalMs;
    }
    get phase() { return this.phaseValue; }
    get lostAt() { return this.lostAtValue; }
    get activePressedLanes() { return [...this.pressedLanes]; }
    get headIsResolved() { return this.headResolved; }
    get samples() { return this.pathRuntime.samples; }
    canAcceptLane(lane, chartTimeMs) {
        if (this.phaseValue === "finished" || chartTimeMs > this.note.endTime)
            return false;
        if (!this.headResolved && Math.abs(chartTimeMs - this.note.startTime) > this.headWindowMs)
            return false;
        return this.pathRuntime.coversLane(lane, Math.max(this.note.startTime, Math.min(this.note.endTime, chartTimeMs)));
    }
    pressLane(lane, chartTimeMs) {
        if (!this.canAcceptLane(lane, chartTimeMs))
            return [];
        if (!this.headResolved) {
            const delta = chartTimeMs - this.note.startTime;
            if (Math.abs(delta) > this.headWindowMs)
                return [];
            this.headResolved = true;
            this.phaseValue = "holding";
            this.lostAtValue = null;
            this.pressedLanes.add(lane);
            return [{ noteId: this.note.id, type: "head", time: chartTimeMs, lane, timingDeltaMs: delta }];
        }
        const wasDisconnected = this.phaseValue === "disconnected";
        if (wasDisconnected && this.lostAtValue !== null && chartTimeMs - this.lostAtValue > this.reconnectWindowMs) {
            return [];
        }
        this.pressedLanes.add(lane);
        if (wasDisconnected) {
            this.phaseValue = "reconnected";
            this.lostAtValue = null;
            return [{ noteId: this.note.id, type: "reconnect", time: chartTimeMs, lane }];
        }
        this.phaseValue = "holding";
        return [];
    }
    releaseLane(lane, chartTimeMs) {
        this.pressedLanes.delete(lane);
        if (this.phaseValue === "finished" || !this.headResolved)
            return;
        if (!this.hasCoveredPressedLane(chartTimeMs)) {
            this.phaseValue = "disconnected";
            this.lostAtValue ??= chartTimeMs;
        }
    }
    /** Move one active pointer between lanes without manufacturing a release/re-press gap. */
    moveLane(fromLane, toLane, chartTimeMs) {
        if (this.phaseValue === "finished" || !this.pressedLanes.has(fromLane) || fromLane === toLane)
            return [];
        this.pressedLanes.delete(fromLane);
        if (this.pathRuntime.coversLane(toLane, Math.max(this.note.startTime, Math.min(this.note.endTime, chartTimeMs))))
            this.pressedLanes.add(toLane);
        if (this.hasCoveredPressedLane(chartTimeMs)) {
            if (this.phaseValue === "disconnected" && this.lostAtValue !== null && chartTimeMs - this.lostAtValue <= this.reconnectWindowMs) {
                this.phaseValue = "reconnected";
                this.lostAtValue = null;
                return [{ noteId: this.note.id, type: "reconnect", time: chartTimeMs, lane: toLane }];
            }
            this.phaseValue = "holding";
            this.lostAtValue = null;
        }
        else {
            this.phaseValue = "disconnected";
            this.lostAtValue ??= chartTimeMs;
        }
        return [];
    }
    /** Auto-play follows the occupied path while keeping one scored head and one unit per tick. */
    autoMaintain(chartTimeMs) {
        if (this.phaseValue === "finished" || chartTimeMs < this.note.startTime)
            return [];
        const events = [];
        if (!this.headResolved) {
            const initialLane = this.pathRuntime.lanesAt(this.note.startTime)[0];
            if (initialLane !== undefined)
                events.push(...this.pressLane(initialLane, this.note.startTime));
        }
        if (this.headResolved && chartTimeMs <= this.note.endTime) {
            this.pressedLanes.clear();
            for (const lane of this.pathRuntime.lanesAt(chartTimeMs))
                this.pressedLanes.add(lane);
            if (this.pressedLanes.size > 0) {
                this.phaseValue = "holding";
                this.lostAtValue = null;
            }
        }
        return events;
    }
    /** Process all due ticks in time order. Call once per gameplay update. */
    update(chartTimeMs, autoConnected = false) {
        if (this.phaseValue === "finished")
            return [];
        const events = [];
        // If the head window passed untouched, score the head as LOST once, then continue
        // emitting due internal ticks so remaining units can settle normally.
        if (!this.headResolved && this.phaseValue === "waiting" && chartTimeMs > this.note.startTime + this.headWindowMs) {
            const missTime = this.note.startTime + this.headWindowMs + 0.001;
            this.headResolved = true;
            this.phaseValue = "disconnected";
            this.lostAtValue = missTime;
            events.push({ noteId: this.note.id, type: "head", time: missTime, timingDeltaMs: this.headWindowMs + 1 });
        }
        if (!this.headResolved)
            return events;
        const tickEnd = Math.min(chartTimeMs, this.note.endTime);
        while (this.nextTickTime <= tickEnd) {
            const lanes = this.pathRuntime.lanesAt(this.nextTickTime);
            const connected = autoConnected || (this.pressedLanes.size > 0 && [...this.pressedLanes].some((lane) => lanes.includes(lane)));
            const grade = connected ? "PURE" : "LOST";
            events.push({ noteId: this.note.id, type: "tick", time: this.nextTickTime, grade, lanes });
            if (connected) {
                if (this.phaseValue !== "reconnected")
                    this.phaseValue = "holding";
                this.lostAtValue = null;
            }
            else {
                this.phaseValue = "disconnected";
                this.lostAtValue = this.nextTickTime;
            }
            this.nextTickIndex++;
            this.nextTickTime = this.note.startTime + this.nextTickIndex * this.tickIntervalMs;
        }
        if (chartTimeMs >= this.note.endTime && !this.finishedEventSent) {
            this.phaseValue = "finished";
            this.finishedEventSent = true;
            events.push({ noteId: this.note.id, type: "finish", time: this.note.endTime });
            this.pressedLanes.clear();
        }
        else if (this.phaseValue === "holding" && !this.hasCoveredPressedLane(chartTimeMs)) {
            this.phaseValue = "disconnected";
            this.lostAtValue ??= chartTimeMs;
        }
        else if (this.phaseValue === "reconnected" && this.hasCoveredPressedLane(chartTimeMs)) {
            this.phaseValue = "holding";
        }
        return events;
    }
    hasCoveredPressedLane(time) {
        const lanes = this.pathRuntime.lanesAt(Math.max(this.note.startTime, Math.min(this.note.endTime, time)));
        return [...this.pressedLanes].some((lane) => lanes.includes(lane));
    }
}
