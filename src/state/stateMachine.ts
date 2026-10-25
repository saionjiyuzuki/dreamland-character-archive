import type { AppState, LoadingContext, PauseContext } from '../core/types.js';
export const APP_STATE:Record<AppState,AppState> = Object.freeze({BOOT:'BOOT',LOADING:'LOADING',MENU:'MENU',SELECT:'SELECT',PLAYING:'PLAYING',PAUSED:'PAUSED',RESULT:'RESULT',ERROR_FATAL:'ERROR_FATAL'} as const);
export const PAUSE_REASON={USER:'user',VISIBILITY:'visibility',SYSTEM:'system'} as const;
export type StateContext = Record<string,unknown> & Partial<LoadingContext & PauseContext>;
export interface StateHooks { enter(state:AppState,ctx:StateContext,prev:AppState):void|Promise<void>; restore(state:AppState,ctx:StateContext|null):void|Promise<void>; }
const fallbackHooks:StateHooks={enter(){},restore(){}};
let hooks=fallbackHooks;
export function setStateHooks(next:StateHooks){hooks=next;}
export const ALLOWED_TRANSITIONS:Record<AppState,AppState[]>= {
 BOOT:['LOADING'],LOADING:[],MENU:['SELECT'],SELECT:['MENU','LOADING','PLAYING'],PLAYING:['PAUSED','RESULT','SELECT','MENU'],PAUSED:['PLAYING','SELECT','MENU'],RESULT:['LOADING','SELECT','MENU'],ERROR_FATAL:[]
};
export const StateMachine={
 state:'BOOT' as AppState, context:null as StateContext|null,
 transition(next:AppState,context:StateContext={}){
  const prev=this.state; if(next===prev){this.context=context;return true;}
  let candidates=ALLOWED_TRANSITIONS[prev]||[];
  if(prev==='LOADING'){const scope=this.context?.scope;candidates=scope==='app'?['MENU','ERROR_FATAL']:['SELECT','PLAYING'];}
  if(!candidates.includes(next))return false;
  const prevContext=this.context;
  this.state=next; this.context=context;
  try{hooks.enter(next,context,prev); return true;}
  catch(error){console.error('[StateMachine] hook failed; rolling back',prev,'←',next,error); this.state=prev; this.context=prevContext; try{hooks.restore(prev,prevContext);}catch(restoreError){console.error('[StateMachine] restore failed',restoreError);} return false;}
 },
 resetToBoot(){this.state='BOOT';this.context=null;}
};
export type { AppState };


// V12.4.1 legacy compatibility bridge
if (typeof window !== 'undefined') {
  (window as any).ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
}
