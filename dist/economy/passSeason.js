// V12.9 V-PASS Season 01 reward table. Free track = Coin, milestone Crystal and 初级 cosmetics;
// premium track = 高级 cosmetics plus enough Crystal to pay back its unlock price.
import { findHitEffect, findNoteSkin } from '../cosmetics/catalog.js';
export const PASS_MAX_TIER = 30;
export const PASS_EXP_PER_TIER = 100;
export const PREMIUM_PASS_PRICE = 100;
export const PASS_SEASON = { id: 'S01', name: '梦境启航', code: 'SEASON 01' };
const coin = (amount) => ({ kind: 'coin', amount });
const crystal = (amount) => ({ kind: 'crystal', amount });
const skin = (id) => ({ kind: 'noteSkin', id });
const fx = (id) => ({ kind: 'hitEffect', id });
// Index 0 = tier 1. Crystal milestones on the free track every 5 tiers (110 total);
// premium returns 122 Crystal for a 100 Crystal unlock.
const FREE = [
    coin(80), coin(80), fx('fx_ripple'), coin(100), crystal(10),
    coin(100), coin(100), skin('skin_frost'), coin(120), crystal(15),
    coin(120), coin(120), fx('fx_stardust'), coin(140), crystal(15),
    coin(140), coin(140), skin('skin_sakura'), coin(160), crystal(20),
    coin(160), coin(180), coin(180), coin(180), crystal(20),
    coin(200), coin(200), coin(200), coin(200), crystal(30),
];
const PREMIUM = [
    fx('fx_nova'), crystal(5), coin(200), crystal(5), skin('skin_aurum'),
    coin(200), crystal(5), coin(250), crystal(5), fx('fx_lotus'),
    coin(250), crystal(8), coin(250), crystal(8), skin('skin_neon'),
    coin(300), crystal(8), coin(300), crystal(8), fx('fx_rift'),
    coin(300), crystal(10), coin(350), crystal(10), skin('skin_prism'),
    coin(350), crystal(10), coin(400), crystal(10), crystal(30),
];
export const PASS_TIERS = FREE.map((free, i) => ({ tier: i + 1, free, premium: PREMIUM[i] }));
export function passReward(track, tier) {
    const row = PASS_TIERS[tier - 1];
    return row ? row[track] : undefined;
}
export function isCosmeticReward(r) {
    return r.kind === 'noteSkin' || r.kind === 'hitEffect';
}
export function rewardLabel(r) {
    switch (r.kind) {
        case 'coin': return `◉ ${r.amount} Coin`;
        case 'crystal': return `✧ ${r.amount} Crystal`;
        case 'noteSkin': return `音符「${findNoteSkin(r.id)?.name || r.id}」`;
        case 'hitEffect': return `特效「${findHitEffect(r.id)?.name || r.id}」`;
    }
}
/** Where a cosmetic can be earned, for "未获得" hints in the loadout. */
export function cosmeticSource(id) {
    for (const row of PASS_TIERS) {
        for (const track of ['free', 'premium']) {
            const r = row[track];
            if (isCosmeticReward(r) && r.id === id)
                return `V-PASS ${track === 'free' ? '免费' : '高级'} · TIER ${String(row.tier).padStart(2, '0')}`;
        }
    }
    return '';
}
