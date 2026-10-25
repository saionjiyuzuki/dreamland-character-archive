import type { MultiHoldNote, PathSample } from "../chart/multiHoldSchema.js";

export type OccupationKind = "multiHold" | "hold" | "tap" | "multi";
export interface LaneOccupation {
  laneStart: number;
  laneEnd: number;
  startTime: number;
  endTime: number;
  sourceId: string;
  kind: OccupationKind;
}
export interface TapCandidate {
  id: string;
  lane: number;
  time: number;
  /** Optional visible lifetime for conservative visual-conflict checking. */
  visualStartTime?: number;
  visualEndTime?: number;
}
export interface HoldCandidate {
  id: string;
  laneStart: number;
  laneEnd: number;
  startTime: number;
  endTime: number;
}
export interface ConflictResolution {
  keptTaps: TapCandidate[];
  movedTaps: Array<{ id: string; fromLane: number; toLane: number }>;
  removedTaps: string[];
  holdConflicts: Array<{ multiHoldId: string; holdId: string; atTime: number }>;
}

export function buildMultiHoldOccupations(note: MultiHoldNote, samples: readonly PathSample[]): LaneOccupation[] {
  const result: LaneOccupation[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    result.push({
      laneStart: Math.min(a.leftLane, b.leftLane),
      laneEnd: Math.max(a.rightLane, b.rightLane),
      startTime: note.startTime + a.offsetMs,
      endTime: note.startTime + b.offsetMs,
      sourceId: note.id,
      kind: "multiHold"
    });
  }
  return result;
}

export function occupationsOverlap(a: LaneOccupation, b: LaneOccupation, epsilon = 1e-6): boolean {
  const timeOverlap = a.startTime <= b.endTime + epsilon && b.startTime <= a.endTime + epsilon;
  const laneOverlap = a.laneStart < b.laneEnd - epsilon && b.laneStart < a.laneEnd - epsilon;
  return timeOverlap && laneOverlap;
}

function tapOccupation(tap: TapCandidate, lane = tap.lane): LaneOccupation {
  return {
    laneStart: lane,
    laneEnd: lane + 1,
    startTime: tap.visualStartTime ?? tap.time,
    endTime: tap.visualEndTime ?? tap.time,
    sourceId: tap.id,
    kind: "tap"
  };
}

export function isTapConflicted(tap: TapCandidate, occupations: readonly LaneOccupation[], lane = tap.lane): boolean {
  const target = tapOccupation(tap, lane);
  return occupations.some((occupation) => occupation.sourceId !== tap.id && occupationsOverlap(target, occupation));
}

export function resolveMultiHoldConflicts(
  multiHoldOccupations: readonly LaneOccupation[],
  taps: readonly TapCandidate[],
  holds: readonly HoldCandidate[],
  laneCount: number | ((timeMs: number) => number)
): ConflictResolution {
  const keptTaps: TapCandidate[] = [];
  const movedTaps: ConflictResolution["movedTaps"] = [];
  const removedTaps: string[] = [];
  const holdConflicts: ConflictResolution["holdConflicts"] = [];

  for (const tap of taps) {
    if (!isTapConflicted(tap, multiHoldOccupations)) {
      keptTaps.push({ ...tap });
      continue;
    }

    const availableLanes = Math.max(1, Math.floor(typeof laneCount === 'function' ? laneCount(tap.time) : laneCount));
    const alternatives: number[] = [];
    for (let distance = 1; distance < availableLanes; distance++) {
      const left = tap.lane - distance;
      const right = tap.lane + distance;
      if (left >= 0 && left < availableLanes) alternatives.push(left);
      if (right < availableLanes) alternatives.push(right);
    }
    const safeLane = alternatives.find((lane) => !isTapConflicted(tap, multiHoldOccupations, lane));
    if (safeLane !== undefined) {
      keptTaps.push({ ...tap, lane: safeLane });
      movedTaps.push({ id: tap.id, fromLane: tap.lane, toLane: safeLane });
    } else {
      removedTaps.push(tap.id);
    }
  }

  for (const occupation of multiHoldOccupations) {
    for (const hold of holds) {
      if (occupation.sourceId === hold.id) continue;
      const holdOcc: LaneOccupation = {
        laneStart: hold.laneStart,
        laneEnd: hold.laneEnd,
        startTime: hold.startTime,
        endTime: hold.endTime,
        sourceId: hold.id,
        kind: "hold"
      };
      if (occupationsOverlap(occupation, holdOcc)) {
        const atTime = Math.max(occupation.startTime, hold.startTime);
        if (!holdConflicts.some((c) => c.multiHoldId === occupation.sourceId && c.holdId === hold.id)) {
          holdConflicts.push({ multiHoldId: occupation.sourceId, holdId: hold.id, atTime });
        }
      }
    }
  }

  return { keptTaps, movedTaps, removedTaps, holdConflicts };
}
