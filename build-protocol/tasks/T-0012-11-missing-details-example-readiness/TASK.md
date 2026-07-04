# T-0012.11: Missing Details And Example Readiness

Status: splitting in progress
Branch: `task/T-0012-11-missing-details-example-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11-missing-details-example-readiness`
Baseline commit: `3901ec4`

## Objective

Identify and implement only the remaining framework details required before the
to-do example can be a real app with command, query, subscription, and gRPC
behavior.

This task must stay concrete. It is not a license to rebuild every Spine JVM
subsystem. A gap belongs here only when it blocks the next executable framework
workflow or the example app.

## Required Scope

- Split the task into small sub-tasks before implementation.
- Use evidence from existing TS code, T-0012 review comments, the to-do example
  specification, and relevant Spine JVM docs/source.
- Tie each proposed gap to concrete framework behavior required by the example
  or by real command/query/subscription workflows.
- Prefer small JVM-familiar concepts and names.
- Update docs/API docs and durable logs for each accepted sub-task.

## Explicitly Out Of Scope

- No speculative system context, import bus, scheduler, tenant index,
  observability, catch-up, or worker/process feature unless a concrete workflow
  requires it now.
- No to-do example implementation; that remains `T-0012.12`.
- No broad `Server` facade unless a small service-hosting detail is proven to
  block the example.
- No production storage implementation beyond in-memory unless required for the
  example readiness check.
- No client DSL unless required before the example can exercise real gRPC
  services.

## Evidence To Inspect

- `build-protocol/TODO_EXAMPLE_SPEC.md`.
- `build-protocol/TECHNICAL_SPEC.md`.
- `build-protocol/DEVELOPER_API.md`.
- `build-protocol/tasks/T-0012-10-real-grpc-services/IMPLEMENTATION_REPORT.md`.
- `build-protocol/reviews/T-0012-10-real-grpc-services.md`.
- `packages/server/src/services/spine-services.ts`.
- Relevant JVM docs under `spine-jvm-docs`, especially server runtime,
  client/query/subscription, routing/dispatch/delivery, and entity state docs.

## Acceptance Criteria

- A requirements-splitting sub-agent produces a staged T-0012.11 sub-task list.
- The first non-blocked sub-task is selected and receives its own branch and
  worktree.
- Each sub-task is small enough for a single implementation sub-agent and the
  five required reviewer lanes.
- Any implemented gap is backed by tests and by a clear example-readiness or
  framework-workflow need.
- Review lanes report no remaining order violations.

## Verification Plan

- Splitter output reviewed by the orchestrator and recorded here.
- For each implementation sub-task: focused tests, `pnpm typecheck`,
  `pnpm lint`, tracked-file or full Prettier check, full or justified focused
  tests, docs/API checks, proto checks if touched, coverage threshold check
  when implementation code changes, and `git diff --check`.

## Current State

Task setup is in progress. The requirements-splitting sub-agent has not been
spawned yet. No blocking human question is known.
