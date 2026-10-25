const DEFAULT_WINDOWS = { pureMs: 40, greatMs: 80, farMs: 120 };
export function gradeMultiHoldHead(deltaMs, windows = DEFAULT_WINDOWS) {
    const abs = Math.abs(deltaMs);
    if (abs <= windows.pureMs)
        return "PURE";
    if (abs <= windows.greatMs)
        return "GREAT";
    if (abs <= windows.farMs)
        return "FAR";
    return "LOST";
}
/** Adapts MultiHoldRuntime events to the existing score/judge event shape. */
export function mapMultiHoldRuntimeEvent(event, windows = DEFAULT_WINDOWS) {
    switch (event.type) {
        case "head":
            return { noteId: event.noteId, kind: "head", time: event.time, grade: gradeMultiHoldHead(event.timingDeltaMs ?? Infinity, windows), ...(event.timingDeltaMs === undefined ? {} : { timingDeltaMs: event.timingDeltaMs }), comboUnit: true };
        case "tick":
            return { noteId: event.noteId, kind: "tick", time: event.time, grade: event.grade === "PURE" ? "PURE" : "LOST", comboUnit: true };
        case "reconnect":
            return { noteId: event.noteId, kind: "reconnect", time: event.time, comboUnit: false };
        case "finish":
            return { noteId: event.noteId, kind: "finish", time: event.time, comboUnit: false };
    }
}
