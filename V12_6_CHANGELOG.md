# DREAMLAND V12.6.0 — Song Select UI

## Changed
- Rebuilt the song-select page around the user's hand-drawn layout: top player/score strip, left track library, right difficulty panel, and bottom navigation strip.
- Added responsive layouts for desktop, tablet, and narrow/mobile screens.
- Updated visible judgment names: PURE is displayed as EXCELLENT and FAR as GOOD, including in-game judgment popups and the result-page labels. Internal judgment identifiers and scoring logic remain unchanged.
- Track selection and audio/gameplay flow are preserved from V12.5.2. The EZ/HD/EX labels are currently visual placeholders; the current test library's actual charts remain SP.

## Files modified
- `index.html` — song-select markup/styles and result labels.
- `src/select/songSelectController.ts` — dynamic track count.
- `src/judge/judgeSystem.ts` — visible judgment popup label mapping.
- `package.json` — version/name updated to 12.6.0.
- `V12_6_CHANGELOG.md` — added.

## Files added
- `V12_6_CHANGELOG.md`

No chart data, audio files, or scoring rules were changed. Chrome remains the target browser; Safari-specific fixes are out of scope.
