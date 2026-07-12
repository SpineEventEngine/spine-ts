# T-0037c: Parked Delivery Obligations

Status: Candidate; not started

Dependency: T-0037b complete and integrated.

## Objective

Add the finite package-internal operational-obligation and cause-reporting
model required to retain rejected generation work without unbounded history,
duplicate reporting, or premature lifecycle ownership decisions.

## Human-Imposed Requirements Ledger

- Implement only this child in its future isolated branch/worktree with one
  author, TDD, focused checks, and all four required review lanes.
- Preserve D-0085's distinction between unresolved operational work and
  one-time cause reporting.
- Keep every record/key/helper package-internal and absent from root exports,
  generated declarations, examples, environment options, and public API docs.
- Keep generated Protobuf output out of VCS and do not touch
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
