# T-0012.12e: Task Subscriptions

Status: implementation and local verification complete; pending review/merge
Start: `2026-07-05 20:32 WEST`
End: Pending
Baseline commit: `a8c8f07`
Task log path: `build-protocol/tasks/T-0012-12e-task-subscriptions/TASK.md`
Branch: `task/T-0012-12e-task-subscriptions`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12e-task-subscriptions`
Authoring sub-agent: pending
Reviewer sub-agents: pending
Setup commit: pending commit
Implementation commit: pending
Final branch HEAD: pending

## Objective

Demonstrate live task-list updates through real `SubscriptionService` behavior
in the to-do example.

## Required Inputs To Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/tasks/T-0012-12d-validation-refusal/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- Existing example code under `examples/todo/src`.
- Existing to-do Protobuf contracts and generated schemas under
  `examples/todo/proto` and `examples/todo/generated`.
- Existing subscription seams in `packages/server`, `packages/testing`, and
  related service tests.

## Scope

In scope:

- Add focused black-box example tests for task-list subscription updates.
- Use real framework subscription behavior through `BoundedContextFixture`.
- Cover activation, update content, and cancellation/cleanup.
- Exercise create, rename, complete, and reopen updates emitted by projection
  changes.
- Update example README and `USER_GUIDE.md` only as needed.

Out of scope:

- Durable subscription storage.
- Hand-built test updates or direct command-call subscription shortcuts.
- Standalone server startup or external client guide, which belongs to
  `T-0012.12f`.
- Broad framework redesign unless a focused failing test proves a gap.

## Acceptance Criteria

- Example topic/query helpers can subscribe to the task-list projection target.
- Black-box tests use `BoundedContextFixture.subscribe()` and receive updates
  after create, rename, complete, and reopen commands.
- Tests cover activation, update content, and cancellation/cleanup.
- Subscription updates are emitted from projection changes, not direct command
  calls or hand-built test updates.
- Slow-consumer or cancellation behavior uses existing `SpineServices` queue
  controls; no durable subscription store is added.

## Verification Plan

- Focused example subscription tests.
- `pnpm typecheck`
- `pnpm lint`
- Tracked-file Prettier check.
- `pnpm docs:check`
- `pnpm proto:check-generated`
- `git diff --check`
- Escalated `pnpm test:coverage` if the sandbox denies local gRPC or ZeroMQ
  IPC.

## Initial Decisions

- Continue from `main@4bebdeb`, immediately after `T-0012.12d` integration.
- Use existing `BoundedContextFixture.subscribe()` and framework
  `SubscriptionService` behavior directly.
- Keep subscription testing black-box from the example developer perspective.
- Route any proven framework gap through a focused framework-gap slice before
  continuing dependent example work.

## Implementation Notes

- Added black-box subscription coverage in
  `examples/todo/src/index.test.ts` using
  `BoundedContextFixture.subscribe(createTaskListTopic())`.
- The example now demonstrates task-list subscription updates for create,
  rename, complete, and reopen commands by unpacking real
  `SubscriptionUpdate.entityUpdates` payloads.
- Cancellation coverage uses the existing fixture subscription handle and
  confirms `next()` becomes inert after `cancel()`.
- No framework changes were required. The existing `SubscriptionService`
  behavior already emitted projection-driven updates with the expected shape.

## Verification Evidence

- RED:
  - Added the new example subscription tests first, then ran
    `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`.
  - The first full run passed immediately with 14/14 tests because the
    framework behavior already existed; this slice needed example-level proof
    and docs rather than production code changes.
- GREEN:
  - `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
    passed after the test/doc updates.
- GREEN:
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
  - `pnpm exec prettier --check examples/todo/src/index.test.ts examples/todo/README.md examples/todo/USER_GUIDE.md build-protocol/tasks/T-0012-12e-task-subscriptions/TASK.md build-protocol/tasks/T-0012-12e-task-subscriptions/IMPLEMENTATION_REPORT.md build-protocol/reviews/T-0012-12-to-do-example.md build-protocol/work-logs/T-0012-12.md`
    passed.
  - `pnpm docs:check` passed.
  - `pnpm proto:check-generated` passed.
  - `git diff --check` passed.

## Setup Baseline

- Sandboxed `pnpm install` failed with registry `ENOTFOUND`; escalated
  `pnpm install` succeeded.
- `pnpm typecheck` passed.
- A concurrent first focused test run failed before build outputs were ready,
  with package entry resolution for `@spine-ts/core`.
- After `pnpm typecheck` completed, focused
  `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`
  passed, 1 file / 12 tests.
