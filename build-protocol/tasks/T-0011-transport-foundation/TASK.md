# T-0011: Transport Foundation

Status: Setup Baseline Verified; Requirements Split Pending
Start: `2026-06-30 20:32 WEST`
Baseline commit: `194ce9e`
Task log path: `build-protocol/tasks/T-0011-transport-foundation/TASK.md`
Branch: `task/T-0011-transport-foundation`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-transport-foundation`
Requirements splitter: pending
Authoring sub-agents: pending
Reviewer sub-agents: pending

## Objective

Introduce the first transport foundation after T-0010 completed the
single-process runtime and metadata readiness slices. The transport work must
support the project requirement for local multi-process Node.js execution over
a bus abstraction, initially backed by ZeroMQ local IPC, while hiding ZeroMQ
details behind package-owned transport APIs.

The task must not implement command/event/query services, handler invocation,
repository dispatch, durable delivery, read-side query execution, storage
lifecycle, process supervision, or a broad server facade unless the splitter
breaks out a narrowly justified subtask and the corresponding logs are updated.

## Governing Requirements

- `build-protocol/TECHNICAL_SPEC.md`: local multi-process execution over an
  abstract bus transport initially backed by ZeroMQ.
- `build-protocol/RUNTIME_ARCHITECTURE.md`: transport contracts deal in signal
  envelopes and type URL topics; socket types and ZeroMQ-specific envelopes must
  not leak into domain, repository, server, or service APIs.
- `build-protocol/BUILD_PROTOCOL.md`: one requirements splitter, one branch and
  worktree per task/subtask, one implementer per subtask, five reviewer lanes,
  durable logs, and sub-agent closure after completion.
- `build-protocol/DECISION_LOG.md`: D-0007 limits ZeroMQ to local IPC and
  defers scaling beyond one host; D-0024 deferred ZeroMQ dependency installation
  until the transport-adapter task; D-0045 requires server-module work to
  inspect task-relevant Spine JVM server code and avoid over-engineering.
- T-0010 left transport, buses, delivery, storage, dispatch, service hosting,
  read-side execution, and process supervision explicitly deferred.

## Initial Codebase State

- `packages/transport` currently exports only `packageSkeleton` metadata.
- `packages/server` now has runtime lifecycle, bounded-context runtime handles,
  write-side intake result types, command registration readiness, and event
  registration readiness.
- No ZeroMQ dependency is installed yet.
- No transport interfaces, bus topic types, broker adapter, or worker process
  lifecycle exist yet.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Session inventory exposed task-relevant skills including
`subagent-driven-development`, `using-git-worktrees`,
`verification-before-completion`, `requesting-code-review`,
`typescript-advanced-types`, `nodejs-backend-patterns`,
`javascript-testing-patterns`, `architecture-decision-records`,
`architecture-patterns`, `codebase-design`, `cqrs-implementation`,
`event-store-design`, and `performance`.

Repo-local expected-skill manifest:
`build-protocol/skills/EXPECTED_SKILLS.md` lists the required workflow skills
and key advisory skills. Selected orchestrator skills already read in this
session:

- `subagent-driven-development`: required for splitter/implementer/reviewer
  delegation and continuous execution.
- `using-git-worktrees`: required for isolated task branches/worktrees.
- `verification-before-completion`: required before completion claims.
- `requesting-code-review` and `code-review-excellence`: required for review
  loop construction and response.
- `typescript-advanced-types`, `nodejs-backend-patterns`, and
  `architecture-patterns`: applicable to transport API shape, Node runtime
  boundaries, and avoiding over-engineered abstractions.

Skipped relevant-looking skills for setup:

- `security-threat-model`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`: no explicit threat-model request yet; the
  required security reviewer will cover security review for each subtask.
- `performance`: relevant for reviewers, but setup does not yet implement hot
  paths.

## Required Splitter Output

The requirements splitter must:

1. Inspect the transport-related specs and current `packages/transport` code.
2. Investigate current ZeroMQ/Node transport dependency options before any
   dependency choice is made, preferring official package metadata and GitHub
   sources.
3. Produce a staged T-0011 roadmap with small subtasks.
4. Select the first non-blocked implementable subtask.
5. Keep the first subtask small enough to review without creating a full bus,
   service host, broker supervisor, durable delivery engine, or read-side
   execution model.
6. Identify which later subtasks own ZeroMQ adapter installation, IPC smoke
   tests, process lifecycle, retry/delivery behavior, and server/runtime wiring.

## Initial Non-Blocking Research Notes

The orchestrator inspected:

- `packages/transport/src/index.ts` and `packages/transport/src/index.test.ts`;
- `packages/transport/README.md` and `packages/transport/package.json`;
- `build-protocol/TECHNICAL_SPEC.md`;
- `build-protocol/RUNTIME_ARCHITECTURE.md`;
- `build-protocol/DEVELOPER_API.md`;
- `build-protocol/TODO_EXAMPLE_SPEC.md`;
- T-0010 task/report logs and deferred transport notes.

No blocking human question is known at setup time.

## Verification

- Setup baseline verification passed on `2026-06-30 20:36 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, generated proto
  output clean, and generated files clean.
