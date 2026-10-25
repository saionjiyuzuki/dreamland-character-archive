# DREAMLAND V12.8.1 — Code Optimization

- Added defensive normalization for economy save data: invalid numeric values, malformed arrays, duplicate IDs, and out-of-range pass values are handled safely.
- Escaped chart and cosmetic text before inserting it into economy modal markup.
- Expanded the V-PASS reward display to 30 tiers and capped season progression at tier 30 so the interface and reward loop agree. Rewards remain automatically granted on tier-up and are labelled accordingly.
- Made character-selection storage tolerant of private browsing/storage failures and replaced profile-name HTML interpolation with DOM text nodes.
- Hardened delegated character clicks against non-element targets and invalid character IDs.
- Updated visible/package version to V12.8.1.
- Validation: TypeScript build and automated test suite pass (32 tests).
