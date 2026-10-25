import type { Character } from '../core/types.js';
export const CHARACTERS: Character[] = [
 {id:'c1',name:'梦灵',emoji:'🌙',portrait:'./public/assets/characters/lumina.webp',level:20,skill:'PURE 窗口 +12ms',unlocked:true,pureBonus:12},
 {id:'c2',name:'星使',emoji:'⭐',level:15,skill:'FAR 升级为 GREAT',unlocked:true,farUpgrade:true},
 {id:'c3',name:'焰羽',emoji:'🔥',level:8,skill:'最终得分 +6%',unlocked:true,scoreMul:1.06},
 {id:'c4',name:'冰心',emoji:'❄️',level:25,skill:'LOST 不中断连击',unlocked:true,lostSafe:true},
 {id:'c5',name:'虚空',emoji:'💜',level:30,skill:'全判定 +8ms 宽容',unlocked:false,pureBonus:8,farBonus:8}
];
