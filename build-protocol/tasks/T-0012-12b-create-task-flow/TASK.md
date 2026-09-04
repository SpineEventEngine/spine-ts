# T-0012.12b: Create Task Flow

Status: complete
Start: `2026-07-05 13:23 WEST`
End: `2026-07-05 16:02 WEST`
Baseline commit: `775aa47`
Task log path: `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
Branch: `task/T-0012-12b-create-task-flow`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Authoring sub-agent: `019f3241-11a3-7790-ac86-15bdb454b653` (closed after
timeout; main orchestrator inspected and amended WIP)
Reviewer sub-agents: rounds one through seven closed; all clean
Implementation commit: `a784ea5`
Review-fix commit: `2753627`
Second-fix commit: `61acd94`
Third-fix commit: `1dd62c8`
Round-four-fix commit: `afe5162`
Round-five-doc-fix commit: `e95cd02`
Final reviewed commit: `0c25fce`
Final branch HEAD: `48a3635`
Integration result: merged to `main` as `63f8e9f`.

## Objective

Replace the metadata-only to-do example skeleton with the smallest runnable
vertical workflow: create one task through real command handling, aggregate
state transition, event production, projection update, and query visibility.

## Required Inputs To Read

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/tasks/T-0012-12a-todo-proto/TASK.md`
- `build-protocol/tasks/T-0012-12a-todo-proto/IMPLEMENTATION_REPORT.md`
- Existing example code and generated to-do schemas under `examples/todo`.
- Existing framework seams in `packages/server`, `packages/storage`, and
  `packages/testing` needed for bounded-context fixtures and real services.

## Scope

In scope:

- Add example aggregate/projection code for creating one task.
- Use existing decorators and handler metadata directly.
- Assemble a small single-tenant `Tasks` bounded context with in-memory
  storage.
- Add black-box tests proving command post, asynchronous projection visibility,
  and query/list behavior through real framework service seams.
- Keep generated Protobuf-ES output ignored and regenerated.
- Update example docs/API docs only as needed for new public exports.

Out of scope:

- Rename, complete, and reopen operations.
- Validation/refusal behavior beyond what create flow requires.
- Subscriptions.
- Standalone server process or external client guide.
- Broad server facade, production storage, or framework API changes unless a
  concrete framework gap is proven and routed to a gap task first.

## Acceptance Criteria

- `TaskAggregate` uses decorated `@Assign(CreateTaskSchema)` and
  `@Apply(TaskCreatedSchema)` methods materialized through the existing handler
  metadata contract.
- A task-list projection subscribes to `TaskCreated` and updates read-side
  projection state through the built context.
- The example exposes a small context/server assembly function using
  `BoundedContext.singleTenant("Tasks")`, repositories, and in-memory storage.
- Black-box tests use `BoundedContextFixture.post()` and `readEventually()`
  against real `CommandService` and `QueryService` seams.
- Tests verify immediate ok `Ack`, asynchronous projection visibility, and
  projection list query behavior.
- No broad example client DSL, server facade, production storage, or framework
  API change is introduced.

## Verification Plan

- Focused example black-box tests for create and query/list.
- Focused generated-domain compile or smoke check.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `pnpm test:coverage`; if sandbox restrictions block local endpoints or IPC,
  rerun with approved escalation and record both results.
- `git diff --check`

## Work Log

- `2026-07-05 13:23 WEST`: Main orchestrator created
  `task/T-0012-12b-create-task-flow` from parent branch commit `775aa47` after
  `T-0012.12a` was merged and recorded as complete. Durable logs created before
  implementation.
- `2026-07-05 13:30 WEST`: Implementation sub-agent started the create-flow
  slice and recorded the narrow plan before source edits.
- `2026-07-05 14:00 WEST`: Main orchestrator closed the still-running
  implementation sub-agent after repeated long waits. The sub-agent left
  uncommitted WIP and no final report; main orchestrator inspected the diff
  before continuing.
- `2026-07-05 14:06 WEST`: Main orchestrator kept the narrow example slice,
  amended rough edges, and added aggregate-storage coverage for message-valued
  aggregate IDs.
- `2026-07-05 14:42 WEST`: Implementation commit `a784ea5` was created and
  reviewed by the required five lanes.
- `2026-07-05 15:01 WEST`: Round-one findings were accepted into a review-fix
  pass. The fix pass narrows aggregate ID support, refreshes public docs/logs,
  and makes the example's built-output test dependency explicit.
- `2026-07-05 15:04 WEST`: Review-fix verification passed: focused storage,
  routing, and example tests (3 files / 86 tests), `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, `git diff --check`, and escalated coverage
  (45 files / 634 tests; statements 95.19%, branches 90.52%, functions 97.63%,
  lines 95.21%).
- `2026-07-05 15:17 WEST`: Round-two re-review of `2753627` requested current
  docs/log status, package-root exports for `PrimitiveId`/`MessageId`, normalized
  snapshot IDs, typed repository routes, and finite primitive route IDs. A
  second fix pass began.
- `2026-07-05 15:20 WEST`: Second-fix verification passed: focused storage,
  routing, and example tests (3 files / 89 tests), `pnpm typecheck`, serial
  `pnpm lint`, `pnpm format:check`, `pnpm docs:check`,
  `pnpm proto:check-generated`, `git diff --check`, and escalated coverage
  (45 files / 637 tests; statements 95.15%, branches 90.41%, functions 97.63%,
  lines 95.17%). A parallel lint attempt failed only because concurrent
  `proto:generate` raced another check; serial lint passed.
- `2026-07-05 15:20 WEST`: Second-fix commit `61acd94` created.
- `2026-07-05 15:32 WEST`: Round-three re-review found missing non-finite
  first-field route coverage, cross-package generated example imports in a
  server test, one redundant event route helper, imprecise message-target error
  text, and missing `$typeName` matching for message-target repository routes.
  Third-fix verification passed: focused storage/routing/example tests (3 files
  / 91 tests), `pnpm typecheck`, serial `pnpm lint`, `pnpm format:check`,
  `pnpm docs:check`, `pnpm proto:check-generated`, `git diff --check`, and
  escalated coverage (45 files / 639 tests; statements 95.18%, branches 90.49%,
  functions 97.63%, lines 95.20%).

## Decisions

- Reuse existing framework APIs and generated Protobuf-ES messages directly.
- The todo contract's `TaskId` is a Protobuf message. Aggregate command
  execution and storage preserve finite primitive IDs and complete generated
  Protobuf message IDs.
- No broad client DSL, server facade, or production storage API is added.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `build-protocol/work-logs/T-0012-12b.md`
- `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
- `build-protocol/tasks/T-0012-12b-create-task-flow/IMPLEMENTATION_REPORT.md`
- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `examples/todo/package.json`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`
- `examples/todo/tsconfig.json`
- `packages/server/src/repository/aggregate-storage.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/aggregate-storage.test.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `pnpm-lock.yaml`
- `vitest.config.ts`

## Tests Run

- `pnpm exec vitest run examples/todo/src/index.test.ts --passWithNoTests`:
  passed, 2 tests.
- `pnpm typecheck`: passed after rerunning serially; an earlier parallel
  typecheck/lint attempt raced two `proto:generate` processes and failed with
  `ENOTEMPTY`.
- `pnpm exec vitest run examples/todo/src/index.test.ts packages/server/test/repository/aggregate-storage.test.ts --passWithNoTests`:
  passed, 31 tests.
- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts --passWithNoTests`:
  passed, 46 tests.
- `pnpm exec vitest run packages/server/test/repository/aggregate-storage.test.ts --passWithNoTests`:
  passed, 34 tests after coverage-focused cases were added.
- `pnpm exec vitest run packages/server/test/repository/repository-routing.test.ts --passWithNoTests`:
  passed, 47 tests after message-valued event ID routing coverage was added.
- `pnpm exec vitest run examples/todo/src/index.test.ts packages/server/test/repository/aggregate-storage.test.ts packages/server/test/repository/repository-routing.test.ts --passWithNoTests`:
  passed, 83 tests.
- `pnpm lint`: passed.
- `pnpm format:check`: passed after formatting
  `packages/server/test/repository/aggregate-storage.test.ts`.
- `pnpm docs:check`: passed with generated `@generated` TypeDoc warnings and
  the known invalid-origin source-link warning.
- `pnpm proto:check-generated`: passed.
- `git diff --check`: passed.

## Coverage Result

- Sandboxed `pnpm test:coverage`: failed from sandbox restrictions and
  timeout-heavy subprocess/compiler tests. The notable sandbox failures were
  ZeroMQ local IPC `Operation not permitted`, HTTP2 `listen EPERM 127.0.0.1`,
  and 5s test timeouts.
- Escalated `pnpm test:coverage`: removed permission failures but hit existing
  timeout-sensitive tests under coverage.
- Escalated
  `pnpm exec vitest run --coverage --passWithNoTests --testTimeout=120000 --maxWorkers=1`:
  passed 45 files / 631 tests. Coverage: statements 95.06%, branches 90.12%,
  functions 97.61%, lines 95.07%.

## Documentation And Public API Impact

| Area                             | Impact                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Package README impact            | Updated to describe the runnable in-process create flow.                                                             |
| TypeDoc/API docs impact          | Public example exports have TSDoc comments.                                                                          |
| Public API additions/removals    | Replaced `exampleSkeleton` with `createTodoContext()`, `TaskAggregate`, and `TaskListProjection`.                    |
| Framework `USER_GUIDE.md` impact | N/A unless a framework gap is proven.                                                                                |
| Example `USER_GUIDE.md` impact   | Updated with focused test/build commands for this slice.                                                             |
| API examples                     | Black-box test demonstrates command and query flow.                                                                  |
| Compatibility notes              | Raw Vitest import of decorated source is not supported; focused test uses built output after `pnpm typecheck:build`. |

## Security Impact

| Area                    | Impact                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| Dependencies            | Added workspace dependencies already used by the example implementation.                 |
| Secrets and credentials | No secrets required.                                                                     |
| IPC                     | Real service tests may use local listeners through existing fixtures.                    |
| Validation              | Full invalid-command path deferred to `T-0012.12d`.                                      |
| Tenant boundaries       | Single-tenant `Tasks` context only.                                                      |
| `Any`/deserialization   | Uses generated schemas and existing `packCommand`, `packEvent`, and `unpackAny` helpers. |
| Logging                 | Do not log sensitive payloads; example tests should avoid noisy output.                  |
