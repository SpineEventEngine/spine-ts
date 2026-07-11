# Round 92 Fix Report

Timestamp: `2026-07-10T23:55:22Z`

## Findings

- Security: row-claim renewal can be missed when shard renewal completes while
  the row claim is still being acquired. The active claim has not been set yet,
  so `ActiveClaim.renew()` returns without updating the row claim to the next
  shard session. The callback can then run with a stale row-claim expiry, and a
  competing worker can reclaim the row after that stale expiry.
- Documentation/style: Round 90 report and review-log header still use the
  planning timestamp instead of the actual Round 90 verification timestamp.

## Changes

- Added a regression that blocks row claim acquisition while shard renewal
  completes, then asserts the stored row claim is synchronized to the renewed
  shard-session expiry before endpoint callback dispatch.
- After a row claim is acquired and installed as the active claim, delivery now
  waits for any in-flight shard renewal, verifies the shard lease is still
  active, and synchronizes the stored row claim to the latest shard session
  before invoking the endpoint callback.
- Aligned the Round 90 fix report timestamp and review-log Round 90 header with
  the actual `2026-07-10T23:55:22Z` verification timestamp.

## Verification

- Coordinator verification passed at `2026-07-11T00:11:56Z`.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/context/projection-handoff.test.ts`
  passed with 3 files and 91 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  passed.
- `pnpm --config.verify-deps-before-run=false docs:check` passed with only the
  existing invalid TypeDoc `origin` warning.
- `pnpm --config.verify-deps-before-run=false format:check` passed.
- The targeted stale-record search returned no matches.
- `git diff --check` passed.
- Generated/API reference diff checks returned no changed files.
