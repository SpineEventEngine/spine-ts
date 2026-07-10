# T-0026 Round 37 Fix Report

Status: verified
Branch: `task/T-0026-transport-backed-delivery-workers`
Worktree: `.worktrees/T-0026-transport-backed-delivery-workers`
Date: `2026-07-10`

## Scope

Round 37 addresses one durable-log cleanup batch and one reliability regression:

1. Record that Round 35 coordinator commit `5c3705e2`
   (`Fix delivery claim blocking and offset rescan`) and Round 36 coordinator
   commit `e4388fb5` (`Fix delivery review gate cleanup`) already exist.
2. Mark older Round 24/25 expired-claim reclaim records as historical and
   superseded by Round 35 / `5c3705e2`.
3. Fix the drain race where skipped rows can disappear after pending-boundary
   validation but before the offset-page read, letting a loop falsely idle past
   reachable supported work.

## Implementation

- Added a focused regression in `delivery-loop.test.ts` that removes a full
  skipped head page after boundary validation and before the offset-page query.
  Before the fix, the loop returned `IDLE` with `delivered: 0` while the
  supported tail row remained reachable.
- Added a narrow delivery storage test probe for targeting a specific inbox
  query number.
- Updated `Delivery.#drainAvailableMessages()` so a short offset-page read with
  no accepted or failed work revalidates the pending boundary and performs one
  bounded head rescan if the boundary moved.
- Updated task, work, review, and Round 24/25/35/36 reports so they preserve
  historical context while stating the current no-reclaim contract: expired and
  live row claims both block competing delivery until a future explicit recovery
  policy exists.

## Verification

- RED: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "rescans when skipped rows disappear after boundary validation"`
  - Failed before the fix: 1 failed, 25 skipped. The loop returned `IDLE` with
    `delivered: 0` instead of delivering `signal-supported-tail`.
- GREEN: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "rescans when skipped rows disappear after boundary validation"`
  - 1 file passed; 1 test passed and 25 skipped.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 5 files passed; 224 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  - `tsc -b` completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - Proto generation, TypeDoc, and API-doc expectation checks completed with
    exit code 0.
  - Reported only the existing invalid `origin` TypeDoc source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false lint`
  - Proto generation, generated typecheck, ESLint, and cleanup enforcement
    completed with exit code 0.
- PASS: `pnpm --config.verify-deps-before-run=false format`
  - Formatter completed with exit code 0 before final verification.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
  - All matched files use Prettier code style.
- PASS: `git diff --check`
  - No whitespace or conflict-marker errors.

Notes:

- An initial parallel `docs:check` run failed when another parallel
  `proto:generate` was also touching generated output. The sequential rerun
  above passed.
- An initial `lint` run found test-local cleanup (`prefer-const` and an async
  no-op); the final lint rerun above passed after the test cleanup.

## Commit Note

No commit was created by the fix worker, per Round 37 instruction. Coordinator
commit `1403505e` (`Fix delivery offset boundary race`) recorded this verified
fix.

## Coordinator Verification

- `2026-07-10T16:22:00Z`: Coordinator inspected the fix and reran
  verification.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts -t "rescans when skipped rows disappear after boundary validation"`
  - 1 file passed; 1 test passed and 25 skipped.
- PASS: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - 5 files passed; 224 tests passed.
- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`
  - Reported only the existing invalid `origin` TypeDoc source-link warning.
- PASS: `pnpm --config.verify-deps-before-run=false lint`
- PASS: `pnpm --config.verify-deps-before-run=false format:check`
- PASS: `git diff --check`
