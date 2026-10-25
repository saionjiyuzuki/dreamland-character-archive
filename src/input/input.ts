import type { AppState, PauseReason } from '../core/types.js';

export interface InputDeps {
  D:any;
  G:any;
  StateMachine:{state:AppState; context:any};
  APP_STATE:Record<AppState,AppState>;
  PAUSE_REASON:{USER:PauseReason;VISIBILITY:PauseReason;SYSTEM:PauseReason};
  GameClock:any;
  laneCount:()=>number;
  activeKeyMap:()=>string[];
  consumeSettingsKeydown:(event:KeyboardEvent)=>boolean;
  onPointerDown:(id:any,lane:number,clientX:number,clientY:number,event?:Event)=>void;
  onPointerMove:(id:any,lane:number)=>void;
  onPointerUp:(id:any)=>void;
  pauseGame:(reason:PauseReason)=>void;
  resumeGame:()=>void;
  clamp:(v:number,a:number,b:number)=>number;
}

export class InputController {
  constructor(private readonly d:InputDeps){}

  bindGameplayInputs(){
    const d=this.d,D=d.D,G=d.G;

    D.keysContainer.addEventListener('pointerdown',(e:PointerEvent)=>{
      e.preventDefault();
      const key=(e.target as Element|null)?.closest?.('.key') as HTMLElement|null;
      if(!key)return;
      const lane=parseInt(key.dataset.lane||'',10);if(Number.isNaN(lane))return;
      try{D.keysContainer.setPointerCapture(e.pointerId);}catch{}
      d.onPointerDown(e.pointerId,lane,e.clientX,e.clientY,e);
    },{passive:false});
    D.keysContainer.addEventListener('pointerup',(e:PointerEvent)=>{e.preventDefault();d.onPointerUp(e.pointerId);});
    D.keysContainer.addEventListener('pointermove',(e:PointerEvent)=>{
      e.preventDefault();if(!G.playing||G.paused)return;
      const rect=D.keysContainer.getBoundingClientRect();
      const nx=d.clamp((e.clientX-rect.left)/Math.max(1,rect.width),0,0.999999);
      const lane=Math.min(d.laneCount()-1,Math.floor(nx*d.laneCount()));
      d.onPointerMove(e.pointerId,lane);
    },{passive:false});
    D.keysContainer.addEventListener('pointercancel',(e:PointerEvent)=>d.onPointerUp(e.pointerId));

    document.addEventListener('pointerup',(e:PointerEvent)=>{if(G.playing)d.onPointerUp(e.pointerId)},{passive:true});
    document.addEventListener('pointercancel',(e:PointerEvent)=>{if(G.playing)d.onPointerUp(e.pointerId)},{passive:true});

    D.screen.addEventListener('pointerdown',(e:PointerEvent)=>{
      if((e.target as Element|null)?.closest?.('.pause-btn, .pause-mask, .keys-container, .page'))return;
      if(!G.playing||G.paused||d.StateMachine.state!==d.APP_STATE.PLAYING||!d.GameClock.hasStarted())return;
      const rect=D.screen.getBoundingClientRect();const nx=d.clamp((e.clientX-rect.left)/Math.max(1,rect.width),0,1);
      const lane=Math.floor(nx*d.laneCount());if(lane<0||lane>=d.laneCount())return;
      e.preventDefault();try{D.screen.setPointerCapture(e.pointerId);}catch{}
      d.onPointerDown(e.pointerId,lane,e.clientX,e.clientY,e);
    },{passive:false});
    D.screen.addEventListener('pointerup',(e:PointerEvent)=>{
      if((e.target as Element|null)?.closest?.('.pause-btn, .pause-mask, .keys-container, .page'))return;
      d.onPointerUp(e.pointerId);
    });
    D.screen.addEventListener('pointermove',(e:PointerEvent)=>{
      if((e.target as Element|null)?.closest?.('.pause-btn, .pause-mask, .keys-container, .page'))return;
      if(!G.playing||G.paused)return;
      const rect=D.screen.getBoundingClientRect();const nx=d.clamp((e.clientX-rect.left)/Math.max(1,rect.width),0,1);
      const lane=Math.min(d.laneCount()-1,Math.floor(nx*d.laneCount()));d.onPointerMove(e.pointerId,lane);
    },{passive:true});

    document.addEventListener('keydown',(e:KeyboardEvent)=>{
      if(e.repeat)return;const code=e.code;
      if(d.consumeSettingsKeydown(e)) return;
      if(e.key==='Escape'&&G.playing){G.paused?d.resumeGame():d.pauseGame(d.PAUSE_REASON.USER);return;}
      if(d.StateMachine.state!==d.APP_STATE.PLAYING||G.paused||!d.GameClock.hasStarted())return;
      const idx=d.activeKeyMap().findIndex(k=>k===code);
      if(idx>=0&&idx<G.laneMode){e.preventDefault();d.onPointerDown('k'+idx,idx,0,0,e);}
    });
    document.addEventListener('keyup',(e:KeyboardEvent)=>{
      const idx=d.activeKeyMap().findIndex(k=>k===e.code);if(idx>=0){e.preventDefault();d.onPointerUp('k'+idx);}
    });

    document.addEventListener('visibilitychange',()=>{
      if(document.hidden&&d.StateMachine.state===d.APP_STATE.PLAYING)d.pauseGame(d.PAUSE_REASON.VISIBILITY);
    });
  }
}
