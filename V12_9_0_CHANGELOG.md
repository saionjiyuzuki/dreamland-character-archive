# DREAMLAND V12.9.0 — V-PASS Dual Track, Daily Missions, Note Skins & Hit Effects

## V-PASS Season 01
- 30 tiers, 100 EXP per tier, with a **free track** and a **premium track** shown side by side on a horizontally scrolling reward board. The board scrolls to the tier you are currently working toward.
- Rewards are now **claimed manually** (per cell or with 「一键领取」) instead of being granted silently on tier-up. Claimable cells pulse, and red-dot badges appear on the 通行证 / 每日任务 entry points.
- **Crystal milestones**: free tiers 5/10/15/20/25/30 give 10/15/15/20/20/30 Crystal (110 total). The premium track adds another 122 Crystal.
- The premium pass is unlocked with **100 in-game Crystal** (no real payment). Unlocking it lets you claim the premium rewards for every tier you have already reached.
- Reward preview: clicking a note-skin or hit-effect reward plays it in the hero preview stage.

## Note skins & hit effects (basic / premium)
- 初级 (free track): 霜晶, 樱绯 note skins; 清音涟漪, 星屑 hit effects.
- 高级 (premium track): 流金辉石, 深空霓虹, 棱镜幻彩 note skins; 超新星, 天穹莲华, 虚空裂隙 hit effects.
- Skins are rendered in gameplay by `src/render/noteSkins.ts`. Hit effects (`src/render/hitEffects.ts`) are drawn on the note canvas at the judge line for EXCELLENT/GREAT/GOOD and are capped at 48 concurrent bursts. They are purely visual and do not affect timing or judgement.
- New 「装扮 · 特效」 tab: a live preview stage, equip buttons, and the unlock source for each item you don't own yet.

## Daily missions
- 4 missions per day (「完成 3 首歌曲」 is always included; the other 3 are drawn deterministically from a pool of 7 based on the date). Missions reset at local midnight, and a countdown is shown.
- Mission rewards are V-PASS EXP plus Coin/Crystal. Claiming all 4 unlocks a daily completion bonus (+60 EXP, ◉100, ✧5).
- AUTO plays don't count. The result screen lists the missions you just completed and how many rewards are waiting to be claimed.
- Entry points: the ☑ button in the main-menu top bar, the MISSION item in song select, and the tab inside the pass modal.

## Save compatibility
- The save format moves to version 2 under the same localStorage key. In V12.8 saves, tiers in `claimedPass` were already paid out automatically, so they stay claimed. Any cosmetic that now sits on those tiers is granted, so nothing is lost and nothing is paid twice.
- Equipped skins/effects that you don't own fall back to the defaults.

## Cleanup
- Removed the inline `MutationObserver` that rewrote the pass DOM. Because of its one-shot `vpassEnhanced` flag, any later re-render fell back to the plain layout. The pass page is now rendered entirely from TypeScript.
- New tests: `tests/economy.test.mjs` (season table, claiming, premium back-fill, tier cap, legacy migration, daily missions).
