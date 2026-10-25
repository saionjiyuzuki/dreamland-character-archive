export class HoldVisualEffectManager {
    ttlMs;
    minPureSpacingMs;
    feedback = [];
    lastPureFeedbackAt = Number.NEGATIVE_INFINITY;
    constructor(ttlMs = 420, minPureSpacingMs = 250) {
        this.ttlMs = ttlMs;
        this.minPureSpacingMs = minPureSpacingMs;
    }
    addTick(noteId, grade, time, x, y) {
        if (grade === "PURE" && time - this.lastPureFeedbackAt < this.minPureSpacingMs)
            return null;
        if (grade === "PURE")
            this.lastPureFeedbackAt = time;
        const item = {
            id: `${noteId}:tick:${time}`,
            text: grade === "PURE" ? "PERFECT" : "LOST",
            grade, x, y, bornAt: time, expiresAt: time + this.ttlMs
        };
        this.feedback.push(item);
        return item;
    }
    activeAt(time) {
        for (let i = this.feedback.length - 1; i >= 0; i--) {
            if (this.feedback[i].expiresAt <= time)
                this.feedback.splice(i, 1);
        }
        return this.feedback;
    }
    clear() { this.feedback.length = 0; this.lastPureFeedbackAt = Number.NEGATIVE_INFINITY; }
}
