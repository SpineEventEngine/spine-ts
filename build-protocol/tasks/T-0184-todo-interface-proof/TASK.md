# T-0184: To-Do Interface-Routing Proof

Status: Resumed — implementation and verification pending
Start: `2026-08-14 WEST`
End: Pending
Baseline commit: `aed2f194`
Branch: `task/T-0184-todo-interface-proof`
Worktree: `.worktrees/T-0184-todo-interface-proof`
Task classification: High-risk example-domain and serialized-contract proof
Implementation owner: existing `implementer`, explicit `gpt-5.6-terra` / medium
Runtime metadata: unavailable from the desktop surface; the immutable configured
role/profile is the available evidence.

## Objective

Demonstrate the accepted Wave 11 interface-token routing contract in the To-Do
domain without adding shared Gateway behavior or a new routing API.

## Required Inputs

- `AGENTS.md`, `build-protocol/BUILD_PROTOCOL.md`, and
  `build-protocol/PROJECT_COMPLETION_PLAN.md`.
- `build-protocol/planning/WAVE_11_TS_TYPE_ROUTING_PLAN.md`, D-0113, and the
  integrated T-0180 through T-0183 contracts.

## Human-Imposed Requirements Ledger

1. Add a real `TaskListId`.
2. `CreateTask` carries `TaskId`, `TaskListId`, and title.
3. Task state retains its list and optional current assignee.
4. Add `AssignTask`, `ReassignTask`, and `UnassignTask`.
5. Add `TaskAssigned`, `TaskReassigned`, and `TaskUnassigned`.
6. Every Task event carries enough list identity for `TaskList` routing.
7. `TaskAssigned` and `TaskUnassigned` declare
   `(is).ts_type = "TaskAssignmentEvent"`.
8. `TaskReassigned` has no `TaskReassignmentEvent`; its old/new-assignee fan-out
   is an exact-schema route.
9. Commands carry no `(is)`/`(every_is)` marker in this example.
10. `TaskList`, keyed by `TaskListId`, registers one `TaskEvent` route instead
    of one route per Task event.
11. An assignee-oriented Projection, keyed by `UserId`, registers one shared
    `TaskAssignmentEvent` route for assignment and unassignment, plus one exact
    `TaskReassigned` route for two-target fan-out.
12. The create/assign/reassign/unassign journey proves zero, one, and many
    Event targets and durable replay without rerouting.
13. Preserve native black-box, startup, Proto-module, smoke, and the supported
    one-Gateway/multiple-application-node loopback topology. Do not introduce
    multiple-Gateway behavior.
14. Generated files have no copyright header and retain the generated/provenance
    contract. Authored TS/Proto retains the 2026 CodeMatters header and exactly
    one following blank line.

## Scope

In scope: To-Do Proto model, authored `TaskAssignmentEvent`, Aggregate,
Projections, context assembly, generated-model configuration/output, tests, and
smoke scripts under `examples/todo` as necessary.

Out of scope: shared server routing, generated-interface tooling, reader-facing
documentation, new Gateway behavior, `routeSemantic()`, `@Route`, commands with
interface markers, `TaskReassignmentEvent`, and any serialization format change.

## Acceptance

- implement the exact domain model and routes above;
- prove `TaskListId` persistence and TaskList aggregation;
- prove assign, reassign, and unassign behavior;
- prove `TaskEvent` removes per-event TaskList route declarations;
- prove exact `TaskReassigned` produces two assignee targets and wins over
  interface routes;
- prove `TaskAssignmentEvent` routes assignment/unassignment;
- prove zero, one, and many target outcomes;
- repository scan proves `TaskReassignmentEvent` does not exist;
- native black-box, startup, Proto-module, smoke, and loopback multi-process
  behavior remain green.

The loopback multi-process test retains the existing supported topology: one
Gateway connected to multiple application nodes. It is not a multiple-Gateway
test and creates no Wave 12 behavior.

## Demonstrated Progress And Superseded Blockers

- RED: `pnpm exec vitest run examples/todo/test/interface-routing-contract.test.ts`
  initially failed both assertions because the Task event token declarations and
  the application routing were absent.
- GREEN: after the To-Do Proto/model changes, the same focused test passed
  `2/2`.
- Direct `pnpm -C examples/todo proto:generate` succeeds and emits generated
  TaskEvent and TaskAssignmentEvent token files with the required provenance
  header and no copyright header.
- Historical blocker 1: root `pnpm proto:generate` was blocked before publication: its atomic model
  stage copies only `package.json`, `spine-proto.json`, and `proto`. Authored
  interface discovery consequently cannot find `tsconfig.json` or `src`; a
  naive copy also changes the depth at which To-Do's `../../tsconfig.base.json`
  extension resolves. This is shared transaction/source-view work outside this
  task's ownership.
- Historical blocker 2: direct generated-model typechecking was independently blocked by emitted
  interface `memberSchemas` constants without declaration-safe tuple
  annotations, producing TypeScript `TS9013` under `isolatedDeclarations`.
  This is shared T-0181 generator work outside this task's ownership.

These historical blockers are superseded by T-0184A, integrated, tagged, and
post-merge verified at `0bacb0b3`. Its root source-view transaction preserves
the live authored/configuration view and emits declaration-safe tuples. T-0184
is resumed; full preflight, coverage, native black-box/startup/Proto-module/
smoke/loopback verification, specialist review, and `verify:task` remain
pending implementation continuation.

## Review And Verification Plan

- Focused behavior RED/GREEN and at least 90% coverage for changed example
  production code.
- Cheap preflight, then bounded `verify:task` with native loopback permissions.
- Relevant specialist lanes: TypeScript/API, style/maintainability,
  performance/reliability, and documentation/TSDoc.
- Security is deferred unless the example exposes a new trust boundary; T-0186
  owns the final Wave security review.

## Runtime Admission Root Cause (Resolved)

- RED: valid `CreateTask` invoked `TaskAggregate.createTask`, but no
  `TaskCreated` was stored and neither a generated `TaskEvent` route nor an
  exact `TaskCreated` route reached `TaskListProjection`.
- Boundary tracing proved token membership and generated-registry schema
  identity correct. The aggregate's framework-created initial Task state has
  its ID; the first command then establishes `task_list_id`. Its `(set_once)`
  option rejected that legitimate first update before event binding.
- GREEN: `task_list_id` remains required and validated but is no longer
  `set_once`. A focused state-transition test now proves first-create list
  initialization; regenerated TaskEvent routing passes. A temporary exact-route
  probe also passed and was removed after ruling routing out. This is a To-Do
  Proto modeling correction, not a shared routing change.

## Durable Replay Evidence (GREEN)

- A handler failure is not a valid retry fixture: local delivery acknowledges
  that failure and marks its projection Inbox row `DELIVERED`.
- The accepted proof admits one live TaskCreated through TaskEvent, then uses
  public `DeliveryBuilder` to persist a second `TO_DELIVER`
  `UPDATE_SUBSCRIBER` row in a shared backend. A fresh BlackBox context
  materializes that row while its TaskEvent route throws if invoked; it is not
  invoked.
- Focused evidence is GREEN (`1/1`). The wider native matrix, coverage,
  preflight, and bounded task verification remain pending.

## Compile-Convergence Checkpoint

- `pnpm typecheck:tooling` initially failed only in stale tests after the
  generated TaskList ID migration. Assigned tests now use `TaskListId` and
  generated `TaskList` values, guard generated optional fields, preserve the
  exact-optional callback contract, and construct server fixtures with
  `TaskListIdSchema`; tooling typecheck and six focused Todo suites exit 0.
- Prior coverage remains RED at 86.54% against the required 90%. Fresh LCOV
  will be recorded from one converged coverage-enabled `verify:task` run.
  Cleanup/TSDoc gates currently report only pre-existing unassigned findings in
  `examples/todo/src/index.ts`.
