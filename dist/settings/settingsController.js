import { OFFSET_LIMIT_MS } from './latencyCalibration.js';
export const VISUAL_OFFSET_LIMIT_MS = 150;
export const DEFAULT_KEY_MAP = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'];
const DEFAULT_KEY_MAP_BY_LANES = {
    4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
    6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
    8: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
};
export function defaultKeyMapForLanes(lanes) {
    return [...(DEFAULT_KEY_MAP_BY_LANES[lanes] || DEFAULT_KEY_MAP_BY_LANES[8])];
}
export function keyCodeLabel(code) {
    if (code === 'Space')
        return 'SPACE';
    if (code.startsWith('Key'))
        return code.slice(3).toUpperCase();
    if (code.startsWith('Digit'))
        return code.slice(5);
    if (code === 'Semicolon')
        return ';';
    if (code === 'Quote')
        return "'";
    if (code === 'Comma')
        return ',';
    if (code === 'Period')
        return '.';
    if (code === 'Slash')
        return '/';
    if (code === 'Backslash')
        return '\\';
    if (code === 'Minus')
        return '-';
    if (code === 'Equal')
        return '=';
    if (code.startsWith('Arrow'))
        return code.slice(5);
    return code;
}
export function normalizeKeyCode(value, fallback) {
    if (typeof value !== 'string' || !value)
        return fallback;
    if (value.length === 1) {
        if (/^[a-z]$/i.test(value))
            return 'Key' + value.toUpperCase();
        if (value === ';')
            return 'Semicolon';
        if (value === ',')
            return 'Comma';
        if (value === '.')
            return 'Period';
        if (value === '/')
            return 'Slash';
        if (value === '\\')
            return 'Backslash';
    }
    return value;
}
/** Owns persisted preferences, lane key maps, remapping, and settings control wiring. */
export class SettingsController {
    d;
    constructor(d) {
        this.d = d;
    }
    load() {
        this.loadKeyMap();
        try {
            const raw = JSON.parse(localStorage.getItem('dreamland_settings') || '{}');
            if (Number.isFinite(raw.speed))
                this.d.G.speed = this.clamp(raw.speed, 1, 10);
            if (Number.isFinite(raw.offset))
                this.d.G.offset = this.clamp(raw.offset, -OFFSET_LIMIT_MS, OFFSET_LIMIT_MS);
            if (Number.isFinite(raw.visualOffset))
                this.d.G.visualOffset = this.clamp(raw.visualOffset, -VISUAL_OFFSET_LIMIT_MS, VISUAL_OFFSET_LIMIT_MS);
            if (Number.isFinite(raw.volume))
                this.d.G.volume = this.clamp(raw.volume, 0, 100);
        }
        catch { /* keep safe defaults */ }
    }
    syncControls() {
        const G = this.d.G;
        const speed = document.getElementById('nspeed');
        const offset = document.getElementById('noffset');
        const volume = document.getElementById('nvol');
        const visual = document.getElementById('nvisual');
        if (speed)
            speed.value = String(G.speed);
        if (offset)
            offset.value = String(G.offset);
        if (volume)
            volume.value = String(G.volume);
        if (visual)
            visual.value = String(G.visualOffset || 0);
        const speedVal = document.getElementById('speedVal');
        const offsetVal = document.getElementById('offsetVal');
        const volumeVal = document.getElementById('volumeVal');
        const visualVal = document.getElementById('visualVal');
        if (speedVal)
            speedVal.textContent = G.speed.toFixed(1);
        if (offsetVal)
            offsetVal.textContent = String(G.offset);
        if (volumeVal)
            volumeVal.textContent = String(G.volume);
        if (visualVal)
            visualVal.textContent = String(G.visualOffset || 0);
    }
    saveSettings = () => {
        try {
            localStorage.setItem('dreamland_settings', JSON.stringify({
                speed: this.d.G.speed,
                offset: this.d.G.offset,
                visualOffset: this.d.G.visualOffset || 0,
                volume: this.d.G.volume,
            }));
        }
        catch { /* storage can be unavailable in private contexts */ }
    };
    loadKeyMap() {
        try {
            const raw = JSON.parse(localStorage.getItem('dreamland_sp_keys') || 'null');
            if (Array.isArray(raw) && raw.length === 8) {
                // Migration from V10's legacy array format: a stored array represents user customization.
                this.d.G.keyMap = raw.map((value, i) => normalizeKeyCode(value, DEFAULT_KEY_MAP[i]));
                // A legacy array equal to the defaults was likely written by the old Reset button.
                this.d.G.keyMapCustom = this.d.G.keyMap.some((value, i) => value !== DEFAULT_KEY_MAP[i]);
            }
            else if (raw && Array.isArray(raw.keyMap) && raw.keyMap.length === 8) {
                this.d.G.keyMap = raw.keyMap.map((value, i) => normalizeKeyCode(value, DEFAULT_KEY_MAP[i]));
                this.d.G.keyMapCustom = !!raw.custom;
            }
        }
        catch { /* keep safe defaults */ }
    }
    saveKeyMap = () => {
        try {
            localStorage.setItem('dreamland_sp_keys', JSON.stringify({
                version: 2,
                custom: !!this.d.G.keyMapCustom,
                keyMap: this.d.G.keyMap,
            }));
        }
        catch { /* storage can be unavailable in private contexts */ }
    };
    activeKeyMap() {
        return this.d.G.keyMapCustom
            ? this.d.G.keyMap.slice(0, this.d.G.laneMode)
            : defaultKeyMapForLanes(this.d.G.laneMode);
    }
    clearWaitingKey() {
        if (this.d.G.waitingKey === null)
            return;
        this.d.G.waitingKey = null;
        this.renderKeybinds();
    }
    renderKeybinds() {
        const grid = this.d.D.keybindGrid;
        if (!grid)
            return;
        grid.innerHTML = this.d.G.keyMap.map((key, i) => `<button type="button" class="keybind ${this.d.G.waitingKey === i ? 'waiting' : ''}" data-keybind="${i}"><small>L${i + 1}</small>${keyCodeLabel(key || '?')}</button>`).join('');
    }
    /** Returns true when keydown belongs to remapping rather than gameplay. */
    consumeKeydown(event) {
        const G = this.d.G;
        if (G.waitingKey === null)
            return false;
        event.preventDefault();
        const code = event.code;
        if (code === 'Escape') {
            this.clearWaitingKey();
            return true;
        }
        if (G.keyMap.includes(code) && G.keyMap[G.waitingKey] !== code) {
            this.d.toast('该键已被占用');
            return true;
        }
        G.keyMap[G.waitingKey] = code;
        G.keyMapCustom = true;
        G.waitingKey = null;
        this.saveKeyMap();
        this.renderKeybinds();
        this.d.updateLaneUI(G.laneMode);
        return true;
    }
    bindControls() {
        const bindRange = (id, valId, fmt, fn) => {
            const el = document.getElementById(id);
            const valueEl = document.getElementById(valId);
            if (!el || !valueEl)
                return;
            el.addEventListener('input', () => {
                const value = Number.parseFloat(el.value);
                valueEl.textContent = fmt(value);
                fn(value);
            });
        };
        bindRange('nspeed', 'speedVal', value => value.toFixed(1), value => {
            this.d.G.speed = value;
            this.d.G.fallTime = this.d.computeFallTime(value);
            this.saveSettings();
            if (this.d.D.hudSpeed)
                this.d.D.hudSpeed.textContent = value.toFixed(1);
            if (this.d.G.playing)
                this.d.renderLanes();
        });
        bindRange('noffset', 'offsetVal', value => String(value), value => {
            this.d.G.offset = value;
            this.saveSettings();
        });
        bindRange('nvisual', 'visualVal', value => String(value), value => {
            this.d.G.visualOffset = value;
            this.saveSettings();
        });
        bindRange('nvol', 'volumeVal', value => String(value), value => {
            this.d.G.volume = value;
            this.d.AudioEngine.init();
            this.d.AudioEngine.setVolume(value);
            this.saveSettings();
        });
        this.d.D.keybindGrid?.addEventListener('click', (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const btn = target?.closest('.keybind');
            if (!btn)
                return;
            const index = Number(btn.dataset.keybind);
            if (!Number.isInteger(index) || index < 0 || index >= 8)
                return;
            this.d.G.waitingKey = this.d.G.waitingKey === index ? null : index;
            this.renderKeybinds();
        });
        this.d.D.keybindReset?.addEventListener('click', () => {
            this.d.G.keyMap = [...DEFAULT_KEY_MAP];
            this.d.G.keyMapCustom = false;
            this.d.G.waitingKey = null;
            this.saveKeyMap();
            this.renderKeybinds();
            this.d.updateLaneUI(this.d.G.laneMode);
            this.d.toast('已恢复默认键位');
        });
        window.addEventListener('beforeunload', this.saveSettings);
    }
    /** Apply a measured judgement offset (from latency calibration) and reflect it in the slider. */
    applyOffset(value) {
        this.d.G.offset = this.clamp(Math.round(value), -OFFSET_LIMIT_MS, OFFSET_LIMIT_MS);
        this.saveSettings();
        this.syncControls();
    }
    clamp(value, min, max) {
        return value < min ? min : value > max ? max : value;
    }
}
