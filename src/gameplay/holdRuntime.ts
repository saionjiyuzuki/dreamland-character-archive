import type { RuntimeNote } from '../chart/chartRuntime.js';
export interface HoldRuntimeDeps{G:any;chart:{holdTickCount(note:RuntimeNote):number;noteUnitCount(note:RuntimeNote):number;holdLaneAtTime(note:RuntimeNote,t:number):number};gradeOf:(note:RuntimeNote,t:number)=>string;applyUnitResult:(result:string,note:RuntimeNote|null,effect:boolean)=>void;recordTiming?:(result:string,delta:number)=>void;updateUI:()=>void;}
export class HoldRuntime{
  constructor(private readonly d:HoldRuntimeDeps){}
  start(note:RuntimeNote,id:string|number,t:number,auto=false):boolean{
    const G=this.d.G;if(note.dead||!note.isHold)return false;const start=note.time+Number(G.offset||0),end=start+note.dur,farBonus=Number(G.char?.farBonus||0);
    if(t<start-160||t>end||note.holding)return false;
    if(note._started){note.holding=true;note.holdId=id;note.autoHold=auto;note.holdBroken=false;note.lastHoldT=t;note.lastLane=this.d.chart.holdLaneAtTime(note,t);G.holding.set(id,note);return true;}
    note._started=true;note.holding=true;note.holdId=id;note.autoHold=auto;note.holdBroken=false;note.lastHoldT=t;note.lastLane=this.d.chart.holdLaneAtTime(note,t);
    note.totalTicks=this.d.chart.holdTickCount(note)+1;note.ticksDone=0;note.missedTicks=0;note.nextTickIndex=0;note.headScored=false;G.holding.set(id,note);
    const headResult=Math.abs(t-start)<=160+farBonus?this.d.gradeOf(note,t):'LOST';this.d.applyUnitResult(headResult,note,true);if(!auto)this.d.recordTiming?.(headResult,t-start);note.headScored=true;note.ticksDone=1;
    const totalInternal=note.totalTicks-1;if(totalInternal>0){const elapsed=clamp(t-start,0,note.dur),passedInternal=Math.min(totalInternal,Math.floor((elapsed/Math.max(1,note.dur))*totalInternal));for(let i=0;i<passedInternal;i++){this.d.applyUnitResult('LOST',null,false);note.missedTicks=(note.missedTicks||0)+1;note.ticksDone++;}}
    return true;
  }
  break(note:RuntimeNote):void{const G=this.d.G;if(!note||!note.isHold||note.dead||!note.holding)return;note.holding=false;note.holdBroken=true;if(note.holdId!=null)G.holding.delete(note.holdId);note.holdId=null;this.d.updateUI();}
  updateTicks(note:RuntimeNote,t:number):void{
    if(!note||!note._started||note.dead)return;const start=note.time+Number(this.d.G.offset||0),total=note.totalTicks||(this.d.chart.holdTickCount(note)+1);if(total<=0)return;
    const elapsed=clamp(t-start,0,note.dur),passed=elapsed<=0?1:Math.min(total,1+Math.floor((elapsed/Math.max(1,note.dur))*(total-1)));
    while((note.ticksDone||0)<passed){const idx=note.ticksDone||0;note.ticksDone=idx+1;const tickT=start+(idx/Math.max(1,total-1))*note.dur;
      if(note.holding){const expected=this.d.chart.holdLaneAtTime(note,tickT),actual=Number.isFinite(note.lastLane)?Number(note.lastLane):expected;if(Math.abs(actual-expected)<=1.15)this.d.applyUnitResult('PURE',null,false);else{this.d.applyUnitResult('LOST',null,false);note.missedTicks=(note.missedTicks||0)+1;}}
      else{this.d.applyUnitResult('LOST',null,false);note.missedTicks=(note.missedTicks||0)+1;}
    }
  }
  update(t:number):void{const G=this.d.G;for(const note of G.active as RuntimeNote[]){if(!note.isHold||note.dead)continue;const endTime=note.time+note.dur+Number(G.offset||0);
      if(!note._started){if(t>=endTime){const total=note.totalTicks||this.d.chart.noteUnitCount(note);for(let i=0;i<total;i++)this.d.applyUnitResult('LOST',null,false);note.finished=true;note.dead=true;}continue;}
      this.updateTicks(note,t);if(t>=endTime&&!note.finished){note.holding=false;note.autoComplete=true;note.finished=true;note.fadeDuration=140;note.fadeEndTime=t+140;if(note.holdId!=null)G.holding.delete(note.holdId);note.holdId=null;}
    }}
  autoResolve(note:RuntimeNote,t:number):void{if(note.judged||note.dead)return;this.start(note,`auto:${note.time}`,t,true);}
  updateLastLane(note:RuntimeNote,lane:number,t:number):void{if(!note.holding||note.dead)return;note.lastLane=lane;note.lastMoveT=t;}
}
function clamp(v:number,a:number,b:number){return v<a?a:v>b?b:v;}
