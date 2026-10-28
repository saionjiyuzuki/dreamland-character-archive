import { DIFFICULTIES, DIFFICULTY_META, laneLabel, noteCount } from '../data/songs.js';
import { escapeHTML, formatDuration } from '../ui/html.js';
const SORTS = { default: '默认', level: '难度', title: '曲名', bpm: 'BPM' };
const FILTERS = { all: '全部', unlocked: '已解锁', favorite: '收藏' };
const PREFS_KEY = 'dl_select_v2', FAV_KEY = 'dl_favorites', PREVIEW_DELAY_MS = 380;
function readJSON(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key) || 'null');
        return v ?? fallback;
    }
    catch {
        return fallback;
    }
}
function writeJSON(key, value) { try {
    localStorage.setItem(key, JSON.stringify(value));
}
catch { /* optional */ } }
/**
 * Song select: song list, detail panel with difficulty picker, looping preview, and a confirmation step
 * before a chart starts (click a song to select it, click it again or press 开始演奏 to confirm).
 */
export class SongSelectController {
    d;
    songId = '';
    diff = 'HD';
    filter = 'all';
    sort = 'default';
    previewOn = true;
    favorites = new Set();
    confirming = false;
    previewTimer = null;
    constructor(d) {
        this.d = d;
        const p = readJSON(PREFS_KEY, {});
        if (p.song && d.songs.some(s => s.id === p.song))
            this.songId = p.song;
        if (DIFFICULTIES.includes(p.diff))
            this.diff = p.diff;
        if (p.filter && p.filter in FILTERS)
            this.filter = p.filter;
        if (p.sort && p.sort in SORTS)
            this.sort = p.sort;
        if (p.preview === false)
            this.previewOn = false;
        const fav = readJSON(FAV_KEY, []);
        if (Array.isArray(fav))
            for (const id of fav)
                if (typeof id === 'string')
                    this.favorites.add(id);
        d.preview?.onChange(() => this.syncPreviewState());
    }
    getBest(id) {
        try {
            return Number.parseInt(localStorage.getItem('dl_best_' + id) || '0', 10) || 0;
        }
        catch {
            return 0;
        }
    }
    getBestGrade(id) {
        try {
            return localStorage.getItem('dl_bestgrade_' + id) || '';
        }
        catch {
            return '';
        }
    }
    setBest(id, value, grade) {
        try {
            if (value > this.getBest(id)) {
                localStorage.setItem('dl_best_' + id, String(value));
                if (grade)
                    localStorage.setItem('dl_bestgrade_' + id, grade);
            }
        }
        catch { /* best scores are optional when storage is unavailable */ }
    }
    savePrefs() { writeJSON(PREFS_KEY, { song: this.songId, diff: this.diff, filter: this.filter, sort: this.sort, preview: this.previewOn }); }
    chart(song, diff) { const id = song.charts[diff]; return id ? this.d.CHARTS[id] : undefined; }
    /** The preferred difficulty if this song has it, otherwise the closest one it does have. */
    diffFor(song) {
        if (song.charts[this.diff])
            return this.diff;
        const at = DIFFICULTIES.indexOf(this.diff);
        return [...DIFFICULTIES].sort((a, b) => Math.abs(DIFFICULTIES.indexOf(a) - at) - Math.abs(DIFFICULTIES.indexOf(b) - at)).find(k => song.charts[k]) || 'SP';
    }
    visibleSongs() {
        let list = this.d.songs.slice();
        if (this.filter === 'unlocked')
            list = list.filter(s => this.d.economy.isSongUnlocked(s.id));
        if (this.filter === 'favorite')
            list = list.filter(s => this.favorites.has(s.id));
        const level = (s) => this.chart(s, this.diffFor(s))?.diff || 0;
        if (this.sort === 'level')
            list.sort((a, b) => level(a) - level(b));
        if (this.sort === 'title')
            list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
        if (this.sort === 'bpm')
            list.sort((a, b) => a.bpm - b.bpm);
        return list;
    }
    current() {
        return this.d.songs.find(s => s.id === this.songId) || this.d.songs[0];
    }
    /* ── rendering ── */
    render() {
        const list = this.d.D.songList;
        if (!list)
            return;
        const songs = this.visibleSongs();
        if (!this.d.songs.some(s => s.id === this.songId))
            this.songId = this.d.songs[0]?.id || '';
        const count = document.getElementById('selectTrackCount');
        if (count)
            count.textContent = String(songs.length).padStart(2, '0');
        list.innerHTML = songs.map(song => this.rowHTML(song)).join('') || `<div class="sel-empty">${this.filter === 'favorite' ? '还没有收藏的曲目 · 在右侧点 ☆ 收藏' : '没有符合条件的曲目'}</div>`;
        const filters = document.getElementById('selectFilters');
        if (filters)
            filters.innerHTML = Object.keys(FILTERS).map(f => `<button type="button" data-select-filter="${f}" class="${f === this.filter ? 'filter-active' : ''}">${FILTERS[f]}</button>`).join('')
                + `<button type="button" class="select-sort" data-select-sort>排序 · ${SORTS[this.sort]} ↕</button>`;
        this.renderDetail();
        this.renderConfirm();
    }
    rowHTML(song) {
        const unlocked = this.d.economy.isSongUnlocked(song.id), diff = this.diffFor(song), chart = this.chart(song, diff);
        const best = chart ? this.getBest(chart.id) : 0, grade = chart ? this.getBestGrade(chart.id) : '';
        const pips = DIFFICULTIES.map(k => {
            const c = this.chart(song, k);
            return `<i class="pip ${k.toLowerCase()}${c ? '' : ' none'}${k === diff ? ' on' : ''}" title="${k}">${c ? c.diff : '–'}</i>`;
        }).join('');
        return `<button type="button" class="sel-song${song.id === this.songId ? ' active' : ''}${unlocked ? '' : ' locked'}" data-select-song="${escapeHTML(song.id)}" style="--accent:${song.accent}">
      <span class="sel-jacket">${escapeHTML(song.jacket)}</span>
      <span class="sel-copy"><strong>${escapeHTML(song.title)}${song.tag ? `<em class="sel-tag ${song.tag.toLowerCase()}">${song.tag}</em>` : ''}${this.favorites.has(song.id) ? '<em class="sel-fav">★</em>' : ''}</strong><small>${escapeHTML(song.artist)}</small></span>
      <span class="sel-pips">${pips}</span>
      <span class="sel-best">${unlocked ? (best ? `<b>${grade || ''}</b>${best.toLocaleString()}` : '<span>NO PLAY</span>') : `🔒 ✧ ${this.d.economy.songPrice(song.id)}`}</span>
    </button>`;
    }
    renderDetail() {
        const panel = document.getElementById('selectDetail');
        const song = this.current();
        if (!panel || !song)
            return;
        const diff = this.diffFor(song), chart = this.chart(song, diff), unlocked = this.d.economy.isSongUnlocked(song.id);
        const best = chart ? this.getBest(chart.id) : 0, grade = chart ? this.getBestGrade(chart.id) : '';
        const meta = DIFFICULTY_META[diff];
        const tabs = DIFFICULTIES.map(k => {
            const c = this.chart(song, k);
            return `<button type="button" class="diff-tab ${k.toLowerCase()}${k === diff ? ' active' : ''}" data-select-diff="${k}" ${c ? '' : 'disabled'}><small>${k}</small><b>${c ? c.diff : '—'}</b></button>`;
        }).join('');
        const previewing = !!this.d.preview?.current;
        panel.style.setProperty('--accent', song.accent);
        panel.style.setProperty('--diff', meta.color);
        panel.innerHTML = `
      <div class="sd-art${previewing ? ' playing' : ''}"><div class="select-art-orbit orbit-a"></div><div class="select-art-orbit orbit-b"></div><div class="sd-jacket">${escapeHTML(song.jacket)}</div>
        <div class="sd-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <button type="button" class="sd-preview${this.previewOn ? ' on' : ''}" data-select-preview-toggle aria-label="切换试听">${this.previewOn ? (previewing ? '♪ 试听中' : '♪ 试听') : '♪ 试听已关闭'}</button>
        <button type="button" class="sd-fav${this.favorites.has(song.id) ? ' on' : ''}" data-select-fav aria-label="收藏">${this.favorites.has(song.id) ? '★' : '☆'}</button></div>
      <div class="sd-head"><small>${song.tag ? `${song.tag} · ` : ''}BPM ${Math.round(song.bpm)} · ${formatDuration(song.duration)}</small><h2>${escapeHTML(song.title)}</h2><p>${escapeHTML(song.artist)}</p></div>
      <div class="select-difficulty-title"><span>DIFFICULTY</span><i></i><small>← → 切换难度</small></div>
      <div class="diff-tabs">${tabs}</div>
      <div class="sd-diff-info"><b>${diff} / ${meta.name} · LV.${chart?.diff ?? '—'}</b><span>${meta.desc}</span></div>
      <div class="sd-stats">
        <div><small>NOTES</small><b>${chart ? noteCount(chart).toLocaleString() : '—'}</b></div>
        <div><small>LANES</small><b>${chart ? laneLabel(chart) : '—'}</b></div>
        <div><small>BEST</small><b>${best ? best.toLocaleString() : '—'}</b></div>
        <div><small>RANK</small><b class="sd-grade ${grade}">${grade || '—'}</b></div>
      </div>
      ${unlocked
            ? `<button type="button" class="sd-start" data-select-start ${chart ? '' : 'disabled'}><span>▶ 开始演奏</span><small>ENTER · 再次点击曲目也可开始</small></button>`
            : `<button type="button" class="sd-start locked" data-select-buy><span>🔒 前往商店解锁</span><small>✧ ${this.d.economy.songPrice(song.id)} Crystal · 解锁后全部难度可玩</small></button>`}`;
        const top = document.querySelector('.select-top-score');
        if (top)
            top.innerHTML = `<small>BEST · ${diff} LV.${chart?.diff ?? '—'}</small><strong>${best ? best.toLocaleString().padStart(9, ' ') : '— — — — — —'}</strong><span>RANK ${grade || '—'}</span>`;
    }
    renderConfirm() {
        const box = document.getElementById('selectConfirm');
        if (!box)
            return;
        const song = this.current();
        box.classList.toggle('hidden', !this.confirming || !song);
        if (!this.confirming || !song) {
            box.innerHTML = '';
            return;
        }
        const diff = this.diffFor(song), chart = this.chart(song, diff), meta = DIFFICULTY_META[diff];
        if (!chart)
            return;
        const best = this.getBest(chart.id);
        box.style.setProperty('--accent', song.accent);
        box.style.setProperty('--diff', meta.color);
        box.innerHTML = `<div class="sc-backdrop" data-select-confirm-cancel></div>
      <section class="sc-panel" role="dialog" aria-modal="true" aria-label="确认开始">
        <small class="sc-kicker">READY TO PLAY · 确认开始</small>
        <div class="sc-song"><span class="sc-jacket">${escapeHTML(song.jacket)}</span><div><h3>${escapeHTML(song.title)}</h3><p>${escapeHTML(song.artist)}</p></div></div>
        <div class="sc-diff"><b>${diff}</b><span>${meta.name}</span><strong>LV.${chart.diff}</strong></div>
        <dl class="sc-info"><div><dt>NOTES</dt><dd>${noteCount(chart).toLocaleString()}</dd></div><div><dt>LANES</dt><dd>${laneLabel(chart)}</dd></div><div><dt>SPEED</dt><dd>${Number(this.d.G.speed || 5).toFixed(1)}</dd></div><div><dt>BEST</dt><dd>${best ? best.toLocaleString() : '—'}</dd></div></dl>
        <div class="sc-actions"><button type="button" class="sc-cancel" data-select-confirm-cancel>返回 <small>ESC</small></button><button type="button" class="sc-go" data-select-confirm-go>开始演奏 <small>ENTER</small></button></div>
      </section>`;
        box.querySelector('[data-select-confirm-go]')?.focus?.();
    }
    syncPreviewState() {
        const playing = !!this.d.preview?.current;
        document.querySelector('#selectDetail .sd-art')?.classList.toggle('playing', playing);
        const btn = document.querySelector('[data-select-preview-toggle]');
        if (btn)
            btn.textContent = this.previewOn ? (playing ? '♪ 试听中' : '♪ 试听') : '♪ 试听已关闭';
    }
    /* ── actions ── */
    schedulePreview() {
        if (this.previewTimer)
            clearTimeout(this.previewTimer);
        this.previewTimer = null;
        const song = this.current();
        if (!song || !this.previewOn || !this.d.preview) {
            this.d.preview?.stop();
            return;
        }
        this.previewTimer = setTimeout(() => {
            this.previewTimer = null;
            if (this.d.StateMachine.state !== this.d.APP_STATE.SELECT)
                return;
            const chartId = song.charts.SP || Object.values(song.charts)[0];
            const url = chartId ? this.d.audioUrl?.(chartId) : undefined;
            if (url)
                void this.d.preview?.play(url, song.previewStartMs);
        }, PREVIEW_DELAY_MS);
    }
    selectSong(id) {
        if (id === this.songId || !this.d.songs.some(s => s.id === id))
            return;
        this.songId = id;
        this.confirming = false;
        this.savePrefs();
        this.render();
        document.querySelector('.sel-song.active')?.scrollIntoView?.({ block: 'nearest' });
        this.schedulePreview();
    }
    setDifficulty(key) {
        const song = this.current();
        if (!song?.charts[key] || this.diffFor(song) === key)
            return;
        this.diff = key;
        this.savePrefs();
        this.render();
    }
    stepSong(delta) {
        const list = this.visibleSongs();
        if (!list.length)
            return;
        const i = list.findIndex(s => s.id === this.songId);
        this.selectSong(list[(Math.max(0, i) + delta + list.length) % list.length].id);
    }
    stepDifficulty(delta) {
        const song = this.current();
        if (!song)
            return;
        const have = DIFFICULTIES.filter(k => song.charts[k]);
        const i = have.indexOf(this.diffFor(song));
        const next = have[Math.max(0, Math.min(have.length - 1, i + delta))];
        if (next)
            this.setDifficulty(next);
    }
    /** First step: open the confirmation panel (and start decoding the audio meanwhile). */
    requestStart() {
        if (this.d.StateMachine.state !== this.d.APP_STATE.SELECT)
            return;
        const song = this.current();
        if (!song)
            return;
        if (!this.d.economy.isSongUnlocked(song.id)) {
            this.d.economy.open('songs', song.id);
            return;
        }
        const chart = this.chart(song, this.diffFor(song));
        if (!chart)
            return;
        this.confirming = true;
        void this.d.AudioEngine.prime(chart.id);
        this.renderConfirm();
    }
    cancelStart() { if (!this.confirming)
        return; this.confirming = false; this.renderConfirm(); }
    /** Second step: actually start the chart. */
    confirmStart() {
        if (!this.confirming || this.d.StateMachine.state !== this.d.APP_STATE.SELECT)
            return;
        const song = this.current(), chart = song && this.chart(song, this.diffFor(song));
        this.confirming = false;
        this.renderConfirm();
        if (!song || !chart || !this.d.economy.isSongUnlocked(song.id))
            return;
        this.leave();
        this.d.startGame(chart);
    }
    /** Called when the song select page becomes visible. */
    enter() { this.confirming = false; this.render(); this.schedulePreview(); }
    /** Called when leaving song select for any other state. */
    leave() {
        if (this.previewTimer) {
            clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
        this.d.preview?.stop();
        if (this.confirming) {
            this.confirming = false;
            this.renderConfirm();
        }
    }
    bindEvents() {
        document.addEventListener('click', (event) => {
            if (this.d.StateMachine.state !== this.d.APP_STATE.SELECT)
                return;
            const t = event.target instanceof Element ? event.target : null;
            if (!t)
                return;
            if (t.closest('[data-select-confirm-go]')) {
                this.confirmStart();
                return;
            }
            if (t.closest('[data-select-confirm-cancel]')) {
                this.cancelStart();
                return;
            }
            const row = t.closest('[data-select-song]');
            if (row?.dataset.selectSong) {
                if (row.dataset.selectSong === this.songId)
                    this.requestStart();
                else
                    this.selectSong(row.dataset.selectSong);
                return;
            }
            const tab = t.closest('[data-select-diff]');
            if (tab?.dataset.selectDiff) {
                this.setDifficulty(tab.dataset.selectDiff);
                return;
            }
            if (t.closest('[data-select-start]')) {
                this.requestStart();
                return;
            }
            if (t.closest('[data-select-buy]')) {
                this.requestStart();
                return;
            }
            if (t.closest('[data-select-preview-toggle]')) {
                this.previewOn = !this.previewOn;
                this.savePrefs();
                if (this.previewOn)
                    this.schedulePreview();
                else {
                    this.d.preview?.stop();
                }
                this.syncPreviewState();
                return;
            }
            if (t.closest('[data-select-fav]')) {
                const id = this.songId;
                if (this.favorites.has(id))
                    this.favorites.delete(id);
                else
                    this.favorites.add(id);
                writeJSON(FAV_KEY, [...this.favorites]);
                this.render();
                return;
            }
            const filter = t.closest('[data-select-filter]');
            if (filter?.dataset.selectFilter) {
                this.filter = filter.dataset.selectFilter;
                this.savePrefs();
                this.render();
                return;
            }
            if (t.closest('[data-select-sort]')) {
                const keys = Object.keys(SORTS);
                this.sort = keys[(keys.indexOf(this.sort) + 1) % keys.length];
                this.savePrefs();
                this.render();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (this.d.StateMachine.state !== this.d.APP_STATE.SELECT || this.d.G.waitingKey != null)
                return;
            const k = e.key;
            if (this.confirming) {
                if (k === 'Enter') {
                    e.preventDefault();
                    this.confirmStart();
                }
                else if (k === 'Escape' || k === 'Backspace') {
                    e.preventDefault();
                    this.cancelStart();
                }
                return;
            }
            if (k === 'ArrowDown') {
                e.preventDefault();
                this.stepSong(1);
            }
            else if (k === 'ArrowUp') {
                e.preventDefault();
                this.stepSong(-1);
            }
            else if (k === 'ArrowRight') {
                e.preventDefault();
                this.stepDifficulty(1);
            }
            else if (k === 'ArrowLeft') {
                e.preventDefault();
                this.stepDifficulty(-1);
            }
            else if (k === 'Enter') {
                e.preventDefault();
                this.requestStart();
            }
            else if (k === 'Escape') {
                e.preventDefault();
                this.d.navigate?.('main');
            }
        });
    }
}
