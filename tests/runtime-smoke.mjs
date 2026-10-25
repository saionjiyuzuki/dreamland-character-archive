import { ChartRuntime } from '../dist/chart/chartRuntime.js';
import { HoldRuntime } from '../dist/gameplay/holdRuntime.js';
import { JudgeSystem } from '../dist/judge/judgeSystem.js';

const G = {
  offset: 0,
  fallTime: 1500,
  active: [], pending: [], pendingIndex: 0,
  totalNotes: 0, remaining: 0, songEnd: 0,
  holding: new Map(), char: { scoreMul: 1, lostSafe: false },
  score: 0, combo: 0, maxCombo: 0, pure: 0, great: 0, far: 0, lost: 0,
  auto: false, paused: false,
};

const chart = {
  id: 'smoke', title: 'Smoke', artist: 'test', bpm: 180, diff: 16,
  jacket: '', lanes: 4, duration: 3000,
  notes: [
    [100, 'tap', 1, 0, 0],
    [500, 'hold', 2, 600, 2, [[0, 2], [300, 3], [600, 2]]],
  ],
};

const chartRuntime = new ChartRuntime({ G, laneCountAtTime: () => 4 });
chartRuntime.load(chart);
if (G.totalNotes !== 4) throw new Error('Chart unit count mismatch');
chartRuntime.updateSpawn(0);
if (G.active.length !== 2) throw new Error('Chart spawn mismatch');

let judge;
const hold = new HoldRuntime({
  G,
  chart: chartRuntime,
  gradeOf: (note, t) => judge.gradeOf(note, t),
  applyUnitResult: (result, note, effect) => judge.applyUnitResult(result, note, effect),
  updateUI() {},
});
judge = new JudgeSystem({
  G,
  D: {},
  StateMachine: { state: 'PLAYING' },
  APP_STATE: { PLAYING: 'PLAYING' },
  chart: chartRuntime,
  hold,
  AudioEngine: { sfx() { return true; } },
  popEffect() {},
  updateUI() {},
  endGame() {},
});

judge.handleInput(1, 100, 'k1');
if (G.pure !== 1 || G.remaining !== 3) throw new Error('Tap judgement mismatch');
judge.handleInput(2, 500, 'p1');
hold.updateTicks(G.active.find(n => n.isHold), 800);
if (G.remaining !== 1) throw new Error('Hold tick processing mismatch');

console.log('DREAMLAND V11.3 runtime smoke: PASS');
