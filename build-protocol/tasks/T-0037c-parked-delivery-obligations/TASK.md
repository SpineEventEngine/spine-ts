# T-0037c: Parked Delivery Obligations

Status: Candidate; not started

Dependency: T-0037b complete and integrated.

## Objective

Add the finite package-internal operational-obligation and cause-reporting
model required to retain rejected generation work without unbounded history,
duplicate reporting, or premature lifecycle ownership decisions.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep the implementation/review package small and limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using TDD.
- Do not assign duplicate authors or reviewers for the same role, and close
  every participating author/reviewer agent after its role completes.
- Before server-module implementation, inspect and record the relevant Spine
  JVM `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review.
- Run all four independent review lanes until clean; defer security review to
  final project readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final child
  acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Preserve D-0085's distinction between unresolved operational work and
  one-time cause reporting.
- Keep every record/key/helper package-internal. Commit no generated artifacts
  and make no root/public export or API change; emitted internal declarations
  may change. Add no example, environment option, or public API docs.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns the canonical finite record table and pure/internal operations
to park, coalesce, supersede, reclassify, select, report, and consume rejected
obligations. Truthful keys are limited to registration plus configured
shard/obligation scope, generation plus configured shard, and at most one
generation-spanning shared record. The table retains one representative cause,
report state, one bounded reported-since-resolution flag, and a saturating
occurrence count per canonical record.

T-0037c may use synthetic owner tokens in tests. It does not create or remove
real environment registrations; T-0037d and T-0037e consume this module.

## Likely Files

- A new package-internal parked-obligation module under
  `packages/server/src/delivery/`
- T-0037b coordinator integration only where settled/rejected evidence enters
  or resolves the table
- Focused parked-obligation and coordinator tests
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Repeated rejection cardinality cannot grow record keys, scope arrays, or
  retained causes beyond D-0085's configured owner/shard bound and one shared
  record.
- Occurrence counts saturate at `Number.MAX_SAFE_INTEGER`; deterministic
  configured-shard and settled-cause order selects one representative.
- Reporting marks exactly selected unreported representatives atomically;
  reported causes never surface twice, while unresolved obligations remain.
- A later rejection after reporting installs at most one new representative in
  the same record without retaining error history.
- Matching successful re-evaluation consumes only actually re-evaluated units;
  omitted, stopped, unrelated, and partially covered broader scopes remain.
- Reclassification after owner removal coalesces into canonical destinations
  without arbitrary subset keys or duplicate causes.
- Fulfilled `FAILED` creates disposition/readiness obligation only and retains
  no cause record.

## D-0085 Invariants

- Rejection is parked until later external readiness; no immediate restart.
- Operational resolution and cause reporting are independent.
- Memory is bounded by live registrations/configured shards plus one shared
  record, not rejection count.
- Durable rows and retained delivery attempts remain diagnostics; no public
  monitor, health, dead-letter, or error-history surface is introduced.

## Explicit Exclusions

No real registration cardinality, startup recovery/rollback, environment
attachment, generation retirement, close ordering, server integration, retry
timing, public API, or T-0036 loop/worker change belongs here.
