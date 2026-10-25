export interface HoldTickFeedback {
  id: string;
  text: "PERFECT" | "LOST";
  grade: "PURE" | "LOST";
  x: number;
  y: number;
  bornAt: number;
  expiresAt: number;
}

export class HoldVisualEffectManager {
  private readonly feedback: HoldTickFeedback[] = [];
  private lastPureFeedbackAt = Number.NEGATIVE_INFINITY;
  constructor(private readonly ttlMs = 420, private readonly minPureSpacingMs = 250) {}

  addTick(noteId: string, grade: "PURE" | "LOST", time: number, x: number, y: number): HoldTickFeedback | null {
    if (grade === "PURE" && time - this.lastPureFeedbackAt < this.minPureSpacingMs) return null;
    if (grade === "PURE") this.lastPureFeedbackAt = time;
    const item: HoldTickFeedback = {
      id: `${noteId}:tick:${time}`,
      text: grade === "PURE" ? "PERFECT" : "LOST",
      grade, x, y, bornAt: time, expiresAt: time + this.ttlMs
    };
    this.feedback.push(item);
    return item;
  }

  activeAt(time: number): readonly HoldTickFeedback[] {
    for (let i = this.feedback.length - 1; i >= 0; i--) {
      if (this.feedback[i]!.expiresAt <= time) this.feedback.splice(i, 1);
    }
    return this.feedback;
  }

  clear(): void { this.feedback.length = 0; this.lastPureFeedbackAt = Number.NEGATIVE_INFINITY; }
}
