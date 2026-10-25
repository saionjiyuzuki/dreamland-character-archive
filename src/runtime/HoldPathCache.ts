import { sampleMultiHoldPath } from "../chart/holdPath.js";
import type { MultiHoldNote, PathSample } from "../chart/multiHoldSchema.js";

interface CacheEntry { signature: string; samples: PathSample[] }

export class HoldPathCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(note: MultiHoldNote, laneCount: number, sampleCount?: number): readonly PathSample[] {
    const signature = JSON.stringify({
      startTime: note.startTime,
      endTime: note.endTime,
      lanes: note.lanes,
      path: note.path ?? null,
      laneCount,
      sampleCount: sampleCount ?? null
    });
    const cached = this.entries.get(note.id);
    if (cached?.signature === signature) return cached.samples;
    const samples = sampleCount === undefined
      ? sampleMultiHoldPath(note, { laneCount })
      : sampleMultiHoldPath(note, { laneCount, sampleCount });
    this.entries.set(note.id, { signature, samples });
    return samples;
  }

  invalidate(noteId: string): void { this.entries.delete(noteId); }
  clear(): void { this.entries.clear(); }
  get size(): number { return this.entries.size; }
}
