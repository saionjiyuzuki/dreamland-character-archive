# DREAMLAND V12.10.0 — Song Select Rework, EZ / HD / EX Charts, Standalone V-PASS & Shop

## Song catalog & new charts
- The song list is now organised by **song**. Each song has four difficulty slots, **EZ / HD / EX / SP**; before, every chart was its own card.
- New EZ / HD / EX charts for Last Dance, Destr0yer, 神話, 《Ж》 and Disorder (15 charts). `src/chart/difficultyDerive.ts` generates them from each song's SP chart:
  - It ranks the SP onsets by bar position (downbeat > beat > 8th > 16th/32nd) and stacking.
  - It thins them per difficulty, then lays them onto 4K using the same hand model as the SP charts.
  - Every generated chart passes `scripts/charts/playability.mjs` with zero violations. The test `tests/songs.test.mjs` enforces this.
- Levels and density per difficulty:

  | | Level | Notes / second |
  |---|---|---|
  | EZ | 2 | ~1 |
  | HD | 6–7 | ~2–2.7 |
  | EX | 11–13 | ~3.4–5 |
  | SP | 16 / 20 | — |

- The old `TEST 4K` cards are retired. Multi Hold Lab stays as a LAB entry with only its SP slot.
- `src/data/audioMap.ts` maps one audio file per song to every chart id. `AudioEngine` now reads from it instead of keeping its own copy.

## Song select
- **Layout**: the song list sits on the left. Each row shows the level of all four difficulties and your best score / rank for the current difficulty. The detail panel on the right has the jacket, BPM, length, difficulty tabs, note count, lane mode, and best score / rank.
- **Preview**: about 0.4s after you select a song, it plays the densest stretch of the SP chart (usually the chorus) in a loop with fade in / fade out.
  - `src/audio/previewPlayer.ts` streams the file through an `<audio>` element routed into the master bus, so the volume setting applies.
  - You can switch the preview off; the choice is remembered.
  - It stops when a song starts or when you leave the page.
- **Two-step start**: clicking a song selects it. Clicking it again, pressing 「开始演奏」 or pressing Enter opens a confirmation panel showing difficulty, level, notes, lanes, speed and best score. 「开始演奏」 or Enter starts the chart; 返回 or Esc cancels. While the panel is open, the song audio starts decoding so loading is shorter.
- **Keyboard**: ↑ ↓ change song, ← → change difficulty, Enter starts, Esc goes back.
- **Filters, sort, favourites**:
  - Filters: 全部 / 已解锁 / 收藏.
  - Sort: 默认 / 难度 / 曲名 / BPM.
  - ☆ marks a song as a favourite.
  - The selected song, difficulty, filter, sort and preview setting are all remembered.
- Results also store the best grade per chart. The result screen shows the difficulty, e.g. 「HD LV.7」.
- Removed the decorative EZ/HD/EX/SP slider and its inline script.

## Standalone V-PASS and shop pages
- **V-PASS** (`#pagePass`) and the **shop** (`#pageShop`) are full pages now; the 「梦境补给站」 modal is gone. Both pages show your Crystal / Coin balance. Their BACK button returns to where you came from (main menu or song select).
- V-PASS page tabs: 通行证 / 每日任务 / 装扮 · 特效.
- Shop page tabs:
  - 曲目 (Crystal): every song with its four levels, a ▶ preview button and an unlock / 去演奏 button.
  - 主题 (Coin).
  - A premium-pass banner links to V-PASS.
- The shop has been removed from song select. A locked song shows 「前往商店解锁」, which opens the shop with that song highlighted.
- Songs now unlock as a whole, which includes every difficulty. 《Ж》 and Disorder cost 12 Crystal each; the other songs are free. V12.9 saves that unlocked a single chart now own the whole song.
