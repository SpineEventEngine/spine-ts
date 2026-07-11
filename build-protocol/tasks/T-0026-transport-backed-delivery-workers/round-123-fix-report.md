# Round 123 Fix Report

## Scope

- Added focused runtime branch coverage for exact-message delivery drains that
  skip already-delivered rows and worker-unsupported `CATCH_UP` rows.
- Added focused runtime transport coverage for command and event intake when
  the bound runtime closes outside the transport binding gate.
- Left `.codex-review-packages/` untouched and did not commit.

## Verification

- Focused: `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/delivery/delivery-worker.test.ts` passed with 55 tests
  after the delivery-worker additions.
- Focused: the combined sandboxed runtime/delivery run failed only because the
  existing ZeroMQ IPC test could not create a sandboxed socket (`EPERM`).
- Focused unsandboxed: `pnpm --config.verify-deps-before-run=false exec vitest
run packages/server/test/delivery/delivery-worker.test.ts
packages/server/test/runtime/runtime-transport.test.ts` passed with 2 files and
  68 tests.
- Coverage sandboxed: `pnpm --config.verify-deps-before-run=false
test:coverage:generated` failed in local HTTP/2 and ZeroMQ IPC tests with
  `EPERM`.
- Coverage unsandboxed before the runtime-transport addition passed regular
  tests with 59 files and 1218 tests, but branch coverage was still `89.97%`
  (`3346/3719`).
- Coverage unsandboxed after the runtime-transport addition:
  `pnpm --config.verify-deps-before-run=false test:coverage:generated` passed
  with 59 files and 1219 tests. Global branch coverage is now `90.02%`
  (`3348/3719`).

Coordinator verification repeated the green checks on `2026-07-11T04:05:55Z`:
focused unsandboxed Vitest passed with 2 files and 68 tests, `format:check`
passed, `git diff --check` passed, and unsandboxed
`test:coverage:generated` passed with 59 files and 1219 tests. Global branch
coverage remained `90.02%` (`3348/3719`).
