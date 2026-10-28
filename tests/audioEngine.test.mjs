import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal fake Web Audio graph: enough to observe scheduling decisions.
class Param { constructor(v=1){this.value=v;this.events=[];} setValueAtTime(v,t){this.events.push(['set',v,t]);this.value=v;} linearRampToValueAtTime(v,t){this.events.push(['lin',v,t]);} exponentialRampToValueAtTime(v,t){this.events.push(['exp',v,t]);} setTargetAtTime(v){this.value=v;} cancelScheduledValues(){} }
class Node { connect(){} disconnect(){} }
class Gain extends Node { gain=new Param(1); }
class Src extends Node { buffer=null; onended=null; starts=[]; stops=[]; start(when,offset){this.starts.push([when,offset]);} stop(t){this.stops.push(t);} }
class Osc extends Node { type='sine'; frequency=new Param(440); onended=null; start(){} stop(){} }
class FakeCtx {
  static last; state='running'; currentTime=10; outputLatency=0.05; baseLatency=0.01; destination=new Node(); sources=[]; oscs=0; listeners={};
  constructor(){FakeCtx.last=this;}
  createGain(){return new Gain();} createBufferSource(){const s=new Src();this.sources.push(s);return s;} createOscillator(){this.oscs++;return new Osc();}
  addEventListener(n,f){this.listeners[n]=f;} async resume(){this.state='running';}
  async decodeAudioData(){return {duration:120};}
}
globalThis.window={AudioContext:FakeCtx};
globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
let fetches=0; const realFetch=globalThis.fetch; globalThis.fetch=async(...a)=>{fetches++;return realFetch(...a);};

const { AudioEngine } = await import('../dist/audio/audioEngine.js');
const near=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b}`);

test('output latency falls back to outputLatency + baseLatency', () => {
  AudioEngine.init();
  near(AudioEngine.outputLatencySec(), 0.06);
});

test('pre-roll start is scheduled ahead by latency so the downbeat is heard at game time 0', async () => {
  const c=FakeCtx.last;
  const a=await AudioEngine.start('song_sp_last_dance',-2000);
  const [when,offset]=c.sources.at(-1).starts[0];
  near(offset,0); near(when,10+2-0.06);
  // At scheduling time the audible song position is exactly the game time.
  near(AudioEngine.currentPositionSec('song_sp_last_dance')*1000,-0 + 0, 1e-6);
  assert.equal(a.songId,'song_sp_last_dance');
});

test('mid-song resume renders ahead by latency and reads game time lazily', async () => {
  const c=FakeCtx.last; let reads=0;
  await AudioEngine.start('song_sp_last_dance',()=>{reads++;return 30000;});
  const [when,offset]=c.sources.at(-1).starts[0];
  assert.equal(reads,1); near(when,10); near(offset,30.06);
  near(AudioEngine.currentPositionSec('song_sp_last_dance'),30);
});

test('pause/stop fade out instead of hard-cutting', async () => {
  const c=FakeCtx.last; AudioEngine.pause();
  const src=c.sources.at(-1); assert.ok(src.stops[0]>c.currentTime,'stop is deferred past the fade');
  assert.equal(AudioEngine.active.paused,true);
});

test('charts sharing one file share a single decode', async () => {
  const before=fetches; await AudioEngine.prepare('song_ez_last_dance'); await AudioEngine.prepare('song_hd_last_dance');
  assert.equal(fetches,before); assert.ok(AudioEngine.isReady('song_ez_last_dance'));
});

test('decoded buffer cache is bounded', async () => {
  // Only one real song ships; register throwaway ids so three distinct files go through the (faked) fetch.
  const { AUDIO_SOURCES_TEST } = await import('../dist/data/audioMap.js');
  const ids=['a','b','c'].map(k=>{const id=`cache_probe_${k}`;AUDIO_SOURCES_TEST[id]=`./public/audio/cache-probe-${k}.mp3`;return id;});
  try{for(const id of ids)await AudioEngine.prepare(id);}finally{for(const id of ids)delete AUDIO_SOURCES_TEST[id];}
  assert.ok(AudioEngine.buffers.size<=2);
});

test('simultaneous identical hit sounds are merged, distinct ones are not', () => {
  const c=FakeCtx.last; const n=c.oscs;
  AudioEngine.sfx('pure'); AudioEngine.sfx('pure'); AudioEngine.sfx('far');
  assert.equal(c.oscs-n,2);
  c.currentTime+=0.05; AudioEngine.sfx('pure'); assert.equal(c.oscs-n,3);
});

test('iOS interrupted state triggers system pause hook', async () => {
  const { setAudioGamePlaying } = await import('../dist/audio/audioEngine.js');
  let hit=0; AudioEngine.setHooks({onSystemInterrupt:()=>hit++}); setAudioGamePlaying(true);
  FakeCtx.last.state='interrupted'; FakeCtx.last.listeners.statechange(); setAudioGamePlaying(false);
  assert.equal(hit,1);
});

test('calibration clicks are scheduled on the audio clock and heard times account for input age', () => {
  const c=FakeCtx.last; c.state='running';
  const r=AudioEngine.scheduleClicks(4,0.5,0.6);
  assert.deepEqual(r.times.map(t=>+(t-c.currentTime).toFixed(6)),[0.6,1.1,1.6,2.1]);
  const heard=AudioEngine.heardContextTime();
  const past=AudioEngine.heardContextTimeAt(performance.now()-30);
  assert.ok(Math.abs((heard-past)-0.03)<0.005);
  r.cancel();
  c.state='suspended'; assert.equal(AudioEngine.heardContextTime(),null); c.state='running';
});
