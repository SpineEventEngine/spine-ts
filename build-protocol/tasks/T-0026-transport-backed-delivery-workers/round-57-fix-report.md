# Round 57 Fix Report: T-0026 Resume Cursor Starvation

Reported: `2026-07-10T21:20:00Z` (the verified fix was committed earlier as
`7d1b09ad` at `2026-07-10T19:55:11Z`)

## Scope

Round 57 addresses the complete Round 56 findings:

- The then-current `build-protocol/work-logs/T-0026.md` rendered Round 45 at
  `19:45` and Round 46 at `17:57:08Z`; later commit evidence reconciles the
  actual sequence as Round 45 at `17:45`, Round 46 at `17:57:08Z`, and Round
  47 work after the final verification coverage gate.
- `build-protocol/reviews/T-0026-transport-backed-delivery-workers.md` had two
  wrapped `git diff --check ca8fb2b3...HEAD` references with flush-left
  continuation lines inside list items.
- `packages/server/src/delivery/delivery.ts` could preserve a stale resumed
  cursor across skipped-only full pages, pausing without reconsidering a head
  row that became available after an earlier live claim was cleared or expired.

## Red

- Added the focused regression
  `DeliveryLoop > drops a stale skipped-only resume cursor so a cleared head
claim is reconsidered`.
- Red command:
  ```sh
  pnpm --config.verify-deps-before-run=false exec vitest run \
    packages/server/test/delivery/delivery-loop.test.ts \
    -t "drops a stale skipped-only resume cursor"
  ```
- Red result: failed as expected because the resumed loop returned
  `delivered: 0` instead of `delivered: 1`.

## Changes

- The reporting record initially described a Round 46 timestamp correction.
  Commit evidence later established that the correct durable sequence keeps
  Round 46 at `2026-07-10T17:57:08Z` after the Round 45 `17:45` records.
- Rewrapped the two review-log `git diff --check ca8fb2b3...HEAD` references
  so continuation lines remain indented within their bullets.
- Changed `Delivery.drain()` so a resumed drain that exhausts its skipped-only
  scan budget without accepted work or failures drops the stale resume cursor.
  `DeliveryLoop` then performs the next bounded drain from the head, preserving
  the finite scan budget without querying once per skipped row.

## Green

- Green command:
  ```sh
  pnpm --config.verify-deps-before-run=false exec vitest run \
    packages/server/test/delivery/delivery-loop.test.ts \
    -t "drops a stale skipped-only resume cursor"
  ```
- Green result: passed with 1 test run and 27 skipped in
  `delivery-loop.test.ts`.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts`
  passed with 28 tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts`
  passed with 51 tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed with only the
  existing invalid TypeDoc `origin` warning.
- Initial `pnpm --config.verify-deps-before-run=false format:check` flagged
  Markdown formatting in the T-0026 review log. The repo formatter normalized
  it, and the rerun passed.
- `git diff --check` passed.

## Follow-up

Rerun all five reviewer lanes from the Round 57 HEAD after verification passes.
