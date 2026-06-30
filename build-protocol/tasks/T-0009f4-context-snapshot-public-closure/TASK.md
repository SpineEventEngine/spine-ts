# T-0009f.4: Immutable Built Context Snapshot And Public Closure

Status: Setup Complete; Baseline Verification Passed
Start: `2026-06-30 13:30 WEST`
Baseline commit: `855da4a`
Task log path:
`build-protocol/tasks/T-0009f4-context-snapshot-public-closure/TASK.md`
Branch: `task/T-0009f4-context-snapshot-public-closure`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f4-context-snapshot-public-closure`
Parent task: `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
Authoring sub-agent: pending
Reviewer sub-agents: pending

## Objective

Close the T-0009f public bounded-context/repository registration surface with
immutable built-context snapshot behavior and documentation/API polish that can
serve as the contract for later runtime tasks.

The task must not add dispatch, delivery, close/lifecycle execution, storage,
stand/query execution, bus registration, system context construction, gRPC, or
ZeroMQ behavior.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
creating or changing `@spine-ts/server` runtime/API code. Setup inspected:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  bounded-context builder, build sequence, repository registration, lifecycle,
  storage, and public API implications;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, repository
  dispatch-to-inbox and read/write segregation notes;
- `build-protocol/DEVELOPER_API.md`, bounded-context assembly API;
- `build-protocol/RUNTIME_ARCHITECTURE.md`, runtime registration and bus/stand
  separation;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`.

Implementation impact:

- Spine JVM `BoundedContextBuilder.repositories()` returns an immutable copy of
  currently configured repositories; later builder mutations do not update the
  returned list.
- Spine JVM `BoundedContextBuilder.build()` constructs a system context, domain
  context, buses, stand, tenant index, repository registrations, dispatchers,
  and delivery registrations. Those runtime objects are not available in this TS
  slice.
- Spine JVM `BoundedContext.close()` closes buses, broker, stand, import bus,
  repositories, tenant index, and probes. This task must not introduce
  close/lifecycle execution; it may only document that lifecycle is deferred.
- The TS surface should therefore expose defensive immutable metadata snapshots
  and explicit deferred capability markers or notes only where they keep later
  runtime integration clear.

## Scope

Implement or polish only:

- immutable built-context snapshots over name, tenant mode, and registered
  repository metadata;
- defensive copies/frozen views for builder and built-context repository
  snapshots;
- final public exports and TypeDoc/API guard updates for any new public closure
  types;
- user/API/architecture documentation clarifying this is a registration
  contract, not a running server;
- tests proving snapshot immutability, builder mutation isolation after
  `build()`, and no read/write/runtime behavior leaks into this slice.

## Out Of Scope

- `close()` or any lifecycle execution method on `BoundedContext`.
- Bus, dispatcher, inbox, delivery, stand, storage, tenant-index, or system
  context construction.
- Repository `registerWith(context)`, storage opening, handler invocation, or
  type-supplier registration.
- gRPC service routing or ZeroMQ transport integration.
- Default repository creation from entity classes.

## Skill Applicability

Session inventory exposed installed skills including `subagent-driven-development`,
`using-git-worktrees`, `verification-before-completion`,
`test-driven-development`, `typescript-advanced-types`,
`requesting-code-review`, `receiving-code-review`, `architecture-patterns`,
`cqrs-implementation`, and `codebase-design`.

Selected skills:

- `subagent-driven-development`: required by build protocol for implementer and
  reviewer sub-agents.
- `using-git-worktrees`: used to create this isolated worktree.
- `verification-before-completion`: required before any completion claim or
  integration.
- `test-driven-development`: implementer must write or adjust focused tests
  before production changes where feasible.
- `typescript-advanced-types`: applicable to public immutable snapshot and
  generic repository types.
- `architecture-patterns`, `cqrs-implementation`, and `codebase-design`:
  applicable as server-scope guardrails; keep read/write segregation and a small
  registration contract.

Skipped relevant-looking skills:

- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  runtime/storage/projection work, not this closure slice.
- `nodejs-backend-patterns`: no HTTP/gRPC server implementation is in scope.
- `security-best-practices`: full security reviewer lane remains mandatory; no
  separate threat-model artifact is required for this metadata-only task.

Repo expected-skill manifest:
`build-protocol/skills/EXPECTED_SKILLS.md`.
Installed-skill enumeration command for sub-agents to record:
`find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
Installed-skill lock manifest source:
`/Users/armiol/.agents/.skill-lock.json`.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Verification Plan

- Focused server tests covering immutable snapshots and public closure behavior.
- `node scripts/check-api-docs.mjs`.
- `CI=true corepack pnpm verify`.

## Verification

- Baseline verification passed on `2026-06-30 13:32 WEST`: `CI=true corepack
pnpm verify` passed with 17 test files / 212 tests, coverage 96.39%
  statements / 90.8% branches / 99.09% functions / 96.32% lines, TypeDoc/API
  checks with 100 proto / 28 core / 96 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.

## Human Questions And Answers

- None.
