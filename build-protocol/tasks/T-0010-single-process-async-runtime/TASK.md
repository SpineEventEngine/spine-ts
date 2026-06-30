# T-0010: Single-Process Async Runtime

Status: Final Whole-Branch Review Fix Verified
Start: `2026-06-30 14:57 WEST`
Baseline commit: `169af02`
Task log path: `build-protocol/tasks/T-0010-single-process-async-runtime/TASK.md`
Branch: `task/T-0010-single-process-async-runtime`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0010-single-process-async-runtime`
Requirements splitter:
`019f18d6-f12d-7640-9c9e-be8943200c99` (Plato the 6th, closed)
Authoring sub-agents:

- `T-0010.1`: `019f18e2-6b71-72d2-ad2a-fb3cf0b5859f` (closed);
  `019f18f1-ad4c-7fb2-b079-994735ee337c` (review fix, closed).
- `T-0010.4`: `019f195f-908c-7943-8dc9-5f7f1d94ebe2` (closed);
  `019f196c-c5d2-7212-b559-f1b9d8939ec2` (review fix, closed).
- `T-0010.5`: `019f198d-7dc2-7641-9abb-4c49d776e370` (closed);
  `019f199d-9b3a-76f0-887b-5ea128774140` (review fix, closed).
- `T-0010.6`: `019f19c2-19e5-7762-9d62-edc7c336018f` (closed);
  review-fix/log-fix workers `019f19d0-f773-7392-b68b-b1c448e8d5df`,
  `019f19d4-d4d0-71b3-9130-012db5290987`,
  `019f19d8-b547-7fc0-803c-d009a7f14ecb`, and
  `019f19dc-8495-7152-a968-aebb531530e6` (all closed).

Reviewer sub-agents:

- `T-0010.1`: all required review lanes completed and closed.
- `T-0010.4`: all required review lanes completed and closed, including final
  re-review lanes `019f1979-0da3-7bf1-9119-ee0e8bb0ad4c`,
  `019f1979-47a0-7703-b882-1f56c2adff15`,
  `019f1979-6fc3-7022-ba8f-fd272e8f5468`,
  `019f1979-a556-7583-93a0-7f59499e1dda`, and
  `019f1979-d135-7342-a3d5-38c286f5da1c`.
- `T-0010.5`: all required review lanes completed and closed.
- `T-0010.6`: all required review lanes completed and closed, including final
  documentation re-review `019f19df-8137-79c2-9d95-c05deb7db5ae` (closed,
  CLEAN).

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

## Splitter Result

Requirements splitter `019f18d6-f12d-7640-9c9e-be8943200c99` completed on
`2026-06-30 15:01 WEST` and was closed by the orchestrator. Blocking questions:
none.

Roadmap:

1. `T-0010.1 Runtime Lifecycle And Async Queue Kernel`: add the smallest
   server-owned async lifecycle/queue primitive with explicit `start()`,
   `close()`, status, idempotent close, and queued work that runs after intake
   returns.
2. `T-0010.2 Bounded Context Runtime Handle`: build a runtime-facing handle
   from a built `BoundedContext` snapshot without changing builder semantics.
3. `T-0010.3 Write-Side Signal Intake Result`: introduce internal command/event
   intake result types that preserve accepted-for-async-work versus immediate
   intake failure without depending on `Ack` yet.
4. `T-0010.4 Command Registration Readiness`: use handler metadata to compute
   command-assignment ownership/readiness and enforce one effective assignee
   per command type.
5. `T-0010.5 Event Registration Readiness`: compute event-side readiness from
   metadata for subscriptions, reactions, applications, and domestic/external
   deferral notes.
6. `T-0010.6 Runtime Closure And User-Facing Docs`: close T-0010 with API docs,
   compatibility notes, and a tiny bounded-context runtime assembly smoke test.

First selected non-blocked subtask:
`T-0010.1 Runtime Lifecycle And Async Queue Kernel`.

Acceptance criteria for `T-0010.1`:

- public or narrowly exported server runtime lifecycle contract has `start()`
  and `close()` with deterministic state transitions;
- closing is idempotent and prevents new queued work;
- queued work is not executed synchronously during intake;
- no global singleton, import-time registration, process supervision, gRPC,
  ZeroMQ, durable storage, read-side stand, or repository dispatch;
- README/TypeDoc explain that this is a single-process async kernel only;
- implementer follows TDD and reviewers run all five lanes.

Out of scope for `T-0010.1`: `CommandBus`, `EventBus`, `ImportBus`, `Stand`,
`Server`, `CommandService`, `Ack`, delivery inbox, event store, tenant index,
system context, integration broker, ZeroMQ, worker processes, and full
repository dispatch.

Tooling/dependency decision: no new dependencies are needed for T-0010.1; use
existing TypeScript, Vitest, TypeDoc, and current server tests. ZeroMQ remains
deferred to a later transport-adapter task.

## Verification

- Setup baseline verification passed on `2026-06-30 15:00 WEST`:
  `CI=true corepack pnpm verify` passed with 17 test files / 212 tests,
  coverage 96.39% statements / 90.8% branches / 99.09% functions / 96.32%
  lines, TypeDoc/API checks with 100 proto / 28 core / 97 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.
- Parent integration verification after merge commit `556c23a` passed on
  `2026-06-30 15:50 WEST`: `CI=true corepack pnpm verify` passed with 18 test
  files / 219 tests, coverage 96.33% statements / 90.87% branches / 99.12%
  functions / 96.26% lines, TypeDoc/API checks with 100 proto / 28 core / 104
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `d8ce736` passed on
  `2026-06-30 16:28 WEST`: `CI=true corepack pnpm verify` passed with 18 test
  files / 224 tests, coverage 96.22% statements / 90.3% branches / 99.15%
  functions / 96.15% lines, TypeDoc/API checks with 100 proto / 28 core / 106
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `575e1d3` passed on
  `2026-06-30 17:20 WEST`: `CI=true corepack pnpm verify` passed with 19 test
  files / 234 tests, coverage 96.21% statements / 90.38% branches / 99.16%
  functions / 96.14% lines, TypeDoc/API checks with 100 proto / 28 core / 116
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `032257b` passed on
  `2026-06-30 18:08 WEST`: `CI=true corepack pnpm verify` passed with 20 test
  files / 242 tests, coverage 95.94% statements / 90.38% branches / 98.15%
  functions / 95.87% lines, TypeDoc/API checks with 100 proto / 28 core / 119
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `480d14c` passed on
  `2026-06-30 19:04 WEST`: `CI=true corepack pnpm verify` passed with 21 test
  files / 256 tests, coverage 96.45% statements / 90.55% branches / 99.24%
  functions / 96.39% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean.
- Parent integration verification after merge commit `64c8e4c` passed on
  `2026-06-30 19:58 WEST`: `CI=true corepack pnpm verify` passed with 21 test
  files / 257 tests, coverage 96.45% statements / 90.55% branches / 99.24%
  functions / 96.39% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, proto lint/generate checksum
  verification, and generated proto output clean. Parent log commit `8dfbafb`
  records this post-merge verification evidence.
- Final-review focused verification passed on `2026-06-30 20:13 WEST`:
  `corepack pnpm vitest run packages/server/src/command-registration-readiness.test.ts packages/server/src/index.test.ts`
  passed with 2 test files / 21 tests.
- Final-review full verification first reached `format:check` on
  `2026-06-30 20:13 WEST` and failed because Prettier needed to rewrite
  `build-protocol/work-logs/T-0010-6.md` and `build-protocol/work-logs/T-0010.md`.
  `corepack pnpm prettier --write build-protocol/work-logs/T-0010-6.md build-protocol/work-logs/T-0010.md`
  passed.
- Final-review full verification passed on `2026-06-30 20:14 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, proto lint/generate checksum verification, and generated
  proto output clean.

## Human Questions And Answers

- None.

## Subtask Progress

- `T-0010.1 Runtime Lifecycle And Async Queue Kernel` subtask branch/worktree
  created on `2026-06-30 15:08 WEST` from parent commit `70692a9`. Setup logs
  are created; setup baseline verification passed on `2026-06-30 15:11 WEST`
  with 17 test files / 212 tests and clean TypeDoc/API, proto, and
  generated-output gates. Implementation, review fixes, and clean re-review
  completed on branch `task/T-0010-1-runtime-lifecycle-queue`; all participating
  sub-agents were closed. The subtask was merged into the parent branch as
  `556c23a Integrate T-0010.1 runtime lifecycle queue`.
- Next selected subtask:
  `T-0010.2 Bounded Context Runtime Handle`.
- `T-0010.2 Bounded Context Runtime Handle` branch/worktree created on
  `2026-06-30 15:52 WEST` from parent commit `d570bba`. Setup logs are
  created; setup baseline verification passed on `2026-06-30 15:56 WEST` with
  18 test files / 219 tests and clean TypeDoc/API, proto, and generated-output
  gates. Implementation, review fix, and clean re-review completed on branch
  `task/T-0010-2-bounded-context-runtime-handle`; all participating sub-agents
  were closed. The subtask was merged into the parent branch as
  `d8ce736 Integrate T-0010.2 bounded context runtime handle`.
- Next selected subtask:
  `T-0010.3 Write-Side Signal Intake Result`.
- `T-0010.3 Write-Side Signal Intake Result` branch/worktree created on
  `2026-06-30 16:31 WEST` from parent commit `4d58ba8`. Setup logs are
  created; setup baseline verification passed on `2026-06-30 16:35 WEST` with
  18 test files / 224 tests and clean TypeDoc/API, proto, and generated-output
  gates. Implementation, review fixes, and clean re-review completed on branch
  `task/T-0010-3-write-side-signal-intake-result`; all participating
  sub-agents were closed. The subtask was merged into the parent branch as
  `575e1d3 Integrate T-0010.3 write-side signal intake result`.
- Next selected subtask:
  `T-0010.4 Command Registration Readiness`.
- `T-0010.4 Command Registration Readiness` branch/worktree created on
  `2026-06-30 17:24 WEST` from parent commit `e5e7b1d`. Setup logs are
  created; setup baseline verification passed on `2026-06-30 17:27 WEST` with
  19 test files / 234 tests and clean TypeDoc/API, proto, and generated-output
  gates. Implementation, review fix, clean final re-review, and review closure
  completed on branch `task/T-0010-4-command-registration-readiness`; all
  participating sub-agents were closed. The subtask was merged into the parent
  branch as `032257b Integrate T-0010.4 command registration readiness`.
- User server-module guardrail: `BUILD_PROTOCOL.md` now explicitly requires
  task-relevant inspection of Spine JVM `core-jvm/server` source before
  creating or changing `@spine-ts/server` runtime/API code, with a bias toward
  the smallest familiar TS contract and against speculative server
  abstractions.
- Next selected subtask:
  `T-0010.5 Event Registration Readiness`.
- `T-0010.5 Event Registration Readiness` branch/worktree created on
  `2026-06-30 18:12 WEST` from parent commit `20aaad1`. Setup logs and D-0052
  are created; setup baseline verification passed on `2026-06-30 18:16 WEST`
  with 20 test files / 242 tests and clean TypeDoc/API, proto, and
  generated-output gates. Implementation, review fixes, clean final re-review,
  documentation second re-review, and review closure completed on branch
  `task/T-0010-5-event-registration-readiness`; all participating sub-agents
  were closed. The subtask was merged into the parent branch as
  `480d14c Integrate T-0010.5 event registration readiness`.
- Integrated subtask:
  `T-0010.6 Runtime Closure And User-Facing Docs`.
- `T-0010.6 Runtime Closure And User-Facing Docs` branch/worktree created on
  `2026-06-30 19:10 WEST` from parent T-0010 commit `94a28bf`.
- `T-0010.6` implementation sub-agent added the public runtime assembly smoke
  test and documentation updates on `2026-06-30 19:24 WEST`. The subtask still
  has no production runtime code or public export changes, no lockfile changes,
  and no to-do example edits. Focused test/typecheck/lint/format/docs checks
  passed after one lint-only test edit. Final full verification passed on
  `2026-06-30 19:28 WEST` with 21 test files / 257 tests and clean TypeDoc/API,
  proto, and generated-output checks.
- `T-0010.6` review closure completed after documentation log-fix rounds. All
  participating sub-agents were closed. The subtask was merged into the parent
  branch as `64c8e4c Integrate T-0010.6 runtime closure docs`; parent
  verification passed on `2026-06-30 19:58 WEST` with 21 test files / 257 tests
  and coverage above the 90% target.
- T-0010 subtask roadmap is complete. Next gate: final whole-branch review
  before integration beyond the T-0010 task branch.
- Final whole-branch review fix activity started on `2026-06-30 20:09 WEST`.
  Scope: canonicalize `CommandRegistrationReadiness.fromRegistry()` through
  `HandlerMetadataRegistry`, add duplicate-bypass regression coverage, update
  stale T-0010.6 child integration logs, and update parent T-0010 logs/report
  with the final-review fix activity.
- Final-review fix verification passed on `2026-06-30 20:14 WEST` after
  formatting two edited work-log Markdown tables.
