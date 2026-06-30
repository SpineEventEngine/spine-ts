# T-0010: Single-Process Async Runtime

Status: Setup Complete; Requirements Splitting Pending
Start: `2026-06-30 14:57 WEST`
Baseline commit: `169af02`
Task log path: `build-protocol/tasks/T-0010-single-process-async-runtime/TASK.md`
Branch: `task/T-0010-single-process-async-runtime`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-single-process-async-runtime`
Requirements splitter: pending.
Authoring sub-agents: pending splitter output.
Reviewer sub-agents: pending implementation subtask selection.

## Objective

Introduce the first single-process asynchronous runtime slice after the
repository and bounded-context registration seams. The task should give built
bounded contexts a small runtime-facing execution boundary that later command,
event, read-side, transport, delivery, and server-service tasks can consume
without adding gRPC, ZeroMQ, durable delivery, read-side query execution, or
multi-process behavior yet.

The runtime must preserve the project constraints:

- strict read-side/write-side segregation;
- asynchronous signal processing after public intake;
- ZeroMQ hidden behind a later transport abstraction and not used directly here;
- OOP TypeScript APIs with generics where public API is needed;
- Spine JVM conceptual familiarity without source-level compatibility;
- no speculative server abstractions beyond what the inspected JVM server code
  and this task scope justify.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. Setup inspected:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  bounded-context build sequence, runtime parts, server lifecycle, command
  service, multitenancy, and close sections;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, especially bus
  semantics, command/event bus behavior, delivery boundaries, and routing
  summary sections;
- `build-protocol/RUNTIME_ARCHITECTURE.md`, asynchronous signal processing,
  runtime roles, bus semantics, process model, and delivery boundaries;
- `build-protocol/DEVELOPER_API.md`, repositories and bounded-context assembly
  plus public services sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/bus/Bus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- task-relevant source list under
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server`
  was enumerated for buses, bounded contexts, server, command/event, delivery,
  inbox, and integration classes.

Implementation impact:

- JVM buses accept signals, convert them to envelopes, filter, store or record
  accepted signals, acknowledge posting, then dispatch asynchronously through
  registered dispatchers. The first TS slice should model a small async boundary
  and deterministic lifecycle without pretending to implement full bus
  filtering, storage, dispatch outcomes, delivery monitors, or system events.
- JVM `BoundedContext` constructs command/event/import buses, stand,
  integration broker, tenant index, system client, and visibility guard during
  build/init. T-0010 should avoid recreating the whole graph and instead expose
  a minimal runtime snapshot/handle that can later host those parts.
- JVM `EventBus` stores events before dispatch and `CommandBus` separates ack
  from deeper dispatch/rejection outcomes. T-0010 must keep this distinction in
  docs and tests even if only queueing/lifecycle seams are implemented.
- JVM shutdown is explicit and close-oriented. T-0010 should prefer
  idempotent async `start`/`close` or equivalent lifecycle contracts, with
  no global singleton or process supervisor unless the splitter proves it is
  necessary.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Session inventory exposed installed skills including
`subagent-driven-development`, `using-git-worktrees`,
`verification-before-completion`, `requesting-code-review`,
`architecture-patterns`, `cqrs-implementation`, `event-store-design`,
`projection-patterns`, `saga-orchestration`, `nodejs-backend-patterns`,
`javascript-testing-patterns`, `test-driven-development`,
`typescript-advanced-types`, `architecture-decision-records`,
`codebase-design`, and `planning-with-files`.

Selected skills read by the orchestrator before setup:

- `subagent-driven-development`: required by the user and protocol for
  splitter/implementer/reviewer delegation and continuous execution.
- `using-git-worktrees`: required for isolated task branches and worktrees.
- `verification-before-completion`: required before claiming any task or
  integration state.
- `requesting-code-review`: required before task/subtask completion and merge.

Task-relevant skills to pass to sub-agents:

- `architecture-patterns`, `cqrs-implementation`, and `codebase-design` for
  preserving runtime boundaries without over-engineering;
- `nodejs-backend-patterns`, `javascript-testing-patterns`, and
  `test-driven-development` for async Node runtime behavior and tests;
- `typescript-advanced-types` for generic public API boundaries;
- `event-store-design`, `projection-patterns`, and `saga-orchestration` are
  adjacent but should usually be skipped or narrowly referenced in T-0010
  unless the splitter selects a subtask that explicitly touches those domains.

## Splitter Assignment

The requirements-splitting sub-agent must produce a staged roadmap for T-0010
and select the first non-blocked implementable subtask. It must keep the first
runtime slice smaller than the JVM server graph, avoid gRPC/ZeroMQ/storage
delivery/read-side execution, and identify which future tasks own those pieces.

## Verification

- Setup baseline verification passed on `2026-06-30 15:00 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Human Questions And Answers

- None.
