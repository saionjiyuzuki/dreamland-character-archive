export interface MultiHoldPathPoint {
  /** Offset in milliseconds from note.startTime. */
  time: number;
  /** Legacy form: zero-based lane indices. Occupied range is min(lanes) .. max(lanes)+1. */
  lanes?: number[];
  /** Optional continuous left edge in lane-boundary coordinates. */
  leftLane?: number;
  /** Optional continuous right edge in lane-boundary coordinates. */
  rightLane?: number;
  /** Optional width in lane units; can be combined with centerLane. */
  width?: number;
  /** Optional center in lane-boundary coordinates; used with width. */
  centerLane?: number;
}

export interface MultiHoldPath {
  points: MultiHoldPathPoint[];
}

export interface MultiHoldNote {
  id: string;
  type: "multiHold";
  /** Initial occupied lanes. Used when path is omitted and to preserve existing chart semantics. */
  lanes: number[];
  startTime: number;
  endTime: number;
  path?: MultiHoldPath;
  tickIntervalMs?: number;
}

export interface PathSample {
  /** Offset in milliseconds from note.startTime. */
  offsetMs: number;
  /** Continuous lane-edge coordinates. A lane spans [lane, lane + 1]. */
  leftLane: number;
  rightLane: number;
}

export type MultiHoldPhase = "waiting" | "holding" | "disconnected" | "reconnected" | "finished";
export type HoldTickGrade = "PURE" | "LOST";
export type HeadGrade = "PURE" | "GREAT" | "FAR" | "LOST";

export interface HoldTickEvent {
  noteId: string;
  type: "tick";
  time: number;
  grade: HoldTickGrade;
  lanes: number[];
}

export interface MultiHoldRuntimeEvent {
  noteId: string;
  type: "head" | "reconnect" | "tick" | "finish";
  time: number;
  lane?: number;
  timingDeltaMs?: number;
  grade?: HeadGrade | HoldTickGrade;
  lanes?: number[];
}

export interface LaneProjectionPoint {
  x: number;
  y: number;
}

export type MultiHoldProjector = (laneBoundary: number, chartTimeMs: number) => LaneProjectionPoint;
