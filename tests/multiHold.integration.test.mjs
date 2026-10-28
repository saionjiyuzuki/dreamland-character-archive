import test from 'node:test';
import assert from 'node:assert/strict';
import { ChartRuntime } from '../dist/chart/chartRuntime.js';
import { MultiHoldAdapter } from '../dist/integration/MultiHoldAdapter.js';

function makeG(){
  return {
    offset:0,fallTime:1600,active:[],pending:[],pendingIndex:0,
    totalNotes:0,remaining:0,songEnd:0,holding:new Map(),multiHoldPointers:new Map(),
    auto:false,score:0,combo:0,maxCombo:0,pure:0,great:0,far:0,lost:0,
    char:{scoreMul:1,lostSafe:false}
  };
}

test('ChartRuntime loads mixed legacy tuples and Multi Hold objects into one score timeline',()=>{
  const G=makeG();
  const chart={
    id:'mixed-fixture',title:'mixed',artist:'test',bpm:120,diff:9,jacket:'',lanes:4,duration:4,
    laneSections:[[0,4,4]],
    notes:[
      [500,'tap',0,0,0],
      {id:'mh-integration',type:'multiHold',lanes:[1,2],startTime:1000,endTime:2000,tickIntervalMs:250}
    ]
  };
  const judged=[];
  let runtime;
  runtime=new ChartRuntime({
    G,laneCountAtTime:()=>4,
    createMultiHoldAdapter:(note,runtimeNote)=>new MultiHoldAdapter(note,{
      laneCount:4,coordinateLaneCount:4,getLaneCount:()=>4,headWindowMs:160,reconnectWindowMs:500,
      onJudgeEvent:event=>{
        judged.push(event);
        if(event.kind==='head'||event.kind==='tick'){
          runtimeNote.multiHoldUnitsDone=(runtimeNote.multiHoldUnitsDone||0)+1;
          G.remaining=Math.max(0,G.remaining-1);
          if(event.grade==='PURE')G.pure++;else if(event.grade==='GREAT')G.great++;else if(event.grade==='FAR')G.far++;else if(event.grade==='LOST')G.lost++;
        }
      }
    })
  });
  runtime.load(chart);
  assert.equal(G.totalNotes,6,'one tap plus one head and four 250ms ticks');
  assert.equal(G.songEnd,2000);
  runtime.updateSpawn(0);
  const multi=G.active.find(note=>note.isMultiHold);
  assert.ok(multi);
  assert.equal(multi.id,'mh-integration');
  assert.ok(multi.multiHoldAdapter);
  assert.equal(multi.multiHoldAdapter.canAcceptLane(2,1000),true);
  multi.multiHoldAdapter.press(2,1000);
  multi.multiHoldAdapter.update(1250);
  multi.multiHoldAdapter.release(2,1260);
  multi.multiHoldAdapter.update(1500);
  assert.deepEqual(judged.filter(e=>e.kind==='head').map(e=>e.grade),['PURE']);
  assert.equal(judged.filter(e=>e.kind==='tick').length,2);
  assert.equal(G.pure,2);
  assert.equal(G.lost,1);
  assert.equal(multi.multiHoldUnitsDone,3);
});

test('missed Multi Hold head becomes LOST and still resolves every scheduled tick',()=>{
  const events=[];
  const note={id:'miss-head',type:'multiHold',lanes:[0,1],startTime:1000,endTime:2000,tickIntervalMs:500};
  const adapter=new MultiHoldAdapter(note,{
    laneCount:4,coordinateLaneCount:4,headWindowMs:160,reconnectWindowMs:500,
    judgeWindows:{pureMs:45,greatMs:90,farMs:160},
    onJudgeEvent:event=>events.push(event)
  });
  adapter.update(1161);
  adapter.update(2000);
  assert.equal(events.filter(e=>e.kind==='head'&&e.grade==='LOST').length,1);
  assert.equal(events.filter(e=>e.kind==='tick'&&e.grade==='LOST').length,2);
  assert.equal(events.filter(e=>e.kind==='finish').length,1);
});

import { CHARTS } from '../dist/data/charts.js';
import { AUDIO_SOURCES_TEST } from '../dist/data/audioMap.js';
test('the real song list ships Multi Hold in the Last Dance DZ chart with its audio source',()=>{
  const chart=CHARTS.song_dz_last_dance;
  assert.ok(chart,'Last Dance DZ should be selectable in the integrated game');
  assert.deepEqual([...new Set(chart.laneSections.map(section=>section[2]))].sort(),[4,6,8]);
  assert.ok(chart.notes.filter(note=>!Array.isArray(note)&&note.type==='multiHold').length>0);
  assert.ok(AUDIO_SOURCES_TEST[chart.id]);
});
