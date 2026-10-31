/** Chart editor page (editor.html): wires the model, view and audio to the DOM. */
import { CHARTS } from '../data/charts.js';
import { AUDIO_SOURCES_TEST } from '../data/audioMap.js';
import { defaultKeyMapForLanes } from '../settings/settingsController.js';
import { SNAP_DIVISORS, TICKS_PER_BEAT, TimingMap, divisorTicks, formatPosition, parsePosition } from './timing.js';
import { LANE_OPTIONS, emptyProject, exportChartWithTiming, importChart, lanesAt, noteEnd, noteStart, parseProjectJSON, playtestChart, sectionIndex, sortSections, } from './chartModel.js';
import { EditorAudio } from './editorAudio.js';
import { ChartView } from './editorView.js';
import { History, addNote, checkProject, headRange, insertKeyframe, makeHold, makeMulti, makeTap, mirrored, pasteNotes, quantized, removeNotes, replaceNotes, setSection, shifted, withEnd, withKeyframe, withoutKeyframe, } from './editOps.js';
import { AUTOSAVE_KEY, PLAYTEST_KEY, encodeWav, loadAudio, saveAudio, savePlaytestAudio } from './audioStore.js';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clone = (v) => JSON.parse(JSON.stringify(v));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const fmtTime = (ms) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, '0')}`; };
const canvas = $('cv');
const view = new ChartView(canvas);
const audio = new EditorAudio();
const history = new History();
let project = emptyProject();
let map = new TimingMap(project.timing);
let tool = 'select';
let snapDiv = 16, snapOn = true, edgeSnap = 2, showWave = true, hitsOn = true, metroOn = false;
let clip = [];
let dirty = false;
/** Position playback started from (Shift+Space returns there). */
let playFrom = 0;
let issues = [];
const st = {
    project, map, sections: sortSections(project.sections), timeMs: 0, pxPerMs: 0.35, snap: snapDiv, selected: new Set(),
    overrides: new Map(), ghosts: [], marquee: null, hoverTick: null, hoverLane: null, peaks: new Float32Array(0), peakMs: audio.peakMs, flashes: [],
};
/* ───────────── model changes ───────────── */
function syncDerived() {
    map = new TimingMap(project.timing);
    st.project = project;
    st.map = map;
    st.sections = sortSections(project.sections);
    for (const id of [...st.selected])
        if (!project.notes.some(n => n.id === id))
            st.selected.delete(id);
}
/** Every edit goes through here: one undo step, then derived state, panels and autosave. */
function commit(label, fn) {
    const before = clone(project);
    fn(project);
    if (JSON.stringify(before) === JSON.stringify(project))
        return;
    history.push(before);
    changed(label);
}
function changed(label) {
    syncDerived();
    dirty = true;
    issues = checkProject(project);
    renderPanels();
    updateStatus(label);
    scheduleAutosave();
}
function setProject(p, label, keepHistory = false) {
    if (audio.isPlaying)
        stopPlayback();
    if (!keepHistory)
        history.clear();
    project = p;
    st.selected.clear();
    st.overrides.clear();
    st.ghosts = [];
    syncDerived();
    issues = checkProject(project);
    st.timeMs = clamp(st.timeMs, minMs(), endMs());
    renderAll();
    updateStatus(label);
}
function undo() { const p = history.undo(project); if (p) {
    project = p;
    changed('撤销');
} }
function redo() { const p = history.redo(project); if (p) {
    project = p;
    changed('重做');
} }
const endMs = () => project.meta.duration * 1000;
const minMs = () => Math.min(0, project.timing.offsetMs) - 2000;
const curTick = () => map.msToTick(st.timeMs);
const kAt = (tick) => lanesAt(st.sections, tick);
const selectedNotes = () => project.notes.filter(n => st.selected.has(n.id));
/* ───────────── autosave ───────────── */
let saveTimer = 0;
function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project, timeMs: st.timeMs, savedAt: Date.now() }));
            dirty = false;
            updateStatus();
        }
        catch {
            toast('自动保存失败：浏览器存储空间不足');
        }
    }, 3000);
}
window.addEventListener('beforeunload', e => {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ project, timeMs: st.timeMs, savedAt: Date.now() }));
        dirty = false;
    }
    catch { /* keep the prompt */ }
    if (dirty)
        e.preventDefault();
});
/* ───────────── toast / status ───────────── */
let toastTimer = 0;
function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
}
let lastAction = '';
function updateStatus(label) {
    if (label)
        lastAction = label;
    const t = curTick(), pos = map.position(Math.floor(t)), counts = { tap: 0, hold: 0, multi: 0 };
    for (const n of project.notes)
        counts[n.kind]++;
    const errs = issues.filter(i => i.level === 'error').length, warns = issues.length - errs;
    $('status').innerHTML = [
        `<span>位置 <b class="mono">${formatPosition(pos)}</b></span>`,
        `<span>BPM <b>${+map.bpmAt(Math.max(0, t)).toFixed(3)}</b> · ${pos.beats}/4</span>`,
        `<span><b>${kAt(Math.max(0, t))}K</b></span>`,
        `<span>细分 <b>1/${snapDiv}</b>${snapOn ? '' : ' (关)'}</span>`,
        `<span>音符 <b>${project.notes.length}</b> (Tap ${counts.tap} · Hold ${counts.hold} · Multi ${counts.multi})</span>`,
        `<span>选中 <b>${st.selected.size}</b></span>`,
        `<span style="color:${errs ? 'var(--err)' : warns ? 'var(--warn)' : 'var(--ok)'}">${errs ? `${errs} 个错误` : '无错误'}${warns ? ` · ${warns} 个警告` : ''}</span>`,
        `<span>${dirty ? '未保存' : '已自动保存'}</span>`,
        lastAction ? `<span>${esc(lastAction)}</span>` : '',
    ].join('');
    ($('btnUndo')).disabled = !history.canUndo;
    ($('btnRedo')).disabled = !history.canRedo;
}
/* ───────────── playback ───────────── */
function clicksBetween(fromMs, toMs) {
    const out = [];
    if (hitsOn)
        for (const n of project.notes) {
            const ms = map.tickToMs(noteStart(n));
            if (ms > fromMs && ms <= toMs)
                out.push({ ms, kind: 'hit' });
        }
    if (metroOn) {
        const a = Math.ceil(map.msToTick(fromMs) / TICKS_PER_BEAT - 1e-6), b = Math.floor(map.msToTick(toMs) / TICKS_PER_BEAT + 1e-6);
        for (let beat = a; beat <= b; beat++) {
            const t = beat * TICKS_PER_BEAT, ms = map.tickToMs(t);
            if (ms <= fromMs || ms > toMs)
                continue;
            out.push({ ms, kind: map.position(t).beat === 0 && map.position(t).tick === 0 ? 'bar' : 'beat' });
        }
    }
    return out;
}
async function startPlayback() {
    playFrom = st.timeMs;
    await audio.play(st.timeMs);
    $('btnPlay').textContent = '⏸';
}
function stopPlayback(returnToStart = false) {
    audio.stop();
    st.timeMs = returnToStart ? playFrom : audio.positionMs();
    $('btnPlay').textContent = '▶';
    // Snap the paused playhead onto the grid so placement by keyboard lands on a grid point.
    if (!returnToStart && snapOn)
        st.timeMs = map.tickToMs(map.snap(curTick(), snapDiv));
    st.flashes = [];
    updateStatus();
}
function togglePlay(returnToStart = false) { if (audio.isPlaying)
    stopPlayback(returnToStart);
else
    void startPlayback(); }
function seekMs(ms) {
    const t = clamp(ms, minMs(), endMs());
    if (audio.isPlaying)
        void audio.play(t);
    else
        st.timeMs = t;
    st.timeMs = t;
    updateStatus();
}
const seekTick = (tick) => seekMs(map.tickToMs(tick));
function stepGrid(dir, div = snapDiv) { seekTick(map.step(curTick(), div, dir)); }
function stepBar(dir) {
    const t = curTick(), bar = map.barOf(t), start = map.barStart(bar);
    seekTick(dir > 0 ? map.barStart(bar + 1) : t - start > 0.5 ? start : map.barStart(bar - 1));
}
let lastFlashMs = -Infinity;
function frame() {
    if (audio.isPlaying) {
        audio.pump(clicksBetween);
        const pos = audio.positionMs();
        // Lane flashes for notes crossing the judge line
        for (const n of project.notes) {
            const ms = map.tickToMs(noteStart(n));
            if (ms > lastFlashMs && ms <= pos) {
                const [l, r] = headRange(n);
                st.flashes.push({ ms, left: l, right: r, k: kAt(noteStart(n)) });
            }
        }
        st.flashes = st.flashes.filter(f => pos - f.ms < 200);
        lastFlashMs = pos;
        st.timeMs = pos;
        if (pos >= endMs())
            stopPlayback();
        if (Math.floor(pos / 100) !== Math.floor(lastStatusMs / 100)) {
            lastStatusMs = pos;
            updateStatus();
        }
    }
    else
        lastFlashMs = st.timeMs;
    updateTransport();
    st.snap = snapDiv;
    st.peaks = showWave ? audio.peaks : new Float32Array(0);
    view.draw(st);
    requestAnimationFrame(frame);
}
let lastStatusMs = 0;
function updateTransport() {
    $('txtTime').textContent = fmtTime(st.timeMs);
    const inp = $('inpPos');
    if (document.activeElement !== inp)
        inp.value = formatPosition(map.position(Math.floor(curTick())));
    const r = $('rngSeek');
    if (document.activeElement !== r)
        r.value = String(Math.round((st.timeMs / Math.max(1, endMs())) * 1000));
}
let drag = null;
function rawTickAtY(y) { return map.msToTick(view.msOfY(st, y)); }
function tickAtY(y) { const t = rawTickAtY(y); return snapOn ? map.snap(t, snapDiv) : Math.round(t); }
function laneAtX(x, k) { return clamp(Math.floor(view.edgeOfX(x, k)), 0, k - 1); }
function edgeAtX(x, k) {
    const e = clamp(view.edgeOfX(x, k), 0, k);
    return edgeSnap ? Math.round(e * edgeSnap) / edgeSnap : Math.round(e * 100) / 100;
}
const minLen = () => divisorTicks(snapOn ? snapDiv : 64);
function pt(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function multiGhost(d, x, y) {
    const t1 = tickAtY(y), k = kAt(d.tick), e1 = edgeAtX(x, k);
    let left = Math.min(d.edge, e1), right = Math.max(d.edge, e1);
    if (edgeSnap === 1 || right - left < 1) {
        // Lane-sized range: from the lane under the press to the lane under the cursor.
        const a = Math.min(laneAtX(view.xOfEdge(d.edge, k) + 1e-3, k), laneAtX(x, k)), b = Math.max(laneAtX(view.xOfEdge(d.edge, k) + 1e-3, k), laneAtX(x, k));
        if (right - left < 1) {
            left = a;
            right = b + 1;
        }
    }
    if (right - left < 1)
        right = Math.min(k, left + 1);
    return makeMulti(d.tick, t1 > d.tick ? t1 : d.tick + minLen(), left, right);
}
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
    canvas.focus();
    const { x, y } = pt(e), hit = view.hitTest(st, x, y);
    if (e.button === 2) {
        if (hit)
            commit('删除音符', p => { removeNotes(p, new Set([hit.note.id])); });
        return;
    }
    if (e.button !== 0)
        return;
    canvas.setPointerCapture(e.pointerId);
    if (tool === 'erase') {
        drag = { kind: 'erase', before: clone(project), removed: 0 };
        eraseAt(x, y);
        return;
    }
    if (hit) {
        beginHit(hit, x, y, e);
        return;
    }
    if (!view.inLanes(x)) {
        // Outside the lanes: drag to scrub
        drag = null;
        seekTick(tickAtY(y));
        return;
    }
    const tick = tickAtY(y), k = kAt(tick);
    if (tool === 'tap') {
        const n = makeTap(tick, laneAtX(x, k));
        commit('放置 Tap', p => { addNote(p, n); });
        st.selected = new Set([n.id]);
        renderPanels();
        return;
    }
    if (tool === 'hold') {
        drag = { kind: 'hold', tick, lane: laneAtX(x, k) };
        st.ghosts = [makeHold(tick, tick + minLen(), laneAtX(x, k))];
        return;
    }
    if (tool === 'multi') {
        drag = { kind: 'multi', tick, edge: edgeAtX(x, k) };
        st.ghosts = [multiGhost(drag, x, y)];
        return;
    }
    // select tool on empty space: marquee
    const base = e.shiftKey || e.ctrlKey || e.metaKey ? new Set(st.selected) : new Set();
    if (!base.size)
        st.selected.clear();
    drag = { kind: 'marquee', base };
    st.marquee = { x0: x, y0: y, x1: x, y1: y };
    renderPanels();
});
function beginHit(hit, x, y, e) {
    const id = hit.note.id;
    if (hit.part === 'kf') {
        drag = { kind: 'kf', note: hit.note, index: hit.index, edge: hit.edge || 'lane' };
        return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (st.selected.has(id))
            st.selected.delete(id);
        else
            st.selected.add(id);
        renderPanels();
        updateStatus();
        return;
    }
    if (!st.selected.has(id))
        st.selected = new Set([id]);
    const k = kAt(noteStart(hit.note));
    drag = { kind: 'move', origin: { tick: rawTickAtY(y), lane: laneAtX(x, k), k }, anchor: noteStart(hit.note), notes: selectedNotes(), copy: e.altKey, moved: false };
    renderPanels();
    updateStatus();
}
function eraseAt(x, y) {
    if (drag?.kind !== 'erase')
        return;
    const hit = view.hitTest(st, x, y);
    if (hit) {
        drag.removed += removeNotes(project, new Set([hit.note.id]));
        syncDerived();
    }
}
canvas.addEventListener('pointermove', e => {
    const { x, y } = pt(e);
    if (!drag) {
        const inside = view.inLanes(x);
        st.hoverTick = inside ? tickAtY(y) : null;
        st.hoverLane = inside && (tool === 'tap' || tool === 'hold') && st.hoverTick != null ? laneAtX(x, kAt(st.hoverTick)) : null;
        const hit = inside ? view.hitTest(st, x, y) : null;
        canvas.style.cursor = tool === 'erase' ? (hit ? 'pointer' : 'crosshair') : hit?.part === 'kf' ? 'grab' : hit ? 'move' : inside ? 'crosshair' : 'ns-resize';
        return;
    }
    st.hoverTick = null;
    st.hoverLane = null;
    switch (drag.kind) {
        case 'erase':
            eraseAt(x, y);
            break;
        case 'hold': {
            const t1 = tickAtY(y), k = kAt(drag.tick);
            st.ghosts = [makeHold(drag.tick, t1 > drag.tick ? t1 : drag.tick + minLen(), drag.lane, t1 > drag.tick ? laneAtX(x, k) : drag.lane)];
            break;
        }
        case 'multi':
            st.ghosts = [multiGhost(drag, x, y)];
            break;
        case 'marquee': {
            st.marquee.x1 = x;
            st.marquee.y1 = y;
            st.selected = new Set([...drag.base, ...view.inRect(st, st.marquee).map(n => n.id)]);
            break;
        }
        case 'kf': {
            const n = drag.note, k = kAt(noteStart(n)), tick = tickAtY(y);
            const value = drag.edge === 'lane' ? laneAtX(x, k) : edgeAtX(x, k);
            st.overrides = new Map([[n.id, withKeyframe(n, drag.index, tick, value, drag.edge, k)]]);
            break;
        }
        case 'move': {
            const raw = rawTickAtY(y) - drag.origin.tick, target = drag.anchor + raw;
            const dTick = (snapOn ? map.snap(target, snapDiv) : Math.round(target)) - drag.anchor;
            const dLane = laneAtX(x, drag.origin.k) - drag.origin.lane;
            if (!drag.moved && (dTick || dLane))
                drag.moved = true;
            const moved = drag.notes.map(n => shifted(n, dTick, dLane, st.sections));
            if (drag.copy) {
                st.ghosts = moved;
                st.overrides.clear();
            }
            else
                st.overrides = new Map(moved.map(n => [n.id, n]));
            break;
        }
    }
});
function endDrag() {
    const d = drag;
    drag = null;
    if (!d)
        return;
    switch (d.kind) {
        case 'erase':
            if (d.removed) {
                history.push(d.before);
                changed(`擦除 ${d.removed} 个音符`);
            }
            break;
        case 'hold':
        case 'multi': {
            const n = st.ghosts[0];
            st.ghosts = [];
            if (n) {
                commit(d.kind === 'hold' ? '放置 Hold' : '放置 Multi Hold', p => { addNote(p, n); });
                st.selected = new Set([n.id]);
                renderPanels();
            }
            break;
        }
        case 'marquee':
            st.marquee = null;
            renderPanels();
            updateStatus();
            break;
        case 'kf': {
            const next = st.overrides.get(d.note.id);
            st.overrides.clear();
            if (next)
                commit('调整关键帧', p => replaceNotes(p, [next]));
            break;
        }
        case 'move': {
            const ghosts = st.ghosts, over = [...st.overrides.values()];
            st.ghosts = [];
            st.overrides.clear();
            if (!d.moved)
                break;
            if (d.copy) {
                const copies = ghosts.map(n => ({ ...n, id: `${n.id}c${Math.random().toString(36).slice(2, 6)}` }));
                commit(`复制 ${copies.length} 个音符`, p => { for (const n of copies)
                    addNote(p, n); });
                st.selected = new Set(copies.map(n => n.id));
            }
            else
                commit(`移动 ${over.length} 个音符`, p => replaceNotes(p, over));
            renderPanels();
            break;
        }
    }
}
canvas.addEventListener('pointerup', endDrag);
/** Drops drag previews. An erase drag has already removed notes from the project, so it is committed (undoable, autosaved). */
function cancelDrag() {
    if (drag?.kind === 'erase') {
        endDrag();
        return;
    }
    drag = null;
    st.ghosts = [];
    st.overrides.clear();
    st.marquee = null;
}
canvas.addEventListener('pointercancel', cancelDrag);
canvas.addEventListener('pointerleave', () => { if (!drag) {
    st.hoverTick = null;
    st.hoverLane = null;
} });
canvas.addEventListener('dblclick', e => {
    const { x, y } = pt(e), hit = view.hitTest(st, x, y);
    if (!hit || hit.note.kind === 'tap')
        return;
    if (hit.part === 'kf') {
        commit('删除关键帧', p => replaceNotes(p, [withoutKeyframe(hit.note, hit.index)]));
        return;
    }
    if (hit.part === 'body') {
        const next = insertKeyframe(hit.note, tickAtY(y));
        commit('添加关键帧', p => replaceNotes(p, [next]));
        st.selected = new Set([next.id]);
        renderPanels();
    }
});
let wheelAcc = 0;
canvas.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
        setZoom(st.pxPerMs * Math.exp(-e.deltaY * 0.0015));
        return;
    }
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    while (Math.abs(wheelAcc) >= 40) {
        stepGrid(wheelAcc < 0 ? 1 : -1);
        wheelAcc -= Math.sign(wheelAcc) * 40;
    }
}, { passive: false });
function setZoom(v) {
    st.pxPerMs = clamp(v, 0.05, 1.6);
    $('rngZoom').value = String(st.pxPerMs);
}
/* ───────────── selection ops ───────────── */
function deleteSelected() { const n = st.selected.size; if (n)
    commit(`删除 ${n} 个音符`, p => { removeNotes(p, st.selected); }); }
function copySelected(cut = false) {
    clip = clone(selectedNotes());
    if (!clip.length)
        return;
    toast(`已复制 ${clip.length} 个音符`);
    if (cut)
        commit(`剪切 ${clip.length} 个音符`, p => { removeNotes(p, new Set(clip.map(n => n.id))); });
}
function paste() {
    if (!clip.length)
        return;
    const at = snapOn ? map.snap(curTick(), snapDiv) : Math.round(curTick());
    let out = [];
    commit(`粘贴 ${clip.length} 个音符`, p => { out = pasteNotes(p, clip, at); });
    st.selected = new Set(out.map(n => n.id));
    renderPanels();
    updateStatus();
}
function transformSelected(label, f) {
    const sel = selectedNotes();
    if (!sel.length)
        return;
    commit(label, p => replaceNotes(p, sel.map(f)));
}
const nudgeLane = (d) => transformSelected('左右移动', n => shifted(n, 0, d, st.sections));
const nudgeTick = (dir) => transformSelected('前后移动', n => shifted(n, map.step(noteStart(n), snapDiv, dir) - noteStart(n), 0, st.sections));
/* ───────────── keyboard ───────────── */
/** Lane keys held down while live charting: code -> { tick, lane }. */
const liveKeys = new Map();
const liveTick = () => {
    const t = map.msToTick(audio.isPlaying ? audio.positionMs() : st.timeMs);
    return snapOn ? map.snap(t, snapDiv) : Math.round(t);
};
function laneForKey(code, tick) {
    const k = kAt(tick), i = defaultKeyMapForLanes(k).indexOf(code);
    return i;
}
function isTyping(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && t !== canvas;
}
document.addEventListener('keydown', e => {
    if (isTyping(e) || ($('dlgHelp')).open)
        return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod) {
        const key = k.toLowerCase();
        const run = (f) => { e.preventDefault(); f(); };
        if (key === 'z')
            return run(e.shiftKey ? redo : undo);
        if (key === 'y')
            return run(redo);
        if (key === 'c')
            return run(() => copySelected());
        if (key === 'x')
            return run(() => copySelected(true));
        if (key === 'v')
            return run(paste);
        if (key === 'a')
            return run(() => { st.selected = new Set(project.notes.map(n => n.id)); renderPanels(); updateStatus(); });
        if (key === 's')
            return run(saveProjectFile);
        if (key === 'o')
            return run(() => $('fileProject').click());
        if (key === 'g')
            return run(() => { const i = $('inpPos'); i.focus(); i.select(); });
        if (k === 'Enter')
            return run(() => void playtest());
        if (k === '=' || k === '+')
            return run(() => setZoom(st.pxPerMs * 1.25));
        if (k === '-')
            return run(() => setZoom(st.pxPerMs / 1.25));
        return;
    }
    // Lane keys place notes at the playhead (live charting while playing).
    if (!e.altKey && !e.repeat) {
        const tick = liveTick(), lane = laneForKey(e.code, tick);
        if (lane >= 0 && tool !== 'multi') {
            e.preventDefault();
            liveKeys.set(e.code, { tick, lane });
            return;
        }
    }
    if (liveKeys.has(e.code)) {
        e.preventDefault();
        return;
    }
    const handled = (f) => { e.preventDefault(); f(); };
    switch (k) {
        case ' ': return handled(() => togglePlay(e.shiftKey));
        case 'ArrowUp': return handled(() => (e.altKey ? nudgeTick(1) : stepGrid(1)));
        case 'ArrowDown': return handled(() => (e.altKey ? nudgeTick(-1) : stepGrid(-1)));
        case 'ArrowLeft': return handled(() => nudgeLane(-1));
        case 'ArrowRight': return handled(() => nudgeLane(1));
        case 'PageUp': return handled(() => stepBar(1));
        case 'PageDown': return handled(() => stepBar(-1));
        case 'Home': return handled(() => seekMs(minMs() + 2000));
        case 'End': return handled(() => seekMs(endMs()));
        case 'Delete':
        case 'Backspace': return handled(deleteSelected);
        case 'Escape': return handled(() => { st.selected.clear(); cancelDrag(); renderPanels(); updateStatus(); });
        case '[': return handled(() => setSnap(SNAP_DIVISORS[Math.max(0, SNAP_DIVISORS.indexOf(snapDiv) - 1)]));
        case ']': return handled(() => setSnap(SNAP_DIVISORS[Math.min(SNAP_DIVISORS.length - 1, SNAP_DIVISORS.indexOf(snapDiv) + 1)]));
        case '1': return handled(() => setTool('select'));
        case '2': return handled(() => setTool('tap'));
        case '3': return handled(() => setTool('hold'));
        case '4': return handled(() => setTool('multi'));
        case '5': return handled(() => setTool('erase'));
        case 'm':
        case 'M': return handled(() => transformSelected('镜像', n => mirrored(n, st.sections)));
        case 'q':
        case 'Q': return handled(() => transformSelected(`量化到 1/${snapDiv}`, n => quantized(n, map, snapDiv)));
        case '?': return handled(() => $('dlgHelp').showModal());
    }
});
document.addEventListener('keyup', e => {
    const down = liveKeys.get(e.code);
    if (!down)
        return;
    liveKeys.delete(e.code);
    e.preventDefault();
    const end = liveTick();
    // Held for at least one grid step (and inside the same lane section): a hold, otherwise a tap.
    const n = end - down.tick >= minLen() && sectionIndex(st.sections, down.tick) === sectionIndex(st.sections, end)
        ? makeHold(down.tick, end, down.lane) : makeTap(down.tick, down.lane);
    commit(n.kind === 'hold' ? '放置 Hold' : '放置 Tap', p => { addNote(p, n); });
    if (!audio.isPlaying) {
        st.selected = new Set([n.id]);
        renderPanels();
    }
});
function setTool(t) {
    tool = t;
    document.querySelectorAll('#toolButtons [data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
}
function setSnap(div) {
    snapDiv = div;
    st.snap = div;
    $('selSnap').value = String(div);
    updateStatus();
}
/* ───────────── panels ───────────── */
const posText = (tick) => formatPosition(map.position(tick));
/** Reads a "bar:beat:tick" input; shows a toast and returns null when invalid. */
function readPos(v) {
    const t = parsePosition(v, map);
    if (t == null)
        toast(`位置格式应为 小节:拍:tick，例如 12:3:096`);
    return t;
}
function renderAll() { renderPanels(); renderMeta(); renderTiming(); renderSections(); updateTransport(); }
function renderPanels() { renderNote(); renderCheck(); renderSectionsIfOpen(); }
let activeTab = 'note';
function renderSectionsIfOpen() { if (activeTab === 'sections')
    renderSections(); if (activeTab === 'timing')
    renderTiming(); }
function renderNote() {
    const el = $('paneNote'), sel = selectedNotes();
    if (!sel.length) {
        el.innerHTML = `<h3>音符</h3><p class="hint">未选中音符。用选择工具 (1) 单击或框选音符后，可在这里精确编辑位置、轨道和关键帧。</p>
      <h3>放置</h3><p class="hint">Tap 工具单击放置；Hold 工具按住拖动；Multi 工具横向拖范围、纵向拖长度。也可以在播放时按 ${defaultKeyMapForLanes(kAt(Math.max(0, curTick()))).map(c => c.replace('Key', '').replace('Semicolon', ';')).join(' ')} 实时打谱。</p>`;
        return;
    }
    if (sel.length > 1) {
        const a = Math.min(...sel.map(noteStart)), b = Math.max(...sel.map(noteEnd));
        el.innerHTML = `<h3>已选中 ${sel.length} 个音符</h3>
      <div class="grid2"><label>范围</label><span class="mono">${posText(a)} – ${posText(b)}</span></div>
      <div class="row"><button type="button" data-act="mirror">镜像 (M)</button><button type="button" data-act="quant">量化到 1/${snapDiv} (Q)</button>
      <button type="button" data-act="copy">复制</button><button type="button" data-act="del">删除</button></div>
      <div class="grid2"><label for="inpShift">整体平移</label><div class="row"><input type="number" id="inpShift" value="0" step="1" style="width:70px" /> <span class="hint">格 (1/${snapDiv})</span><button type="button" data-act="shift">应用</button></div></div>`;
        return;
    }
    const n = sel[0], k = kAt(noteStart(n));
    const laneSel = (id, v) => `<select id="${id}">${Array.from({ length: k }, (_, i) => `<option value="${i}" ${i === v ? 'selected' : ''}>轨道 ${i + 1}</option>`).join('')}</select>`;
    let body = '';
    if (n.kind === 'tap') {
        body = `<div class="grid2"><label for="inpNPos">位置</label><input type="text" id="inpNPos" class="mono" value="${posText(n.tick)}" />
      <label for="selNLane">轨道</label>${laneSel('selNLane', n.lane)}
      <label>时间</label><span class="mono">${fmtTime(map.tickToMs(n.tick))} (${Math.round(map.tickToMs(n.tick))} ms)</span></div>`;
    }
    else {
        const rows = n.points.map((q, i) => `<tr>
      <td>${i === 0 ? '头' : i === n.points.length - 1 ? '尾' : i}</td>
      <td><input type="text" class="mono" data-kf="${i}" data-f="tick" value="${posText(q.tick)}" ${i === 0 ? 'disabled title="头部位置用上面的「位置」修改"' : ''} /></td>
      ${n.kind === 'hold' ? `<td><input type="number" min="1" max="${k}" step="1" data-kf="${i}" data-f="lane" value="${esc((q.lane ?? 0) + 1)}" style="width:56px" /></td>`
            : `<td><input type="number" min="0" max="${k}" step="0.25" data-kf="${i}" data-f="left" value="${esc(q.left)}" style="width:58px" /></td><td><input type="number" min="0" max="${k}" step="0.25" data-kf="${i}" data-f="right" value="${esc(q.right)}" style="width:58px" /></td>`}
      <td>${i > 0 && i < n.points.length - 1 ? `<button type="button" class="x" data-delkf="${i}" title="删除关键帧">×</button>` : ''}</td></tr>`).join('');
        const len = noteEnd(n) - noteStart(n);
        body = `<div class="grid2"><label for="inpNPos">位置</label><input type="text" id="inpNPos" class="mono" value="${posText(noteStart(n))}" />
      <label for="inpNEnd">结束</label><input type="text" id="inpNEnd" class="mono" value="${posText(noteEnd(n))}" />
      <label>长度</label><span class="mono">${+(len / TICKS_PER_BEAT).toFixed(4)} 拍 · ${Math.round(map.tickToMs(noteEnd(n)) - map.tickToMs(noteStart(n)))} ms</span>
      ${n.kind === 'multi' ? `<label for="inpNTick">判定间隔</label><div class="row"><input type="number" id="inpNTick" min="0" step="1" value="${esc(n.tickIntervalMs)}" placeholder="${Math.round(map.beatMsAt(noteStart(n)) / 2)}" /> <span class="hint">ms，空 = 半拍</span></div>` : ''}</div>
      <h3>关键帧 <span class="hint">(双击长条身体添加)</span></h3>
      <table><tr><th></th><th>位置</th>${n.kind === 'hold' ? '<th>轨道</th>' : '<th>左边缘</th><th>右边缘</th>'}<th></th></tr>${rows}</table>
      <div class="row"><button type="button" data-act="addkf">在播放线处添加关键帧</button></div>`;
    }
    el.innerHTML = `<h3>${n.kind === 'tap' ? 'Tap' : n.kind === 'hold' ? 'Hold' : 'Multi Hold'} · ${k}K</h3>${body}
    <div class="row"><button type="button" data-act="mirror">镜像</button><button type="button" data-act="quant">量化到 1/${snapDiv}</button><button type="button" data-act="del">删除</button>
    ${n.kind === 'tap' ? '<button type="button" data-act="toHold">转为 Hold</button>' : n.kind === 'hold' ? '<button type="button" data-act="toTap">转为 Tap</button>' : ''}</div>`;
}
$('paneNote').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    const sel = selectedNotes(), act = b.dataset.act;
    if (b.dataset.delkf) {
        const i = Number(b.dataset.delkf);
        commit('删除关键帧', p => replaceNotes(p, [withoutKeyframe(sel[0], i)]));
        return;
    }
    if (act === 'mirror')
        transformSelected('镜像', n => mirrored(n, st.sections));
    else if (act === 'quant')
        transformSelected(`量化到 1/${snapDiv}`, n => quantized(n, map, snapDiv));
    else if (act === 'del')
        deleteSelected();
    else if (act === 'copy')
        copySelected();
    else if (act === 'shift') {
        const steps = Math.round(Number($('inpShift').value) || 0);
        if (!steps)
            return;
        transformSelected(`平移 ${steps} 格`, n => { let t = noteStart(n); for (let i = 0; i < Math.abs(steps); i++)
            t = map.step(t, snapDiv, steps > 0 ? 1 : -1); return shifted(n, t - noteStart(n), 0, st.sections); });
    }
    else if (act === 'addkf') {
        const n = sel[0], t = snapOn ? map.snap(curTick(), snapDiv) : Math.round(curTick());
        if (t <= noteStart(n) || t >= noteEnd(n)) {
            toast('播放线不在这个长条的范围内');
            return;
        }
        commit('添加关键帧', p => replaceNotes(p, [insertKeyframe(n, t)]));
    }
    else if (act === 'toHold') {
        const n = sel[0];
        if (n.kind !== 'tap')
            return;
        const h = { ...makeHold(n.tick, n.tick + Math.max(minLen(), TICKS_PER_BEAT), n.lane), id: n.id };
        commit('转为 Hold', p => replaceNotes(p, [h]));
    }
    else if (act === 'toTap') {
        const n = sel[0];
        if (n.kind !== 'hold')
            return;
        commit('转为 Tap', p => replaceNotes(p, [{ id: n.id, kind: 'tap', tick: n.points[0].tick, lane: n.points[0].lane }]));
    }
});
$('paneNote').addEventListener('change', e => {
    const t = e.target, sel = selectedNotes();
    if (sel.length !== 1)
        return;
    const n = sel[0], k = kAt(noteStart(n));
    if (t.id === 'inpNPos') {
        const v = readPos(t.value);
        if (v == null)
            return renderNote();
        commit('修改位置', p => replaceNotes(p, [shifted(n, v - noteStart(n), 0, st.sections)]));
    }
    else if (t.id === 'selNLane' && n.kind === 'tap')
        commit('修改轨道', p => replaceNotes(p, [{ ...n, lane: Number(t.value) }]));
    else if (t.id === 'inpNEnd') {
        const v = readPos(t.value);
        if (v == null)
            return renderNote();
        commit('修改结束位置', p => replaceNotes(p, [withEnd(n, v)]));
    }
    else if (t.id === 'inpNTick' && n.kind === 'multi') {
        const v = Math.round(Number(t.value));
        commit('修改判定间隔', p => replaceNotes(p, [{ ...n, tickIntervalMs: v > 0 ? v : undefined }]));
    }
    else if (t.dataset.kf && n.kind !== 'tap') {
        const i = Number(t.dataset.kf), f = t.dataset.f, q = n.points[i];
        if (f === 'tick') {
            const v = readPos(t.value);
            if (v == null)
                return renderNote();
            commit('修改关键帧', p => replaceNotes(p, [withKeyframe(n, i, v, n.kind === 'hold' ? q.lane : q.left, n.kind === 'hold' ? 'lane' : 'left', k)]));
        }
        else if (f === 'lane')
            commit('修改关键帧', p => replaceNotes(p, [withKeyframe(n, i, q.tick, Number(t.value) - 1, 'lane', k)]));
        else
            commit('修改关键帧', p => replaceNotes(p, [withKeyframe(n, i, q.tick, Number(t.value), f, k)]));
    }
    renderNote();
});
function renderMeta() {
    const m = project.meta;
    $('paneMeta').innerHTML = `<h3>曲目信息</h3>
    <div class="grid2">
      <label for="mTitle">曲名</label><input type="text" id="mTitle" data-m="title" value="${esc(m.title)}" />
      <label for="mArtist">曲师</label><input type="text" id="mArtist" data-m="artist" value="${esc(m.artist)}" />
      <label for="mId">谱面 ID</label><input type="text" id="mId" data-m="id" value="${esc(m.id)}" />
      <label for="mDiffName">难度</label><select id="mDiffName" data-m="difficulty">${['', 'EZ', 'HD', 'EX', 'DZ'].map(d => `<option value="${d}" ${d === (m.difficulty || '') ? 'selected' : ''}>${d || '—'}</option>`).join('')}</select>
      <label for="mDiff">等级</label><input type="number" id="mDiff" data-m="diff" min="1" max="30" step="1" value="${esc(m.diff)}" />
      <label for="mJacket">封面字符</label><input type="text" id="mJacket" data-m="jacket" value="${esc(m.jacket)}" maxlength="4" />
      <label for="mDur">时长 (秒)</label><input type="number" id="mDur" data-m="duration" min="1" step="0.001" value="${esc(m.duration)}" />
    </div>
    <div class="row"><button type="button" id="btnDurAudio" ${audio.duration ? '' : 'disabled'}>时长设为音频长度${audio.duration ? ` (${audio.duration.toFixed(3)} 秒)` : ''}</button></div>
    <label class="check"><input type="checkbox" data-m="backdrop" ${m.backdrop ? 'checked' : ''} /> 显示几何背景 (节拍跟随 offset)</label>
    <h3>音频</h3>
    <p class="hint">${project.audioName ? `当前：${esc(project.audioName)}` : '未加载音频。用顶部「加载音频…」选择本地文件，或载入内置谱面自动使用它的歌曲。'}</p>`;
}
$('paneMeta').addEventListener('change', e => {
    const t = e.target, key = t.dataset.m;
    if (!key)
        return;
    commit('修改曲目信息', p => {
        const m = p.meta;
        if (key === 'backdrop')
            m[key] = t.checked;
        else if (key === 'diff')
            m[key] = clamp(Math.round(Number(t.value) || 1), 1, 30);
        else if (key === 'duration')
            m[key] = Math.max(1, Number(t.value) || p.meta.duration);
        else if (key === 'difficulty') {
            if (t.value)
                m[key] = t.value;
            else
                delete m[key];
        }
        else if (key === 'id')
            m[key] = t.value.trim().replace(/[^\w-]/g, '_') || 'custom_chart';
        else
            m[key] = t.value;
    });
    renderMeta();
});
$('paneMeta').addEventListener('click', e => {
    if (e.target.id === 'btnDurAudio' && audio.duration) {
        commit('时长设为音频长度', p => { p.meta.duration = Math.round(audio.duration * 1000) / 1000; });
        renderMeta();
    }
});
function renderTiming() {
    const tm = project.timing;
    $('paneTiming').innerHTML = `<h3>Offset</h3>
    <div class="grid2"><label for="tOffset">第 1 小节位置</label><div class="row"><input type="number" id="tOffset" step="1" value="${tm.offsetMs}" /> <span class="hint">ms</span></div></div>
    <div class="row"><button type="button" data-t="off-10">−10</button><button type="button" data-t="off-1">−1</button><button type="button" data-t="off+1">+1</button><button type="button" data-t="off+10">+10</button>
      <button type="button" data-t="offHere" title="把播放线所在的时间设为第 1 小节">设为播放线时间</button></div>
    <p class="hint">音符按小节/拍保存：修改 offset 或 BPM 时音符跟着节拍一起移动。</p>
    <h3>BPM 变化</h3>
    <table><tr><th>位置</th><th>BPM</th><th>时间</th><th></th></tr>
    ${tm.bpms.map((b, i) => `<tr><td><input type="text" class="mono" data-bpm="${i}" data-f="tick" value="${posText(b.tick)}" ${i ? '' : 'disabled'} /></td>
      <td><input type="number" data-bpm="${i}" data-f="bpm" min="1" max="2000" step="0.001" value="${b.bpm}" /></td>
      <td class="mono">${fmtTime(map.tickToMs(b.tick))}</td><td>${i ? `<button type="button" class="x" data-delbpm="${i}" title="删除">×</button>` : ''}</td></tr>`).join('')}
    </table>
    <div class="row"><button type="button" data-t="addBpm">在播放线处添加 BPM 变化</button></div>
    <h3>拍号</h3>
    <table><tr><th>小节</th><th>每小节拍数</th><th></th></tr>
    ${tm.meters.map((m, i) => `<tr><td><input type="number" data-meter="${i}" data-f="bar" min="1" step="1" value="${m.bar + 1}" ${i ? '' : 'disabled'} /></td>
      <td><div class="row"><input type="number" data-meter="${i}" data-f="beats" min="1" max="32" step="1" value="${m.beats}" style="width:60px" /> <span class="hint">/4</span></div></td>
      <td>${i ? `<button type="button" class="x" data-delmeter="${i}" title="删除">×</button>` : ''}</td></tr>`).join('')}
    </table>
    <div class="row"><button type="button" data-t="addMeter">在当前小节添加拍号变化</button></div>`;
}
$('paneTiming').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    const act = b.dataset.t;
    if (b.dataset.delbpm) {
        const i = Number(b.dataset.delbpm);
        commit('删除 BPM 变化', p => { p.timing.bpms.splice(i, 1); });
    }
    else if (b.dataset.delmeter) {
        const i = Number(b.dataset.delmeter);
        commit('删除拍号变化', p => { p.timing.meters.splice(i, 1); });
    }
    else if (act?.startsWith('off') && act !== 'offHere') {
        const d = Number(act.slice(3));
        commit('修改 offset', p => { p.timing.offsetMs = Math.round(p.timing.offsetMs + d); });
    }
    else if (act === 'offHere') {
        const ms = Math.round(st.timeMs);
        commit('修改 offset', p => { p.timing.offsetMs = ms; });
    }
    else if (act === 'addBpm') {
        const t = snapOn ? map.snap(curTick(), snapDiv) : Math.round(curTick());
        if (t <= 0) {
            toast('第一个 BPM 在 1:1:000，修改它的数值即可');
            return;
        }
        const bpm = map.bpmAt(t);
        commit('添加 BPM 变化', p => { p.timing.bpms = p.timing.bpms.filter(x => x.tick !== t); p.timing.bpms.push({ tick: t, bpm }); p.timing.bpms.sort((a, c) => a.tick - c.tick); });
    }
    else if (act === 'addMeter') {
        const bar = map.barOf(Math.max(0, curTick()));
        if (bar <= 0) {
            toast('第 1 小节的拍号直接修改即可');
            return;
        }
        const beats = map.beatsInBar(bar);
        commit('添加拍号变化', p => { p.timing.meters = p.timing.meters.filter(x => x.bar !== bar); p.timing.meters.push({ bar, beats }); p.timing.meters.sort((a, c) => a.bar - c.bar); });
    }
    renderTiming();
});
$('paneTiming').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'tOffset') {
        const v = Number(t.value);
        if (Number.isFinite(v))
            commit('修改 offset', p => { p.timing.offsetMs = Math.round(v * 1000) / 1000; });
    }
    else if (t.dataset.bpm) {
        const i = Number(t.dataset.bpm);
        if (t.dataset.f === 'bpm') {
            const v = Number(t.value);
            if (v > 0 && v <= 2000)
                commit('修改 BPM', p => { p.timing.bpms[i].bpm = v; });
            else
                toast('BPM 应在 1–2000 之间');
        }
        else {
            const v = readPos(t.value);
            if (v != null && v > 0)
                commit('移动 BPM 变化', p => { p.timing.bpms[i].tick = v; p.timing.bpms.sort((a, c) => a.tick - c.tick); });
        }
    }
    else if (t.dataset.meter) {
        const i = Number(t.dataset.meter), v = Math.round(Number(t.value));
        if (t.dataset.f === 'beats') {
            if (v >= 1 && v <= 32)
                commit('修改拍号', p => { p.timing.meters[i].beats = v; });
        }
        else if (v >= 2)
            commit('移动拍号变化', p => { p.timing.meters[i].bar = v - 1; p.timing.meters.sort((a, c) => a.bar - c.bar); });
    }
    project.timing = normalizeTimingSafe(project.timing);
    syncDerived();
    renderTiming();
});
/** Merges duplicate BPM ticks / meter bars after edits (keeps the first BPM at tick 0). */
function normalizeTimingSafe(t) {
    const bpms = t.bpms.filter((b, i, a) => a.findIndex(c => c.tick === b.tick) === i);
    const meters = t.meters.filter((m, i, a) => a.findIndex(c => c.bar === m.bar) === i);
    return { ...t, bpms, meters };
}
function renderSections() {
    const secs = st.sections;
    $('paneSections').innerHTML = `<h3>变轨 (轨道数)</h3>
    <table><tr><th>位置</th><th>轨道</th><th>时间</th><th>音符</th><th></th></tr>
    ${secs.map((s, i) => {
        const next = secs[i + 1]?.tick ?? Infinity, count = project.notes.filter(n => noteStart(n) >= (i ? s.tick : -Infinity) && noteStart(n) < next).length;
        return `<tr><td><input type="text" class="mono" data-sec="${i}" data-f="tick" value="${posText(s.tick)}" ${i ? '' : 'disabled'} /></td>
      <td><select data-sec="${i}" data-f="lanes">${LANE_OPTIONS.map(k => `<option value="${k}" ${k === s.lanes ? 'selected' : ''}>${k}K</option>`).join('')}</select></td>
      <td class="mono">${fmtTime(i ? map.tickToMs(s.tick) : 0)}</td><td>${count}</td>
      <td>${i ? `<button type="button" class="x" data-delsec="${i}" title="删除">×</button>` : ''}</td></tr>`;
    }).join('')}
    </table>
    <div class="row"><button type="button" id="btnAddSec">在播放线处变轨</button></div>
    <p class="hint">变轨点前 170 ms 到后 760 ms 是游戏的变轨动画，这段时间不应放音符 (检查页会提示)。轨道减少时，超出新轨道数的音符会在检查页报错。</p>`;
}
$('paneSections').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b)
        return;
    if (b.dataset.delsec) {
        const i = Number(b.dataset.delsec);
        commit('删除变轨点', p => { p.sections = sortSections(p.sections); p.sections.splice(i, 1); });
    }
    else if (b.id === 'btnAddSec') {
        const t = snapOn ? map.snap(curTick(), snapDiv) : Math.round(curTick());
        if (t <= 0) {
            toast('开头的轨道数直接修改第一行即可');
            return;
        }
        const cur = kAt(t), next = LANE_OPTIONS.find(k => k !== cur);
        commit(`在 ${posText(t)} 变轨`, p => setSection(p, t, next));
    }
    renderSections();
});
$('paneSections').addEventListener('change', e => {
    const t = e.target, i = Number(t.dataset.sec);
    if (!t.dataset.sec)
        return;
    if (t.dataset.f === 'lanes')
        commit('修改轨道数', p => { p.sections = sortSections(p.sections); p.sections[i].lanes = Number(t.value); });
    else {
        const v = readPos(t.value);
        if (v != null && v > 0)
            commit('移动变轨点', p => { p.sections = sortSections(p.sections); p.sections[i].tick = v; p.sections = sortSections(p.sections); });
    }
    renderSections();
});
function renderCheck() {
    const errs = issues.filter(i => i.level === 'error').length;
    const nps = project.meta.duration > 0 ? project.notes.length / project.meta.duration : 0;
    $('paneCheck').innerHTML = `<h3>统计</h3>
    <div class="stats">
      <div class="stat"><b>${project.notes.length}</b><small>音符</small></div>
      <div class="stat"><b>${nps.toFixed(2)}</b><small>平均每秒音符</small></div>
      <div class="stat"><b style="color:${errs ? 'var(--err)' : 'var(--ok)'}">${errs}</b><small>错误</small></div>
      <div class="stat"><b style="color:${issues.length - errs ? 'var(--warn)' : 'var(--ok)'}">${issues.length - errs}</b><small>警告</small></div>
    </div>
    <h3>问题列表 <span class="hint">点击跳转并选中</span></h3>
    <div class="issues">${issues.length ? issues.slice(0, 300).map((x, i) => `<button type="button" class="issue ${x.level}" data-issue="${i}"><b>${posText(x.tick)}</b><span>${esc(x.msg)}</span></button>`).join('')
        : '<p class="hint">没有发现问题。</p>'}${issues.length > 300 ? `<p class="hint">另有 ${issues.length - 300} 项未显示</p>` : ''}</div>`;
}
$('paneCheck').addEventListener('click', e => {
    const b = e.target.closest('[data-issue]');
    if (!b)
        return;
    const x = issues[Number(b.dataset.issue)];
    if (!x)
        return;
    seekTick(x.tick);
    st.selected = new Set(x.ids);
    renderNote();
    updateStatus();
});
/* ───────────── files & audio ───────────── */
function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function saveProjectFile() {
    download(`${project.meta.id}.dlproj.json`, JSON.stringify(project, null, 1));
    toast('已保存编辑器工程 (.dlproj.json)，可用「打开…」继续编辑');
}
function exportChartFile() {
    const errs = issues.filter(i => i.level === 'error').length;
    if (errs && !confirm(`检查发现 ${errs} 个错误，游戏载入时可能移动或删除这些音符。仍要导出吗？`))
        return;
    download(`${project.meta.id}.chart.json`, JSON.stringify(exportChartWithTiming(project)));
    toast('已导出游戏谱面 JSON (含 editorTiming，可无损重新导入)');
}
let audioToken = 0;
async function loadAudioData(data, name, url) {
    const token = ++audioToken;
    try {
        await audio.load(data.slice(0));
        if (token !== audioToken)
            return false;
        project.audioName = name;
        if (url)
            project.audioUrl = url;
        else
            delete project.audioUrl;
        renderMeta();
        updateStatus(`音频：${name}`);
        return true;
    }
    catch (err) {
        toast(`音频解码失败：${err?.message || err}`);
        return false;
    }
}
async function loadAudioUrl(url) {
    try {
        const res = await fetch(url);
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        return await loadAudioData(await res.arrayBuffer(), decodeURIComponent(url.split('/').pop() || url), url);
    }
    catch (err) {
        toast(`无法读取音频 ${url}：${err?.message || err}`);
        return false;
    }
}
async function loadLocalAudio(file) {
    const data = await file.arrayBuffer();
    if (!(await loadAudioData(data, file.name)))
        return;
    saveAudio({ name: file.name, type: file.type, data }).catch(() => toast('音频较大，未能保存到浏览器，下次打开需要重新加载'));
    if (!project.notes.length && audio.duration)
        project.meta.duration = Math.round(audio.duration * 1000) / 1000;
    changed(`加载音频 ${file.name}`);
    renderMeta();
}
function loadBuiltin(id) {
    const chart = CHARTS[id];
    if (!chart)
        return;
    if (project.notes.length && dirty && !confirm('载入内置谱面会替换当前谱面 (当前谱面已自动保存在浏览器中，但会被覆盖)。继续吗？'))
        return;
    const { project: p, report } = importChart(clone(chart));
    st.timeMs = 0;
    setProject(p, `载入 ${chart.title}`);
    toast(`已载入 ${chart.title} ${chart.difficulty || ''}：${report.notes} 个音符${report.offGrid ? `，${report.offGrid} 个不在 1/48、1/64 网格上` : '，全部对齐网格'}`);
    const url = AUDIO_SOURCES_TEST[id];
    if (url)
        void loadAudioUrl(url).then(ok => { if (ok)
            scheduleAutosave(); });
    scheduleAutosave();
}
async function openProjectFile(file) {
    try {
        const { project: p, report } = parseProjectJSON(JSON.parse(await file.text()));
        setProject(p, `打开 ${file.name}`);
        if (report)
            toast(`已导入谱面：${report.notes} 个音符${report.offGrid ? `，${report.offGrid} 个不在网格上 (保留原时间)` : ''}`);
        if (p.audioUrl)
            void loadAudioUrl(p.audioUrl);
        else if (p.audioName) {
            const a = await loadAudio();
            if (a && a.name === p.audioName)
                await loadAudioData(a.data, a.name);
            else
                toast(`请重新加载音频「${p.audioName}」`);
        }
        scheduleAutosave();
    }
    catch (err) {
        toast(`无法打开 ${file.name}：${err?.message || err}`);
    }
}
/* ───────────── playtest ───────────── */
/** Writes the chart (from the bar at the playhead) and its audio for the game, then opens the game in a new tab. */
async function playtest() {
    if (audio.isPlaying)
        stopPlayback();
    const bar = map.barOf(Math.max(0, curTick())), startMs = Math.max(0, map.tickToMs(map.barStart(bar)));
    const chart = playtestChart(project, startMs);
    if (!chart.notes.length) {
        toast('从当前小节起没有音符');
        return;
    }
    const win = window.open('about:blank', '_blank');
    try {
        let buffer = audio.buffer;
        if (!buffer) {
            // No audio: a silent track of the chart length so the game clock still runs.
            const rate = 8000;
            buffer = new AudioBuffer({ length: Math.ceil(project.meta.duration * rate), sampleRate: rate, numberOfChannels: 1 });
        }
        // The same stamp on audio and chart lets the game reject audio left over from an earlier playtest.
        const savedAt = Date.now();
        await savePlaytestAudio({ name: project.audioName || 'silence.wav', type: 'audio/wav', data: encodeWav(buffer, startMs / 1000), savedAt });
        localStorage.setItem(PLAYTEST_KEY, JSON.stringify({ chart, savedAt }));
    }
    catch (err) {
        win?.close();
        toast(`试玩准备失败：${err?.message || err}`);
        return;
    }
    const url = `./index.html?playtest=${Date.now()}`;
    if (win)
        win.location.href = url;
    else
        location.href = url;
    toast(`从第 ${bar + 1} 小节开始试玩`);
}
/* ───────────── toolbar bindings ───────────── */
function bindUI() {
    const sel = $('selBuiltin');
    for (const [id, c] of Object.entries(CHARTS))
        sel.insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(c.title)} · ${esc(c.difficulty || '')} ${c.diff}</option>`);
    sel.addEventListener('change', () => { if (sel.value)
        loadBuiltin(sel.value); sel.value = ''; canvas.focus(); });
    $('selSnap').innerHTML = SNAP_DIVISORS.map(d => `<option value="${d}" ${d === snapDiv ? 'selected' : ''}>1/${d}</option>`).join('');
    $('selSnap').addEventListener('change', e => { setSnap(Number(e.target.value)); canvas.focus(); });
    $('chkSnap').addEventListener('change', e => { snapOn = e.target.checked; updateStatus(); });
    $('selEdgeSnap').addEventListener('change', e => { edgeSnap = Number(e.target.value); });
    $('rngZoom').addEventListener('input', e => { st.pxPerMs = Number(e.target.value); });
    $('chkWave').addEventListener('change', e => { showWave = e.target.checked; });
    $('chkHits').addEventListener('change', e => { hitsOn = e.target.checked; });
    $('chkMetro').addEventListener('change', e => { metroOn = e.target.checked; });
    const vol = () => audio.setVolumes(Number($('rngMusic').value), Number($('rngHits').value));
    $('rngMusic').addEventListener('input', vol);
    $('rngHits').addEventListener('input', vol);
    $('selRate').addEventListener('change', e => { audio.setRate(Number(e.target.value)); canvas.focus(); });
    document.querySelectorAll('#toolButtons [data-tool]').forEach(b => b.addEventListener('click', () => { setTool(b.dataset.tool); canvas.focus(); }));
    document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
        activeTab = b.dataset.tab;
        document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
        document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === activeTab));
        renderAll();
    }));
    $('btnPlay').addEventListener('click', () => { togglePlay(); canvas.focus(); });
    $('btnPrevBar').addEventListener('click', () => stepBar(-1));
    $('btnNextBar').addEventListener('click', () => stepBar(1));
    const pos = $('inpPos');
    pos.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const t = readPos(pos.value);
            if (t != null) {
                seekTick(t);
                canvas.focus();
            }
        }
        else if (e.key === 'Escape')
            canvas.focus();
    });
    $('rngSeek').addEventListener('input', e => seekMs((Number(e.target.value) / 1000) * endMs()));
    $('btnNew').addEventListener('click', () => {
        if (project.notes.length && !confirm('新建会清空当前谱面 (可以撤销前先保存工程)。继续吗？'))
            return;
        const p = emptyProject();
        if (audio.duration) {
            p.meta.duration = Math.round(audio.duration * 1000) / 1000;
            p.audioName = project.audioName;
            if (project.audioUrl)
                p.audioUrl = project.audioUrl;
        }
        st.timeMs = 0;
        setProject(p, '新建谱面');
        scheduleAutosave();
    });
    $('btnOpen').addEventListener('click', () => $('fileProject').click());
    $('fileProject').addEventListener('change', e => { const f = e.target.files?.[0]; if (f)
        void openProjectFile(f); e.target.value = ''; });
    $('btnAudio').addEventListener('click', () => $('fileAudio').click());
    $('fileAudio').addEventListener('change', e => { const f = e.target.files?.[0]; if (f)
        void loadLocalAudio(f); e.target.value = ''; });
    $('btnSave').addEventListener('click', saveProjectFile);
    $('btnExport').addEventListener('click', exportChartFile);
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnPlaytest').addEventListener('click', () => void playtest());
    $('btnHelp').addEventListener('click', () => $('dlgHelp').showModal());
    // Drag & drop: JSON opens a project / chart, anything else is tried as audio.
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (!f)
            return;
        if (/\.json$/i.test(f.name) || f.type === 'application/json')
            void openProjectFile(f);
        else
            void loadLocalAudio(f);
    });
    new ResizeObserver(() => view.resize()).observe(canvas);
}
/* ───────────── startup ───────────── */
async function restore() {
    const params = new URLSearchParams(location.search), chartId = params.get('chart');
    if (chartId && CHARTS[chartId]) {
        loadBuiltin(chartId);
        return;
    }
    try {
        const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
        if (saved?.project) {
            const { project: p } = parseProjectJSON(saved.project);
            st.timeMs = Number(saved.timeMs) || 0;
            setProject(p, '已恢复上次的编辑');
            if (p.audioUrl)
                void loadAudioUrl(p.audioUrl);
            else if (p.audioName) {
                const a = await loadAudio();
                if (a && a.name === p.audioName)
                    await loadAudioData(a.data, a.name);
            }
            return;
        }
    }
    catch { /* fall through to a new project */ }
    setProject(emptyProject(), '新建谱面');
}
bindUI();
view.resize();
renderAll();
updateStatus();
requestAnimationFrame(frame);
void restore();
// Expose for debugging and automated checks.
window.__editor = { get project() { return project; }, st, view, audio, commit, setTool, seekTick, setSnap, loadBuiltin, playtest, undo, redo };
