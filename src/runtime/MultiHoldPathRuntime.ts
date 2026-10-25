import { sampleMultiHoldAt } from "../chart/holdPath.js";
import type { MultiHoldNote, PathSample } from "../chart/multiHoldSchema.js";

export interface LaneRange { leftLane: number; rightLane: number }

export class MultiHoldPathRuntime {
  constructor(
    readonly note: MultiHoldNote,
    readonly samples: readonly PathSample[],
    private readonly laneCountSource: number | (() => number)
  ) {
    if (samples.length < 2) throw new Error(`Multi Hold ${note.id} requires at least two path samples`);
  }

  get laneCount(): number {
    return Math.max(1, Math.floor(typeof this.laneCountSource === "function" ? this.laneCountSource() : this.laneCountSource));
  }

  rangeAt(chartTimeMs: number): LaneRange {
    const offset = Math.max(0, Math.min(this.note.endTime - this.note.startTime, chartTimeMs - this.note.startTime));
    const sample = sampleMultiHoldAt(this.samples, offset);
    return { leftLane: sample.leftLane, rightLane: sample.rightLane };
  }

  lanesAt(chartTimeMs: number): number[] {
    const { leftLane, rightLane } = this.rangeAt(chartTimeMs);
    const lanes: number[] = [];
    for (let lane = 0; lane < this.laneCount; lane++) {
      // Half-open lane cells [lane, lane + 1] intersect the continuous hold span.
      if (lane + 1 > leftLane + 1e-6 && lane < rightLane - 1e-6) lanes.push(lane);
    }
    return lanes;
  }

  coversLane(lane: number, chartTimeMs: number): boolean {
    return this.lanesAt(chartTimeMs).includes(lane);
  }
}
