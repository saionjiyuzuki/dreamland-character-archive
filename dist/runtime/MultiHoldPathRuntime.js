import { sampleMultiHoldAt } from "../chart/holdPath.js";
export class MultiHoldPathRuntime {
    note;
    samples;
    laneCountSource;
    constructor(note, samples, laneCountSource) {
        this.note = note;
        this.samples = samples;
        this.laneCountSource = laneCountSource;
        if (samples.length < 2)
            throw new Error(`Multi Hold ${note.id} requires at least two path samples`);
    }
    get laneCount() {
        return Math.max(1, Math.floor(typeof this.laneCountSource === "function" ? this.laneCountSource() : this.laneCountSource));
    }
    rangeAt(chartTimeMs) {
        const offset = Math.max(0, Math.min(this.note.endTime - this.note.startTime, chartTimeMs - this.note.startTime));
        const sample = sampleMultiHoldAt(this.samples, offset);
        return { leftLane: sample.leftLane, rightLane: sample.rightLane };
    }
    lanesAt(chartTimeMs) {
        const { leftLane, rightLane } = this.rangeAt(chartTimeMs);
        const lanes = [];
        for (let lane = 0; lane < this.laneCount; lane++) {
            // Half-open lane cells [lane, lane + 1] intersect the continuous hold span.
            if (lane + 1 > leftLane + 1e-6 && lane < rightLane - 1e-6)
                lanes.push(lane);
        }
        return lanes;
    }
    coversLane(lane, chartTimeMs) {
        return this.lanesAt(chartTimeMs).includes(lane);
    }
}
