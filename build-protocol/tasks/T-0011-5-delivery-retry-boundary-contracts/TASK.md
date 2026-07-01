# T-0011.5: Delivery And Retry Boundary Contracts

Status: Implemented; Verified; Pending Review
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 23:52 WEST`
Baseline commit: `bc028bc`
Task log path:
`build-protocol/tasks/T-0011-5-delivery-retry-boundary-contracts/TASK.md`
Branch: `task/T-0011-5-delivery-retry-boundary-contracts`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-5-delivery-retry-boundary-contracts`
Authoring sub-agent: `019f1ac0-673f-76b3-a7f6-58c84f0d3e85` authored the
implementation; closed by orchestrator after it stalled before commit
Reviewer sub-agents: pending

## Objective

Define the smallest adapter-agnostic delivery and retry boundary contracts
needed by the transport foundation. This slice should model transport-visible
delivery attempt evidence, delivery status/result values, and failure
classification that later server/storage delivery workers can consume. It must
not implement durable inbox/outbox storage, retry scheduling, handler
invocation, repository dispatch, process supervision, or server runtime wiring.

## Acceptance Criteria

- `@spine-ts/transport` exposes a small public contract surface for delivery
  attempt status, retry/failure classification, and delivery results over
  existing transport topics, subscriptions, participant identities, and worker
  registrations.
- The public contract is framed in logical transport concepts and signal
  topics, not ZeroMQ socket types, endpoint strings, multipart frames, storage
  record schemas, or handler/repository internals.
- Deterministic helpers rebuild immutable value objects from semantic inputs,
  reject forged derived keys/statuses, and classify failures without leaking
  raw exceptions or process details.
- Tests cover status transitions, retry eligibility boundaries, failure
  classification, copy safety, and explicit out-of-scope adapter/storage
  details without opening sockets or starting processes.
- Package, architecture, and API docs explain the delivery/retry boundary and
  explicitly defer durable inbox/outbox storage, retry workers, scheduling,
  handler invocation, repository dispatch, broker process supervision, and
  server runtime wiring.
- TypeScript, lint, format, docs/API checks, proto workflow, and full
  verification remain green.

## Out Of Scope

- Durable inbox/outbox records, storage adapters, shard ownership, catch-up
  storage, or retry queues.
- Actual retry loops, retry timers, exponential backoff, worker scheduling, or
  broker restart recovery.
- Command/event/query service behavior, repository invocation, handler
  dispatch, read-side execution, gRPC services, or `@spine-ts/server` runtime
  wiring.
- ZeroMQ socket topology, endpoint layout, frame formats, or multi-host
  networking.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain behind an abstraction.
- D-0045: server-module work must inspect Spine JVM `core-jvm/server` and avoid
  over-engineering. This subtask is transport-only; if it touches
  `@spine-ts/server`, it must first inspect corresponding JVM server code and
  record that evidence.
- D-0054: T-0011 owns transport foundations in small slices. T-0011.5 owns
  delivery/retry boundary contracts, not the durable delivery engine.

## JVM Research Notes

Task-relevant Spine JVM documentation inspected during setup:

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`: delivery records
  are durable inbox messages; delivery deduplication is target-aware; retries
  are policy-driven by delivery monitor/failure actions, not implicit infinite
  loops in handlers.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`: delivery
  storage belongs to the server environment and must not be folded into a
  transport-only package.
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`:
  inbox and catch-up storage are environment-wide delivery storages, built on
  storage abstractions rather than transport APIs.

Implication: this slice should expose only reusable boundary values and
classification helpers. Durable delivery state and policy execution belong to
later storage/server tasks.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Selected skills for this subtask:

- `subagent-driven-development`: required orchestrator/worker/reviewer
  workflow.
- `using-git-worktrees`: isolated subtask worktree created.
- `verification-before-completion`: required before task completion.
- `receiving-code-review`: required for evaluating reviewer findings before
  fixes.
- `systematic-debugging`: required if setup, tests, or review fixes fail.
- `typescript-advanced-types`: applicable to generic, frozen transport result
  contracts.
- `javascript-testing-patterns`: applicable for deterministic Vitest coverage.
- `nodejs-backend-patterns`: applicable only for boundary modeling of
  asynchronous retry classifications; no server implementation is in scope.

Skipped relevant-looking skills:

- `security-threat-model`: not explicitly requested; the required security
  reviewer will inspect exception redaction and process-detail leakage risks.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  delivery/storage/runtime concerns, out of scope here.

## Verification

- Setup dependency install on `2026-06-30 23:52 WEST`: sandboxed
  `corepack pnpm install --frozen-lockfile` was interrupted after npm registry
  `ENOTFOUND` retries while populating the fresh worktree. Escalated
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused 197 packages, and ran the approved `zeromq@6.5.0` install script.

- Setup baseline verification passed on `2026-06-30 23:55 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 276 tests,
  coverage 96.60% statements / 91.06% branches / 99.30% functions / 96.54%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 31 transport expected exports, copied Spine proto checksum verification,
  proto lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command ran
  with native IPC access because the inherited ZeroMQ smoke tests bind
  `ipc://` endpoints and the managed sandbox rejects those binds with `EPERM`.

- Implementation RED on `2026-07-01 00:01 WEST`:
  `corepack pnpm vitest run packages/transport/src/index.test.ts` failed as
  expected with 4 failing delivery/retry boundary tests because
  `createTransportDeliveryAttempt()`, `classifyTransportDeliveryFailure()`,
  and `createTransportDeliveryResult()` were not implemented yet.

- Focused implementation GREEN on `2026-07-01 00:03 WEST`:
  `corepack pnpm vitest run packages/transport/src/index.test.ts` passed with
  1 test file / 17 tests after adding transport-only delivery attempt, failure
  classification, and result/status helpers.

- Required focused/final verification passed before commit:
  `corepack pnpm typecheck` passed; `corepack pnpm docs:check` passed with the
  existing invalid-`origin` TypeDoc warning only and TypeDoc/API counts 100
  proto / 28 core / 124 server / 26 storage / 46 transport exports;
  `git diff --check` passed; privileged branch-tip
  `CI=true corepack pnpm verify` passed on `2026-07-01 00:50 WEST` with 23
  test files / 280 tests, coverage 96.04% statements / 90.31% branches /
  99.33% functions / 95.98% lines, copied Spine proto checksum verification,
  proto lint/generate, and generated-clean all passed. The full verify used
  native IPC access because inherited ZeroMQ smoke tests bind `ipc://`
  endpoints.
- Authoring handoff note: implementation sub-agent
  `019f1ac0-673f-76b3-a7f6-58c84f0d3e85` authored the code/docs/log updates,
  but did not complete its final commit handoff after verification. The
  orchestrator closed the still-running agent and is committing the verified
  diff to keep the task resumable and avoid leaving verified work stranded.

## Implementation Notes

- Start from existing `packages/transport` contracts and keep additions in the
  transport package unless implementation discovers a recorded reason to do
  otherwise.
- Prefer pure deterministic helpers over runtime objects.
- Do not create a "delivery engine" in this task. A useful boundary should be
  small enough for later server/storage code to consume without inheriting
  transport internals.
- If any `@spine-ts/server` code becomes necessary, first inspect the
  corresponding Spine JVM `core-jvm/server` sources and record the evidence in
  this task log before making changes.

Implementation sub-agent notes:

- Stayed transport-only; no `packages/server` files were touched, so no
  additional `core-jvm/server` source inspection was required.
- Added immutable delivery attempt/result/failure-classification contracts to
  `@spine-ts/transport` root API. Helpers rebuild values from semantic
  subscription, worker, delivery, target, outcome, and failure inputs.
- Delivery attempt/result helpers reject forged prebuilt attempt keys, worker
  participant keys, subscription descriptor keys, result statuses, and result
  keys. Existing generic topic/subscription lifecycle helpers keep their
  previous canonicalization behavior.
- Failure classification redacts details to sorted scalar own data fields and
  drops raw exception, endpoint, socket/frame, process, payload, and
  storage-record shaped fields.
- Retry eligibility is exposed only as classification/result data; no retry
  loops, timers, worker scheduling, durable inbox/outbox storage, handler
  invocation, repository dispatch, process supervision, or server runtime wiring
  were added.
