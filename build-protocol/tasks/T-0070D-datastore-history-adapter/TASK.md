# T-0070D: Datastore Entity-History Adapter

Status: Complete

## Objective

Implement the frozen T-0070 current-record, state-history, and diagnostic
event-history storage contract in `@spine-event-engine/storage-datastore`.
Repository execution remains unchanged until T-0071.

## Classification

High-risk. This task adds durable provider-specific identity, retry,
concurrency, bounded maintenance, and lifecycle behavior.

## Human-Imposed Requirements Ledger

- Preserve behavioral and conceptual Spine JVM parity with idiomatic,
  non-over-engineered TypeScript.
- Use only `@spine-event-engine/*` package names and imports.
- State history is opt-in at repository level; Aggregate event history is
  unconditional, Process Manager event history is opt-in, Projection event
  history is absent, and rejections are excluded. T-0070D implements only the
  storage seam needed by those later T-0071 policies.
- History is not a remote client API.
- Reads are asynchronous, immutable, and newest first.
- Retention is application-managed with bounded `trim`/`truncate`; add no
  unlimited scan option and no generic cursor API.
- Datastore operations must use strict finite provider pushdown and reject
  overflow; indexed bigint is limited to the exact signed 64-bit range.
- Persisted layouts may change without migration compatibility.
- Preserve unrelated files and never modify `human-review-1-jul.md`.
- Use the canonical build protocol, existing roles, isolated worktrees, and
  explicit child model metadata.
- Push origin immediately after every commit; the implementation owner does
  not commit or push.

## Frozen Contract and Ownership

- Authoritative contract:
  `build-protocol/planning/WAVE_2_JVM_PARITY_PLAN.md`, T-0070, and
  `@spine-event-engine/storage/internal/entity-history`.
- Exclusive production ownership: `packages/storage-datastore/**`.
- Task-record ownership:
  `build-protocol/tasks/T-0070D-datastore-history-adapter/**`,
  `build-protocol/work-logs/T-0070D.md`, and
  `build-protocol/reviews/T-0070D-datastore-history-adapter.md`.
- Do not edit shared storage contracts, repository execution, RDBMS files, or
  other task records.

## Acceptance Criteria

- The Datastore factory supplies current records, state history, and event
  history through the frozen internal SPI.
- It passes the reusable provider conformance suite and provider-specific
  tests for large histories, durable fingerprint compatibility across
  independent factories, tuple non-collision, identical/divergent retry,
  every partial-failure stage, and immutable reads.
- State/event identity and ordering are durable and match T-0070 exactly.
- Maintenance uses provider-native key-only selection/deletion in stable,
  bounded chunks; it is resumable, idempotent, concurrency-safe according to
  the frozen contract, and close-aware.
- Tenant/context/storage-key isolation and pre-access incompatibility rejection
  are durable rather than process-local.
- No repository cutover, public history route, compatibility alias, migration,
  unlimited scan setting, or new generic cursor API is added.
- README and TypeDoc accurately document configuration, limits, lifecycle,
  partial-failure behavior, and storage-provider usage with code snippets.

## Assignment

- Existing role: `implementer`.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields are explicit in dispatch. The owner may not spawn children,
  commit, push, merge, or edit outside the ownership above.

## Review and Verification

Run focused Datastore unit/emulator/cloud-safe checks, generated typecheck,
lint/cleanup, formatting, docs/API, release readiness, generated-output checks,
and provider conformance before review. Style, documentation, TypeScript/API,
and performance/reliability concerns are required. Security is N/A unless a
new trust boundary is introduced.
