// @ts-nocheck
// V11 typed-core boundary: gameplay/UI remains in a compatibility layer while the core services are typed modules.
import { APP_STATE, PAUSE_REASON, ALLOWED_TRANSITIONS, setStateHooks } from './state/stateMachine.js';
import { GameClock } from './core/gameClock.js';
import { AudioEngine, setAudioGamePlaying } from './audio/audioEngine.js';
import { CHARTS } from './data/charts.js';
import { CHARACTERS } from './data/characters.js';
import { STORY } from './data/story.js';
import { AUDIO_SOURCES_TEST } from './data/audioMap.js';
import { createNoteRenderer, renderLanes as renderLanesImpl } from './render/renderer.js';
import { HitEffectLayer } from './render/hitEffects.js';
import { activeHitEffect } from './cosmetics/catalog.js';
import { GameplaySession } from './gameplay/gameplaySession.js';
import { InputController } from './input/input.js';
import { ChartRuntime } from './chart/chartRuntime.js';
import { HoldRuntime } from './gameplay/holdRuntime.js';
import { JudgeSystem } from './judge/judgeSystem.js';
import { UIController } from './ui/uiController.js';
import { SettingsController, DEFAULT_KEY_MAP, keyCodeLabel } from './settings/settingsController.js';
import { LatencyCalibration } from './settings/latencyCalibration.js';
import { SongSelectController } from './select/songSelectController.js';
import { ResultController } from './result/resultController.js';
import { EconomyService } from './economy/economyService.js';
import { SONGS } from './data/songs.js';
import { PreviewPlayer } from './audio/previewPlayer.js';
import { MultiHoldAdapter } from './integration/MultiHoldAdapter.js';
import { sampleMultiHoldPath } from './chart/holdPath.js';
import { buildMultiHoldOccupations, resolveMultiHoldConflicts } from './runtime/LaneOccupation.js';
import type { MultiHoldNote } from './chart/multiHoldSchema.js';
import { backdropShapes, drawTrackBackdrop } from './render/trackBackdrop.js';


/* ── 3D 透视参数 ── */
const PERSP = {
  horizonRatio: 0.10,   // 地平线 y 比例
  judgeRatio: 0.82,     // 判定线 y 比例
  kTop: 0.05,           // 轨道路径顶端的最小 k
};
const DEFAULT_LANE_COUNT = 6;
function laneCount(){ return Number(G.laneCount) || DEFAULT_LANE_COUNT; }
function visualLaneCount(){ return Number.isFinite(Number(G.visualLaneCount)) ? Number(G.visualLaneCount) : laneCount(); }
function perspectiveProfile(lc){
  const n=Number(lc)||DEFAULT_LANE_COUNT;
  const cxShift=n===4?0:(n===6?0.007:(n===8?-0.007:0));
  const hShift=n===4?0:(n===6?0.008:(n===8?-0.008:0));
  return {cxRatio:0.5+cxShift,horizonRatio:PERSP.horizonRatio+hShift,judgeRatio:PERSP.judgeRatio};
}
function visualPerspective(){
  const w=Layout.w||1,h=Layout.h||1,lc=visualLaneCount(),prof=perspectiveProfile(lc);
  return {
    cx:Number.isFinite(G.visualPerspectiveCx)?G.visualPerspectiveCx:w*prof.cxRatio,
    horizonY:Number.isFinite(G.visualHorizonY)?G.visualHorizonY:h*prof.horizonRatio,
    judgeY:Number.isFinite(G.visualJudgeY)?G.visualJudgeY:h*prof.judgeRatio
  };
}
function laneCountAtTime(ms){
  const secs=Math.max(0, Number(ms)||0)/1000;
  const segs=G.chart && Array.isArray(G.chart.laneSections) ? G.chart.laneSections : [];
  for(const s of segs){ if(secs>=s[0] && secs<s[1]) return Number(s[2])||DEFAULT_LANE_COUNT; }
  return segs.length ? Number(segs[segs.length-1][2])||4 : (G.chart?.lanes||DEFAULT_LANE_COUNT);
}
function noteLaneCount(n){ return Number(n.laneCount)||laneCountAtTime(n.time); }
function laneModeLabel(n){ return `${n}K`; }
let Settings: SettingsController;
let UI: UIController;
let SongSelect: SongSelectController;
let Result: ResultController;
let Economy: EconomyService;

function updateLaneUI(n){
  G.laneMode=n;
  G.waitingKey=null;
  if(D.hudLanes) D.hudLanes.textContent=laneModeLabel(n);
  const keys=D.keysContainer.querySelectorAll('.key');
  keys.forEach((k,i)=>{
    k.style.display=i<n?'flex':'none';
    const keyMap=Settings.activeKeyMap(); const sp=k.querySelector('span'); if(sp) sp.textContent=keyCodeLabel(keyMap[i]||DEFAULT_KEY_MAP[i]||'');
  });
}
function activeKeyMap(){ return Settings.activeKeyMap(); }
function renderKeybinds(){ Settings.renderKeybinds(); }

const PURE_W = 45;
const GREAT_W = 90;
const FAR_W = 160;

const $ = (s, r) => (r || document).querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* AudioEngine is provided by ./audio/audioEngine.ts (single implementation; fetches the files in public/audio/). */

/* ════════════ DOM ════════════ */
const D = {
  app:$('.app'), screen:$('#screen'),
  gameplay:$('#gameplay'),
  laneSvg:$('#laneSvg'),
  judgeLine:$('#judgeLine'),
  noteCanvas:$('#noteCanvas'),
  judgments:$('#judgmentsContainer'),
  combo:$('#comboDisplay'), score:$('#scoreDisplay'),
  hudSpeed:$('#hudSpeed'), hudLanes:$('#hudLanes'), progressFill:$('#progressFill'),
  keysContainer:$('#keysContainer'),
  songList:$('#songList'), charGrid:$('#charGrid'),
  storyTitle:$('#storyTitle'), storyContent:$('#storyContent'),
  resultGrade:$('#resultGrade'), resultSong:$('#resultSong'),
  pageLoading:$('#pageLoading'), loadingTitle:$('#loadingTitle'), loadingScopeText:$('#loadingScopeText'),
  loadingSongActions:$('#loadingSongActions'), loadingCancelBtn:$('#loadingCancelBtn'),
  pageFatal:$('#pageFatal'), fatalDetail:$('#fatalDetail'), fatalReloadBtn:$('#fatalReloadBtn'),
  pauseTitle:$('#pauseTitle'), pauseHint:$('#pauseHint'),
  rPure:$('#rPure'), rGreat:$('#rGreat'), rFar:$('#rFar'), rLost:$('#rLost'),
  rCombo:$('#rCombo'), rScore:$('#rScore'), keybindGrid:$('#keybindGrid'), keybindReset:$('#keybindReset'),
  pauseBtn:$('#pauseBtn'), pauseMask:$('#pauseMask'), autoBtn:$('#autoBtn')
};

/* ════════════ 兼容镜像状态（真实状态由 StateMachine 管理） ════════════ */
const G = {
  state:'BOOT', stateContext:null, menuPage:'main', selectedSongId:null,
  page:'main', char:CHARACTERS[0],
  speed:5, offset:0, visualOffset:0, volume:70,
  playing:false, paused:false, pausedReason:null,
  chart:null,
  fallTime:1500,
  score:0, combo:0, maxCombo:0,
  pure:0, great:0, far:0, lost:0,
  timingStats:{early:0,late:0,earlySum:0,lateSum:0,count:0,sum:0},
  totalNotes:0, remaining:0, songEnd:0,
  pending:[], pendingIndex:0, active:[], holding:new Map(), multiHoldPointers:new Map(),
  rafId:null, driftTimer:null, laneTransitionRaf:0, loadingToken:0, audioStartTimer:null, audioStarted:false, audioStallTimer:null,
  lastScore:'', lastCombo:'', preludeMs:900, storyIdx:0, auto:false, autoUsed:false, laneMode:DEFAULT_LANE_COUNT, keyMap:[...DEFAULT_KEY_MAP], keyMapCustom:false, waitingKey:null
};

const Layout = { w:0, h:0,
  update(){
    const r = D.screen.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
  }

};

const NoteRenderer = createNoteRenderer(D,Layout);
const HitFx = new HitEffectLayer();
const HIT_GRADE_BY_TEXT = { EXCELLENT:'PURE', GREAT:'GREAT', GOOD:'FAR' };
function renderLanes(){renderLanesImpl({D,Layout,G,PERSP,visualPerspective,visualLaneCount,perspectiveProfile});}
NoteRenderer.init();

/* ════════════ V10 Canvas Note Renderer · Hold Cache + Batch · AudioEngine Factory ════════════ */


function syncStateMirror(){
  G.state = StateMachine.state;
  setAudioGamePlaying(StateMachine.state===APP_STATE.PLAYING && !!G.audioStarted);
  G.stateContext = StateMachine.context;
  G.playing = StateMachine.state===APP_STATE.PLAYING || StateMachine.state===APP_STATE.PAUSED;
  G.paused = StateMachine.state===APP_STATE.PAUSED;
  G.pausedReason = StateMachine.context && StateMachine.context.reason || null;
}

const StateMachine = {
  state:APP_STATE.BOOT,
  context:null,
  transition(next, context={}){
    const prev=this.state;
    if(next===prev){ this.context=context; syncStateMirror(); return true; }
    let allowed = ALLOWED_TRANSITIONS[prev] || [];
    if(prev===APP_STATE.LOADING){
      const scope=this.context && this.context.scope;
      allowed = scope==='app' ? [APP_STATE.MENU,APP_STATE.ERROR_FATAL] : [APP_STATE.SELECT,APP_STATE.PLAYING];
    }
    if(!allowed.includes(next)){
      console.warn('[StateMachine] illegal transition',prev,'→',next,this.context);
      return false;
    }
    const prevContext=this.context;
    this.state=next;
    this.context=context || {};
    try{
      syncStateMirror();
      StateHooks.enter(next,this.context,prev);
      return true;
    }catch(err){
      console.error('[StateMachine] transition hook failed; rolling back',prev,'←',next,err);
      this.state=prev; this.context=prevContext; syncStateMirror();
      try{ StateHooks.restore(prev,prevContext); }catch(restoreErr){ console.error('[StateMachine] visual restore failed',restoreErr); }
      toast('状态切换失败，已回滚');
      return false;
    }
  },
  resetToBoot(){ this.state=APP_STATE.BOOT; this.context=null; syncStateMirror(); }
};


const PAGES = ['Main', 'SongSelect', 'Character', 'Story', 'Settings', 'Pass', 'Shop', 'Result'];
UI = new UIController({
  D, G, PAGES, StateMachine, APP_STATE, CHARACTERS, STORY,
  clearWaitingKey: () => Settings.clearWaitingKey(),
  onMenuPage: (page) => Economy?.showPage(page),
});
const visiblePage = (id) => UI.visiblePage(id);
const navigateMenuPage = (page) => UI.navigateMenuPage(page);
const toast = (msg) => UI.toast(msg);
const Preview = new PreviewPlayer(AudioEngine);
const audioUrl = (chartId) => AUDIO_SOURCES_TEST[chartId];
Economy = new EconomyService(CHARTS, toast);
SongSelect = new SongSelectController({ D, G, CHARTS, songs: SONGS, StateMachine, APP_STATE, AudioEngine, startGame, economy: Economy, preview: Preview, audioUrl, navigate: (page) => UI.navigate(page) });
Economy.setOptions({ navigate: (page) => UI.navigate(page), preview: Preview, audioUrl, selectSong: (id) => SongSelect.selectSong(id) });
Result = new ResultController({
  D, G, StateMachine, APP_STATE, AudioEngine,
  setBest: (songId, score, grade) => SongSelect.setBest(songId, score, grade),
  visiblePage, economy: Economy,
});
const showResult = () => Result.show();
Settings = new SettingsController({
  G, D, AudioEngine, toast, updateLaneUI, computeFallTime, renderLanes,
});

const StateHooks = {
  enter(state,ctx,prev){
    // Song previews belong to song select (and the shop page, which lives in MENU).
    if(state!==APP_STATE.SELECT) SongSelect.leave();
    if(state!==APP_STATE.MENU) Economy.showPage('');
    switch(state){
      case APP_STATE.BOOT:
        break;
      case APP_STATE.LOADING:
        this.enterLoading(ctx,prev); break;
      case APP_STATE.MENU:
        this.enterMenu(ctx); break;
      case APP_STATE.SELECT:
        this.enterSelect(ctx); break;
      case APP_STATE.PLAYING:
        GameSession.enterPlaying(ctx); break;
      case APP_STATE.PAUSED:
        GameSession.enterPaused(ctx); break;
      case APP_STATE.RESULT:
        GameSession.enterResult(); break;
      case APP_STATE.ERROR_FATAL:
        this.enterFatal(ctx); break;
    }
  },
  enterLoading(ctx){
    visiblePage('pageLoading');
    D.gameplay.classList.remove('active');
    D.keysContainer.classList.remove('show');
    D.pauseBtn.classList.remove('show');
    D.autoBtn.classList.remove('show');
    D.pauseMask.classList.remove('show');
    if(ctx.scope==='app'){
      D.loadingTitle.textContent='准备梦境';
      D.loadingScopeText.textContent='正在初始化应用资源';
      D.loadingSongActions.style.display='none';
      loadAppScope();
    }else{
      D.loadingTitle.textContent=(ctx.chart?.title || '歌曲')+' · 加载中';
      D.loadingScopeText.textContent='正在准备谱面与音频资源';
      D.loadingSongActions.style.display='block';
      loadSongScope(ctx.chart,ctx.token);
    }
  },
  enterMenu(ctx){
    Settings.clearWaitingKey();
    GameSession.stopGameplayForMenu();
    visiblePage('pageMain');
    const target=(ctx && ctx.page) || 'main';
    navigateMenuPage(target);
  },
  enterSelect(ctx){
    Settings.clearWaitingKey();
    GameSession.stopGameplayForMenu();
    visiblePage('pageSongSelect');
    D.pauseMask.classList.remove('show');
    G.menuPage='songSelect'; G.page='songSelect';
    SongSelect.enter();
    if(ctx && ctx.toast) toast(ctx.toast);
  },
  enterFatal(ctx){
    GameSession.stopGameplayHard();
    visiblePage('pageFatal');
    D.fatalDetail.textContent = ctx?.message || '应用级资源加载失败。';
  },
  restore(state,ctx){
    switch(state){
      case APP_STATE.MENU:
        GameSession.stopGameplayForMenu();
        visiblePage('pageMain');
        navigateMenuPage((ctx&&ctx.page)||'main');
        break;
      case APP_STATE.SELECT:
        GameSession.stopGameplayForMenu();
        visiblePage('pageSongSelect');
        Settings.clearWaitingKey();
        G.menuPage='songSelect'; G.page='songSelect'; SongSelect.render();
        break;
      case APP_STATE.PLAYING:
        visiblePage(null); D.gameplay.classList.add('active'); D.keysContainer.classList.add('show');
        D.pauseBtn.classList.add('show'); D.autoBtn.classList.add('show'); D.pauseMask.classList.remove('show');
        renderLanes();
        break;
      case APP_STATE.PAUSED:
        visiblePage(null); D.gameplay.classList.add('active'); D.keysContainer.classList.add('show');
        D.pauseBtn.classList.add('show'); D.autoBtn.classList.remove('show');
        GameSession.enterPaused(ctx||{reason:PAUSE_REASON.USER});
        break;
      case APP_STATE.RESULT:
        visiblePage('pageResult');
        break;
      case APP_STATE.LOADING:
        visiblePage('pageLoading');
        break;
      case APP_STATE.ERROR_FATAL:
        this.enterFatal(ctx||{});
        break;
      default: break;
    }
  }
};

setStateHooks(StateHooks);

async function loadAppScope(){
  const token=++G.loadingToken;
  try{
    // 当前 V7 的 app-scope 资源主要是内嵌数据与基础运行时；保留异步边界，供后续 JSON 化继续使用。
    await Promise.resolve();
    if(token!==G.loadingToken || StateMachine.state!==APP_STATE.LOADING || StateMachine.context.scope!=='app') return;
    StateMachine.transition(APP_STATE.MENU,{page:'main'});
  }catch(err){
    if(token!==G.loadingToken) return;
    StateMachine.transition(APP_STATE.ERROR_FATAL,{message:'应用级资源加载失败：'+(err?.message || String(err))});
  }
}

async function loadSongScope(chart,token){
  if(!chart || token!==G.loadingToken) return;
  if(!AUDIO_SOURCES_TEST[chart.id]){
    G.loadingToken++;
    StateMachine.transition(APP_STATE.SELECT,{toast:'该曲目缺少本地音频文件'});
    return;
  }
  try{
    await AudioEngine.prepare(chart.id);
    if(token!==G.loadingToken || StateMachine.state!==APP_STATE.LOADING || StateMachine.context.scope!=='song') return;
    StateMachine.transition(APP_STATE.PLAYING,{chart,resourceReady:true});
  }catch(err){
    if(token!==G.loadingToken) return;
    G.loadingToken++;
    StateMachine.transition(APP_STATE.SELECT,{toast:'歌曲加载失败：'+(err?.message || '无法读取音频')});
  }
}

function cancelSongLoading(){
  if(StateMachine.state!==APP_STATE.LOADING || StateMachine.context.scope!=='song') return;
  const songId=StateMachine.context.chart?.id;
  G.loadingToken++;
  if(songId) AudioEngine.abort(songId);
  StateMachine.transition(APP_STATE.SELECT);
}

/* ════════════ Audio ↔ GameClock 对齐协议 · AudioContext 输出参考 ════════════ */
const AudioSync = {
  start(){this.stop();G.driftTimer=setInterval(()=>this.checkDrift(),500);},
  stop(){if(G.driftTimer){clearInterval(G.driftTimer);G.driftTimer=null;}},
  checkDrift(){
    if(StateMachine.state!==APP_STATE.PLAYING||!GameClock.hasStarted()||!G.audioStarted)return;
    const gameMs=GameClock.now();
    if(gameMs<0)return;
    const audioSec=AudioEngine.currentPositionSec(G.chart?.id);
    if(audioSec==null)return;
    const audioMs=audioSec*1000;
    const drift=audioMs-gameMs,abs=Math.abs(drift);
    if(abs<30)return;
    if(abs<100){GameClock.softCorrect(audioMs,600);return;}
    GameClock.hardAlign(audioMs);
    console.warn('[AudioSync] hard alignment',{driftMs:drift,audioTime:audioSec,gameTime:gameMs,outputLatencyMs:AudioEngine.getOutputLatencyMs()});
  },
  immediate(){queueMicrotask(()=>this.checkDrift());}
};

let ChartRuntimeImpl: ChartRuntime;
let HoldRuntimeImpl: HoldRuntime;
let JudgeSystemImpl: JudgeSystem;

const GameSession = new GameplaySession({
  G,D,Layout,GameClock,AudioEngine,AudioSync,StateMachine,APP_STATE,PAUSE_REASON,renderer:NoteRenderer,renderLanes,triggerLaneTransition,visiblePage,showResult,
  laneCountAtTime,perspectiveProfile,updateLaneUI,computeFallTime,noteUnitCount,loadChart,updateSpawn,updateNotes,updateAuto,updateMiss,updateHolds,updateProgress,checkEnd,renderKeybinds,
});

AudioEngine.setHooks?.({
  onSystemInterrupt: () => GameSession.systemPauseIfNeeded(),
  onEndedUnexpected: () => {
    if (StateMachine.state === APP_STATE.PLAYING && GameClock.hasStarted() && GameClock.now() < G.songEnd - 100) {
      GameSession.pause(PAUSE_REASON.SYSTEM);
    }
  }
});

/* ════════════ 3D 投影核心 ════════════ */
function computeFallTime(speed){
  // 速度 5 → 1500ms；速度 10 → 750ms；速度 1 → 7500ms
  return 7500 / speed;
}

/* ════════════ 游戏核心 ════════════ */
function getSongClock(){
  return GameClock.now();
}

function holdTickCount(n){ return ChartRuntimeImpl.holdTickCount(n); }
function noteUnitCount(n){ return ChartRuntimeImpl.noteUnitCount(n); }

function loadChart(chart){ return ChartRuntimeImpl.load(chart); }
function triggerLaneTransition(from,to){
  const w=Layout.w,h=Layout.h,start={lc:Number.isFinite(Number(G.visualLaneCount))?Number(G.visualLaneCount):(Number(from)||DEFAULT_LANE_COUNT),...visualPerspective()};
  const prof=perspectiveProfile(Number(to)||DEFAULT_LANE_COUNT),target={lc:Number(to)||DEFAULT_LANE_COUNT,cx:w*prof.cxRatio,horizonY:h*prof.horizonRatio,judgeY:h*prof.judgeRatio};
  const t0=performance.now(),dur=720; if(G.laneTransitionRaf)cancelAnimationFrame(G.laneTransitionRaf);
  const ease=t=>{t=clamp(t,0,1);return t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;};
  function frame(now){const p=clamp((now-t0)/dur,0,1),e=ease(p);G.visualLaneCount=start.lc+(target.lc-start.lc)*e;G.visualPerspectiveCx=start.cx+(target.cx-start.cx)*e;G.visualHorizonY=start.horizonY+(target.horizonY-start.horizonY)*e;G.visualJudgeY=start.judgeY+(target.judgeY-start.judgeY)*e;renderLanes();if(p<1)G.laneTransitionRaf=requestAnimationFrame(frame);else{G.visualLaneCount=target.lc;G.visualPerspectiveCx=target.cx;G.visualHorizonY=target.horizonY;G.visualJudgeY=target.judgeY;renderLanes();G.laneTransitionRaf=0;}}
  G.laneTransitionRaf=requestAnimationFrame(frame);
}

function startGame(chart, options={}){
  if(!chart) return;
  G.selectedSongId=chart.id;
  if(StateMachine.state===APP_STATE.SELECT || StateMachine.state===APP_STATE.RESULT){
    if(options.resourceReady){
      StateMachine.transition(APP_STATE.PLAYING,{chart,resourceReady:true});
    }else if(AudioEngine.isReady(chart.id)){
      StateMachine.transition(APP_STATE.PLAYING,{chart,resourceReady:true});
    }else{
      G.loadingToken++;
      StateMachine.transition(APP_STATE.LOADING,{scope:'song',chart,token:G.loadingToken});
    }
  }
}

// Spawn slightly earlier when the visual offset draws notes ahead of game time.
function updateSpawn(t){ return ChartRuntimeImpl.updateSpawn(t+Math.max(0,Number(G.visualOffset)||0)); }

function createNote(n){ return ChartRuntimeImpl.createNote(n); }

function holdPathSamples(n){ return ChartRuntimeImpl.holdPathSamples(n); }
function laneCenterAt(lane,k,lc=visualLaneCount()){
  const w=Layout.w,cx=visualPerspective().cx;
  const xj=w*(lane+0.5)/lc;
  return cx+(xj-cx)*k;
}
function laneEdgeAt(edge,lane,k,lc=visualLaneCount()){
  const w=Layout.w,cx=visualPerspective().cx;
  const xj=w*(lane+edge)/lc;
  return cx+(xj-cx)*k;
}
function pathLaneAt(path,dt,lc){ return ChartRuntimeImpl.pathLaneAt(path,dt,lc); }
function buildHoldPathCache(n){ return ChartRuntimeImpl.buildHoldPathCache(n); }
function curveLaneAt(cache,u){ return ChartRuntimeImpl.curveLaneAt(cache,u); }
function makeCurvePath(n){ return ChartRuntimeImpl.makeCurvePath(n); }
function getRenderPathSamples(n,startU,t,lcVisual,horizonY,judgeY,T,w){
  const cache=makeCurvePath(n);
  const base=cache.samples;
  const out=[];
  const su=clamp(startU,0,1);
  const startLane=curveLaneAt(cache,su);
  const startDt=su*n.dur;
  const startEventT=n.time+G.offset+startDt;
  const startRem=startEventT-t;
  const startK=1/(1+Math.max(0,startRem)/T);
  const addSample=(u,lane)=>{
    const dtNote=u*n.dur;
    const eventT=n.time+G.offset+dtNote;
    const rem=eventT-t;
    const kk=1/(1+Math.max(0,rem)/T);
    if(kk<=0.035) return;
    const yy=horizonY+(judgeY-horizonY)*kk;
    const trackCenter=laneCenterAt(lane,kk,lcVisual);
    const trackW=Math.max(5,(w/lcVisual)*kk*0.62);
    out.push({x:trackCenter,y:yy,left:trackCenter-trackW/2,right:trackCenter+trackW/2,lane,k:kk,u});
  };
  if(startK>0.035) addSample(su,startLane);
  // Cached points are already ordered by u; skip those behind the current head.
  const startIndex=Math.max(0,Math.floor(su*cache.steps));
  for(let i=startIndex;i<base.length;i++){
    const p=base[i];
    if(p.u<=su+1e-6) continue;
    addSample(p.u,p.lane);
  }
  return out;
}

function createMultiHoldAdapter(note: MultiHoldNote, runtimeNote){
  const char=G.char||{};
  const pureMs=PURE_W+(Number(char.pureBonus)||0);
  const greatMs=GREAT_W+(Number(char.pureBonus)||0);
  const farMs=FAR_W+(Number(char.farBonus)||0);
  const coordLanes=chartMaxLaneCount(G.chart||{lanes:note.lanes.length,notes:[]});
  return new MultiHoldAdapter(note,{
    laneCount:Math.max(1,laneCountAtTime(runtimeNote.time)),
    coordinateLaneCount:coordLanes,
    getLaneCount:()=>Math.max(1,laneCount()),
    headWindowMs:farMs,
    reconnectWindowMs:500,
    tickIntervalMs:Math.max(50,Number(note.tickIntervalMs)||500),
    judgeWindows:{pureMs,greatMs,farMs},
    onJudgeEvent:(event)=>{
      const target=(G.active||[]).find(n=>n.isMultiHold&&n.id===event.noteId)||runtimeNote;
      if(event.kind==='head'||event.kind==='tick'){
        let grade=event.grade||'LOST';
        if(grade==='FAR'&&G.char?.farUpgrade)grade='GREAT';
        if(event.kind==='head'){target.judged=true;target.headScored=true;}
        if(event.kind==='tick'){target.ticksDone=(target.ticksDone||0)+1;if(grade==='LOST')target.missedTicks=(target.missedTicks||0)+1;}
        target.multiHoldUnitsDone=(target.multiHoldUnitsDone||0)+1;
        target.gray=grade==='LOST';
        try{
          const range=target.multiHoldAdapter?.runtime.pathRuntime.rangeAt(event.time);
          if(range)target.lane=(range.leftLane+range.rightLane)/2-.5;
        }catch{}
        applyUnitResult(grade,target,true);
        if(event.kind==='head')JudgeSystemImpl.recordTiming(grade,Number(event.timingDeltaMs));
      }else if(event.kind==='reconnect'){
        target.gray=false;
      }else if(event.kind==='finish'){
        target.finished=true;
        target.multiHoldFinishedAt=event.time;
      }
    }
  });
}

function updateMultiHolds(t){
  for(const note of G.active as any[]){
    if(!note?.isMultiHold||note.dead||!note.multiHoldAdapter)continue;
    if(G.auto)note.multiHoldAdapter.autoMaintain(t);
    note.multiHoldAdapter.update(t,!!G.auto);
  }
}

function updateNotes(gameT){
  updateMultiHolds(gameT);
  // Visual offset only shifts where notes are drawn (compensates display latency); pruning and judging stay on game time.
  const t=gameT+(Number(G.visualOffset)||0);
  const w=Layout.w,h=Layout.h;
  const vp=visualPerspective();
  const cx=vp.cx,horizonY=vp.horizonY,judgeY=vp.judgeY;
  const fallTime=G.fallTime;
  const T=fallTime/4;
  const lcVisual=visualLaneCount();
  const laneW=w/Math.max(1,lcVisual);
  const baseNoteW=laneW*0.62;
  const baseNoteH=laneW*0.17;
  const c=NoteRenderer.begin();
  if(!c)return;
  // Chart-specific decorative geometry, painted first so every note stays on top of it.
  const backdrop=G.chart?.backdrop;
  if(backdrop)drawTrackBackdrop(c,backdropShapes(t,{kind:backdrop.kind,bpm:Number(G.chart.bpm)||0,firstBeatMs:Number(backdrop.firstBeatMs)+(Number(G.offset)||0)},{w,cx,horizonY,judgeY,fallTime}));
  const taps=[],holds=[],ticks=[],multiHolds=[];

  for(let i=G.active.length-1;i>=0;i--){
    const n=G.active[i];
    if(n.dead){G.active.splice(i,1);continue;}
    if(n.fadeEndTime>0&&gameT>=n.fadeEndTime){n.dead=true;G.active.splice(i,1);continue;}

    const dt=n.time+G.offset-t;
    if(n.isMultiHold){
      const endTime=Number(n.multiHoldData?.endTime??(n.time+n.dur+G.offset));
      if(gameT>endTime+180){
        n.dead=true;G.active.splice(i,1);
        for(const [pointerId,binding] of G.multiHoldPointers){if(binding?.note===n)G.multiHoldPointers.delete(pointerId);}
        continue;
      }
      if(dt>fallTime+60)continue;
      if(n.multiHoldAdapter)multiHolds.push({note:n,adapter:n.multiHoldAdapter,alpha:1});
      continue;
    }
    if(!n.isHold&&n.time+G.offset-gameT < -220){n.dead=true;G.active.splice(i,1);continue;}
    if(dt>fallTime+60)continue;

    const k=1/(1+Math.max(0,dt)/T);
    const nLanes=lcVisual;
    const xJudge=w*(n.lane+0.5)/nLanes;
    const x=cx+(xJudge-cx)*k;
    const y=horizonY+(judgeY-horizonY)*k;
    const alpha=n.fadeEndTime>0?clamp((n.fadeEndTime-t)/Math.max(1,n.fadeDuration||180),0,1):1;
    if(alpha<=0)continue;

    if(n.isHold){
      const holdLc=lcVisual;
      const progress=clamp((t-(n.time+G.offset))/Math.max(1,n.dur),0,1);
      const startU=(t>(n.time+G.offset))?progress:0;
      const renderSamples=getRenderPathSamples(n,startU,t,holdLc,horizonY,judgeY,T,w);
      // Hold body is drawn as a plain translucent ribbon; tick markers are no longer painted inside it.
      if(renderSamples.length)holds.push({samples:renderSamples,alpha,holding:n.holding,gray:!!n.gray});
    }else{
      const noteW=Math.max(6,baseNoteW*k),noteH=Math.max(4,baseNoteH*k);
      taps.push({x,y,w:noteW,h:noteH,alpha,hot:k>0.88,gray:!!n.gray});
    }
  }

  // Multi Hold is painted first; normal Hold/Tap batches remain above it, preserving readability.
  for(const item of multiHolds){
    const adapter=item.adapter;
    adapter.draw(c,(laneBoundary,eventTime)=>{
      const currentLanes=Math.max(1,visualLaneCount());
      const laneEdge=clamp(laneBoundary,0,currentLanes);
      const dt=Math.max(0,eventTime-t);
      const k=1/(1+dt/T);
      const xJudge=w*laneEdge/currentLanes;
      return {x:cx+(xJudge-cx)*k,y:horizonY+(judgeY-horizonY)*k};
    },t,item.alpha);
  }
  NoteRenderer.drawFrame(c,taps,holds,ticks);
  HitFx.draw(c);
  NoteRenderer.end();
}

function applyUnitResult(result,n=null,effect=true){ return JudgeSystemImpl.applyUnitResult(result,n,effect); }
function scorePureUnit(){ return applyUnitResult('PURE',null,false); }
function holdLaneAtTime(n,t){ return ChartRuntimeImpl.holdLaneAtTime(n,t); }
function startHold(n,id,t,auto=false){ return HoldRuntimeImpl.start(n,id,t,auto); }
function breakHold(n){ return HoldRuntimeImpl.break(n); }
function updateHoldTicks(n,t){ return HoldRuntimeImpl.updateTicks(n,t); }
function autoResolveNote(n,t){ if(n.isHold) return HoldRuntimeImpl.autoResolve(n,t); return JudgeSystemImpl.judgeNote(n,'PURE',t); }
function updateAuto(t){ return JudgeSystemImpl.updateAuto(t); }

function updateMiss(t){ return JudgeSystemImpl.updateMiss(t); }

function updateHolds(t){ return JudgeSystemImpl.updateHolds(t); }

function updateProgress(t){
  if (G.songEnd > 0){
    const p = clamp(t / G.songEnd, 0, 1);
    D.progressFill.style.width = (p * 100).toFixed(1) + '%';
  }
}

function checkEnd(t){ return JudgeSystemImpl.checkEnd(t); }

/* ── 判定 ── */
function judgeNote(n,result,t){ return JudgeSystemImpl.judgeNote(n,result,t); }

function popEffect(n, text, color, timing=""){
  const w = Layout.w, h = Layout.h;
  const vp = visualPerspective();
  const cx = vp.cx;
  const horizonY = vp.horizonY;
  const judgeY = vp.judgeY;
  const T = G.fallTime / 4;
  const dt = 0;
  const k = 1;
  const xJudge = w * (n.lane + 0.5) / visualLaneCount();
  const x = cx + (xJudge - cx) * k;
  const y = horizonY + (judgeY - horizonY) * k;
  const hitGrade = HIT_GRADE_BY_TEXT[text];
  if (hitGrade) HitFx.spawn(x, y, w / Math.max(1, visualLaneCount()), hitGrade, activeHitEffect());

  const el = document.createElement('div');
  el.className = 'judge-text';
  el.textContent = text;
  el.style.left = x.toFixed(1) + 'px';
  el.style.top = (y - 30).toFixed(1) + 'px';
  el.style.color = color;
  D.judgments.appendChild(el);
  if (timing) {
    const timingEl = document.createElement('div');
    timingEl.className = 'timing-text ' + (timing.startsWith('EARLY') ? 'timing-early' : 'timing-late');
    timingEl.textContent = timing;
    timingEl.style.left = x.toFixed(1) + 'px';
    timingEl.style.top = (y - 8) + 'px';
    D.judgments.appendChild(timingEl);
    setTimeout(() => timingEl.remove(), 500);
  }
  setTimeout(() => el.remove(), 500);
}

/* ── 输入 ── */
function now(){return getSongClock();}
function eventSongTime(e){const current=now(),ts=Number(e?.timeStamp);if(!Number.isFinite(ts))return current;const perfTs=ts>1e12?ts-performance.timeOrigin:ts;return current-clamp(performance.now()-perfTs,0,120);}

function findNote(lane,t){ return JudgeSystemImpl.findNote(lane,t); }

function gradeOf(note,t){ return JudgeSystemImpl.gradeOf(note,t); }

function onPointerDown(id,lane,clientX,clientY,event=null){
  if(StateMachine.state!==APP_STATE.PLAYING||G.paused||!GameClock.hasStarted())return;
  const t=event?eventSongTime(event):now();
  let best=null,bestDistance=Infinity;
  for(const note of G.active){
    if(!note?.isMultiHold||note.dead||!note.multiHoldAdapter)continue;
    const adapter=note.multiHoldAdapter;
    if(!adapter.canAcceptLane(lane,t))continue;
    const waiting=adapter.runtime.phase==='waiting';
    const distance=waiting?Math.abs(t-adapter.note.startTime):-1;
    if(distance<bestDistance){best=note;bestDistance=distance;}
  }
  if(best){
    best.multiHoldAdapter.press(lane,t);
    G.multiHoldPointers.set(id,{note:best,lane});
    flashLane(lane);
    return;
  }
  JudgeSystemImpl.handleInput(lane,t,id);
  flashLane(lane);
}

function onPointerMove(id,lane){
  if(StateMachine.state!==APP_STATE.PLAYING||G.paused)return;
  const binding=G.multiHoldPointers.get(id);
  if(binding){
    if(binding.lane!==lane){binding.note.multiHoldAdapter?.moveLane(binding.lane,lane,now());binding.lane=lane;}
    return;
  }
  JudgeSystemImpl.moveHold(id,lane,now());
}

function onPointerUp(id){
  const binding=G.multiHoldPointers.get(id);
  if(binding){binding.note.multiHoldAdapter?.release(binding.lane,GameClock.hasStarted()?now():0);G.multiHoldPointers.delete(id);return;}
  JudgeSystemImpl.releaseHold(id);
}

function flashLane(lane){
  const keys = D.keysContainer.querySelectorAll('.key');
  const key = keys[lane];
  if (!key) return;
  key.classList.add('active');
  setTimeout(() => key.classList.remove('active'), 90);
}

/* ── UI ── */
function updateUI(){
  const s = String(Math.max(0,Math.round(G.score))).padStart(7, '0');
  if (s !== G.lastScore){ G.lastScore = s; D.score.textContent = s; }

  const c = String(G.combo);
  if (c !== G.lastCombo){ G.lastCombo = c; D.combo.textContent = c; }

  if (G.combo > 0){ D.combo.classList.add('show'); }
  else { D.combo.classList.remove('show'); }
  D.combo.style.transform = 'translate(-50%,-50%) scale(1)';
}

/* ── 暂停 / 结束 ── */
function pauseGame(reason=PAUSE_REASON.USER){
  GameSession.pause(reason);
}

function resumeGame(){
  GameSession.resume();
}

function endGame(){
  GameSession.finish();
}

function quitToSelect(){
  if(StateMachine.state===APP_STATE.PAUSED){
    StateMachine.transition(APP_STATE.SELECT);
  }
}

/* ════════════ 事件绑定 ════════════ */

ChartRuntimeImpl = new ChartRuntime({ G, laneCountAtTime, createMultiHoldAdapter });
HoldRuntimeImpl = new HoldRuntime({
  G,
  chart: ChartRuntimeImpl,
  gradeOf: (note,t) => JudgeSystemImpl.gradeOf(note,t),
  applyUnitResult: (result,note,effect) => JudgeSystemImpl.applyUnitResult(result,note,effect),
  recordTiming: (result,delta) => JudgeSystemImpl.recordTiming(result,delta),
  updateUI
});
JudgeSystemImpl = new JudgeSystem({
  G, D, StateMachine, APP_STATE,
  chart: ChartRuntimeImpl,
  hold: HoldRuntimeImpl,
  AudioEngine, popEffect, updateUI, endGame
});

const Input = new InputController({
  D, G, StateMachine, APP_STATE, PAUSE_REASON, GameClock, laneCount,
  activeKeyMap, consumeSettingsKeydown: (event) => Settings.consumeKeydown(event),
  onPointerDown, onPointerMove, onPointerUp, pauseGame, resumeGame, clamp
});

function bindEvents(){


  UI.bindEvents();
  SongSelect.bindEvents();
  Settings.bindControls();
  new LatencyCalibration({ AudioEngine, visualOffsetMs: () => Number(G.visualOffset) || 0, apply: ms => Settings.applyOffset(ms) }).bind();
  Result.bindEvents();

  D.autoBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
  D.autoBtn.addEventListener('click', e => {
    e.stopPropagation();
    G.auto=!G.auto;
    if(G.auto) G.autoUsed=true;
    D.autoBtn.classList.toggle('active',G.auto);
    toast(G.auto ? 'AUTO 已开启：自动 Perfect' : 'AUTO 已关闭');
  });

  D.pauseBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); });
  D.pauseBtn.addEventListener('pointerup', e => {
    e.stopPropagation(); e.preventDefault();
    if(StateMachine.state===APP_STATE.PLAYING) pauseGame(PAUSE_REASON.USER);
    else if(StateMachine.state===APP_STATE.PAUSED) resumeGame();
  });
  D.pauseBtn.addEventListener('click', e => e.stopPropagation());

  $('#resumeBtn').addEventListener('click', resumeGame);
  $('#quitBtn').addEventListener('click', () => quitToSelect());
  D.pauseMask.addEventListener('click', e => {
    if(StateMachine.state!==APP_STATE.PAUSED) return;
    const reason=StateMachine.context?.reason;
    if(reason===PAUSE_REASON.VISIBILITY || reason===PAUSE_REASON.SYSTEM){ resumeGame(); }
  });
  D.loadingCancelBtn.addEventListener('click', e => { e.stopPropagation(); cancelSongLoading(); });
  D.fatalReloadBtn.addEventListener('click', () => location.reload());

  Input.bindGameplayInputs();

  /* 尺寸 */
  let rzTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      Layout.update();
      NoteRenderer.resize();
      if(G.playing){const prof=perspectiveProfile(visualLaneCount());G.visualPerspectiveCx=Layout.w*prof.cxRatio;G.visualHorizonY=Layout.h*prof.horizonRatio;G.visualJudgeY=Layout.h*prof.judgeRatio;renderLanes();}
    }, 100);
  });

}

/* ════════════ Hold / Multi Hold 占用保护 ════════════ */
function chartNoteTime(note){ return Array.isArray(note) ? (Number(note[0])||0) : (Number(note?.startTime ?? note?.time)||0); }
function chartMaxLaneCount(chart){
  let max=Math.max(1,Number(chart?.lanes)||4);
  for(const section of (chart?.laneSections||[])) max=Math.max(max,Number(section?.[2])||1);
  for(const note of (chart?.notes||[])){
    if(Array.isArray(note)){max=Math.max(max,(Number(note[2])||0)+1);for(const p of (Array.isArray(note[5])?note[5]:[]))max=Math.max(max,(Number(p?.[1])||0)+1);}
    else if(note?.type==='multiHold'){
      for(const lane of (note.lanes||[]))max=Math.max(max,(Number(lane)||0)+1);
      for(const p of (note.path?.points||[]))for(const lane of (p.lanes||[]))max=Math.max(max,(Number(lane)||0)+1);
    }
  }
  return Math.max(1,Math.min(8,max));
}
function sanitizeHoldConflicts(chart){
  if(!chart||!Array.isArray(chart.notes))return;
  const raw=chart.notes.map((a,index)=>Array.isArray(a)?({a,index,t:Number(a[0])||0,type:a[1],lane:Number(a[2])||0,dur:Number(a[3])||0,path:Array.isArray(a[5])?a[5]:[]}):({a,index,t:chartNoteTime(a),type:a?.type||'other',lane:0,dur:0,path:[]}));
  const holds=raw.filter(x=>x.type==='hold');
  if(!holds.length){chart.notes.sort((a,b)=>chartNoteTime(a)-chartNoteTime(b));return;}
  const laneAt=(h,t)=>{
    const pts=(h.path.length?h.path:[[0,h.lane],[h.dur,h.lane]]).map(p=>({dt:clamp(Number(p[0])||0,0,h.dur),lane:Number(p[1])||0})).sort((a,b)=>a.dt-b.dt);
    if(t<=pts[0].dt)return pts[0].lane;if(t>=pts[pts.length-1].dt)return pts[pts.length-1].lane;let i=1;while(i<pts.length&&t>pts[i].dt)i++;
    const p0=pts[Math.max(0,i-2)],p1=pts[i-1],p2=pts[i],p3=pts[Math.min(pts.length-1,i+1)],q=(t-p1.dt)/Math.max(1,p2.dt-p1.dt),q2=q*q,q3=q2*q;
    return .5*((2*p1.lane)+(-p0.lane+p2.lane)*q+(2*p0.lane-5*p1.lane+4*p2.lane-p3.lane)*q2+(-p0.lane+3*p1.lane-3*p2.lane+p3.lane)*q3);
  };
  const keep=[];let removed=0;
  for(const x of raw){
    if(x.type!=='tap'||!Array.isArray(x.a)){keep.push(x.a);continue;}
    let blocked=false;
    for(const h of holds){const rel=x.t-h.t;if(rel<-70||rel>h.dur+70)continue;if(Math.abs(x.lane-laneAt(h,clamp(rel,0,h.dur)))<.60){blocked=true;break;}}
    if(blocked)removed++;else keep.push(x.a);
  }
  keep.sort((a,b)=>chartNoteTime(a)-chartNoteTime(b));chart.notes=keep;chart._holdConflictRemoved=removed;
  if(removed)console.info('[ChartSanitize] removed conflicting single-hold taps',chart.id,removed);
}
function chartLaneCountAt(chart,timeMs){const secs=Math.max(0,Number(timeMs)||0)/1000;const sections=Array.isArray(chart?.laneSections)?chart.laneSections:[];for(const section of sections)if(secs>=section[0]&&secs<section[1])return Math.max(1,Number(section[2])||chart?.lanes||4);return sections.length?Math.max(1,Number(sections[sections.length-1][2])||chart?.lanes||4):Math.max(1,Number(chart?.lanes)||4);}
function sanitizeMultiHoldConflicts(chart){
  if(!chart||!Array.isArray(chart.notes))return;
  const multiHolds=chart.notes.filter(n=>!Array.isArray(n)&&n?.type==='multiHold');
  if(!multiHolds.length)return;
  const coordinateLaneCount=chartMaxLaneCount(chart), occupations=[];
  for(const note of multiHolds){
    try{
      const normalized={...note,id:String(note.id||`${chart.id}:mh:${note.startTime}`),type:'multiHold',startTime:Number(note.startTime)||0,endTime:Number(note.endTime)||0,lanes:Array.isArray(note.lanes)?note.lanes:[]};
      if(!(normalized.endTime>normalized.startTime)||!normalized.lanes.length)continue;
      const samples=sampleMultiHoldPath(normalized,{laneCount:coordinateLaneCount});
      occupations.push(...buildMultiHoldOccupations(normalized,samples));
    }catch(err){console.warn('[ChartSanitize] invalid Multi Hold path',chart.id,note?.id,err);}
  }
  if(!occupations.length)return;
  const taps=[];
  chart.notes.forEach((raw,index)=>{if(Array.isArray(raw)&&raw[1]==='tap')taps.push({id:`tap:${index}`,lane:Number(raw[2])||0,time:Number(raw[0])||0});});
  const holds=[];
  chart.notes.forEach((raw,index)=>{
    if(!Array.isArray(raw)||raw[1]!=='hold')return;
    const lane=Number(raw[2])||0,dur=Number(raw[3])||0,path=Array.isArray(raw[5])?raw[5]:[];
    const lanes=[lane,...path.map(p=>Number(p?.[1])||0)];
    holds.push({id:`hold:${index}`,laneStart:Math.min(...lanes),laneEnd:Math.max(...lanes)+1,startTime:Number(raw[0])||0,endTime:(Number(raw[0])||0)+dur});
  });
  const result=resolveMultiHoldConflicts(occupations,taps,holds,(timeMs)=>chartLaneCountAt(chart,timeMs));
  const keptById=new Map(result.keptTaps.map(t=>[t.id,t]));
  const removed=new Set(result.removedTaps);
  const conflictedHoldIds=new Set(result.holdConflicts.map(c=>c.holdId));
  const moved=new Map(result.movedTaps.map(t=>[t.id,t]));
  const rebuilt=[];
  chart.notes.forEach((raw,index)=>{
    if(Array.isArray(raw)&&raw[1]==='hold'&&conflictedHoldIds.has(`hold:${index}`))return;
    if(!Array.isArray(raw)||raw[1]!=='tap'){rebuilt.push(raw);return;}
    const id=`tap:${index}`;if(removed.has(id))return;
    const resolved=keptById.get(id);const move=moved.get(id);
    if(move){const copy=[...raw];copy[2]=move.toLane;rebuilt.push(copy);}else rebuilt.push(raw);
    if(!resolved&& !move) { /* keep stable; resolver may omit only removed candidates */ }
  });
  chart.notes=rebuilt.sort((a,b)=>chartNoteTime(a)-chartNoteTime(b));
  chart._multiHoldConflictReport={movedTaps:result.movedTaps,removedTaps:result.removedTaps,holdConflicts:result.holdConflicts};
  if(result.movedTaps.length||result.removedTaps.length||result.holdConflicts.length){
    console.info('[ChartSanitize] Multi Hold conflicts',chart.id,{moved:result.movedTaps.length,removed:result.removedTaps.length,holdConflicts:result.holdConflicts.length,removedHolds:result.holdConflicts.length});
  }
}
Object.values(CHARTS).forEach(chart=>{sanitizeHoldConflicts(chart);sanitizeMultiHoldConflicts(chart);});

/* ════════════ 初始化 ════════════ */
function init(){
  Settings.load();
  SongSelect.render();
  UI.renderCharacters();
  UI.renderStory();
  Settings.renderKeybinds();

  StateMachine.resetToBoot();
  visiblePage(null);
  D.pageLoading.classList.remove('hidden');
  D.pageFatal.classList.add('hidden');

  Settings.syncControls();

  bindEvents();

  Layout.update();
  G.fallTime=computeFallTime(G.speed);
  syncStateMirror();

  const unlock=()=>{
    AudioEngine.init();AudioEngine.resume();AudioEngine.setVolume(G.volume);
    document.removeEventListener('pointerdown',unlock);document.removeEventListener('touchend',unlock);document.removeEventListener('click',unlock);document.removeEventListener('keydown',unlock);
  };
  document.addEventListener('pointerdown',unlock,{once:true});document.addEventListener('touchend',unlock,{once:true});document.addEventListener('click',unlock,{once:true});document.addEventListener('keydown',unlock,{once:true});

  console.log('%cDREAMLAND v12.6.3 · Variable-Width Multi Hold', 'color:#7dd3fc;font-size:15px;font-weight:600;letter-spacing:3px');
  console.log('%cIntegrated menu · Canvas gameplay · Multi Hold · AudioContext engine · Song Select · Result', 'color:#7a7a84;font-size:11px');

  StateMachine.transition(APP_STATE.LOADING,{scope:'app'});
}

export function boot(){ init(); }
