# Implementation Report: T-0011.3 Local IPC Smoke Tests

Status: Implementation Handoff Ready
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

## Expected Files

Likely changed files:

- adapter-private test/helper files under `packages/transport/src`;
- `packages/transport/README.md`;
- `docs/architecture/README.md` and/or `docs/api/README.md` if local IPC smoke
  scope needs clarification;
- this task/report/work/review log set.

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

## Open Items

- Dispatch the implementation sub-agent.
