import { SettingsController, DEFAULT_KEY_MAP } from '../dist/settings/settingsController.js';
import { SongSelectController } from '../dist/select/songSelectController.js';
import { ResultController } from '../dist/result/resultController.js';
import { UIController } from '../dist/ui/uiController.js';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); },
};
globalThis.window = { addEventListener() {} };
function makeClassList() {
  const set = new Set();
  return {
    add(...names) { names.forEach(n => set.add(n)); },
    remove(...names) { names.forEach(n => set.delete(n)); },
    contains(name) { return set.has(name); },
    toggle(name, force) {
      const next = force === undefined ? !set.has(name) : !!force;
      if (next) set.add(name); else set.delete(name);
      return next;
    },
  };
}
function makeElement() {
  return {
    textContent: '', innerHTML: '', value: '', dataset: {}, className: '', style: { setProperty() {} },
    classList: makeClassList(), listeners: {}, querySelector() { return null; },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    appendChild(child) { this.child = child; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  };
}
const elements = new Map();
globalThis.document = {
  getElementById(id) { if (!elements.has(id)) elements.set(id, makeElement()); return elements.get(id); },
  createElement() { return makeElement(); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  head: makeElement(),
  addEventListener() {},
};

// Settings load preserves a real zero volume and migrates legacy keymaps.
store.set('dreamland_settings', JSON.stringify({ speed: 7, offset: -15, volume: 0 }));
store.set('dreamland_sp_keys', JSON.stringify(['KeyQ', ...DEFAULT_KEY_MAP.slice(1)]));
const G = { speed: 5, offset: 0, volume: 70, keyMap: [...DEFAULT_KEY_MAP], keyMapCustom: false, laneMode: 4, waitingKey: null, playing: false, fallTime: 1500 };
const D = {
  keybindGrid: makeElement(), keybindReset: makeElement(), hudSpeed: makeElement(), laneSvg: makeElement(),
  songList: makeElement(), charGrid: makeElement(), storyTitle: makeElement(), storyContent: makeElement(),
  resultGrade: makeElement(), resultSong: makeElement(), rPure: makeElement(), rGreat: makeElement(), rFar: makeElement(), rLost: makeElement(), rCombo: makeElement(), rScore: makeElement(),
  gameplay: makeElement(), keysContainer: makeElement(), pauseBtn: makeElement(), autoBtn: makeElement(), pauseMask: makeElement(), screen: makeElement(),
};
let toastText = '';
let lanesUpdated = 0;
const Settings = new SettingsController({
  G, D, AudioEngine: { init() {}, setVolume() {} }, toast: msg => { toastText = msg; },
  updateLaneUI() { lanesUpdated++; }, computeFallTime: speed => 7500 / speed, renderLanes() {},
});
Settings.load();
if (G.speed !== 7 || G.offset !== -15 || G.volume !== 0) throw new Error('Settings persistence failed');
if (Settings.activeKeyMap()[0] !== 'KeyQ') throw new Error('Legacy custom keymap migration failed');
Settings.syncControls();
if (document.getElementById('nvol').value !== '0') throw new Error('Volume UI failed to preserve zero');
G.waitingKey = 0;
const event = { code: 'KeyZ', preventDefault() {} };
if (!Settings.consumeKeydown(event) || G.keyMap[0] !== 'KeyZ' || !G.keyMapCustom) throw new Error('Key remapping failed');
const savedKeys = JSON.parse(store.get('dreamland_sp_keys'));
if (savedKeys.version !== 2 || savedKeys.keyMap[0] !== 'KeyZ') throw new Error('Versioned keymap persistence failed');

// Song selection owns list output, best-score persistence and the two-step start.
const chart = { id: 'demo', title: 'Demo', artist: 'Unit Test', bpm: 180, diff: 16, jacket: 'D', lanes: 4, duration: 1000, notes: [] };
const demoSong = { id: 'demo_song', title: 'Demo', artist: 'Unit Test', jacket: 'D', accent: '#fff', bpm: 180, duration: 1, price: 0, charts: { HD: 'demo' }, previewStartMs: 0 };
let selectedChart = null;
const selectState = { state: 'SELECT' };
const SongSelect = new SongSelectController({
  D, G, CHARTS: { demo: chart }, songs: [demoSong], StateMachine: selectState, APP_STATE: { SELECT: 'SELECT' },
  AudioEngine: { prime() {} }, economy: { isSongUnlocked() { return true; }, songPrice() { return 0; }, open() {} }, startGame(value) { selectedChart = value; },
});
SongSelect.render();
if (!D.songList.innerHTML.includes('data-select-song="demo_song"')) throw new Error('Song list render failed');
SongSelect.setBest('demo', 12345, 'S');
if (SongSelect.getBest('demo') !== 12345 || SongSelect.getBestGrade('demo') !== 'S') throw new Error('Best score persistence failed');
SongSelect.requestStart();
if (selectedChart) throw new Error('First step must only open the confirmation');
SongSelect.confirmStart();
if (selectedChart !== chart) throw new Error('Song selection routing failed');

// Result rendering owns the score presentation and visible-page switch.
let visiblePageId = null;
const resultG = { pure: 8, great: 1, far: 1, lost: 0, score: 987654, maxCombo: 9, chart, autoUsed: false, playing: true, paused: false, page: 'gameplay' };
const Result = new ResultController({
  D, G: resultG, PAGES: ['Main', 'SongSelect', 'Result'],
  StateMachine: { state: 'RESULT', transition() { return true; } },
  APP_STATE: { RESULT: 'RESULT', SELECT: 'SELECT', LOADING: 'LOADING' }, AudioEngine: { prime() {} },
  setBest: (id, score) => SongSelect.setBest(id, score), economy: { grantPlayRewards() { return { coin: 30, exp: 60, levelUps: 0, passUps: 0 }; } }, visiblePage(id) { visiblePageId = id; },
});
Result.show();
if (visiblePageId !== 'pageResult' || D.rScore.textContent !== '987,654' || resultG.playing || resultG.page !== 'result') throw new Error('Result rendering failed');
if (SongSelect.getBest('demo') !== 987654) throw new Error('Result did not persist best score');

// UI page visibility/navigation core is independently testable.
const uiG = { menuPage: 'main', page: 'main', waitingKey: null, char: { id: 'c1' }, storyIdx: 0 };
const uiStateMachine = { state: 'MENU', context: null, transition(next, ctx) { this.state = next; this.context = ctx || {}; return true; } };
const UI = new UIController({
  D, G: uiG, PAGES: ['Main', 'SongSelect', 'Settings', 'Result'],
  StateMachine: uiStateMachine, APP_STATE: { MENU: 'MENU', SELECT: 'SELECT', RESULT: 'RESULT', PAUSED: 'PAUSED' },
  CHARACTERS: [{ id: 'c1', name: 'C', emoji: 'C', level: 1, skill: 'S', unlocked: true }],
  STORY: [{ title: 'Chapter', content: 'Text' }], clearWaitingKey() { uiG.waitingKey = null; },
});
for (const page of ['Main', 'SongSelect', 'Settings', 'Result', 'Loading', 'Fatal']) document.getElementById('page' + page).classList.add('hidden');
UI.visiblePage('pageSettings');
if (document.getElementById('pageSettings').classList.contains('hidden') || !document.getElementById('pageMain').classList.contains('hidden')) throw new Error('UI page visibility failed');
UI.renderCharacters();
UI.renderStory();
if (!D.charGrid.innerHTML.includes('char-card') || D.storyTitle.textContent !== 'Chapter') throw new Error('UI module render failed');
UI.navigate('songSelect');
if (uiG.waitingKey !== null || uiStateMachine.state !== 'SELECT') throw new Error('UI navigation/cleanup failed');
UI.navigate('main');
if (uiStateMachine.state !== 'MENU') throw new Error('UI return navigation failed');

console.log('DREAMLAND V12.10 controller smoke: PASS');
