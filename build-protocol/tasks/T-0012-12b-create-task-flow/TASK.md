# T-0012.12b: Create Task Flow

Status: opened; implementation pending
Start: `2026-07-05 13:23 WEST`
End: Pending
Baseline commit: `775aa47`
Task log path: `build-protocol/tasks/T-0012-12b-create-task-flow/TASK.md`
Branch: `task/T-0012-12b-create-task-flow`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`
Authoring sub-agent: pending
Reviewer sub-agents: pending
Implementation commit: pending
Final branch HEAD: pending

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

## Decisions

- Reuse existing framework APIs and generated Protobuf-ES messages directly.
- No new dependency or framework-gap task is selected before implementation.
- If a missing framework feature is proven, pause this slice and route it
  through the framework-gap rule in the parent task.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- Pending.

## Tests Run

- Pending.

## Coverage Result

- Pending.

## Documentation And Public API Impact

| Area                             | Impact                                                  |
| -------------------------------- | ------------------------------------------------------- |
| Package README impact            | Pending implementation.                                 |
| TypeDoc/API docs impact          | Pending; new public example exports must be documented. |
| Public API additions/removals    | Pending.                                                |
| Framework `USER_GUIDE.md` impact | N/A unless a framework gap is proven.                   |
| Example `USER_GUIDE.md` impact   | Final runnable guide remains `T-0012.12f`.              |
| API examples                     | Pending.                                                |
| Compatibility notes              | Pending.                                                |

## Security Impact

| Area                    | Impact                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| Dependencies            | No new dependency planned.                                              |
| Secrets and credentials | No secrets required.                                                    |
| IPC                     | Real service tests may use local listeners through existing fixtures.   |
| Validation              | Full invalid-command path deferred to `T-0012.12d`.                     |
| Tenant boundaries       | Single-tenant `Tasks` context only.                                     |
| `Any`/deserialization   | Use existing generated registry/service contracts.                      |
| Logging                 | Do not log sensitive payloads; example tests should avoid noisy output. |
