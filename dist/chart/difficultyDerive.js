export const DERIVE_PROFILES = {
    EZ: { gapBeats: 1, gapFloorMs: 430, minWeight: 2, chordWeight: null, holdMinMs: 600, holdMaxMs: 2200, slides: false, jackMs: 0, level: [1, 5] },
    HD: { gapBeats: .5, gapFloorMs: 225, minWeight: 1, chordWeight: 4, holdMinMs: 380, holdMaxMs: 2600, slides: false, jackMs: 340, level: [5, 10] },
    EX: { gapBeats: .25, gapFloorMs: 118, minWeight: 1, chordWeight: 3, holdMinMs: 300, holdMaxMs: 3000, slides: true, jackMs: 230, level: [9, 14] },
};
const HAND_GAP_MS = 170, LEAD_IN_MS = 600, GRID_TOLERANCE_MS = 18, GAP_SLACK_MS = 8, LANES = 4;
function lanesAt(chart, ms) {
    const secs = chart.laneSections || [];
    const s = ms / 1000;
    for (const sec of secs)
        if (s >= sec[0] && s < sec[1])
            return sec[2];
    return secs.length ? secs[secs.length - 1][2] : chart.lanes || LANES;
}
/** Groups the SP notes into onsets (notes closer than 12ms are one onset). */
function collectOnsets(chart) {
    const raw = [];
    for (const n of chart.notes) {
        if (Array.isArray(n)) {
            const [t, kind, lane, dur, , path] = n, K = lanesAt(chart, t);
            const end = path?.length ? path[path.length - 1][1] : lane;
            raw.push({ t, lane: lane + .5, K, hold: kind === 'hold' ? dur : 0, slide: Math.sign(end - lane) });
        }
        else if (n && n.type === 'multiHold') {
            const K = lanesAt(chart, n.startTime), lanes = n.lanes.length ? n.lanes : [0];
            const pts = n.path?.points || [], last = pts[pts.length - 1]?.lanes || lanes;
            const mid = (ls) => (Math.min(...ls) + Math.max(...ls) + 1) / 2;
            raw.push({ t: n.startTime, lane: mid(lanes), K, hold: n.endTime - n.startTime, slide: Math.sign(mid(last) - mid(lanes)) });
        }
    }
    raw.sort((a, b) => a.t - b.t);
    const out = [];
    for (let i = 0; i < raw.length;) {
        let j = i;
        while (j < raw.length && raw[j].t - raw[i].t < 12)
            j++;
        const g = raw.slice(i, j), longest = g.reduce((a, b) => (b.hold > a.hold ? b : a));
        out.push({ t: Math.round(g[0].t), size: g.length, hold: longest.hold, pos: g.reduce((s, x) => s + x.lane / x.K, 0) / g.length, slide: longest.slide, weight: 0 });
        i = j;
    }
    return out;
}
/** Finds the grid, the beat and the downbeat from the onsets themselves (SP charts sit on 16th / 32nd onsets). */
function weighOnsets(onsets, bpm, firstBeatMs) {
    const beat = 60000 / bpm, s32 = beat / 8;
    const dev = (t, o) => Math.abs(t - (o + Math.round((t - o) / s32) * s32));
    const strength = (x) => x.size + (x.hold ? 1 : 0);
    // Strongest of n rotations of a grid with the given unit, e.g. which 32nd of eight is the beat.
    const rotation = (list, unit, base, n) => {
        const score = new Array(n).fill(0);
        for (const x of list)
            score[((Math.round((x.t - base) / unit) % n) + n) % n] += strength(x);
        return score.indexOf(Math.max(...score));
    };
    let beatPhase = Number(firstBeatMs);
    if (!Number.isFinite(beatPhase)) {
        let phase = 0, best = -1;
        for (let o = 0; o < s32; o++) {
            const hits = onsets.reduce((n, x) => n + (dev(x.t, o) < GRID_TOLERANCE_MS ? 1 : 0), 0);
            if (hits > best) {
                best = hits;
                phase = o;
            }
        }
        beatPhase = phase + rotation(onsets.filter(x => dev(x.t, phase) < GRID_TOLERANCE_MS), s32, phase, 8) * s32;
    }
    for (const x of onsets) {
        if (dev(x.t, beatPhase) >= GRID_TOLERANCE_MS) {
            x.weight = 0;
            continue;
        }
        const k = ((Math.round((x.t - beatPhase) / s32) % 8) + 8) % 8;
        x.weight = k === 0 ? 3 : k === 4 ? 2 : 1;
    }
    const beats = onsets.filter(x => x.weight === 3), bar = rotation(beats, beat, beatPhase, 4);
    for (const x of beats)
        if (((Math.round((x.t - beatPhase) / beat) % 4) + 4) % 4 === bar)
            x.weight = 4;
}
/** Accepts the strongest onsets first so thinning keeps the downbeats and accents, then restores time order. */
function thin(onsets, minGap, minWeight) {
    const rank = (x) => x.weight * 10 + Math.min(4, x.size) * 3 + (x.hold ? 4 : 0);
    const pool = onsets.filter(x => x.weight >= minWeight && x.t >= LEAD_IN_MS).sort((a, b) => rank(b) - rank(a) || a.t - b.t);
    const taken = [];
    const fits = (t) => {
        let lo = 0, hi = taken.length;
        while (lo < hi) {
            const m = (lo + hi) >> 1;
            if (taken[m] < t)
                lo = m + 1;
            else
                hi = m;
        }
        return (lo === 0 || t - taken[lo - 1] >= minGap) && (lo === taken.length || taken[lo] - t >= minGap);
    };
    const keep = [];
    for (const x of pool)
        if (fits(x.t)) {
            keep.push(x);
            let i = taken.findIndex(v => v > x.t);
            if (i < 0)
                i = taken.length;
            taken.splice(i, 0, x.t);
        }
    return keep.sort((a, b) => a.t - b.t);
}
export function deriveChart(sp, key, id) {
    const P = DERIVE_PROFILES[key];
    const onsets = collectOnsets(sp);
    weighOnsets(onsets, sp.bpm, sp.backdrop?.firstBeatMs);
    const beat = 60000 / sp.bpm;
    // Note times are whole milliseconds on a fractional grid, so a gap of exactly one grid step may read 1ms short.
    const picked = thin(onsets, Math.max(P.gapFloorMs, beat * P.gapBeats) - GAP_SLACK_MS, P.minWeight);
    const hand = [{ end: -1e9, lane: -1, t: -1e9 }, { end: -1e9, lane: -1, t: -1e9 }];
    const notes = [];
    let lastHand = 1, lastT = -1e9;
    const free = (h, t) => t - hand[h].end >= HAND_GAP_MS;
    const laneFor = (h, t, pos) => {
        const pair = [h * 2, h * 2 + 1], want = Math.min(LANES - 1, Math.max(0, Math.floor(pos * LANES)));
        let lane = pair.includes(want) ? want : pair[want < pair[0] ? 0 : 1];
        if (P.jackMs && hand[h].lane === lane && t - hand[h].t < P.jackMs)
            lane = pair[0] + pair[1] - lane;
        return lane;
    };
    const place = (h, t, lane, hold, slide) => {
        if (hold > 0) {
            const other = h * 2 + (lane % 2 ? 0 : 1);
            const path = P.slides && slide && hold >= 600 ? [[0, lane], [Math.round(hold / 2), other], [hold, lane]] : [[0, lane], [hold, lane]];
            notes.push([t, 'hold', lane, hold, Math.max(1, Math.round(hold / 180)), path]);
            hand[h] = { end: t + hold, lane: path[path.length - 1][1], t };
        }
        else {
            notes.push([t, 'tap', lane, 0, 0]);
            hand[h] = { end: t, lane, t };
        }
    };
    for (let i = 0; i < picked.length; i++) {
        const x = picked[i], next = picked[i + 1];
        const preferred = x.pos < .5 ? 0 : 1;
        // Fast passages alternate hands; slow ones follow the melodic contour of the SP chart.
        const order = x.t - lastT < 260 ? [1 - lastHand, lastHand] : [preferred, 1 - preferred];
        const h = order.find(c => free(c, x.t));
        if (h === undefined)
            continue;
        // A hold must release HAND_GAP_MS before that hand is needed again; otherwise it stays a tap.
        let hold = x.hold >= P.holdMinMs ? Math.min(P.holdMaxMs, x.hold) : 0;
        if (hold && next && next.t - (x.t + hold) < HAND_GAP_MS && !free(1 - h, next.t))
            hold = Math.max(0, next.t - x.t - HAND_GAP_MS);
        if (hold && hold < P.holdMinMs)
            hold = 0;
        hold = Math.round(hold);
        place(h, x.t, laneFor(h, x.t, x.pos), hold, x.slide);
        lastHand = h;
        lastT = x.t;
        if (P.chordWeight !== null && x.size >= 2 && x.weight >= P.chordWeight && free(1 - h, x.t)) {
            place(1 - h, x.t, laneFor(1 - h, x.t, 1 - x.pos), 0, 0);
        }
    }
    const chart = {
        id, title: sp.title, artist: sp.artist, bpm: sp.bpm, diff: 0, jacket: sp.jacket, lanes: LANES,
        sourceAudio: sp.sourceAudio, duration: sp.duration, notes, songId: sp.songId, difficulty: key,
    };
    if (sp.backdrop)
        chart.backdrop = sp.backdrop;
    chart.diff = rateLevel(chart, P.level);
    return chart;
}
/** Notes per second, overall and over the densest 8 seconds. */
export function chartDensity(chart) {
    const heads = chart.notes.map(n => (Array.isArray(n) ? n[0] : n.startTime)).sort((a, b) => a - b);
    if (heads.length < 2)
        return { avg: 0, peak: 0, count: heads.length };
    let peak = 0;
    for (let i = 0, j = 0; i < heads.length; i++) {
        while (heads[i] - heads[j] > 8000)
            j++;
        peak = Math.max(peak, (i - j + 1) / 8);
    }
    return { avg: heads.length / ((heads[heads.length - 1] - heads[0]) / 1000), peak, count: heads.length };
}
/** Maps density onto the level band of the difficulty: about 0.8 nps per level, peaks count 40%. */
function rateLevel(chart, [lo, hi]) {
    const { avg, peak } = chartDensity(chart);
    const rating = .6 * avg + .4 * peak;
    return Math.max(lo, Math.min(hi, Math.round(rating / .8 + lo * .6)));
}
