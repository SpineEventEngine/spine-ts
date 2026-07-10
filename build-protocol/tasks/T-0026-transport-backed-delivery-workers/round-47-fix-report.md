# Round 47 Coverage Fix Report

Date: `2026-07-10`
Worker: Round 47 fix worker
Baseline: `ca8fb2b3`
Starting HEAD: `7c1233f9`

## Scope

Full generated coverage previously passed all tests and failed only the global
branch coverage threshold: 89.56% versus the required 90%. This fix added
focused behavioral coverage for uncovered T-0026 branches without lowering
thresholds, changing coverage configuration, removing code from coverage, or
changing production behavior.

## Implementation

- `packages/server/test/delivery/delivery-worker-runtime.test.ts`
  - Covers optional `limit` and `maxFailures` forwarding to configured shard
    loops.
  - Covers loop default behavior when the worker omits optional limits.
  - Covers invalid shard-list validation before loops start.
  - Covers double-start rejection while a worker run is active.
  - Covers aggregate worker status priority for `FAILED` and `SKIPPED`.
- `packages/server/test/delivery/sharded-work-registry.test.ts`
  - Covers default registry lease and clock options.
  - Covers renew on missing and mismatched shard sessions.
  - Covers renew compare-and-set retry, retry exhaustion, and non-Error storage
    failure wrapping.
  - Covers non-object renew/release sessions.
  - Covers malformed stored shard-session envelope type URL and value branches.

No production source files were modified.

## TDD Notes

These were coverage-only tests over existing behavior. The first focused
delivery-worker run did fail on a wrong test assumption, proving the new test
was observing the real default drain limit (`100`, not `1000`); the expectation
was corrected and the focused file then passed. No production implementation
change was required.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker-runtime.test.ts`
  - Failed once because the new default-limit expectation used `1000`; actual
    behavior is `100`.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker-runtime.test.ts`
  - Passed: 1 file, 11 tests.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  - Failed in sandbox with local loopback/IPC EPERM:
    `listen EPERM: operation not permitted 127.0.0.1` and ZeroMQ IPC
    `Operation not permitted`.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  - Passed under approved local IPC/loopback access through tests, but still
    failed coverage at 89.72% branches after worker-only tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - Passed after registry renew/default tests: 2 files, 60 tests.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  - Passed under approved local IPC/loopback access through tests, but still
    failed coverage at 89.91% branches.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - Passed after final storage-envelope tests: 2 files, 63 tests.
- `pnpm --config.verify-deps-before-run=false test:coverage:generated`
  - Passed under approved local IPC/loopback access: 59 files, 1211 tests.
  - Branch coverage: 90.02% (3329/3698), meeting the 90% threshold.
- `pnpm --config.verify-deps-before-run=false format`
  - Passed after formatting the tracked registry test change.
- `pnpm --config.verify-deps-before-run=false exec prettier --check build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-47-fix-report.md`
  - Passed for the untracked report file.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker-runtime.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  - Passed after formatting: 2 files, 63 tests.
- `pnpm --config.verify-deps-before-run=false format:check`
  - Passed.
- `git diff --check`
  - Passed.
- Coordinator verification reran focused delivery-worker/registry Vitest,
  `format:check`, `git diff --check`, and approved local IPC/loopback
  `test:coverage:generated`; all passed with 59 files, 1211 tests, and 90.02%
  branch coverage.

## Concerns

- The generated coverage command requires local loopback/IPC approval in this
  sandbox; without approval it fails before coverage reporting with EPERM.
- The global branch gate now passes narrowly at 90.02%, so future branch-heavy
  changes may need accompanying tests.
