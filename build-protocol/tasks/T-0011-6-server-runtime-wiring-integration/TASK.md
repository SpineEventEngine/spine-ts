# T-0011.6: Server Runtime Wiring Integration

Status: In Progress
Parent task: `T-0011 Transport Foundation`
Start: `2026-07-01 03:06 WEST`
Baseline commit: `78346ab`
Task log path:
`build-protocol/tasks/T-0011-6-server-runtime-wiring-integration/TASK.md`
Branch: `task/T-0011-6-server-runtime-wiring-integration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-6-server-runtime-wiring-integration`
Authoring sub-agent: pending
Reviewer sub-agents: pending

## Objective

Connect the `@spine-ts/server` runtime side to the existing transport
abstractions by exposing a small, immutable routing-plan seam for registered
command/event/query/subscription/system signal interests. This slice prepares
later runtime workers to subscribe or publish through `@spine-ts/transport`
without making `BoundedContext`, repositories, or handler metadata depend on
ZeroMQ, socket endpoints, process supervision, durable delivery storage, gRPC
services, or real handler dispatch.

## Acceptance Criteria

- `@spine-ts/server` exposes a minimal public API that derives transport topics
  and subscriptions from existing bounded-context metadata plus
  `CommandRegistrationReadiness` and `EventRegistrationReadiness`.
- Command routing preserves Spine-style unicast semantics by assigning command
  topics to a competing-consumer subscription owned by a command worker role.
- Event routing preserves Spine-style fan-out semantics by assigning event
  topics to fan-out subscriptions for subscriber/reactor/application readiness
  groups without implementing event storage, enrichment, import, or delivery.
- Query, subscription, and system routing are represented only as explicit
  deferred seams when no concrete server readiness metadata exists yet.
- The API is deterministic and copy-safe, rejects malformed context/runtime
  wiring inputs, and does not expose ZeroMQ, IPC endpoints, socket names,
  multipart frames, storage records, or handler invocation details.
- Tests are written test-first and cover command unicast topic planning, event
  fan-out topic planning, deferred read-side/system seams, copy safety,
  malformed input rejection, and explicit out-of-scope behavior.
- Package docs, architecture docs, API docs, and task logs explain the new seam
  and keep full command/event/query/subscription services, repository dispatch,
  durable delivery, read-side execution, and process supervision deferred.
- TypeScript, lint, format, docs/API checks, proto workflow, and full
  verification remain green with coverage at or above 90%.

## Out Of Scope

- Command/event/query/subscription service implementations or gRPC hosting.
- Handler invocation, repository dispatch, aggregate transactions, projections,
  process managers, event import, event enrichment, event persistence, command
  scheduling, command result subscriptions, or acknowledgement monitoring.
- Durable inbox/outbox storage, delivery workers, retry scheduling, delivery
  deduplication, or storage-backed recovery.
- Broker startup, worker process supervision, IPC endpoint allocation, ZeroMQ
  socket topology, frame formats, or multi-host networking.
- A broad `Server` facade or lifecycle supervisor beyond the routing-plan seam.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain hidden behind transport
  abstractions.
- D-0045: server-module work must inspect task-relevant Spine JVM
  `core-jvm/server` source and avoid over-engineering.
- D-0054: T-0011 owns transport foundations in small slices. T-0011.6 owns
  server/runtime wiring seams, not runtime execution or service hosting.

## JVM Research Evidence

Task-relevant JVM research notes inspected before implementation:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`: a bounded
  context owns command bus, event bus, import bus, integration broker, stand,
  tenant index, repositories, and system context. Application code assembles
  contexts through builders; `BoundedContext` is not an extension point.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`: `CommandBus` is
  unicast and rejects duplicate command dispatchers; `EventBus` is multicast
  and dispatches to all eligible event receptors.

Task-relevant local `core-jvm/server` source inspected before implementation:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`:
  context initialization wires `EventBus`, `IntegrationBroker`, and command-bus
  observers; dispatcher registration attaches command dispatchers to the
  command bus and event dispatchers to the event bus or integration broker.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`:
  builder owns registration lists and later builds runtime objects; repository
  registration is distinct from bus/service execution.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`:
  command handling is a unicast bus concern, with filters, scheduling,
  monitoring, tenant consumption, and dispatch kept inside bus/runtime code.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`:
  event handling is a multicast bus concern; posted events are stored before
  subscriber delivery, and enrichment/dead-event behavior are bus concerns.
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/Server.java`:
  service hosting builds and exposes standard services over contexts, and
  shutdown closes contexts after network shutdown.

Implementation impact: T-0011.6 should produce only server-owned routing
metadata that a future bus/worker/service layer can consume. It should not make
the context object itself publish, subscribe, dispatch, schedule, persist, or
supervise processes.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Session inventory exposed task-relevant skills including
`subagent-driven-development`, `using-git-worktrees`,
`verification-before-completion`, `requesting-code-review`,
`receiving-code-review`, `systematic-debugging`, `test-driven-development`,
`typescript-advanced-types`, `javascript-testing-patterns`,
`nodejs-backend-patterns`, `architecture-patterns`, `codebase-design`,
`cqrs-implementation`, `performance`, and `security-best-practices`.

Repo-local expected-skill manifest checked:
`build-protocol/skills/EXPECTED_SKILLS.md`.

Installed-skill entrypoints checked with:
`find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print | sort |
sed -n '1,120p'`.

Installed-skill lock checked at `~/.agents/.skill-lock.json`; the manifest is
readable and records expected sources including `obra/superpowers`,
`mattpocock/skills`, and `wshobson/agents`. The setup read was truncated in
terminal output after the relevant expected entries, which is non-blocking.

Selected orchestrator skills:

- `subagent-driven-development`: required for the implementation/review loop.
- `using-git-worktrees`: isolated worktree created for this subtask.
- `test-driven-development`: required before production code changes.
- `verification-before-completion`: required before completion claims.
- `requesting-code-review`: required for reviewer dispatch.

Selected implementer/reviewer advisory skills to pass by reference:

- `typescript-advanced-types`: relevant to generic immutable routing contracts.
- `javascript-testing-patterns`: relevant to Vitest coverage and copy-safety
  tests.
- `nodejs-backend-patterns`, `architecture-patterns`, `codebase-design`, and
  `cqrs-implementation`: relevant to keeping server/read/write boundaries
  explicit and small.

Skipped relevant-looking skills:

- `security-threat-model`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`: not explicitly requested; the required security
  reviewer will inspect transport-boundary and input-validation risks.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  storage/read-side/workflow concerns, out of scope for this routing-plan seam.

## Verification

- Parent branch verification after T-0011.5 log commit passed on
  `2026-07-01 03:04 WEST` with `CI=true corepack pnpm verify`; result was 23
  test files / 280 tests, coverage 96.16% statements / 90.48% branches /
  99.33% functions / 96.10% lines, TypeDoc/API checks with 100 proto / 28 core
  / 124 server / 26 storage / 46 transport exports, copied Spine proto
  checksum verification, proto lint/generate, generated proto output clean,
  and generated files clean. TypeDoc emitted the existing invalid-`origin`
  warning only. The command used native IPC access because inherited ZeroMQ
  smoke tests bind `ipc://` endpoints.
- T-0011.6 worktree created from `task/T-0011-transport-foundation` at
  `78346ab`.
- T-0011.6 setup dependency install on `2026-07-01 03:10 WEST`:
  sandboxed `corepack pnpm install --frozen-lockfile` was interrupted after
  npm registry `ENOTFOUND` retries while populating the fresh worktree.
  Escalated `corepack pnpm install --frozen-lockfile` passed with the lockfile
  unchanged, reused 197 packages, and ran the approved `zeromq@6.5.0` install
  script.
- T-0011.6 setup baseline verification passed on `2026-07-01 03:11 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 280 tests,
  coverage 96.16% statements / 90.48% branches / 99.33% functions / 96.10%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 46 transport exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command used
  native IPC access because inherited ZeroMQ smoke tests bind `ipc://`
  endpoints.

## Implementation Notes

- Start from existing `packages/server` metadata-only bounded context,
  command-readiness, event-readiness, and runtime lifecycle code.
- Prefer a pure deterministic plan/helper API over runtime objects.
- Do not introduce new external dependencies.
- If implementation pressure suggests a larger `Server`, bus, storage,
  delivery, or process API, defer it to a later task and record the decision
  instead of widening this slice.
