import type { MultiHoldNote, MultiHoldPhase, MultiHoldRuntimeEvent } from "../chart/multiHoldSchema.js";
import { HoldPathCache } from "./HoldPathCache.js";
import { MultiHoldPathRuntime } from "./MultiHoldPathRuntime.js";

export interface MultiHoldRuntimeOptions {
  laneCount: number;
  /** Optional live source for dynamic 4K/6K/8K transitions. */
  getLaneCount?: () => number;
  /** Maximum lane coordinate space used to sample paths; set to 8 for charts spanning lane morphs. */
  coordinateLaneCount?: number;
  headWindowMs?: number;
  reconnectWindowMs?: number;
  tickIntervalMs?: number;
  sampleCount?: number;
}

export class MultiHoldRuntime {
  readonly pathRuntime: MultiHoldPathRuntime;
  readonly tickIntervalMs: number;
  readonly headWindowMs: number;
  readonly reconnectWindowMs: number;
  private readonly pressedLanes = new Set<number>();
  private nextTickTime: number;
  private nextTickIndex = 1;
  private phaseValue: MultiHoldPhase = "waiting";
  private lostAtValue: number | null = null;
  private headResolved = false;
  private finishedEventSent = false;

  constructor(readonly note: MultiHoldNote, options: MultiHoldRuntimeOptions, cache = new HoldPathCache()) {
    if (!note.id) throw new Error("Multi Hold requires a stable id");
    if (!(note.endTime > note.startTime)) throw new Error(`Multi Hold ${note.id} has invalid duration`);
    this.tickIntervalMs = Math.max(50, options.tickIntervalMs ?? note.tickIntervalMs ?? 500);
    this.headWindowMs = Math.max(0, options.headWindowMs ?? 120);
    this.reconnectWindowMs = Math.max(0, options.reconnectWindowMs ?? 500);
    const coordinateLaneCount = options.coordinateLaneCount ?? options.laneCount;
    const samples = cache.get(note, coordinateLaneCount, options.sampleCount);
    this.pathRuntime = new MultiHoldPathRuntime(note, samples, options.getLaneCount ?? options.laneCount);
    this.nextTickTime = note.startTime + this.tickIntervalMs;
  }

  get phase(): MultiHoldPhase { return this.phaseValue; }
  get lostAt(): number | null { return this.lostAtValue; }
  get activePressedLanes(): readonly number[] { return [...this.pressedLanes]; }
  get headIsResolved(): boolean { return this.headResolved; }
  get samples() { return this.pathRuntime.samples; }

  canAcceptLane(lane: number, chartTimeMs: number): boolean {
    if (this.phaseValue === "finished" || chartTimeMs > this.note.endTime) return false;
    if (!this.headResolved && Math.abs(chartTimeMs - this.note.startTime) > this.headWindowMs) return false;
    return this.pathRuntime.coversLane(lane, Math.max(this.note.startTime, Math.min(this.note.endTime, chartTimeMs)));
  }

  pressLane(lane: number, chartTimeMs: number): MultiHoldRuntimeEvent[] {
    if (!this.canAcceptLane(lane, chartTimeMs)) return [];

    if (!this.headResolved) {
      const delta = chartTimeMs - this.note.startTime;
      if (Math.abs(delta) > this.headWindowMs) return [];
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

  releaseLane(lane: number, chartTimeMs: number): void {
    this.pressedLanes.delete(lane);
    if (this.phaseValue === "finished" || !this.headResolved) return;
    if (!this.hasCoveredPressedLane(chartTimeMs)) {
      this.phaseValue = "disconnected";
      this.lostAtValue ??= chartTimeMs;
    }
  }

  /** Move one active pointer between lanes without manufacturing a release/re-press gap. */
  moveLane(fromLane: number, toLane: number, chartTimeMs: number): MultiHoldRuntimeEvent[] {
    if (this.phaseValue === "finished" || !this.pressedLanes.has(fromLane) || fromLane === toLane) return [];
    this.pressedLanes.delete(fromLane);
    if (this.pathRuntime.coversLane(toLane, Math.max(this.note.startTime, Math.min(this.note.endTime, chartTimeMs)))) this.pressedLanes.add(toLane);
    if (this.hasCoveredPressedLane(chartTimeMs)) {
      if (this.phaseValue === "disconnected" && this.lostAtValue !== null && chartTimeMs - this.lostAtValue <= this.reconnectWindowMs) {
        this.phaseValue = "reconnected";
        this.lostAtValue = null;
        return [{ noteId: this.note.id, type: "reconnect", time: chartTimeMs, lane: toLane }];
      }
      this.phaseValue = "holding";
      this.lostAtValue = null;
    } else {
      this.phaseValue = "disconnected";
      this.lostAtValue ??= chartTimeMs;
    }
    return [];
  }

  /** Auto-play follows the occupied path while keeping one scored head and one unit per tick. */
  autoMaintain(chartTimeMs: number): MultiHoldRuntimeEvent[] {
    if (this.phaseValue === "finished" || chartTimeMs < this.note.startTime) return [];
    const events: MultiHoldRuntimeEvent[] = [];
    if (!this.headResolved) {
      const initialLane = this.pathRuntime.lanesAt(this.note.startTime)[0];
      if (initialLane !== undefined) events.push(...this.pressLane(initialLane, this.note.startTime));
    }
    if (this.headResolved && chartTimeMs <= this.note.endTime) {
      this.pressedLanes.clear();
      for (const lane of this.pathRuntime.lanesAt(chartTimeMs)) this.pressedLanes.add(lane);
      if (this.pressedLanes.size > 0) {
        this.phaseValue = "holding";
        this.lostAtValue = null;
      }
    }
    return events;
  }

  /** Process all due ticks in time order. Call once per gameplay update. */
  update(chartTimeMs: number, autoConnected = false): MultiHoldRuntimeEvent[] {
    if (this.phaseValue === "finished") return [];
    const events: MultiHoldRuntimeEvent[] = [];
    // If the head window passed untouched, score the head as LOST once, then continue
    // emitting due internal ticks so remaining units can settle normally.
    if (!this.headResolved && this.phaseValue === "waiting" && chartTimeMs > this.note.startTime + this.headWindowMs) {
      const missTime = this.note.startTime + this.headWindowMs + 0.001;
      this.headResolved = true;
      this.phaseValue = "disconnected";
      this.lostAtValue = missTime;
      events.push({ noteId: this.note.id, type: "head", time: missTime, timingDeltaMs: this.headWindowMs + 1 });
    }
    if (!this.headResolved) return events;
    const tickEnd = Math.min(chartTimeMs, this.note.endTime);
    while (this.nextTickTime <= tickEnd) {
      const lanes = this.pathRuntime.lanesAt(this.nextTickTime);
      const connected = autoConnected || (this.pressedLanes.size > 0 && [...this.pressedLanes].some((lane) => lanes.includes(lane)));
      const grade = connected ? "PURE" : "LOST";
      events.push({ noteId: this.note.id, type: "tick", time: this.nextTickTime, grade, lanes });
      if (connected) {
        if (this.phaseValue !== "reconnected") this.phaseValue = "holding";
        this.lostAtValue = null;
      } else {
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
    } else if (this.phaseValue === "holding" && !this.hasCoveredPressedLane(chartTimeMs)) {
      this.phaseValue = "disconnected";
      this.lostAtValue ??= chartTimeMs;
    } else if (this.phaseValue === "reconnected" && this.hasCoveredPressedLane(chartTimeMs)) {
      this.phaseValue = "holding";
    }
    return events;
  }

  private hasCoveredPressedLane(time: number): boolean {
    const lanes = this.pathRuntime.lanesAt(Math.max(this.note.startTime, Math.min(this.note.endTime, time)));
    return [...this.pressedLanes].some((lane) => lanes.includes(lane));
  }
}
