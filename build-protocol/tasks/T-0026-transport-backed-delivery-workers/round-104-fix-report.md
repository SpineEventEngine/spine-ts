# Round 104 Fix Report

Timestamp: `2026-07-11T01:37:36Z`

## Finding

Round 103 performance/reliability found that stale-offset recovery can exceed
the documented strict `maxReadLimit + limit` storage-read contract. A
`limit: 1` run can read the first cap-sized page, use one-row boundary probes
to detect a moved pending set, then read one more cap-sized head page to reach
a supported row that moved before the old offset.

## Decision

Keep the explicit bounded rescan. Strict storage-row budgeting would lose
liveness for moved supported rows behind already-seen head rows with the
current offset-only storage API.

The aligned contract is:

- `limit` caps endpoint callbacks actually invoked.
- Newly observed pending rows stop at `maxReadLimit + limit`.
- After stale pending-boundary mismatch resets an offset scan to the head,
  recovery may read one additional cap-sized page of already-seen rows plus the
  one-row boundary probes needed to detect the mismatch.
- The recovery remains finite and does not grant repeated full rescans.

## Changes

- Updated the stale-head regression to record inbox query limits and offsets,
  pinning the recovery sequence to first cap page, boundary probe, stale offset
  probe, second boundary probe, and one cap-sized head rescan.
- Updated `Delivery.drain()` API comments and public/user-facing docs to name
  the bounded-rescan allowance.
- Updated durable task, work-log, and review records for the Round 104
  contract.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts -t "stale-head rescan|storage read cap|skipped head rows disappear"`:
  passed, 3 tests selected and 50 skipped.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with only the
  known invalid TypeDoc `origin` source-link warning.
- `pnpm --config.verify-deps-before-run=false format:check`: passed after the
  repo formatter normalized the owned work log and architecture doc.
- `git diff --check`: passed.
- Targeted stale strict-budget wording guard: returned no matches.
