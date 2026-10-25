# DREAMLAND V12.4 RC

Based on V12.3.8_MULTI_HOLD_MERGED.

## Actual modified
- src/state/stateMachine.ts
  - exported ALLOWED_TRANSITIONS
  - kept rollback transition behavior

## Added
- src/app/appLifecycle.ts
- src/audio/safariGuard.ts
- src/app/resourceProbe.ts

## Goals
- reduce legacy startup coupling
- improve Safari startup stability
- prepare legacyGame removal in later 12.4.x

## Not yet removed
- legacyGame.ts compatibility layer remains.
