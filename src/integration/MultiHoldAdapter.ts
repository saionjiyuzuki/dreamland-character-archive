import type { MultiHoldNote, MultiHoldRuntimeEvent, MultiHoldProjector, MultiHoldPhase } from "../chart/multiHoldSchema.js";
import { MultiHoldRuntime, type MultiHoldRuntimeOptions } from "../runtime/MultiHoldRuntime.js";
import { HoldPathCache } from "../runtime/HoldPathCache.js";
import { MultiHoldRenderer, type MultiHoldDrawStats } from "../render/MultiHoldRenderer.js";
import { mapMultiHoldRuntimeEvent, type MultiHoldJudgeWindows, type NormalizedJudgeEvent } from "../judge/MultiHoldJudge.js";

export interface MultiHoldAdapterOptions extends MultiHoldRuntimeOptions {
  judgeWindows?: MultiHoldJudgeWindows;
  onJudgeEvent?: (event: NormalizedJudgeEvent) => void;
}

/** Composition root for adding Multi Hold to a host ChartRuntime/Judge/Renderer loop. */
export class MultiHoldAdapter {
  readonly runtime: MultiHoldRuntime;
  private readonly renderer = new MultiHoldRenderer();

  constructor(readonly note: MultiHoldNote, options: MultiHoldAdapterOptions, cache = new HoldPathCache()) {
    this.options = options;
    this.runtime = new MultiHoldRuntime(note, options, cache);
  }
  private readonly options: MultiHoldAdapterOptions;

  canAcceptLane(lane: number, chartTimeMs: number): boolean { return this.runtime.canAcceptLane(lane, chartTimeMs); }
  press(lane: number, chartTimeMs: number): MultiHoldRuntimeEvent[] {
    return this.dispatch(this.runtime.pressLane(lane, chartTimeMs));
  }
  moveLane(fromLane: number, toLane: number, chartTimeMs: number): MultiHoldRuntimeEvent[] {
    const events = this.runtime.moveLane(fromLane, toLane, chartTimeMs);
    // A pointer may move outside the ribbon and later re-enter from an unpressed lane.
    // In that case accept the destination through the same reconnect rules as a new press.
    if (!this.runtime.activePressedLanes.includes(toLane) && this.runtime.canAcceptLane(toLane, chartTimeMs)) {
      events.push(...this.runtime.pressLane(toLane, chartTimeMs));
    }
    return this.dispatch(events);
  }
  release(lane: number, chartTimeMs: number): void { this.runtime.releaseLane(lane, chartTimeMs); }
  autoMaintain(chartTimeMs: number): MultiHoldRuntimeEvent[] { return this.dispatch(this.runtime.autoMaintain(chartTimeMs)); }
  update(chartTimeMs: number, autoConnected = false): MultiHoldRuntimeEvent[] { return this.dispatch(this.runtime.update(chartTimeMs, autoConnected)); }

  draw(ctx: CanvasRenderingContext2D, projector: MultiHoldProjector, chartTimeMs: number, alpha = 1): MultiHoldDrawStats {
    const phase: MultiHoldPhase = this.runtime.phase;
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

  private dispatch(events: MultiHoldRuntimeEvent[]): MultiHoldRuntimeEvent[] {
    for (const event of events) this.options.onJudgeEvent?.(mapMultiHoldRuntimeEvent(event, this.options.judgeWindows));
    return events;
  }
}
