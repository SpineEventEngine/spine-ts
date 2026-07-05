# T-0012.12f: Runnable Server And Guide

Status: review-fix verified; ready for re-review
Start: `2026-07-05 20:59 WEST`
End: Pending
Baseline commit: `230452d`
Setup commit: `21c3c27`
Implementation commit: `995e842`
Task log path: `build-protocol/tasks/T-0012-12f-runnable-server-guide/TASK.md`
Branch: `task/T-0012-12f-runnable-server-guide`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`
Authoring sub-agent: `019f33cd-dfd0-7c73-bb58-60b7e5045c5d` (closed)
Reviewer sub-agents: round 1 complete and closed; review-fix pending

## Objective

Make the to-do example runnable as a standalone server-side app and replace the
remaining placeholder-oriented README/user-guide content.

## Required Inputs To Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/tasks/T-0012-12e-task-subscriptions/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- Existing example code under `examples/todo/src`.
- Existing service seams in `packages/server`, `packages/testing`, and their
  service tests.

Server-module guardrail:

- Before changing `packages/server` or adding server abstractions, inspect the
  corresponding Spine JVM `core-jvm/server` source or the available local
  `spine-jvm-docs` notes, record the inspected paths, and prefer the smallest
  JVM-familiar contract. This slice should not invent a broad facade or process
  supervisor just to run the example.

## Scope

In scope:

- Add an example server entry point or narrowly scoped startup API for the
  existing to-do bounded context.
- Start a real Connect/Node gRPC-compatible host using existing
  `SpineServices` behavior.
- Add a focused smoke test that posts a command through a real client, reads
  the projection through `QueryService`, and receives or verifies subscription
  behavior.
- Update `examples/todo/README.md` and `examples/todo/USER_GUIDE.md` so they
  describe the runnable app, generation, startup, commands, queries,
  subscriptions, in-memory storage, and demonstrated framework features.

Out of scope:

- A broad `@spine-ts/server` facade or process supervisor.
- Simulated gRPC or hand-built service shortcuts.
- Local multi-process claims that are not actually exercised by the current
  framework. If a missing framework feature is proven, route it to a framework
  gap before claiming the behavior.

## Acceptance Criteria

- The example has a runnable server-side entry path.
- A focused test exercises real gRPC-compatible command, query, and
  subscription behavior.
- README and `USER_GUIDE.md` are no longer placeholder-oriented.
- The implementation uses in-memory storage without baking in-memory specifics
  into general framework contracts.
- Any needed server-module change records the Spine JVM guardrail before code
  changes.

## Verification Plan

- Focused example server/gRPC test. If sandbox blocks loopback listeners, rerun
  the focused command with approved escalation and record that result.
- Focused full example black-box suite.
- `pnpm typecheck`
- `pnpm lint`
- Changed-file Prettier check or `pnpm format:check` if feasible.
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `git diff --check`
- Escalated `pnpm test:coverage` if the sandbox denies local gRPC or ZeroMQ
  IPC.

## Initial Decisions

- Continue from `main@230452d`, immediately after `T-0012.12e` parent
  integration review.
- Prefer existing `SpineServices` and example bounded-context assembly directly
  over a new facade.
- Keep the first runnable-server path small; route proven missing framework
  behavior to a gap task instead of expanding this slice.

## Current State

- Task branch/worktree created.
- Durable setup logs created before implementation.
- Setup verification passed after escalated install.
- Implementation resumed in the task worktree. Required inputs have been read,
  and the planned implementation remains example-owned startup code plus a
  real-client smoke test over existing `SpineServices`.
- Example-owned `startTodoServer()` and package `start` script are implemented.
- Focused real-client smoke coverage passed with escalation after the sandbox
  denied loopback binding.
- Round 1 review found test cleanup, IPv6 URL formatting, package description,
  guide-snippet typing, and durable metadata fixes. Review-fix edits are in
  progress.

## Setup Verification

- Sandboxed `pnpm install` failed with registry `ENOTFOUND`; escalated
  `pnpm install` succeeded.
- Changed-log Prettier check passed.
- `git diff --check` passed.
- First focused todo test failed before build outputs existed, with package
  entry resolution for `@spine-ts/core`.
- `pnpm typecheck` passed and generated/build outputs.
- Focused
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  then passed, 1 file / 14 tests.

## Final Verification

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed with escalation, 1 file / 15 tests.
- `pnpm typecheck` passed.
- `pnpm lint` passed, including cleanup enforcement.
- Changed-file Prettier check passed.
- `pnpm docs:check` passed with the existing invalid-origin TypeDoc warning.
- `pnpm proto:check-generated` passed.
- `git diff --check` passed.
- Sandboxed `pnpm test:coverage` failed with expected local listener/ZeroMQ
  `EPERM` failures. Escalated `pnpm test:coverage` passed, 45 files / 651
  tests, with 95.18% statements, 90.48% branches, 97.63% functions, and 95.2%
  lines.

## Round 1 Review Findings

- Maintainability and reliability: guarantee `server.close()` even if client or
  subscription setup fails in the standalone smoke test.
- Maintainability: avoid leaving an unobserved `nextUpdate` promise if command
  or query assertions fail.
- Maintainability: update the example package description to reflect the
  runnable server.
- Reliability: bracket IPv6 listener hosts in `baseUrl`.
- Documentation: fix non-chronological task/work-log timestamps and stale
  pending sub-agent metadata.
- TypeScript/API docs: guard undefined query row states in the user-guide
  snippet before calling `unpackAny()`.

## Round 1 Review-Fix Verification

- Changed-file Prettier write/check passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- Sandboxed focused Vitest failed with expected `listen EPERM` on
  `127.0.0.1`; escalated focused Vitest passed, 1 file / 15 tests.
- `pnpm lint` passed.
- `pnpm docs:check` passed with the existing invalid-origin TypeDoc warning.
- `pnpm proto:check-generated` passed.
- Next review package starts after implementation commit `995e842`.
