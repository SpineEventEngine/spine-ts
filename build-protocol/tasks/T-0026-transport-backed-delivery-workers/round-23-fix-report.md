# Round 23 Fix Report

Date: 2026-07-10

## Review Intake

Fixed the Round 23 review batch for T-0026:

- Keep the internal claimed delivery snapshot private from endpoint callbacks.
- Bound `Delivery.drain()` scanning when valid unsupported labels or unavailable
  rows dominate a shard.
- Refresh public docs and TypeDoc so valid worker-unsupported labels such as
  `CATCH_UP` remain pending and skipped, while malformed/deprecated legacy rows
  such as stored `IMPORT_EVENT` remain the fail-closed storage-corruption path.
- Reconcile the task ledger with the missing Round 22 entry and this Round 23
  evidence.

## Changes

- `Delivery.drain()` now scans at most the storage read cap plus `limit`
  pending rows per drain: up to one full skipped page plus the accepted
  endpoint-work limit.
- Endpoint callbacks now receive a public snapshot cloned away from the private
  claimed row used for final CAS. `Date` fields are copied, `inboxId` and `id`
  are copied/frozen, and protobuf `Any.value` gets a fresh byte array.
- Added focused delivery tests for callback mutation of nested `Date`/`Any`
  values, scanning across `CATCH_UP` rows before accepted work, and stopping at
  the finite skipped-row scan budget.
- Updated API docs, developer API docs, user guide wording, and delivery
  TypeDoc to remove stale unsupported-label failure-budget language.

## Verification

Final verification was run after the code/doc changes and before this report was
written:

- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/inbox.test.ts`
  - 3 test files passed, 162 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - TypeDoc and API docs check completed with exit code 0.
  - Reported the existing invalid `origin` source-link warning only.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace errors.

## Concerns

- `.codex-review-packages/` was already untracked in this worktree and was left
  untouched.
- No commit was created, per coordinator instruction.
