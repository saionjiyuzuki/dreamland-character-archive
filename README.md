# DREAMLAND V12.6.0 — Startup Fix

Important: always launch using `start.command` or `npm run serve`; both rebuild `dist/` before serving. This prevents Safari from loading stale compiled JavaScript. The local server disables browser caching for module resources.

# DREAMLAND · V12.6.0 Multi Hold Integrated Game

This is the full DREAMLAND project with the V12.3.7 Multi Hold Visual + Path system merged into the actual gameplay loop (not a standalone patch). It includes the V12 main menu, existing song selection/gameplay/results screens, source TypeScript, compiled `dist/`, assets, and four local MP3 files.

## Run on macOS

Recommended: double-click `start.command`. If macOS blocks it, right-click it and choose **Open**. It serves this project directory on the first free local port starting at 4183 and opens the correct page, avoiding old project servers. Keep that terminal window open while playing.

Or use Terminal from this directory:

```bash
npm install
npm run typecheck
npm run build
npm run smoke
npm run serve
```

The scripted server uses `http://localhost:4183` (or the next free port if launched by `start.command`). Audio is decoded from `public/audio/*.mp3` through the existing AudioContext engine. Do not open `index.html` through `file://`; use the local server.

## Multi Hold chart format

Existing tuple notes remain supported unchanged. Multi Hold entries are objects in a chart's `notes` list:

```json
{
  "id": "mh-example-01",
  "type": "multiHold",
  "lanes": [1, 2, 3],
  "startTime": 5000,
  "endTime": 9000,
  "tickIntervalMs": 500,
  "path": {
    "points": [
      { "time": 0, "lanes": [1, 2, 3] },
      { "time": 2000, "lanes": [2, 3, 4] },
      { "time": 4000, "lanes": [1, 2, 3] }
    ]
  }
}
```

Times are milliseconds; `path.points[].time` is offset from `startTime`; lane indices are zero-based. The path's occupied horizontal range spans from `min(lanes)` to `max(lanes) + 1`. One hit on any covered lane judges the head once. Internal ticks are individual score/combo units, while lanes do not multiply scoring. The player can keep a finger on a covered lane or slide between covered lanes. Reconnecting within the 500ms window allows the next tick to succeed; passed or unheld ticks remain LOST. AUTO follows the path and scores its head/ticks automatically.

## In-game example

The song list includes **Multi Hold Lab**, a short test chart that demonstrates a Multi Hold crossing the 4K-to-6K lane transition and a second wider hold in 8K. It uses the existing Disorder MP3.

## Conflict policy

At chart initialization, Multi Hold path occupations are sampled and checked against taps and holds. Conflicting taps are moved to the nearest free lane that exists in that chart section; if no lane is available they are removed. When a single Hold conflicts with a Multi Hold occupation, the Multi Hold has priority and the conflicting single Hold is removed. Summary counts are reported in the browser console.

## Validation

The TypeScript project builds, existing runtime/controller smoke tests pass, and the Multi Hold suite covers path sampling/caching, 4K/6K/8K, lane occupations, visual/time overlap, conflict fallback, head/tick scoring, missed heads, reconnects, renderer output, and tick feedback. A real device check is still recommended for touchscreen ergonomics and audible output.
