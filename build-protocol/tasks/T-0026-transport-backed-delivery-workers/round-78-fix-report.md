# Round 78 Fix Report

Timestamp: `2026-07-10T22:28:32Z`

## Changes

- Renamed private resume-cursor offset validation from `requireScanOffset()` to
  `requireResumeCursorOffset()` without changing behavior or error text.
- Replaced the failure-only shallow endpoint snapshot path with one local
  `endpointSnapshot()` builder that validates supported labels plus
  `TO_DELIVER` status and copies mutable `Date` and `Any.value` fields for
  callback and failure-visible snapshots.
- Added focused delivery-worker coverage proving mutations to
  `DeliveryRun.failures[*].message` do not mutate the pending inbox row.
- Re-anchored the Round 44-46 durable chronology to commit-backed UTC and
  mechanically ordered the review-log sections by round so Round 45 sits after
  Round 44 and before Round 46.
- Reset the task/review dashboard so all five lanes require fresh current-HEAD
  re-review after this fix.

## Verification

- `pnpm --config.verify-deps-before-run=false test packages/server/test/delivery/delivery-worker.test.ts`
  passed at `2026-07-10T22:29:32Z` after proto generation/checks and generated
  build typecheck; Vitest reported 1 file and 52 tests passed.
- The first post-record `format:check` found work-log wrapping only; the repo
  formatter normalized it, and the final `format:check` passed.
- `git diff --check` passed.
- `git status --short` showed no generated Protobuf output in the tracked diff;
  the pre-existing untracked `.codex-review-packages/` directory remains
  untracked.
- Coordinator verification passed at `2026-07-10T22:37:21Z` with focused
  delivery-worker Vitest, generated build typecheck, docs check with only the
  existing invalid TypeDoc `origin` warning, format check, and
  `git diff --check`.
