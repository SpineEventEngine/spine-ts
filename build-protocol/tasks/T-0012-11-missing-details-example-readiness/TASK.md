# T-0012.11: Missing Details And Example Readiness

Status: T-0012.11a, T-0012.11b, and T-0012.11c merged and parent-verified; T-0012.11d round-14 docs/status fix verified
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
- Update durable task/report/review/work logs for each accepted sub-task.
- Update public/API docs for each accepted sub-task when public or API behavior
  changes.

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
- The first non-blocked sub-task is selected by the split and gets a proposed
  branch/worktree. The orchestrator creates that branch/worktree only after the
  splitter review is clean.
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

## Splitting Outcome

The splitter reviewed the current TS runtime, the example specification, the
`T-0012.10` service slice, and curated JVM notes. The resulting roadmap keeps
only the missing details that block a real to-do app or an already-advertised
framework workflow.

The original concrete blockers were:

- repository dispatch was route-only, so commands and events did not invoke
  entity handlers (`T-0012.11a` resolved aggregate command execution);
- aggregate writes did not produce executable command-to-event-to-storage
  behavior (`T-0012.11a` resolved this for aggregate command paths);
- projection updates are not driven from delivered events into the read side;
- `QueryService.Read` still requires ID filters, which is too small for a task
  list view;
- validation and business refusal paths are not wired into runtime command
  execution; and
- `packages/testing` is still a skeleton, so the required black-box example
  tests do not yet have a framework fixture.

Rejected from this split because they are not proven blockers now:

- broad `Server` facade or process supervisor;
- import bus support;
- scheduler or command scheduling;
- tenant index work;
- event-subscription catch-up/recovery;
- worker/process runtime fan-out;
- observability or command-log features; and
- client DSL work.

## First Selected Subtask

Selected first implementable slice: `T-0012.11a Aggregate Command Execution`.

Proposed branch: `task/T-0012-11a-aggregate-command-execution`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`

Why first:

- it was the smallest end-to-end slice that turned the route-only write-side
  path into real framework behavior;
- every later example-readiness slice depends on real aggregate command
  execution; and
- it keeps the work JVM-familiar without introducing a new facade or a
  speculative runtime subsystem.

Resumed-state note:

- `T-0012.11` is split complete and `T-0012.11a` is selected first.
- The `T-0012.11a` branch/worktree is now created from reviewed split commit
  `8804e93`.
- The `T-0012.11a` child worktree has completed the review-fix, coverage-fix,
  and round-2 async-applier fix passes, updated public/API docs, and recorded
  focused plus escalated coverage verification in the child
  task/report/review/work logs.
- `T-0012.11a` is merged into this parent branch at `1a7b6c8`. Parent
  verification passed after rebuilding workspace package entrypoints: focused
  tests (5 files, 62 tests), `pnpm docs:check`, `pnpm typecheck`, `pnpm lint`,
  `git diff --check HEAD^..HEAD`, and escalated `pnpm test:coverage` (45 files,
  564 tests; statements 94.85%, branches 90.03%, functions 97.33%, lines
  94.87%).
- `T-0012.11b` is merged into this parent branch at `cb46983`. It executes
  projection subscribers from delivered events, writes changed projection state
  through context-owned `Stand`, records bounded stored-event redispatch
  diagnostics, and rejects aggregate command execution without `command.id`
  before mutation/storage. Parent verification passed after the merge: focused
  repository/service tests (2 files, 63 tests), `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `pnpm docs:check`, `git diff --check`, and escalated
  `pnpm test:coverage` (45 files, 580 tests; branches 90.04%). Sandboxed
  service/coverage runs remain blocked only by local endpoint permissions.
- `T-0012.11c` is merged into this parent branch at `413c5f7`. It adds direct
  `Stand.readAllVersioned()` list reads over `RecordStorage.query()`, supports
  projection-state `Target.include_all` queries through `QueryService.Read`,
  preserves tenant validation for projection routes, and documents the
  public/API behavior. Parent review found include-all had been accepted for
  all state routes; follow-up commits `764b946` and `a0c6dde` now reject
  non-projection include-all targets with `INVALID_QUERY` before tenant
  validation or storage access. Parent verification passed: focused
  stand/service tests, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm docs:check`, `git diff --check`, and escalated `pnpm test:coverage`
  (45 files, 592 tests; branches 90.03%). Sandboxed coverage remains blocked
  only by local endpoint permissions.
- `T-0012.11d Validation And Immediate Refusal Outcomes` is implemented in its
  child branch. Round-12 reliability follow-up has been applied and verified.

## Staged Subtasks

### T-0012.11a Aggregate Command Execution

Goal:

- Turn repository-backed aggregate command routing into real execution so a
  posted command can be acknowledged and handed to async command processing,
  which then loads or creates an aggregate, runs one assignee, applies the
  resulting event(s), persists aggregate history, and hands the produced events
  to the existing async event bus.

Acceptance criteria:

- A repository command dispatcher no longer stops at `routeCommand()`.
- A built aggregate repository can execute one `@Assign(...)` or
  `defineEntityHandlers(...).assign(...)` happy path through
  `CommandService.Post` intake -> `CommandBus` async dispatch -> repository ->
  aggregate -> stored events.
- Produced events are applied through aggregate appliers before aggregate state
  is stored.
- Aggregate persistence continues to use the existing `AggregateStorage` /
  `EventStore` seams.
- No process manager runtime, import bus, scheduler, client DSL, or broad
  server host is added in this slice.

Evidence inspected:

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/bus/command-bus.ts`
- `packages/server/src/bus/event-bus.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `packages/server/README.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

Expected write scope:

- `packages/server/src/repository/**`
- `packages/server/src/context/**`
- `packages/server/src/bus/**`
- `packages/server/test/repository/**`
- `packages/server/test/context/**`
- durable task/report/review/work-log updates
- public/API docs only if public or API behavior changes

Required verification:

- focused server write-side tests covering aggregate command execution,
  applier-backed state changes, persistence, and async bus handoff;
- `pnpm typecheck`
- `pnpm lint`
- tracked-file Prettier or `pnpm format:check`
- `pnpm docs:check` if public docs/API move
- `pnpm test:coverage`
- `git diff --check`

Why it blocks `T-0012.12` or real framework workflow:

- the example cannot create, rename, complete, or reopen a task until commands
  execute real aggregate handlers instead of only proving route metadata.

### T-0012.11b Projection Event Updates

Goal:

- Execute projection event subscribers from the existing event bus and keep the
  read side in sync from those delivered events.

Acceptance criteria:

- Repository event dispatch no longer stops at `routeEvent()`.
- A projection repository can consume a delivered event, update projection
  state, and write the resulting latest state into read-side storage.
- `Stand` remains the query/subscription facade over that read-side state.
- `SubscriptionService` keeps working over real projection updates emitted from
  event delivery rather than manual `stand.update(...)` calls in tests.
- The slice stays focused on domestic projection updates; no catch-up worker,
  retry loop, or external-event broker work is introduced.

Evidence inspected:

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/test/services/spine-services.test.ts`
- `docs/api/README.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

Expected write scope:

- `packages/server/src/repository/**`
- `packages/server/src/stand/**`
- `packages/server/src/bus/**`
- `packages/server/src/services/**`
- `packages/server/test/repository/**`
- `packages/server/test/stand/**`
- `packages/server/test/services/**`
- durable task/report/review/work-log updates
- public/API docs only if public or API behavior changes

Required verification:

- focused tests covering projection subscriber execution, stand updates, and
  subscription delivery after real event handling;
- `pnpm typecheck`
- `pnpm lint`
- tracked-file Prettier or `pnpm format:check`
- `pnpm docs:check` if public docs/API move
- `pnpm test:coverage`
- `git diff --check`

Why it blocks `T-0012.12` or real framework workflow:

- the example’s task-list projection and live task-list updates require
  delivered events to mutate the read side automatically.

Current state:

- `T-0012.11b` is merged into this parent branch at `cb46983`.
- Parent verification passed after merge: focused repository/service tests,
  typecheck, lint, format, docs, diff whitespace, and escalated coverage with
  45 files and 580 tests.
- Sandboxed service/coverage runs remain blocked only by local endpoint
  permissions.

### T-0012.11c Projection List Queries

Goal:

- Expand the current read-side query slice from ID-only reads to the smallest
  real projection-list query behavior needed by the to-do app.

Acceptance criteria:

- `QueryService.Read` no longer fails every `include_all` task-list query.
- The implementation supports at least projection-state `include_all` reads with
  stable versioned response packing.
- `include_all` projection reads preserve the tenant-boundary behavior already
  covered by `T-0012.10`, including all `TenantId` variants already handled
  there.
- The slice does not add speculative query DSL, paging engine, sort planner, or
  general aggregate querying unless the smallest list-view workflow proves they
  are required.

Evidence inspected:

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/stand.ts`
- `packages/server/test/services/spine-services.test.ts`
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`

Expected write scope:

- `packages/server/src/stand/**`
- `packages/server/src/services/**`
- `packages/server/test/stand/**`
- `packages/server/test/services/**`
- durable task/report/review/work-log updates
- relevant public/API docs

Required verification:

- focused tests covering `include_all` projection reads and preserved response
  version packing;
- focused regression tests covering `include_all` tenant-boundary behavior for
  the `TenantId` variants already handled by `T-0012.10`;
- `pnpm typecheck`
- `pnpm lint`
- tracked-file Prettier or `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`
- `git diff --check`

Why it blocks `T-0012.12` or real framework workflow:

- the example needs a real task-list read model, and the current service only
  supports direct ID lookup.

### T-0012.11d Validation And Immediate Refusal Outcomes

Goal:

- Wire existing validation and small refusal semantics into runtime command
  execution per `PROTOBUF_CONTRACT.md` so the example can demonstrate both
  invalid input and business refusal paths.

Acceptance criteria:

- Runtime command intake/execution validates command payloads with
  `@spine-event-engine/validation-ts` before durable write-side work proceeds.
- Aggregate command handling can surface one immediate business refusal path as
  a Spine `Ack` rejection/error outcome that preserves client-visible error
  details rather than replacing them with custom string-only shapes.
- State-transition validation keeps `(set_once)` semantics in the
  transaction/runtime layer.
- This slice does not add a large error-details hierarchy or late result-stream
  protocol.

Evidence inspected:

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `packages/core/src/index.ts`
- `packages/server/src/services/spine-services.ts`
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

Expected write scope:

- `packages/server/src/repository/**`
- `packages/server/src/services/**`
- `packages/server/src/entity/**`
- `packages/core/src/**` only if runtime integration exposes a missing validation
  seam
- `packages/server/test/**`
- `packages/core/test/**` only if shared validation behavior changes
- durable task/report/review/work-log updates
- relevant public/API docs

Required verification:

- focused tests covering invalid-command validation, immediate refusal
  acknowledgements, and state-transition validation during command execution;
- `pnpm typecheck`
- `pnpm lint`
- tracked-file Prettier or `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`
- `git diff --check`

Why it blocks `T-0012.12` or real framework workflow:

- the example spec explicitly requires one validation failure path and one
  rejection/business refusal path.

### T-0012.11e Minimal Black-Box Test Fixture

Goal:

- Replace the testing-package skeleton with the smallest framework-owned
  black-box fixture needed to write the example's bounded-context tests.

Acceptance criteria:

- `packages/testing` exposes a minimal typed OOP/generic bounded-context
  fixture object or class over built contexts, not helper-function sprawl or
  just package metadata.
- The fixture can drive commands/events through the real framework seams and
  inspect query/subscription outcomes needed by the to-do example.
- The fixture stays in-process and narrow; it does not add multi-process
  orchestration, browser tooling, or a client DSL beyond what tests need.
- Package README and API docs are updated in this slice because it creates a
  public testing package surface.

Evidence inspected:

- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `packages/testing/README.md`
- `packages/testing/src/index.ts`
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`

Expected write scope:

- `packages/testing/**`
- `packages/server/test/**` only for shared helpers or fixture coverage
- durable task/report/review/work-log updates
- package README/API docs updates required

Required verification:

- focused tests for the new testing fixture plus one cross-package smoke test
  against built contexts;
- `pnpm typecheck`
- `pnpm lint`
- tracked-file Prettier or `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`
- `git diff --check`

Why it blocks `T-0012.12` or real framework workflow:

- the example spec requires black-box bounded-context tests, and the current
  testing package is still only a placeholder.
