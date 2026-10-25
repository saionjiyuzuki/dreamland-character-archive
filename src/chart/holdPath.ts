import type { MultiHoldNote, MultiHoldPathPoint, PathSample } from "./multiHoldSchema.js";

export interface SamplePathOptions {
  laneCount: number;
  sampleCount?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function laneBounds(lanes: number[], laneCount: number): { left: number; right: number } {
  const normalized = [...new Set(lanes)]
    .filter(Number.isFinite)
    .map((lane) => clamp(Math.floor(lane), 0, laneCount - 1))
    .sort((a, b) => a - b);
  if (normalized.length === 0) return { left: 0, right: 1 };
  return {
    left: normalized[0] ?? 0,
    right: Math.min(laneCount, (normalized[normalized.length - 1] ?? 0) + 1)
  };
}

function normalizePathPoints(note: MultiHoldNote, laneCount: number): Array<{ time: number; left: number; right: number }> {
  const duration = Math.max(1, note.endTime - note.startTime);
  const source: MultiHoldPathPoint[] = note.path?.points?.length
    ? note.path.points
    : [{ time: 0, lanes: note.lanes }, { time: duration, lanes: note.lanes }];

  const points = source
    .filter((point) => Number.isFinite(point.time) && (
      (Number.isFinite(point.leftLane) && Number.isFinite(point.rightLane)) ||
      (Number.isFinite(point.centerLane) && Number.isFinite(point.width)) ||
      (Array.isArray(point.lanes) && point.lanes.length > 0)
    ))
    .map((point) => {
      let left: number, right: number;
      if (Number.isFinite(point.leftLane) && Number.isFinite(point.rightLane)) {
        left = Number(point.leftLane);
        right = Number(point.rightLane);
      } else if (Number.isFinite(point.centerLane) && Number.isFinite(point.width)) {
        const width = Math.max(0.5, Number(point.width));
        left = Number(point.centerLane) - width / 2;
        right = Number(point.centerLane) + width / 2;
      } else {
        const bounds = laneBounds(point.lanes || [], laneCount);
        left = bounds.left;
        right = bounds.right;
      }
      // A variable-width Multi Hold may narrow below one lane, but never collapse to zero.
      const width = Math.max(0.5, right - left);
      left = clamp((left + right - width) / 2, 0, laneCount - width);
      right = left + width;
      if (right > laneCount) { right = laneCount; left = Math.max(0, right - width); }
      return { time: clamp(point.time, 0, duration), left, right };
    })
    .sort((a, b) => a.time - b.time);

  if (points.length === 0) {
    const bounds = laneBounds(note.lanes, laneCount);
    return [
      { time: 0, left: bounds.left, right: Math.max(bounds.left + 1, bounds.right) },
      { time: duration, left: bounds.left, right: Math.max(bounds.left + 1, bounds.right) }
    ];
  }

  const deduped: typeof points = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.time - point.time) < 0.001) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  if ((deduped[0]?.time ?? 0) > 0) deduped.unshift({ ...deduped[0]!, time: 0 });
  if ((deduped[deduped.length - 1]?.time ?? duration) < duration) {
    deduped.push({ ...deduped[deduped.length - 1]!, time: duration });
  }
  if (deduped.length === 1) deduped.push({ ...deduped[0]!, time: duration });
  return deduped;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function interpolateKeyframes(points: ReturnType<typeof normalizePathPoints>, time: number): { left: number; right: number } {
  if (time <= (points[0]?.time ?? 0)) return { left: points[0]!.left, right: points[0]!.right };
  const final = points[points.length - 1]!;
  if (time >= final.time) return { left: final.left, right: final.right };

  let i = 0;
  while (i < points.length - 2 && time > points[i + 1]!.time) i++;
  const p1 = points[i]!;
  const p2 = points[i + 1]!;
  const p0 = points[Math.max(0, i - 1)]!;
  const p3 = points[Math.min(points.length - 1, i + 2)]!;
  const span = Math.max(0.001, p2.time - p1.time);
  const u = clamp((time - p1.time) / span, 0, 1);
  return {
    left: catmull(p0.left, p1.left, p2.left, p3.left, u),
    right: catmull(p0.right, p1.right, p2.right, p3.right, u)
  };
}

/** Samples a Multi Hold path once. All y/projection work remains in the renderer. */
export function sampleMultiHoldPath(note: MultiHoldNote, options: SamplePathOptions): PathSample[] {
  const duration = Math.max(1, note.endTime - note.startTime);
  const laneCount = Math.max(1, Math.floor(options.laneCount));
  const sampleCount = clamp(Math.floor(options.sampleCount ?? Math.ceil(duration / 40)), 24, 240);
  const keyframes = normalizePathPoints(note, laneCount);
  const samples: PathSample[] = [];

  for (let i = 0; i <= sampleCount; i++) {
    const offsetMs = duration * (i / sampleCount);
    const range = interpolateKeyframes(keyframes, offsetMs);
    let leftLane = clamp(range.left, 0, laneCount - 1);
    let rightLane = clamp(range.right, leftLane + 1, laneCount);
    if (rightLane - leftLane < 1) {
      leftLane = clamp((leftLane + rightLane) / 2 - 0.5, 0, laneCount - 1);
      rightLane = Math.min(laneCount, leftLane + 1);
    }
    samples.push({ offsetMs, leftLane, rightLane });
  }
  return samples;
}

export function sampleMultiHoldAt(samples: readonly PathSample[], offsetMs: number): PathSample {
  if (samples.length === 0) throw new Error("Multi Hold path has no samples");
  if (offsetMs <= samples[0]!.offsetMs) return { ...samples[0]! };
  if (offsetMs >= samples[samples.length - 1]!.offsetMs) return { ...samples[samples.length - 1]! };
  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid]!.offsetMs < offsetMs) low = mid;
    else high = mid;
  }
  const a = samples[low]!;
  const b = samples[high]!;
  const span = Math.max(0.001, b.offsetMs - a.offsetMs);
  const t = clamp((offsetMs - a.offsetMs) / span, 0, 1);
  return {
    offsetMs,
    leftLane: a.leftLane + (b.leftLane - a.leftLane) * t,
    rightLane: a.rightLane + (b.rightLane - a.rightLane) * t
  };
}
