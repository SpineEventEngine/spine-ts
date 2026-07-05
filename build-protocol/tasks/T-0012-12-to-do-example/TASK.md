# T-0012.12: To-Do Example

Status: T-0012.12b merged; T-0012.12c selected
Start: `2026-07-05 10:53 WEST`
End: Pending
Baseline commit: `89868e9`
Task log path: `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
Branch: `task/T-0012-12-to-do-example`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12-to-do-example`
Authoring sub-agent: Requirements splitter
`019f31b8-0110-72c2-bea9-aeb6deea028b`; `T-0012.12a` implementation and
review sub-agents complete and closed; `T-0012.12b` implementation and review
sub-agents complete and closed; `T-0012.12c` implementation pending.
Reviewer sub-agents:

- code style/maintainability:
  `019f31c3-2366-7512-ba51-9cf59bd6248d`,
  `019f31c7-74dc-7d80-9717-56f0ca99abb0`
- documentation:
  `019f31c3-2409-7501-b558-448cc8020849`,
  `019f31c7-758f-7751-a11c-6120702b3764`
- TypeScript/API docs:
  `019f31c3-2479-7440-9b07-eb413055e15e`,
  `019f31c7-7620-7be3-8495-69405cf06aaa`
- security:
  `019f31c3-2507-7491-af84-6355ed82c43f`,
  `019f31c7-76a6-7332-9a69-d18db922c2fc`
- performance/reliability:
  `019f31c3-258a-7ef0-bef3-6cec938b84ca`,
  `019f31c7-772a-7e42-b17c-2d7388b5c24b`
  Implementation commits: `3cc8625` merge of `T-0012.12a`; `63f8e9f` merge of
  `T-0012.12b`
  Final branch HEAD: `63f8e9f`; `T-0012.12c` pending

## Objective

Replace the placeholder `examples/todo` workspace with a real standalone
server-side to-do app that uses the framework as an application developer would:
generated Protobuf-ES domain messages, decorated aggregate command handlers,
event appliers, projection subscribers, real `CommandService`, `QueryService`,
and `SubscriptionService` behavior, in-memory storage, validation, a business
refusal path, black-box tests, and an example `USER_GUIDE.md`.

If the example exposes a missing framework feature, pause the example slice,
record the gap, implement the missing framework feature under the same
autonomous protocol, and then resume the example.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/IMPLEMENTATION_REPORT.md`
- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`

## Skill Applicability

Canonical checklist evidence for `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source                                              | Scope Checked                                       | Evidence                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                             | Task-relevant subset visible in the current session | Selected workflow skills: `subagent-driven-development`, `using-git-worktrees`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`; relevant advisory skills noted below.                                                                                                                |
| Task-provided skill names/paths                     | N/A                                                 | The user did not name a new skill for `T-0012.12`; continuing with protocol-required installed skills.                                                                                                                                                                                                                    |
| `build-protocol/skills/EXPECTED_SKILLS.md`          | Checked                                             | Expected autonomous skills include sub-agent, worktree, review, verification, planning, ADR, TS, and Node backend skills.                                                                                                                                                                                                 |
| `~/.agents/skills/*/SKILL.md`                       | Full readable directory listing                     | `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` found installed task-relevant skills including `epic-breakdown-advisor`, `codebase-design`, `domain-modeling`, `cqrs-implementation`, `projection-patterns`, `javascript-testing-patterns`, `nodejs-backend-patterns`, and protocol skills. |
| `~/.agents/.skill-lock.json` or equivalent manifest | Checked first portion and task-relevant entries     | Lock manifest is readable and records installed user skills from sources including `deanpeters/Product-Manager-Skills`, `mattpocock/skills`, and `wshobson/agents`; no skill install is needed for this task.                                                                                                             |

Selected skills read before task actions:

| Skill                            | Source                                                                    | Applicability                                                         | Instructions Applied                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `subagent-driven-development`    | Session skill, `~/.agents/skills/subagent-driven-development/SKILL.md`    | Governs splitter, implementer, review loop, and continuous execution. | Use fresh sub-agents for splitting, implementation, and review; do not pause between tasks without a real blocker; close agents promptly. |
| `using-git-worktrees`            | Session skill, `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required by project protocol for one branch/worktree per task.        | Created `task/T-0012-12-to-do-example` in `.worktrees/T-0012-12-to-do-example` from `main@89868e9`.                                       |
| `requesting-code-review`         | Session skill, `~/.agents/skills/requesting-code-review/SKILL.md`         | Required review after each task/slice.                                | Use bounded diff packages and route all required lanes through reviewer sub-agents.                                                       |
| `receiving-code-review`          | Session skill, `~/.agents/skills/receiving-code-review/SKILL.md`          | Required for handling reviewer comments.                              | Verify comments against code and fix concrete findings before re-review.                                                                  |
| `verification-before-completion` | Session skill, `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims, commits, and integration.          | Run fresh verification and record command results before claiming readiness.                                                              |

Skills passed to sub-agents/reviewers:

| Recipient                 | Skills/Instructions Passed                                                                                                                                                                                                                | Notes                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Requirements splitter     | `subagent-driven-development`, `epic-breakdown-advisor`, `codebase-design`, `domain-modeling`, `cqrs-implementation`, `projection-patterns`, `nodejs-backend-patterns`, `javascript-testing-patterns`; project protocol overrides skills. | Splitter must produce small implementation slices, identify any framework gaps, and record skill applicability. |
| Implementation sub-agents | Pending implementation.                                                                                                                                                                                                                   | Each implementer receives the applicable slice skills and exact write scope.                                    |
| Reviewers                 | Pending review.                                                                                                                                                                                                                           | Each reviewer receives the required lane plus review/verification skill references.                             |

Skipped relevant-looking skills:

| Skill                     | Source                                            | Reason Skipped                                                                                                                                 |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-design-principles`   | `~/.agents/skills/api-design-principles/SKILL.md` | Example should use existing Spine service APIs and generated Protobuf contracts, not design a new public API unless a framework gap is proven. |
| `architecture-patterns`   | `~/.agents/skills/architecture-patterns/SKILL.md` | Current protocol and Spine JVM familiarity already constrain architecture; use only if a split reveals a framework architecture gap.           |
| `event-store-design`      | `~/.agents/skills/event-store-design/SKILL.md`    | Event store already exists for this task; do not redesign storage while building the example.                                                  |
| `security-best-practices` | Session skill                                     | Not explicitly requested as a standalone security report; security review lane remains mandatory.                                              |

Conflict resolution: project protocol, human instructions, `CODE_QUALITY.md`,
Spine Protobuf contracts, sandbox/approval rules, and explicit task scope win
over installed-skill advice.

### Splitter Skill Applicability Check

Canonical checklist evidence recorded by the requirements-splitting sub-agent
before producing the split on `2026-07-05 11:03 WEST`.

Sources checked:

- Session skill inventory exposed these task-relevant skills:
  `subagent-driven-development`, `epic-breakdown-advisor`,
  `codebase-design`, `domain-modeling`, `cqrs-implementation`,
  `projection-patterns`, `nodejs-backend-patterns`,
  `javascript-testing-patterns`, and `typescript-advanced-types`.
- Task prompt explicitly required considering the same advisory skills and
  project protocol overrides.
- `build-protocol/skills/EXPECTED_SKILLS.md` was read; expected installed
  skills include the autonomous workflow, worktree, review, verification,
  TypeScript, and Node backend skills.
- `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`
  was run against the readable user-installed skill directory.
- `/Users/armiol/.agents/.skill-lock.json` was readable; task-relevant entries
  were present for the splitter skills, including `epic-breakdown-advisor`,
  `codebase-design`, `domain-modeling`, `cqrs-implementation`,
  `projection-patterns`, `javascript-testing-patterns`,
  `nodejs-backend-patterns`, and `typescript-advanced-types`.

Selected skills fully read before use:

- `subagent-driven-development`: applicable as the controlling workflow model
  for branch/task split, later implementer handoffs, review loops, and durable
  progress.
- `epic-breakdown-advisor`: applicable because this task is an epic-sized
  example delivery split; applied the simple-complete-slice and operation
  split patterns.
- `codebase-design`: applicable to avoid shallow facades and keep framework
  gap routing at real seams.
- `domain-modeling`: applicable as a terminology check for `TaskId`, `Task`,
  commands, events, projection, validation, and refusal language; no glossary
  file is changed because this assignment may update only the four task docs.
- `cqrs-implementation`: applicable because the example must demonstrate
  command/write-side behavior separately from projection/query read-side
  behavior.
- `projection-patterns`: applicable because the task-list view and
  subscriptions depend on projection subscribers and read models.
- `nodejs-backend-patterns`: applicable to server startup, Connect/Node gRPC
  hosting, validation, and graceful test/server boundaries.
- `javascript-testing-patterns`: applicable to focused Vitest, black-box, and
  gRPC/query/subscription test planning.
- `typescript-advanced-types`: applicable to generated Protobuf-ES schemas,
  decorated entity classes, and compile-time repository/entity type constraints.

Relevant-looking skills skipped for this splitter role:

- `api-design-principles`: skipped because the example must consume existing
  Spine service contracts, not design a new external API.
- `event-store-design`: skipped because event storage already exists and this
  split must not redesign storage.
- `security-best-practices`: skipped as a standalone skill because a separate
  security report was not requested; the required security review lane remains
  mandatory for each implementation slice.
- `architecture-patterns`: skipped because `BUILD_PROTOCOL.md`, D-0047, and
  the existing package seams already constrain the architecture.

## Scope

In scope:

- Split the example work before implementation.
- Replace placeholder example metadata with runnable domain/server code.
- Add example `.proto` definitions and generated-code workflow using Buf /
  Protobuf-ES; generated files must remain ignored.
- Demonstrate command posting, aggregate command handling, event production,
  projection updates, projection queries, subscriptions, validation failure,
  and a business refusal.
- Use real framework gRPC services; no simulation.
- Use in-memory storage.
- Add black-box tests through `@spine-ts/testing`.
- Update example README and `USER_GUIDE.md`.
- Update framework docs/API docs only if the example exposes a framework gap
  requiring framework changes.

Out of scope:

- Production storage.
- New broad server facade or process supervisor unless a concrete example gap
  proves it is required.
- Client DSL work unless required to exercise real gRPC services.
- Worker/process fan-out beyond existing bus/transport abstractions unless
  required by a recorded framework gap.
- Rewriting Spine service proto definitions.

## Work Log

- `2026-07-05 10:53 WEST`: Created task branch/worktree and began durable logs
  before implementation. The root checkout still has unrelated untracked
  `human-review-1-jul.md`, which is outside this task.
- `2026-07-05 11:03 WEST`: Requirements-splitting sub-agent completed the
  protocol evidence review, inspected the placeholder example and relevant
  framework seams, and recorded the staged implementation roadmap below. No
  production or example code was changed.
- `2026-07-05 11:34 WEST`: Splitter review is clean after round 2. All five
  review lanes have no remaining comments. All participating splitter-review
  sub-agents were closed.
- `2026-07-05 13:12 WEST`: `T-0012.12a Todo Proto Generation` completed its
  implementation and review loop. Clean final lanes: documentation and
  maintainability after historical wording fix, TypeScript/API docs, security,
  and reliability. Merged as `3cc8625 Merge T-0012.12a todo proto generation`.

## Requirements Splitter Evidence

Governing docs read:

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/TODO_EXAMPLE_SPEC.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/DECISION_LOG.md`

Prior task evidence read:

- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
- `build-protocol/tasks/T-0012-11-missing-details-example-readiness/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0012-11.md`
- Current T-0012.11 child-task/report summaries and merge evidence.

Current placeholder evidence read:

- `examples/todo/README.md`
- `examples/todo/USER_GUIDE.md`
- `examples/todo/package.json`
- `examples/todo/tsconfig.json`
- `examples/todo/src/index.ts`
- `examples/todo/src/index.test.ts`

Framework seams inspected for split sizing:

- `packages/testing/src/index.ts`
- `packages/testing/test/index.test.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/src/handler/handler-decorators.ts`
- `packages/server/src/services/spine-services.ts`
- `packages/server/src/stand/stand.ts`
- `packages/storage/src/index.ts`
- root package, TypeScript, Buf, lint, coverage, and generated-code scripts.

Current findings:

- `examples/todo` is metadata-only and explicitly non-runnable.
- T-0012.11 has already delivered the framework seams required for the first
  real example slices: aggregate command execution, projection event updates,
  projection list queries, validation/refusal mapping, real
  `CommandService`/`QueryService`/`SubscriptionService`, and
  `BoundedContextFixture`.
- The repo ignores `packages/*/generated/`, but not
  `examples/todo/generated/`; the example needs an example-local generated-code
  workflow before generated domain code can be used safely.
- The root Buf workflow only targets framework protos under `proto/` into
  `packages/proto/generated`; the example needs a small example-local
  generation setup or a root script extension that does not commit generated
  output.
- No required first slice needs `@spine-ts/server` framework code changes. If a
  later slice does touch `@spine-ts/server`, its implementation task must first
  inspect relevant `spine-jvm-docs/` notes and corresponding Spine JVM
  `core-jvm/server` source or record why only summarized notes were available.

## Staged Implementation Roadmap

Splitting pattern:

- Apply a prerequisite enabling slice for generated domain contracts because
  no real example code can compile without Protobuf-ES domain schemas.
- Then use a simple-complete-slice pattern: first create one task through the
  full command -> aggregate -> event -> projection -> query path.
- Then add the remaining task operations, validation/refusal, subscriptions,
  and runnable server/user documentation.

Common verification gate for every implementation slice:

- Run and record focused tests for the slice.
- Run and record `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, a
  formatting check covering changed tracked files, and `git diff --check`.
- Run and record `pnpm test:coverage` before a slice is considered complete.
  If sandbox restrictions block local endpoints or IPC, rerun the same command
  with approved escalation and record both the sandbox failure and the
  escalated result.
- Coverage must remain at or above the repository 90% threshold unless a
  recorded framework-gap or review decision explicitly changes the gate.

### T-0012.12a Todo Proto Generation

Proposed branch: `task/T-0012-12a-todo-proto`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`

Goal:

- Add the example-local to-do Protobuf contract and generation workflow without
  committing generated output.

Acceptance criteria:

- `examples/todo` owns domain `.proto` files for `TaskId`, `Task`, task-list
  projection state, `CreateTask`, `RenameTask`, `CompleteTask`, `ReopenTask`,
  and `TaskCreated`/`TaskRenamed`/`TaskCompleted`/`TaskReopened`.
- Domain files follow Spine conventions: commands in `*_commands.proto`,
  events in `*_events.proto`, entity state declares `(entity).kind`, and
  validation options are present for at least one required user-supplied field.
- Generated Protobuf-ES output goes under `examples/todo/generated/`, is
  ignored by Git, and is regenerated during the example build/test workflow.
- Example TypeScript can import generated schemas directly without generated
  facades.
- Root or example tooling excludes generated example output from lint,
  coverage, TypeDoc, and formatting churn while still proving ignored output is
  fresh.
- The generated-clean check covers `examples/todo/generated/` and fails on
  tracked, missing, symlinked, stale, or orphaned generated files.
- No runtime framework behavior is added in this slice.

Verification plan:

- Focused example generation command for `examples/todo`.
- `git check-ignore -- examples/todo/generated/.cleanup-enforcement-check`
- `git ls-files -- examples/todo/generated`
- A generated-clean check for `examples/todo/generated/`, either by extending
  `proto:check-generated` or adding an equivalent example-specific script.
- `pnpm docs:check`, proving `examples/todo/generated/**` is excluded or
  otherwise guarded from TypeDoc output while `examples/todo/src/index.ts`
  remains documented.
- Focused example proto/domain compile or smoke test.
- `pnpm typecheck:build`
- Tracked-file Prettier check for changed docs/config/example files.
- `git diff --check`

Why first:

- It is the first non-blocked implementable slice. Every real example class,
  command envelope, query, and black-box test depends on generated domain
  schemas.
- Status: complete and merged via `3cc8625`.

### T-0012.12b Create Task Flow

Proposed branch: `task/T-0012-12b-create-task-flow`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12b-create-task-flow`

Goal:

- Replace the skeleton export with the smallest runnable vertical workflow:
  create one task through real command, aggregate, event, projection, and query
  behavior.

Acceptance criteria:

- `TaskAggregate` uses decorated `@Assign(CreateTaskSchema)` and
  `@Apply(TaskCreatedSchema)` methods materialized through the existing
  handler metadata contract.
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

Verification plan:

- Focused example black-box tests for create and query/list.
- Focused generated-domain compile check.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check.
- `pnpm docs:check` if public exports or docs change.
- `git diff --check`

- Status: complete and merged via `63f8e9f`.

### T-0012.12c Task Operations

Proposed branch: `task/T-0012-12c-task-operations`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`

Goal:

- Add the remaining normal to-do operations over the same aggregate and
  projection path.

Acceptance criteria:

- `RenameTask`, `CompleteTask`, and `ReopenTask` each have decorated aggregate
  command handlers.
- `TaskRenamed`, `TaskCompleted`, and `TaskReopened` each have aggregate
  appliers.
- The projection subscriber updates the list/read model for renamed,
  completed, and reopened tasks.
- Black-box tests verify command posting and query results after each
  operation.
- Event appliers preserve aggregate state through persisted history and
  snapshots rather than mutating projection state directly.

Verification plan:

- Focused example black-box tests for rename, complete, reopen, and replayed
  aggregate state.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check.
- `pnpm docs:check` if public exports or docs change.
- `git diff --check`

### T-0012.12d Validation And Refusal

Proposed branch: `task/T-0012-12d-validation-refusal`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12d-validation-refusal`

Goal:

- Demonstrate the required invalid-command and business-refusal paths through
  real service behavior.

Acceptance criteria:

- At least one command payload with a Spine validation option fails through
  `CommandService.Post` as `COMMAND_VALIDATION_ERROR` with packed
  `spine.validation.ValidationError` details.
- At least one normal command reaches a handler and is refused with
  `CommandRefusalError`, producing a stable non-ok `Ack` error without writing
  events or projection state.
- Proposed refusal names stay short and domain-familiar, such as
  `TASK_ALREADY_DONE` or `TASK_NOT_DONE`.
- Black-box tests prove no read-side state changes after validation failure or
  business refusal.
- No large custom error-details hierarchy is added.

Verification plan:

- Focused example black-box tests for invalid create/rename and refused
  complete/reopen behavior.
- Assertions inspect `Ack` status type/message and packed validation details
  where applicable.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check.
- `pnpm docs:check` if public docs/API move.
- `git diff --check`

### T-0012.12e Task Subscriptions

Proposed branch: `task/T-0012-12e-task-subscriptions`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12e-task-subscriptions`

Goal:

- Demonstrate live task-list updates through real `SubscriptionService`
  behavior.

Acceptance criteria:

- Example topic/query helpers can subscribe to the task-list projection target.
- Black-box tests use `BoundedContextFixture.subscribe()` and receive updates
  after create, rename, complete, and reopen commands.
- Tests cover activation, update content, and cancellation/cleanup.
- Subscription updates are emitted from projection changes, not direct command
  calls or hand-built test updates.
- Slow-consumer or cancellation behavior uses existing `SpineServices` queue
  controls; no durable subscription store is added.

Verification plan:

- Focused example subscription tests.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check` or tracked-file Prettier check.
- `pnpm docs:check` if public docs/API move.
- `git diff --check`

### T-0012.12f Runnable Server And Guide

Proposed branch: `task/T-0012-12f-runnable-server-guide`

Proposed worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12f-runnable-server-guide`

Goal:

- Make the example runnable as a standalone server-side app and replace the
  placeholder README/user guide.

Acceptance criteria:

- The example starts a real Connect/Node gRPC-compatible service host using
  the existing `SpineServices` registrar and the to-do bounded context.
- A focused test starts the example server, posts a command through a real gRPC
  client, reads the projection through `QueryService`, and receives or verifies
  subscription behavior.
- `examples/todo/README.md` describes the runnable example instead of the
  placeholder.
- `examples/todo/USER_GUIDE.md` explains generation, server startup, command
  posting, query state, subscription updates, tests, in-memory storage, and
  demonstrated framework features.
- The guide is honest about local multi-process mode: if current framework bus
  abstractions are sufficient for an example smoke path, include it; if not,
  record the missing framework feature and route it to a framework-gap slice
  before claiming that behavior.
- No broad `@spine-ts/server` facade or process supervisor is introduced merely
  for the example.

Verification plan:

- Focused example server/gRPC test. If sandbox blocks loopback listeners, rerun
  the focused command with approved escalation and record that result.
- Focused example black-box suite.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

### Framework-Gap Routing Rule

No framework-gap slice is selected before `T-0012.12a` because current
inspection did not identify a framework feature missing from the first domain
generation slice.

If a later implementation slice needs `@spine-ts/server`, `@spine-ts/core`,
`@spine-ts/testing`, or generation-tooling behavior not already present, pause
the dependent example slice and insert a gap slice before it. Proposed naming:

- Branch: `task/T-0012-12x-<short-gap-name>`
- Worktree:
  `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12x-<short-gap-name>`

For any gap touching `@spine-ts/server`, the implementer must record the Spine
JVM server-source/docs guardrail before code changes:

- search `spine-jvm-docs/` with task-relevant terms;
- inspect the corresponding local Spine JVM `core-jvm/server` source files
  when available, or record why only summarized notes could be used;
- document inspected paths and implementation impact in the gap task log;
- prefer the smallest JVM-familiar server contract and defer broader behavior.

## Completed Slice

Completed first implementable slice: `T-0012.12a Todo Proto Generation`.

Branch: `task/T-0012-12a-todo-proto`

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12a-todo-proto`

Selection rationale:

- The placeholder example has no domain contracts or generated schemas.
- The example cannot compile real aggregate/projection/service code until its
  Protobuf-ES domain code exists and is ignored/regenerated correctly.
- This slice is self-contained, does not require framework changes, and sets
  up the generated-code guardrail required by the to-do spec.

## Current Selected Slice

Selected next implementable slice: `T-0012.12c Task Operations`.

Branch: `task/T-0012-12c-task-operations`

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-12c-task-operations`

Selection rationale:

- `T-0012.12b` proved one create command through real aggregate handling, event
  production, projection update, and query visibility.
- The next smallest runnable behavior is the remaining normal task operations
  on the same path.
- No framework gap is known before this slice. If implementation proves one,
  it must be routed through a framework-gap task before continuing dependent
  example work.

## Decisions

- Existing architecture decisions in `build-protocol/DECISION_LOG.md` remain
  binding.
- No new third-party library recommendation was made. `T-0012.12a` should reuse
  the existing Buf/Protobuf-ES toolchain and existing workspace setup unless
  implementation proves a concrete tooling gap.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `build-protocol/tasks/T-0012-12-to-do-example/TASK.md`
- `build-protocol/tasks/T-0012-12-to-do-example/IMPLEMENTATION_REPORT.md`
- `build-protocol/reviews/T-0012-12-to-do-example.md`
- `build-protocol/work-logs/T-0012-12.md`

## Tests Run

- `pnpm exec prettier --check build-protocol/tasks/T-0012-12-to-do-example/TASK.md build-protocol/tasks/T-0012-12-to-do-example/IMPLEMENTATION_REPORT.md build-protocol/reviews/T-0012-12-to-do-example.md build-protocol/work-logs/T-0012-12.md`
  - Passed: all matched files use Prettier code style.
- `git diff --check`
  - Passed.

## Coverage Result

- Not run for this docs-only split.

## Documentation And Public API Impact

| Area                             | Impact                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Package README impact            | Example README must be updated from placeholder to runnable app guide.                                                            |
| TypeDoc/API docs impact          | Pending implementation; required for public example exports and for public framework API changes.                                 |
| Public API additions/removals    | Pending implementation; avoid framework API changes unless a framework gap is proven; document public example exports in TypeDoc. |
| Framework `USER_GUIDE.md` impact | Pending implementation; required if example reveals missing framework guidance.                                                   |
| Example `USER_GUIDE.md` impact   | Required; the guide must explain generation, startup, command posting, querying, subscriptions, tests, and demonstrated features. |
| API examples                     | Required through runnable example code and guide snippets.                                                                        |
| Compatibility notes              | Pending implementation.                                                                                                           |

## Security Impact

| Area                    | Impact                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Dependencies            | Pending implementation; avoid new dependencies unless justified.                                                         |
| Secrets and credentials | Example must not use secrets or committed credentials.                                                                   |
| IPC                     | Pending implementation; if local multi-process/transport is exercised, keep ZeroMQ hidden behind transport abstractions. |
| Validation              | Required: demonstrate validation failure through framework validation.                                                   |
| Tenant boundaries       | Required: preserve tenant handling in command/query/subscription tests.                                                  |
| `Any`/deserialization   | Required: pack/unpack generated Protobuf messages through existing framework contracts.                                  |
| Logging                 | Example logs must not expose sensitive payloads or invent audit infrastructure.                                          |

## Verification

- Splitter-doc verification passed with focused Prettier check on the four
  allowed docs and `git diff --check`.
- Round-1 splitter review requested fixes for stale splitter-next-action
  wording, an explicit coverage gate, generated-clean verification for
  `examples/todo/generated/`, and TypeDoc handling for public example exports
  plus ignored generated output. This fix pass records those requirements before
  first implementation.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                                             | Owner             | Linked Task/Decision | Disposition                                                                                    | Next Review Point                                |
| ------------------------------------------------------------------------------------------ | ----------------- | -------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| The placeholder example may expose missing framework features when turned into a real app. | Main orchestrator | This task            | Accepted; route each proven gap into a framework slice before resuming example implementation. | Splitter output and first implementation review. |

## Review Rounds

- Splitter round 1:
  - code style/maintainability: finding on stale
    `IMPLEMENTATION_REPORT.md` next-action wording.
  - documentation: finding on missing concrete generated-clean verification
    for `examples/todo/generated/`.
  - TypeScript/API docs: findings on public example export TypeDoc impact and
    generated-output TypeDoc exclusion/guarding.
  - security: clean.
  - performance/reliability: finding on missing explicit coverage gate.
- Splitter round 2:
  - all five lanes clean through commit `eb22695`.

## Integration Result

Pending.
