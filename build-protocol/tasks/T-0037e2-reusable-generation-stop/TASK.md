# T-0037e2: Reusable Generation Stop

Status: Slice 3B review wave 4 assigned

Started: `2026-07-13T04:26:45Z`

Baseline commit: `8e3139ac`

Branch: `task/T-0037e2-reusable-generation-stop`

Worktree: `.worktrees/T-0037e2-reusable-generation-stop`

This `Status` header is canonical for T-0037e2. Its work and review logs are
derived mirrors and must match it before review.

Because reusable stop changes live-registration ownership, canonical-scope
transfer, publication, admission, concurrency, and external retry boundaries,
one existing requirements splitter is assigned the milestone architecture pass
at expected and explicit `gpt-5.6-sol` / `high`, with documentation-only
ownership and no subagents. It must preserve accepted T-0037b/d/e1 behavior and
split implementation into small independently reviewable slices.

Dependency: T-0037e1 complete and integrated.

## Objective

Implement the sole package-internal reusable generation-stop operation and its
exact-once transition to one fresh generation while live registrations survive.

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
- Preserve existing public close surfaces; add no public explicit-stop,
  generation, registration, scheduler, monitor, retry, signature, option, or
  root export. Public docs must not name the internal explicit-stop operation.
- Commit no generated artifact; run focused API/public-leak checks; do not touch
  examples or `human-review-1-jul.md`.

## Exact Ownership

This child alone owns the lifecycle-gated reusable explicit-stop entry point and
is the sole explicit-stop caller of T-0037b's primitive. It closes old readiness
admission, retains live registrations, and creates one transition-owned fresh
candidate even when no attach races.

The fresh transition has four distinct ordered phases with per-unit progress:

1. rebind every surviving registration and readiness route;
2. transfer every configured, startup, buffered, and retained canonical scope
   exactly once into fresh pending admission;
3. publish the sole candidate;
4. reopen later-write admission.

Configured/startup/buffered/retained scopes are never route-rebound. A bounded
canonical transition owner preserves them from old-route closure through fresh
recovery and phase 2. Rebind and transfer retain separate per-unit checkpoints.
An eligible racing attach waits for and joins this transition-owned candidate.

Construction or partial phase failure publishes no candidate and keeps
admission closed. Before candidate construction, retry may construct one. After
construction, retry resumes the same candidate and completed per-unit progress;
it never constructs a second candidate or self-loops. Candidate work admitted
before failure settles before error propagation.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- T-0037b/d/e1 package-internal generation and lifecycle modules
- Focused reusable-stop transition, failure, retry, and racing-attach tests
- This child's future task/work/review records and narrow architecture updates

## Focused Deterministic TDD

- With live registrations and no racing attach, explicit stop itself creates
  the sole fresh candidate and completes rebind, all-scope transfer,
  publication, then admission reopen, leaving every survivor usable.
- A racing eligible attach waits through retirement and joins that same
  candidate; no old/new overlap, owner gap, or second candidate occurs.
- A write after the fresh snapshot but before route rebind enters the bounded
  transition owner. The test completes registration/readiness-route rebind,
  transfers configured/startup/buffered/retained scopes exactly once into fresh
  pending admission, publishes, reopens admission, and admits the write without
  an unrelated trigger.
- Rebind and transfer failure cases use multiple routes/scopes, fail after one
  unit completes while another remains, retain separate per-unit checkpoints,
  settle admitted candidate work, propagate the error once, and prove external
  retry resumes the same candidate without repeating completed units.
- Construction failure proves no candidate exists; external retry may construct
  exactly one. No failure starts recursive/background retry.
- Quiescence failure retains the unsafe old generation, live registrations,
  transition owner, and endpoint dependencies and performs no later phase.
  Retry resumes without repeating admission closure/stop, proves quiescence,
  completes retirement and all four fresh phases exactly once.
- A reporting-failure case and a distinct post-consumption permanent-retirement-
  failure case each independently persist a supported canonical-scope write
  after the fresh snapshot and before route rebind and prove the transition
  buffer is non-empty. Each case then requires this exact order before the
  original error propagates exactly once: registration/readiness-route rebind ->
  transfer every configured, startup, buffered, and retained scope exactly once
  -> candidate publication -> admission reopen -> buffered-write admission
  without an unrelated trigger -> original error propagation. Neither case may
  rely on the separate normal interleaving test, and the candidate never remains
  unpublished or admission-closed after either replacement-safe result.
- Focused internal-access tests prove this environment entry point is the sole
  explicit-stop caller and server/handoff code cannot call the primitive.
- Focused public-leak/API checks remain green and no generated output is tracked.

## D-0085 Invariants

- The old primitive preserves close-admission/stop, await quiescence, classify,
  consume/report, then permanent-retirement/cleanup order.
- Proven quiescence makes reporting or inert cleanup errors replacement-safe;
  inability to prove quiescence prohibits replacement and endpoint teardown.
- One bounded canonical owner prevents durable readiness loss through transition.
- Transition retry is external, finite, exact-once, and never overlaps generations.

## Explicit Exclusions

No registration detach, ordinary last-detach retirement, permanent environment
close/refusal, facility teardown, failed-start rollback, server/listener close
integration, public explicit-stop API/docs, retry timing, monitor/health/action
surface, topology, adapter, catch-up path, or T-0036 change.

## Architecture Resolution

The implementation-ready private ownership model, ordered operation, failure/
retry semantics, attach linearization, public boundary, risks, and four bounded
TDD slices are recorded in
[`architecture-resolution.md`](architecture-resolution.md).

The resolution keeps `EnvironmentAttachments` as the sole lifecycle gate and
adds one private environment-owned stop operation, one unpublished candidate,
stable registration bindings committed at publication, separate route/transfer
checkpoints, and explicit retry with no public token or export. Coordinator
acceptance at `2026-07-13T04:49:19Z` authorized only Slice 1, the private stop
foundation and complete happy path. The existing implementer is assigned at
explicit `gpt-5.6-terra` / `medium` with no subagents.

## Slice 1 Implementation Record

The existing implementer began after architecture commit `b0a09e3f`, assigned
explicit `gpt-5.6-terra` / `medium`, no subagents. Its canonical skill-
applicability check and selected skill details are recorded in the canonical
T-0037e2 work log; the review log mirrors this status without replacing
accepted history. Coordinator verification and pre-review lint passed, so the
four canonical reviewers are assigned against the committed Slice 1 package.

Wave 1 fixes retain one resumable private stop operation and restore
T-0037e1 recovery-owner precedence. Focused RED/GREEN evidence is appended to
the canonical work log. Coordinator verification and pre-review lint passed;
the committed fix delta is assigned to fresh four-lane review.

The coordinator fix audit additionally requires stop selection to occur at
serialized admission, so earlier queued attach/detach operations linearize
first. This correction, its focused RED/GREEN, and coordinator verification are
complete; Wave 2 found one remaining lifecycle-ownership asymmetry.

The final Wave 1 contract fix makes ordinary stop refuse after an admitted
rejection with a private stable explicit-retry message; only explicit retry
advances retained state. Focused RED/GREEN and coordinator verification are
complete; fresh review of that fix was clean.

Wave 2 fixes require stop to refuse a still-owned rejected non-last detach and
require detach/retry-detach to refuse while an admitted rejected stop owns its
frozen survivor set. Focused RED/GREEN and coordinator verification passed; the
committed fix delta is assigned to fresh four-lane review. No other Slice 1
behavior or later slice is reopened.

The existing implementer reproduced both Wave 2 ownership directions in
focused RED and made them GREEN using only the existing handle operation and
retained stop operation. Focused T-0037e2 plus T-0037d/e1 regressions and the
public-index/typecheck checks passed. Wave 3 review ran and produced the later
recorded duplicate-detach promise-identity finding.

Wave 3 fixes preserve T-0037e1 duplicate-detach promise identity when a queued
detach is blocked by rejected-stop ownership. The existing canonical detach
operation now wins before creating an immediate stop-retry refusal. Focused
RED/GREEN and coordinator verification passed; fresh review is assigned.

## Slice 1 Acceptance

At `2026-07-13T06:03:11Z`, Slice 1 closed after Wave 5 reported clean or
justified N/A dispositions in all four canonical concerns. The accepted private
foundation owns one serialized stop operation, keeps stable survivor handles
and routes, retires before candidate startup, publishes once, reopens and
settles buffered candidate work, resumes retained candidate-construction state,
and preserves T-0037e1 recovery ownership and detach promise identity.

Slice 2, Bounded Capture, Checkpoints, And Transition Failure Retry, is assigned
to the same existing implementer at immutable and explicit `gpt-5.6-terra` /
`medium`, no subagents. Its exact scope and exclusions remain those in the
accepted architecture resolution; Slices 3--4 remain unauthorized.

## Slice 2 Implementation Record

At `2026-07-13T06:07:25Z`, the existing implementer began only accepted Slice
2 at HEAD `bb97aa64`, fixed and explicitly dispatched at `gpt-5.6-terra` /
`medium`, with no subagents. The fresh canonical skill-applicability check, JVM
evidence, scope decisions, and TDD start are appended to the canonical work
log. Slice 1 history remains accepted; old-retirement failure policy and racing
attach behavior remain unauthorized Slices 3--4 work.

At `2026-07-13T06:23:22Z`, the bounded Slice 2 pass was returned for
coordinator review. It adds one private transition-scope owner, stable
configured/startup/buffered/retained provenance coalescing, separate route and
transfer checkpoints, retained-candidate retry, dirty-scope re-admission before
publication, and a non-consuming retained-record capture. Focused and requested
regression/type/format/scope checks are recorded in the canonical work log.

The handback is intentionally explicit about two uncovered implementation
edges and one test gap: descriptor fresh-snapshot/preflight failure still
occurs after candidate construction; a candidate recovery promise rejection is
not covered by the fault-seam settlement test; and a newly discovered tenant/
readiness key after capture is not separately exercised. No additional
abstraction or later-slice policy was added in this bounded pass.

## Slice 2 Coordinator Disposition

At `2026-07-13T06:27:28Z`, the coordinator accepted the handback as bounded
Slice 2A, not complete Slice 2. Independent verification passed 4 files / 91
tests, generated typecheck, formatting, pre-review status/public/inventory lint,
and diff hygiene. Slice 2A owns capture, route and transfer checkpoints,
retained-candidate progress, dirty-scope re-admission, and retained-record
selection.

Slice 2B remains required after 2A review closure: fresh descriptor snapshot/
preflight must precede candidate storage, direct candidate-recovery rejection
must clear and retry its in-flight unit on the same candidate, and a newly
discovered readiness/tenant key after capture must be proven. This split keeps
review bounded and waives no accepted Slice 2 requirement.

At `2026-07-13T06:53:10Z`, Slice 2A closed after Wave 2 reported all four
canonical concerns clean. Slice 2B is assigned to the same implementer at
immutable/explicit `gpt-5.6-terra` / `medium`, no subagents, and owns only the
three recorded remaining edges. Slice 2 is not accepted until 2B closes.

## Slice 2A Review Wave 1 Fix Record

At `2026-07-13T06:39:45Z`, the first fix pass completed the required queue
ordering and generation-capture behavior, but the coordinator audit then found
that its array-front mutations were still O(N). At `2026-07-13T06:44:29Z`, the
implementer replaced that array with an intrusive linked head/tail deque while
preserving dirty tail re-admission and retry restoration. Generation capture
still takes one pending/record snapshot and distributes retained scopes by
registration in configured order. Corrected RED/GREEN and mechanical evidence
is recorded in the canonical work and review logs. Slice 2B remains unchanged
and unimplemented.

## Slice 2B Implementation Start

At `2026-07-13T06:55:21Z`, the existing implementer began only the three
assigned Slice 2B edges from clean HEAD `0ca3d79d`, fixed and explicitly
dispatched at `gpt-5.6-terra` / `medium`, with no subagents. The canonical work
log records the fresh skill applicability check, accepted architecture refresh,
and focused TDD boundary. Slice 2A history remains accepted; Slices 3--4 and all
public/generated/server-integration work remain excluded.

## Slice 2B Implementer Handback

Slice 2B now preflights every frozen survivor descriptor before candidate
construction, restores a directly rejected transfer unit for explicit retry on
the retained candidate, and proves a newly observed tenant readiness key is
captured and settled before atomic publication. Focused RED/GREEN and final
verification evidence are recorded in the canonical work log. The change adds
no public surface, production file, second lifecycle owner, or Slice 3--4
policy.

## Slice 2B Handback Audit Fix

The descriptor preflight snapshot now freezes endpoint values and each startup
tenant together with its storage context before candidate construction.
Initial candidate runtime assembly consumes only those captured values; dynamic
readiness for a newly observed tenant retains the live descriptor path. The
canonical work/review logs record the audit RED/GREEN and refreshed gates.

## Slice 2B Review Wave 1 Fix Handback

The complete Wave 1 batch now captures `storageFactory` in the pre-candidate
descriptor snapshot and makes candidate route freshness commit only after
retry-safe runtime installation and stable-route rebinding. Focused tests prove
a fallible accessor cannot create a candidate and a two-tenant partial worker
installation resumes on the exact retained candidate without duplicating the
completed tenant or skipping the failed tenant. Final evidence is recorded in
the canonical work/review logs; coordinator review is requested.

## Slice 2B Review Wave 2 Fix Handback

The private `EnvironmentDeliveryRuntime` now carries the descriptor snapshot's
captured `StorageFactory`, and default production worker construction uses that
field rather than re-reading the descriptor. A production-path regression
proves no late accessor call and successful replay from the captured factory.
Dynamic tenant runtime creation remains live only before the runtime is formed;
all runtime consumers use the frozen identity afterward. Coordinator review is
requested with final evidence in the canonical logs.

## Slice 3A Implementer Handback

Focused environment tests now cover distinct unsafe synchronous stop and
await-quiescence failures through the retained generation-stop owner. They
prove no candidate phase before explicit retry, exact coordinator checkpoints,
retained buffered readiness and endpoint dependencies, retry coalescing, one
successful four-phase replacement, and continued use of the original handle
and stable readiness route. Existing production checkpoint composition already
satisfied the accepted behavior, so no production expansion was required.
Coordinator review is requested; exact evidence is in the canonical work log.

## Slice 3A Review Wave 1 Fix Handback

The redundant post-retry descriptor accessor increment tuple is removed while
the pre-retry no-access guard and all observable lifecycle, candidate,
publication, callback, and retry assertions remain. The fix is test/record-only;
focused verification is recorded in the canonical logs and coordinator review
is requested.

## Slice 3B Implementer Handback

The retained private stop now distinguishes unsafe retirement rejection from a
replacement-safe finalized old result. Stable report/cleanup causes are retained
once while the existing candidate phases finish, are ordered before any
transition cause, and are not re-emitted after explicit continuation. Stable
routes retain a bounded descriptor/readiness-key drain copy so publication and
synchronous reopen are followed by awaited candidate admission before the old
error propagates. Focused RED/GREEN and final evidence are in the canonical
logs; no parallel retirement owner, public surface, or Slice 4 behavior was
added. Coordinator review is requested.

## Slice 3B Review Wave 1 Fix Handback

The retained old-retirement outcome now has explicit pending, retained-reason,
and emitted states, preserving every JavaScript rejection value including
`undefined` exactly once. Report rejection identity is no longer coerced;
only framework-synthesized coordinator/attachment aggregates carry flattening provenance, while exact
phase-owned aggregates remain one cause. The stable route clones one immutable
readiness snapshot for transition capture and reopen. Focused edge regressions
and final verification are recorded in the canonical work/review logs;
coordinator review is requested without Slice 4 or public/generated expansion.

## Slice 3B Review Wave 2 Fix Handback

Undefined transfer faults now use explicit retained presence and cannot publish
the candidate before explicit retry. Coordinator retirement aggregation is
captured into the current generation-retirement result, while attachment
transfer aggregation uses a private current-catch outcome; previously returned
aggregate objects are therefore exact later phase reasons. Focused reuse and
same-candidate retry evidence is recorded in the canonical logs. Coordinator
review is requested without Slice 4 or public/generated expansion.

## Slice 3B Review Wave 3 Fix Handback

Retirement cause provenance is now owned by the originating
`DeliveryRunCoordinator` as one current instance-local outcome. Single failures
retain `[exactReason]`, including a historical coordinator aggregate reused as
the sole report or worker-retirement reason. The consuming generation can take
those causes only by presenting the exact current rejection reason. Focused
report/retirement reuse and same-candidate retry evidence is recorded in the
canonical logs; coordinator review is requested.
