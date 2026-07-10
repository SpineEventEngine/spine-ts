# Round 24 Fix Report

Date: 2026-07-10

## Review Intake

Fixed the Round 24 review batch for T-0026:

- Restore the durable Round 23 and Round 24 trail in the work log and review
  log, and add this Round 24 fix report.
- Tighten the public direct-worker callback type so endpoint callbacks and
  per-message delivery failures only admit `HANDLE_COMMAND`,
  `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT`.
- Historical Round 24 behavior allowed claim compare-and-set to reclaim
  expired per-message claims using the storage clock. This was superseded by
  Round 35 commit `5c3705e2` (`Fix delivery claim blocking and offset rescan`);
  the current contract blocks competing delivery for both expired and live row
  claims until a future explicit recovery policy exists.
- Keep pre-callback claim/lease failures visible without letting them consume
  the accepted endpoint-work limit.
- Decouple direct-drain page size from accepted-work limit so limit `1` can
  read skipped rows in bounded pages instead of one row per query.

## Changes

- Added exported `DeliveryEndpointMessage` and narrowed `DeliveryEndpoint`
  (later renamed to `OnDeliveryMessage` in Round 25) plus
  `DeliveryFailure.message` to the supported worker-label subset.
- Updated delivery TypeDoc so exact-row drains invoke `onMessage` for the exact
  pending supported row when available, at most once, and so accepted counts
  mean the endpoint callback actually ran.
- Changed `InboxStorage.#claimMessage()` in this round so a live claim still
  blocked claim CAS while an expired claim could be atomically replaced by the
  new shard-session claim. Historical correction: Round 35 / `5c3705e2`
  removed that reclaim path, so any existing row claim now blocks competing
  delivery.
- Updated the `InboxClaim` comment in this round to clarify that local/direct
  workers did not proactively sweep expired claims. Historical correction:
  Round 35 / `5c3705e2` later changed the current comment/contract to no
  expired-claim reclaim without explicit recovery policy.
- Changed direct-drain accounting so pre-callback failures stay in
  `DeliveryRun.failures` without incrementing `accepted`, while callback
  invocation and later failures still count as accepted endpoint work.
- Changed direct-drain reads to page by
  `min(inboxStorageAccess.maxReadLimit, remaining scan budget)` while still
  stopping when accepted endpoint work reaches `limit`.
- Added and updated regressions for then-current expired-claim reclaim,
  pre-callback accepted-limit accounting, bounded query count under skipped
  rows, supported endpoint typing, and live-claim loop idling. Historical
  correction: the expired-claim reclaim regressions are retained as Round 24
  history only; current behavior is the Round 35 no-reclaim contract.

## Verification

Final verification was run after the code/doc changes and before this report
was written:

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts`
  - 3 test files passed, 165 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API docs expectation checks completed with exit code 0.
  - Reported the existing invalid `origin` source-link warning only.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace errors.

## Concerns

- `docs:check` still reports the existing invalid `origin` source-link warning;
  no new docs-check warnings were introduced in this round.
- `.codex-review-packages/` was left untouched.
- No commit was created, per coordinator instruction.
