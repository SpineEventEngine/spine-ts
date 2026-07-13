# T-0037e1: Registration Detach Lifecycle

Status: Slice 1 focused verified; Round 1 review pending

Started: `2026-07-13T00:46:22Z`

Baseline commit: `d8ffc72b`

Branch: `task/T-0037e1-registration-detach-lifecycle`

This `Status` header is canonical for T-0037e1. Its work and review logs are
derived mirrors and must match it before review.

Dependency: T-0037d complete and integrated.

T-0037e1 changes registration detach concurrency, retry, and ordinary
last-registration retirement boundaries. One existing requirements splitter is
therefore assigned a milestone-boundary architecture pass with expected and
explicit `gpt-5.6-sol` / `high`, read-only ownership, and no subagents. It must
consume the accepted task/completion plan and relevant Spine JVM server evidence
without reopening completed T-0037b/c/d or later e2/e3/f policy.

The accepted bounded design is recorded in `architecture-resolution.md`. It
splits this child into four sequential, independently reviewed TDD slices:

1. coordinator settlement observation, selected-owner barrier, and one private
   generation-local delivery-record owner;
2. non-last registration detach and retry;
3. ordinary last-detach authoritative retirement and retry;
4. attach/detach races, handle validation, and failed-start separation.

One existing Terra Medium implementer is assigned Slice 1 only with sole write
ownership, strict TDD, and no subagents. Later slices consume the reviewed
foundation and are not part of the first review package.

### Slice 1 Coordinator Findings

Before packaging, the implementation owner must correct four foundation gaps:

1. Settlement observation emits only genuinely new or changed evidence; an
   identical repeated settlement must not emit again.
2. The selected-owner barrier must propagate a terminal coordinator/observer
   invariant fault instead of swallowing it as successful quiescence.
3. Exact fulfilled re-evaluation must consume only its unit and retain a cause
   for any other rejected unit still parked in the same obligation.
4. The record owner must expose bounded atomic detach and retire selection/
   consumption primitives required by later slices, not only separate select
   and remove helpers that permit ordering mistakes.

The same Terra Medium owner receives all four under strict TDD before Round 1.

Disposition: corrected and focused verified. Settlement equality covers
disposition, cause identity, progress counters, and failure identities; barrier
faults propagate; parked evidence retains one bounded cause per configured unit;
and the record owner now exposes atomic `detach(token)` / `retire()` operations
with exact ownership counts and stable selection order.

## Objective

Add registration-scoped detach and ordinary last-detach retirement without
mixing reusable explicit stop or permanent environment close into this review
package.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep its implementation and review package limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using focused deterministic TDD.
- Do not assign duplicate authors or reviewers for one role, and close every
  participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions, and invent none without corresponding
  Spine JVM evidence.
- Before server-module implementation, inspect and record relevant Spine JVM
  `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review. Once this child starts, this
  child `TASK.md` status is canonical for its work/review status mirrors.
- Run code style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability lanes until clean; defer security to final readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final
  child acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Create no child work/review log until this child actually starts.
- Preserve existing public close surfaces; add no public detach, registration,
  generation, scheduler, monitor, retry, signature, option, or root export.
- Commit no generated artifact; run focused API/public-leak checks; do not touch
  examples, public docs, or `human-review-1-jul.md`.

## Exact Ownership

This child owns the internal registration detach barrier and the distinction
between non-last and ordinary last detach. Non-last detach closes only the
departing registration's readiness, awaits its admitted work, consumes/reports
only its eligible records and newly orphaned generation records, and preserves
the shared generation and sibling state. Its retry is non-retiring and never
stops the shared generation or clears its slot.

Ordinary last detach invokes T-0037b's existing authoritative primitive in
D-0085 order: close admission/stop, await quiescence, classify, consume/report,
then permanently retire/clean up. After proven quiescence it clears the retired
slot through a finally-equivalent path even when reporting or inert cleanup
fails. If quiescence fails, it retains the unsafe slot and endpoint dependencies
for retry of the same operation. A later first eligible attach, not detach,
creates one fresh generation after safe slot clearing.

This child does not own reusable explicit generation stop, survivor transition
rebind/transfer, permanent environment close, or server cleanup ordering.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- T-0037d package-internal registration/generation lifecycle modules
- Focused registration detach, last-detach reuse, and detach/attach race tests
- This child's future task/work/review records and narrow architecture updates

## Focused Deterministic TDD

- Non-last detach establishes the departing registration's work barrier,
  consumes/reports only eligible departing or newly orphaned records, and leaves
  sibling generation identity, readiness, pending work, endpoints, resources,
  and facilities usable.
- A non-last failure/retry retains departing endpoint dependencies until safe,
  resumes only unfinished registration cleanup/reporting exactly once, and
  never stops/retires the shared generation or clears its slot.
- Ordinary last detach invokes, rather than duplicates, T-0037b's primitive in
  D-0085 order and clears only a proven-quiescent retired slot.
- Separate reporting-error and inert permanent-cleanup-error cases prove safe
  slot clearing before propagation, followed by one later eligible first attach
  that creates exactly one fresh generation without old/new overlap.
- A quiescence-failure case proves no classify/consume/report/retire/slot-clear
  or endpoint teardown occurs. Retry resumes the same admission-closed/stopped
  operation without repeating completed phases, proves quiescence, completes
  remaining phases exactly once, safely clears the slot, and permits one later
  fresh attachment.
- A detach/attach race linearizes so an attach before last-detach stop joins the
  current generation, while an attach after stop waits for safe retirement and
  then creates/joins exactly one fresh generation; no owner gap or overlap occurs.
- Focused public-leak/API checks remain green and no generated output is tracked.

## D-0085 Invariants

- Stop precedes await; quiescence precedes classification, reporting, retirement,
  slot clearing, and endpoint teardown.
- Reporting or inert cleanup failure after quiescence cannot reactivate delivery.
- Quiescence failure retains unsafe ownership and requires external retry.
- Durable writes after admission closes remain pending for later fresh recovery.

## Explicit Exclusions

No reusable explicit generation stop, survivor rebind, scope transfer,
candidate publication, permanent environment close, facility teardown,
failed-start rollback, server/listener integration, retry timing, public
monitor/health/action API, topology, adapter, catch-up path, or T-0036 change.

## Slice 1 Implementation Record

- `2026-07-13`: The sole existing Terra Medium implementer completed Slice 1
  under strict focused TDD with no subagents. The coordinator now records each
  settlement through an optional private observer and faults observably on an
  observer invariant error. Its selected-owner barrier removes selected pending
  scopes before and after awaiting the active turn plus its bounded successor,
  while retaining configured, sibling, and settled state.
- One private generation-local `EnvironmentDeliveryRecords` module maps exact
  registered initial/dynamic scopes to `ParkedDeliveryObligations`; it holds no
  second cause ledger. Rejection is bounded by the parked table, `PARKED`
  remains cause-less operational work, `IDLE` consumes its exact unit, and
  `STOPPED` is inert rather than successful re-evaluation. Its private atomic
  record-consumption primitives are foundation only; environment lifecycle
  detach/retry and attachment integration remain excluded for later slices.
