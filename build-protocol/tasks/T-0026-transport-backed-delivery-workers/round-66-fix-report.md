# Round 66 Fix Report

## Scope

- Renamed injected local handoff callbacks to `onHandoff` and `onReplay`.
- Reset a resumed delivery scan cursor to the head after accepted post-cursor work.

## Red

- The new `delivery-loop.test.ts` regression failed before the delivery change:
  expected the cleared head row second, received the second supported tail row.

## Green

- Focused regression passed: `1 passed`, `29 skipped`.

## Verification

- `delivery-loop.test.ts`: `30 passed`.
- Process-manager and projection handoff suites: `23 passed`.
- `typecheck:build:generated`: passed (`tsc -b`).
- `format:check`: passed.
- `docs:check`: not required; the callback option rename is package-internal
  and did not affect exports or API docs.
- `git diff --check`: passed.
