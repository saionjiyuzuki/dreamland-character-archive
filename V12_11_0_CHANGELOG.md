# DREAMLAND V12.11.0 — DIZZY 难度与新曲目

## 曲目
- 新增 **Moonfall**（Xomu，172 BPM）、**Lanterns**（Xomu，128 BPM）、**Iron Princess**（Xomu, Hyp3rLaps3，220 BPM）。
- 曲库现为 4 首：Last Dance、Moonfall（免费）、Lanterns、Iron Princess（各 12 Crystal，价格在 `src/data/songs.ts` 的 `SONG_DEFS` 中修改）。
- 音频位于 `public/audio/`（moonfall.flac / lanterns.flac / iron-princess.mp3）。

## 难度：EZ / HD / EX / DZ
- **DZ（DIZZY）** 取代原 SP 难度。旧存档中 SP 的最高分与评级会自动迁移到 DZ，旧的 SP 解锁记录仍然有效。

| 曲目 | EZ (1–10) | HD (10–15) | EX (15–20) | DZ (20–25) |
|---|---|---|---|---|
| Last Dance | 7 | 13 | 19 | 22（手工设计谱面） |
| Moonfall | 7 | 14 | 19 | 24 |
| Lanterns | 5 | 11 | 17 | 21 |
| Iron Princess | 6 | 13 | 17 | 21 |

## SP 特性下放
- **EZ**：4K，重拍 + 直长条。
- **HD**：4K ↔ 6K 变轨、滑动/弯曲长条（变轨长条）、双押。
- **EX**：最高 8K 变轨、滑动长条、单手 Multi Hold、副歌前 16 分接力。
- **DZ**：4K / 6K / 8K 变轨、双手 Multi Hold、高密度交互与副歌尾段连打。

## 谱面生成
- `scripts/charts/analyze-audio.mjs`：从音频测速（BPM）、找重拍，并记录每个 16 分位置在低 / 中 / 高三个频段的起音强度。
- `scripts/charts/generate.mjs`：把歌曲按乐句切分（安静 / 平缓 / 推进 / 高潮），每个难度按乐句类型决定轨道数、配置和长条，然后交给 `builder.mjs` 的手部模型落键。
- 全部 16 张谱面都通过 `playability.mjs`（同手间隔 ≥ 170ms、跳跃 ≤ 2 轨、长条滑动 ≤ 1 轨、变轨前后静默），并有测试保护。
- 原先由 SP 谱面派生 EZ/HD/EX 的 `src/chart/difficultyDerive.ts` 已移除。
