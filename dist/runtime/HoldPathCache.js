import { sampleMultiHoldPath } from "../chart/holdPath.js";
export class HoldPathCache {
    entries = new Map();
    get(note, laneCount, sampleCount) {
        const signature = JSON.stringify({
            startTime: note.startTime,
            endTime: note.endTime,
            lanes: note.lanes,
            path: note.path ?? null,
            laneCount,
            sampleCount: sampleCount ?? null
        });
        const cached = this.entries.get(note.id);
        if (cached?.signature === signature)
            return cached.samples;
        const samples = sampleCount === undefined
            ? sampleMultiHoldPath(note, { laneCount })
            : sampleMultiHoldPath(note, { laneCount, sampleCount });
        this.entries.set(note.id, { signature, samples });
        return samples;
    }
    invalidate(noteId) { this.entries.delete(noteId); }
    clear() { this.entries.clear(); }
    get size() { return this.entries.size; }
}
