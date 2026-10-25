# DREAMLAND V12.5.2 — Startup Build Fix

## Root cause
`src/legacyGame.ts` imported `ALLOWED_TRANSITIONS`, but the included `dist/legacyGame.js` was stale and missing the import. The previous launcher served static files without rebuilding `dist`, so Safari kept executing that stale output. `dist/main.js` was also inconsistent with `src/main.ts`.

## Actual modifications
- Rebuilt `dist/` from `src/` after deleting stale output.
- `package.json`: build now cleans before TypeScript compilation; `serve` builds first; test/smoke include startup regression checks.
- `start.command`: checks Node/npm, installs missing TypeScript dependency, rebuilds before serving, picks a free port, opens Safari.
- `scripts/serve.py`: adds no-cache headers for Safari module requests.
- Active package/title/console version strings updated to V12.5.2.
- Added `tests/startup-regression.test.mjs`.

## Notes
Historical changelog entries retain prior version references intentionally.
