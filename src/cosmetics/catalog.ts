// V12.9 cosmetics catalog: note skins and hit effects shared by the renderer, V-PASS and loadout UI.

/** default = owned by everyone; basic = 初级 (free track); premium = 高级 (premium track). */
export type CosmeticGrade = 'default' | 'basic' | 'premium';
export type NoteSkinShape = 'bar' | 'capsule' | 'gem' | 'neon' | 'prism';
export type HitEffectStyle = 'halo' | 'ripple' | 'stardust' | 'nova' | 'lotus' | 'rift';

export interface NoteSkin {
  id: string; name: string; desc: string; grade: CosmeticGrade; shape: NoteSkinShape;
  /** Vertical gradient stops (top, middle, bottom) plus the middle stop used close to the judge line. */
  top: string; mid: string; bottom: string; hotMid: string;
  glow: string; stroke: string; accent: string;
}

export interface HitEffect {
  id: string; name: string; desc: string; grade: CosmeticGrade; style: HitEffectStyle;
  /** Colour for EXCELLENT; GREAT/GOOD keep the judgement palette so feedback stays readable. */
  color: string; secondary: string; durationMs: number;
}

export const NOTE_SKINS: NoteSkin[] = [
  { id:'skin_default', name:'梦境标准', desc:'DREAMLAND 默认音符，柔和紫白渐变。', grade:'default', shape:'bar',
    top:'rgba(242,236,255,.98)', mid:'rgba(167,139,250,.96)', bottom:'rgba(109,95,168,.95)', hotMid:'rgba(255,255,255,.98)',
    glow:'rgba(167,139,250,.78)', stroke:'rgba(255,255,255,.78)', accent:'#a78bfa' },
  { id:'skin_frost', name:'霜晶', desc:'冰蓝色晶面，高对比度，适合高速谱面。', grade:'basic', shape:'bar',
    top:'rgba(240,253,255,.98)', mid:'rgba(103,232,249,.95)', bottom:'rgba(14,116,144,.95)', hotMid:'rgba(255,255,255,.98)',
    glow:'rgba(103,232,249,.75)', stroke:'rgba(236,254,255,.85)', accent:'#67e8f9' },
  { id:'skin_sakura', name:'樱绯', desc:'圆角胶囊造型，樱粉色渐层。', grade:'basic', shape:'capsule',
    top:'rgba(255,241,248,.98)', mid:'rgba(249,168,212,.95)', bottom:'rgba(190,24,93,.9)', hotMid:'rgba(255,255,255,.98)',
    glow:'rgba(244,114,182,.75)', stroke:'rgba(255,240,248,.85)', accent:'#f9a8d4' },
  { id:'skin_aurum', name:'流金辉石', desc:'金色音符，中央嵌入菱形辉石。', grade:'premium', shape:'gem',
    top:'rgba(255,251,235,.98)', mid:'rgba(251,191,36,.96)', bottom:'rgba(146,64,14,.95)', hotMid:'rgba(255,255,255,.98)',
    glow:'rgba(251,191,36,.8)', stroke:'rgba(255,247,214,.9)', accent:'#fbbf24' },
  { id:'skin_neon', name:'深空霓虹', desc:'暗色核心与霓虹描边，夜间舞台风格。', grade:'premium', shape:'neon',
    top:'rgba(30,27,75,.96)', mid:'rgba(17,24,39,.96)', bottom:'rgba(30,27,75,.96)', hotMid:'rgba(49,46,129,.98)',
    glow:'rgba(129,140,248,.95)', stroke:'rgba(165,243,252,.98)', accent:'#818cf8' },
  { id:'skin_prism', name:'棱镜幻彩', desc:'横向流动的七彩折射，赛季限定。', grade:'premium', shape:'prism',
    top:'rgba(255,255,255,.98)', mid:'rgba(196,181,253,.96)', bottom:'rgba(99,102,241,.92)', hotMid:'rgba(255,255,255,.98)',
    glow:'rgba(216,180,254,.85)', stroke:'rgba(255,255,255,.92)', accent:'#c4b5fd' },
];

export const HIT_EFFECTS: HitEffect[] = [
  { id:'fx_default', name:'基础光环', desc:'单层光环扩散。', grade:'default', style:'halo', color:'#e0e7ff', secondary:'#a78bfa', durationMs:300 },
  { id:'fx_ripple', name:'清音涟漪', desc:'双层涟漪与放射光线。', grade:'basic', style:'ripple', color:'#a5f3fc', secondary:'#67e8f9', durationMs:380 },
  { id:'fx_stardust', name:'星屑', desc:'击打时迸发上浮的星屑粒子。', grade:'basic', style:'stardust', color:'#fde68a', secondary:'#f9a8d4', durationMs:520 },
  { id:'fx_nova', name:'超新星', desc:'核心闪光、十六道光芒与轨道光柱。', grade:'premium', style:'nova', color:'#fef3c7', secondary:'#fbbf24', durationMs:480 },
  { id:'fx_lotus', name:'天穹莲华', desc:'旋转绽放的莲瓣与飘落花屑。', grade:'premium', style:'lotus', color:'#fbcfe8', secondary:'#c084fc', durationMs:560 },
  { id:'fx_rift', name:'虚空裂隙', desc:'色差冲击波与菱形碎片。', grade:'premium', style:'rift', color:'#a5f3fc', secondary:'#f0abfc', durationMs:460 },
];

export const DEFAULT_NOTE_SKIN = NOTE_SKINS[0].id;
export const DEFAULT_HIT_EFFECT = HIT_EFFECTS[0].id;

export function findNoteSkin(id: string): NoteSkin | undefined { return NOTE_SKINS.find(s => s.id === id); }
export function findHitEffect(id: string): HitEffect | undefined { return HIT_EFFECTS.find(e => e.id === id); }
export function gradeLabel(grade: CosmeticGrade): string { return grade === 'premium' ? '高级' : grade === 'basic' ? '初级' : '默认'; }

/** Equipped cosmetics read by the canvas renderer every frame; the economy service is the only writer. */
const active = { noteSkin: NOTE_SKINS[0], hitEffect: HIT_EFFECTS[0] };
export function activeNoteSkin(): NoteSkin { return active.noteSkin; }
export function activeHitEffect(): HitEffect { return active.hitEffect; }
export function setActiveCosmetics(noteSkinId: string, hitEffectId: string): void {
  active.noteSkin = findNoteSkin(noteSkinId) || NOTE_SKINS[0];
  active.hitEffect = findHitEffect(hitEffectId) || HIT_EFFECTS[0];
}
