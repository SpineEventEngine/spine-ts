# T-0064: In-Memory Delivery Simple-Server Core

Status: Verified; ready to commit

Branch: `task/T-0064-in-memory-delivery-server`

Worktree: `.worktrees/T-0064-in-memory-delivery-server`

Baseline: pushed, integrated, and post-merge-verified `main` at `3693d93f`

## Objective

Create the `@spine-ts/delivery-server` package and implement only the frozen
upstream `delivery-server/simple-server` in-memory Inbox and Shard core. The
packet supplies exact deterministic service behavior and concurrent state
ownership for T-0065's standalone Admin/health/configuration lifecycle and
T-0066's multi-process topology.

## Classification

High-risk. This packet introduces a public package, RPC-shaped service
behavior, serialized mutation and cancellation boundaries, concurrent shard
ownership, stale-session timing, idempotency/reconciliation semantics, and
finite in-memory resource ownership.

## Acceptance Criteria

- Inbox write/remove/find/page/newest behavior and ordering match frozen
  `delivery-server` commit `21f2901f393e552208b97166f4eaeb942f9f5172`.
- Duplicate writes and missing removals have deterministic frozen-compatible
  outcomes; page size, continuation, newest-message, count, and shard state do
  not drift apart.
- One serialized mutation boundary prevents torn batch/count/shard state.
  Cancellation is honored before admission; once admitted, a mutation commits
  atomically even when the caller disappears.
- Response-loss tests prove committed mutable operations are observable and
  reconcilable without blindly duplicating unknown mutations.
- Shard pickup is exclusive under contention. Automatic stale takeover uses
  strict `elapsed > timeout`; manual expiration uses `elapsed >= timeout`; a
  zero timeout disables automatic takeover.
- Release and expiration outcomes preserve the frozen worker/session behavior
  accepted in Wave 1, including the trusted-network limitation recorded for
  final security review.
- Clocks and scheduling seams are deterministic in tests; queues, maps,
  snapshots, and mutation waits remain finite or bounded by stored inbox state.
- Process restart intentionally loses all state and the package documentation
  says so.
- Redis, Hazelcast, durable persistence, Admin/health/configuration/CLI
  lifecycle, human UI/TUI, and live TS/JVM execution are absent from T-0064.

## Required Test-First Evidence

Use RED/GREEN slices for duplicate IDs, missing removals, page boundaries and
ordering, newest selection, batch atomicity, cancellation before/after
admission, dropped responses after commit, concurrent pickup, exact stale-time
boundaries, manual expiration, zero timeout, release outcomes, and restart data
loss. Run package checks plus focused delivery-client/supervisor regressions
before specialist review and one full repository gate after convergence.

## Human-Imposed Requirements Ledger

- Continue Wave 1 autonomously until complete or a genuine protocol or
  environmental blocker is documented.
- Report high-level feature progress at least every 30 minutes and immediately
  report every child result, verification/review result, commit, push, merge,
  or blocker with the next action and whether work continues.
- Push every commit immediately. After task closure push both the task branch
  and `main` and prove local/remote ref equality.
- Implement idiomatic TypeScript feature parity without speculative machinery
  or blind JVM copying.
- Port only upstream `delivery-server/simple-server` and use in-memory state
  only. Redis and Hazelcast are excluded; Admin UI/TUI is Wave 4.
- Live TS/JVM compatibility tests are deferred to Wave 3.
- Use isolated worktrees, TDD, existing project roles, explicit prescribed
  model/reasoning profiles, and preserve unrelated user files. Never read or
  modify `human-review-1-jul.md`.

## Architecture Evidence

- Frozen Wave plan:
  `build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`, T-0064.
- Frozen wire contracts already accepted in `@spine-ts/proto`:
  `spine/delivery/message_delivery.proto`, commands, events, pickup outcomes,
  rejections, and transitive types.
- Frozen upstream source commit:
  `SpineEventEngine/delivery-server@21f2901f393e552208b97166f4eaeb942f9f5172`.
  Only its `simple-server` directory and directly used shared Proto contracts
  may inform runtime parity; no other upstream storage/server module is scope.
- Existing T-0062/T-0063 client, adapters, supervisor, operation cancellation,
  and unknown-outcome reconciliation behavior are integration constraints.

## Skill Applicability

- Selected and fully read for this autonomous implementation session:
  `executing-plans`, `subagent-driven-development`, `using-git-worktrees`,
  `test-driven-development`, `requesting-code-review`, and
  `verification-before-completion`.
- Project-local build protocol rules override generic skill defaults where
  they differ: use only existing configured roles, keep commits and pushes
  orchestrator-owned, collect one complete relevant review wave, and use the
  change-sensitive final/post-merge gate cadence.
- No additional architecture skill is selected because the accepted Wave plan
  and required frozen-source split already define the subsystem boundary; the
  requirements splitter must prevent speculative generalization.

## Requirements Splitter Assignment Gate

- Existing role: `requirements_splitter`.
- Scope: read-only analysis of the frozen `simple-server`, accepted Proto, and
  current delivery client/supervisor; decompose one bounded package
  implementation into public/internal seams, invariants, TDD slices,
  verification, and explicit exclusions.
- Expected model: `gpt-5.6-sol`.
- Expected reasoning: `high`.
- Both fields are explicit in dispatch. Runtime metadata is recorded when the
  surface exposes it; otherwise the immutable configured role/profile and that
  limitation are recorded. Wrong role, omitted field, visible mismatch, or
  inherited fallback requires rejection and redispatch.
- The splitter is read-only and may not spawn children, edit, commit, push,
  merge, install dependencies, or touch protected/unrelated files.

## Implementer Assignment Gate

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- One implementation owner receives exact file ownership only after the split
  is accepted. The implementer may not spawn children, commit, push, merge,
  install without approval, or modify protected/unrelated files.

## Accepted Requirements Split

Runtime self-introspection was unavailable. The accepted immutable configured
assignment was the existing `requirements_splitter`, explicitly
`gpt-5.6-sol` / `high`, with no visible mismatch, inherited fallback, or human
blocker.

### Authoritative semantic decisions

- Preserve frozen strict `when_received > since_when`. Correct the existing
  inclusive `RemoteInbox` assumption by requesting from one representable
  JavaScript millisecond before its continuation, then retain exact-anchor and
  tied-full-page fail-closed checks. Reject underflow before RPC; add no cursor.
- Automatic stale takeover is strict `elapsed > processingTimeout`; manual
  expiration is `elapsed >= inactivityPeriod`; timeout zero disables automatic
  takeover. The README's equal-or-more statement is superseded by source code.
- Explicit release remains frozen worker-agnostic even though the request
  carries a worker. This trusted-network limitation stays documented for the
  T-0067 security gate.
- Inbox identity is full shard `(index, ofTotal)` plus UUID. Write is upsert;
  a direct batch applies input order and the last duplicate wins. Missing and
  duplicate removals succeed without count underflow.
- Page order is receive time, version, UUID ascending. Newest considers only
  `TO_DELIVER` and uses the reverse total order. UUID tie stabilization is an
  idiomatic deterministic TypeScript choice where upstream storage ordering is
  unspecified.
- Direct page size is bounded to `1..1000` as the accepted TypeScript safety
  boundary, not as a claimed JVM service validation.
- Canonical maps are authoritative; future Admin counts/observations are
  derived from actual transitions, not duplicate write/delete notifications.

### State and concurrency seam

- One package-private state owner contains detached wire snapshots in a
  message map and shard records in a shard map. Reads snapshot synchronously;
  pages/newest sort detached arrays bounded by stored state.
- All Inbox and Shard mutations use one FIFO admission executor with at most
  100 pending waiters. Validation and detachment happen before enqueueing.
- Abort before admission removes/skips the waiter and commits nothing.
  Admission is the linearization point: the abort listener is removed and a
  synchronous no-`await` critical section commits atomically even if the
  response is later lost. Saturation fails before admission with
  `RESOURCE_EXHAUSTED`.
- No timer, per-shard promise, completed waiter, duplicate counter map, generic
  storage factory, or durable state is retained. Constructing a new core loses
  all state intentionally.

### Minimal public seam

- Export `createInMemoryDeliveryServerCore`, `InMemoryDeliveryServerCore`,
  `InMemoryDeliveryServerCoreOptions`, and only the service implementation
  types required for caller-owned Connect router registration.
- Options expose a non-negative automatic processing timeout and deterministic
  clock. Maps, executor, subscriptions, test hooks, conditional release, and
  storage abstractions remain private.
- T-0064 owns no listener, process lifecycle, Admin, health, or configuration
  environment parsing.

### Exclusive implementation ownership

One production writer owns:

- `packages/delivery-server/package.json`, `tsconfig.json`, `README.md`;
- `packages/delivery-server/src/index.ts`,
  `in-memory-delivery-core.ts`, `in-memory-delivery-state.ts`,
  `mutation-admission.ts`, `inbox-service.ts`, `shard-service.ts`, and
  `wire-values.ts`;
- focused tests in `packages/delivery-server/test/` for Inbox, Shard,
  admission, real client reconciliation, public API, and one shared fixture;
- the narrow strict-page correction in
  `packages/delivery-client/src/remote/adapters.ts`, its focused paging test,
  and paging README text only if required;
- `tsconfig.json`, `typedoc.json`, `scripts/check-api-docs.mjs`, root
  `README.md`, `docs/api/README.md`, and `pnpm-lock.yaml` for exact workspace
  and public API wiring;
- this task's implementation report and work log.

No other agent edits these paths concurrently. `@spine-ts/server` production
delivery, Proto inputs/generated files, T-0065 lifecycle paths, other storage
packages, examples, and protected/unrelated files remain excluded.

### Ordered test-first slices

1. Scaffold the package/root declarations and prove the exact public seam.
2. Implement single Inbox upsert/find/remove, full shard identity, detached
   values, and actual-transition counts.
3. Implement strict paging/newest plus the millisecond-anchor client correction
   and lossless/fail-closed boundary cases.
4. Implement atomic batches and bounded admission, covering pre-/queued abort,
   post-admission abort, queue capacity, and no torn read/count state.
5. Implement high-contention exclusive pickup and frozen release behavior.
6. Prove automatic equality/+1/zero and manual equality/below-bound expiration
   with a deterministic clock.
7. Prove dropped-response reconciliation and fresh-core restart data loss using
   real Connect transport where required.
8. Close package docs, TypeDoc, exact export inventory, workspace wiring, and
   focused delivery-client/supervisor regressions.

## Dependency Selection

No new third-party dependency is justified. Production reuses the pinned
`@bufbuild/protobuf` 2.12.1, `@connectrpc/connect` 2.1.2, and
`@spine-ts/proto`. Tests may reuse `@connectrpc/connect-node`,
`@spine-ts/delivery-client`, and `@spine-ts/server`. The core does not depend on
the delivery client, storage adapters, Redis, or Hazelcast.

## Required Review Dispositions

- Style/maintainability: required.
- Documentation completeness: required.
- TypeScript/API compatibility: required.
- Performance/reliability: required, emphasizing concurrency, atomicity,
  cancellation, timing boundaries, and bounded resources.
- Final security: N/A for this packet unless a security-critical blocker is
  discovered; the final trusted-network/security boundary remains T-0067.
