# DREAMLAND V12.6.3 — Variable-Width Multi Hold

## Changed
- Multi Hold path points now support variable width over time.
- Existing `lanes: [...]` path points remain backward-compatible.
- New continuous formats: `{ "leftLane": 1.5, "rightLane": 3.25 }` or `{ "centerLane": 2.5, "width": 1.75 }`.
- Width is smoothly interpolated along the ribbon; minimum width is 0.5 lane and geometry is clamped to the track.
- Runtime lane coverage and occupation/conflict checks use the same sampled variable-width path, so hit detection follows the visible width.
- Updated package version to 12.6.3.

## Validation
- TypeScript build and automated tests are run as part of this release packaging.
