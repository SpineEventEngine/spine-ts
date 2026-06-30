# Implementation Report: T-0011.3 Local IPC Smoke Tests

Status: Implemented
Task log: `build-protocol/tasks/T-0011-3-local-ipc-smoke-tests/TASK.md`
Work log: `build-protocol/work-logs/T-0011-3.md`
Review log: `build-protocol/reviews/T-0011-3-local-ipc-smoke-tests.md`
Branch: `task/T-0011-3-local-ipc-smoke-tests`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-3-local-ipc-smoke-tests`

## Summary

T-0011.3 starts from parent T-0011 commit `08d7e82`, after T-0011.2 pinned
`zeromq@6.5.0` and added adapter-private local IPC configuration helpers. This
subtask owns focused local IPC smoke tests over the pinned ZeroMQ dependency.

Implementation added one adapter-private Vitest smoke test file that imports
`zeromq@6.5.0` directly and covers:

- a same-host publish/subscribe IPC flow with `Publisher` and `Subscriber`;
- a same-host request/reply IPC flow with `Request` and `Reply`; and
- temporary IPC directory cleanup plus socket closure in `finally` paths.

The public `@spine-ts/transport` root remains adapter-agnostic and does not
export ZeroMQ sockets, endpoints, multipart frames, or native binding types.
No `@spine-ts/server` files were changed.

## Actual Changed Files

- `packages/transport/src/zeromq-local-ipc-smoke.test.ts`
- `packages/transport/README.md`
- `docs/architecture/README.md`
- `docs/api/README.md`
- `build-protocol/tasks/T-0011-3-local-ipc-smoke-tests/TASK.md`
- `build-protocol/tasks/T-0011-3-local-ipc-smoke-tests/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0011-3.md`
- `build-protocol/reviews/T-0011-3-local-ipc-smoke-tests.md`

## Guardrails

- Keep ZeroMQ socket and endpoint details out of public transport exports.
- Use temporary same-host IPC endpoints and close sockets in every test path.
- Do not introduce broker processes, worker lifecycle, retry/delivery
  semantics, server dispatch, storage, read-side execution, or gRPC wiring.
- Do not touch `@spine-ts/server` without first recording task-relevant
  Spine JVM `core-jvm/server` source evidence.

## Verification

Setup dependency install passed on `2026-06-30 22:08 WEST`:
`corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
reused cached packages, installed 197 workspace packages, and ran the approved
`zeromq@6.5.0` install script.

Setup baseline verification passed on `2026-06-30 22:10 WEST`:
`CI=true corepack pnpm verify` passed with 22 test files / 266 tests, coverage
96.34% statements / 90.48% branches / 99.27% functions / 96.28% lines,
TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage expected
exports, copied Spine proto checksum verification, proto lint/generate,
generated proto output clean, and generated files clean. TypeDoc emitted the
existing invalid-`origin` warning only.

Focused smoke verification passed on `2026-06-30 22:17 WEST`:
`corepack pnpm vitest run packages/transport/src/zeromq-local-ipc-smoke.test.ts`
passed with 1 test file / 2 tests. The command ran with native IPC access
because the managed sandbox rejects ZeroMQ `ipc://` binds with `EPERM`.

Required implementation verification passed on `2026-06-30 22:18-22:21 WEST`:

- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning only.
- `CI=true corepack pnpm verify` passed with 23 test files / 268 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.
- `git diff --check` passed.

## Review Notes

- Round 1 review outcomes were clean for TypeScript/API docs, security, and
  performance/reliability.
- Maintainability was also clean, with one minor non-blocking note about
  failure attribution around awaiting `replyTask` after `requester.receive()`.
- Documentation review asked for the local IPC sandbox permission note, which
  is now recorded in the package, architecture, and API docs.
- The task log now records the completed implementation sub-agent ID and the
  round 1 reviewer state.

## Open Items

- External review lanes remain for the orchestrator/reviewer agents.
