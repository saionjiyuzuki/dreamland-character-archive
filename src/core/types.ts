import type { MultiHoldNote } from '../chart/multiHoldSchema.js';

export type NoteKind = 'tap' | 'hold';
export type LaneSection = [startMs:number,endMs:number,lanes:number];
export type HoldPathPoint = [offsetMs:number,lane:number];
export type RawNote = [timeMs:number,kind:NoteKind,lane:number,durationMs:number,density:number,path?:HoldPathPoint[]];
export type ChartNote = RawNote | MultiHoldNote;
export interface Chart {
  id:string; title:string; artist:string; bpm:number; diff:number; jacket:string;
  lanes:number; testOnly?:boolean; sourceAudio?:string; duration:number;
  notes:ChartNote[]; spRevision?:string; designNotes?:string[]; gimmickPlan?:string[];
  laneSections?:LaneSection[];
  /** Optional decorative track background (visual only). */
  backdrop?:{kind:'geometry';firstBeatMs:number};
}
export interface Character { id:string; name:string; emoji:string; portrait?:string; level:number; skill:string; unlocked:boolean; pureBonus?:number; farBonus?:number; farUpgrade?:boolean; scoreMul?:number; lostSafe?:boolean }
export type AppState = 'BOOT'|'LOADING'|'MENU'|'SELECT'|'PLAYING'|'PAUSED'|'RESULT'|'ERROR_FATAL';
export type PauseReason = 'user'|'visibility'|'system';
export interface LoadingContext { scope:'app'|'song'; chart?:Chart; token?:number }
export interface PauseContext { reason:PauseReason }
