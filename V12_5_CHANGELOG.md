# DREAMLAND V12.5 Legacy Removal RC

## Architecture transition
- main no longer directly boots legacyGame.
- Added App application boundary.
- legacyGame becomes compatibility provider.

## Next steps
- Move UI binding into App.
- Move gameplay session ownership out of legacyGame.
- Delete remaining global bridges.
