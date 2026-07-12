# T-0035: Delivery Run Trigger And Lifecycle Ownership Decision

Status: Round 8 architecture fix coordinator-verified; re-review pending
Started: `2026-07-11T22:40:30Z`
Baseline commit: `9200dcce`
Branch: `task/T-0035-delivery-run-ownership`
Worktree: `.worktrees/T-0035-delivery-run-ownership`

## Objective

Decide which framework-owned lifecycle component starts, retriggers, observes,
and stops bounded `DeliveryWorker` runs after T-0034, without implementing a
public monitor or scheduler API, and sequence the accepted model into the
smallest independently reviewable implementation successors.

## Human-Imposed Requirements Ledger

- Continue autonomously until every project task is complete or a real blocker
  appears.
- Use one feature branch and worktree per coding or documentation task.
- Use one requirements splitter and one decision author; close each agent when
  its role completes.
- Run independent code style/maintainability, documentation, TypeScript/API
  docs, and performance/reliability review lanes until all are clean.
- Defer security review to final project readiness or an explicit human request.
- Update durable task/work/review records before or with every change.
- Keep the slice and review package deliberately small.
- Run lightweight docs/status lint before reviewer dispatch and focused checks
  in inner loops; reserve full `pnpm verify` for final and post-merge gates.
- Ignore superseded historical text unless current records claim it as active.
- Do not touch or rely on `human-review-1-jul.md`.
- Preserve Protobuf contracts and keep generated Protobuf output out of VCS.
- Keep end-user code free of framework `Event` envelopes, manual transactions,
  `@Apply`, schema-bearing decorators, and app-owned handler materialization.
- Aggregate import/importers, `ImportBus`, and aggregate `@Apply` delivery stay
  removed from the active roadmap.
- `IMPORT_EVENT` remains unsupported for new inbox writes; legacy rows fail
  closed. `CATCH_UP` remains pending/skipped in this slice.
- Inspect relevant Spine JVM server docs and source before accepting the
  ownership decision, while avoiding JVM singleton/thread-copying.

## Splitter Result

Requirements splitter `019f5353-3035-7981-bcf5-5479438ecbed` found no blocker
and selected this decision-only slice as the smallest gap after T-0034.
`DeliveryLoop.run()` drains to a bounded outcome and `DeliveryWorker.start()`
runs configured loops once, but no accepted decision owns startup recovery,
new-work notification, later reconsideration of retryable pending rows, worker
outcome handling, or shutdown coordination. Implementing timers, observers, or
supervision first would choose lifecycle policy accidentally.

## Scope

- Add one accepted decision, expected as D-0085.
- Name exactly one framework lifecycle owner for the next implementation slice.
- Separate current manually started, bounded worker runs from future automatic
  production behavior.
- Define ownership implications for:
  - startup recovery of pre-existing supported pending rows;
  - newly persisted supported inbox work;
  - retryable rows left `TO_DELIVER`;
  - `IDLE`, `PAUSED`, `FAILED`, and `SKIPPED` outcomes;
  - stop initiation and one already-active run.
- Define shutdown ordering relative to network intake, contexts, delivery work,
  transport, and storage without designing process supervision.
- Choose the first compact follow-up mechanism at a behavioral level, such as
  explicit environment-owned triggering, local notification, or bounded scan.
- State whether the ownership seam is package-internal or environment
  configuration.
- Identify one smallest successor implementation task.
- Separate internal loop/worker epoch prerequisites from environment lifecycle
  wiring when one implementation task would mix independently reviewable
  contracts.
- Reconcile only active architecture/status wording that would otherwise
  contradict the accepted decision.

## Out Of Scope

- Runtime source, tests, TypeScript declarations, package exports, generated
  files, Protobuf, examples, or public end-user APIs.
- Public `DeliveryMonitor`, `FailedReception`, custom actions/callbacks,
  scheduler APIs, immediate repeat, backoff, jitter, timer values, cancellation
  protocol, dead-letter storage, health reporting, or process supervision.
- ZeroMQ topology, broker ownership, remote workers, or production adapters.
- Catch-up execution/storage or `CATCH_UP` scheduling.
- Aggregate import/importers or new `IMPORT_EVENT` writes.

## Evidence To Use

- T-0032 through T-0034 task, work, review, decision, runtime, and docs records.
- Current `DeliveryLoop`, `DeliveryWorker`, `ServerEnvironment`, and `Server`
  lifecycle source and focused tests.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`.
- Spine JVM `Delivery`, `LocalDispatchingObserver`, `DeliveryMonitor`,
  `TargetDelivery`, `RepeatDispatching`, and `ServerEnvironment` source.

JVM evidence supports environment-level delivery ownership and local
notification, but does not justify copying singleton state, ad hoc thread
creation, recursive repeat, or the public monitor surface into TypeScript.

## Acceptance Criteria

- One accepted decision names exactly one lifecycle owner for the next slice.
- Current behavior is accurately described as explicitly started runs whose
  direct drains and skipped-scan pause streaks are bounded, while a whole loop
  can remain active under continuous supported writes and has no automatic
  restart guarantee after settlement.
- Active architecture distinguishes bounded current direct pages and the
  bounded `PAUSED` outcome from cross-run continuation: current `DeliveryLoop`
  clears its resume cursor before `PAUSED`, so repeated explicit starts may
  rescan the head and do not yet retain a finite epoch. T-0036 adds only
  package-internal opaque continuation/high-watermark-or-equivalent bounds and
  selective paused-shard progress, without public API.
- `ServerEnvironment.delivery` is not called a scheduler merely because it is
  closeable.
- Startup recovery and retryable pending-row wakeups have an owner without
  inventing delay/backoff values.
- `IDLE`, `PAUSED`, `FAILED`, and `SKIPPED` outcomes have explicit ownership
  implications.
- One admitted request makes bounded cross-run progress through a finite scan
  epoch when `PAUSED`; unsupported prefixes cannot force every later run to
  restart from the same head, and concurrent writes cannot extend the epoch
  forever.
- Worker-promise rejection has explicit startup, notification/retry-trigger,
  retained-progress, and shutdown behavior without a public observation API.
- Mixed worker outcomes use package-internal per-shard eligibility: only paused
  shards continue the current epoch; failed/skipped shards park; idle shards
  complete.
- The finite epoch bound caps supported as well as skipped work, so continuous
  supported writes cannot keep one epoch alive indefinitely.
- Shared or reusable caller-owned environments have one seam with internal
  attachment/generation cardinality; one detach cannot disable other servers.
- Last detach permanently stops only the old generation's worker/loops; later
  attachment to a caller-owned environment constructs a fresh internal
  worker/loop generation and performs startup recovery, while environment close
  remains permanent.
- Failed startup rolls back only its package-internal registration, awaits all
  active work that can use its endpoint dependencies before closing them,
  assigns its rejection/cleanup errors to that failed start, and preserves
  sibling registrations, progress, readiness, and parked errors. First/sole and
  server-owned cases remain explicit and coherent.
- Every rejected start partitions parked errors by package-internal
  shard/obligation scope: uniquely attributable records are registration-owned,
  while shared or unassignable records are generation-owned without blaming the
  triggering or unrelated registration.
- T-0036 preserves package-internal rejected-shard identity, each cause and its
  associated obligation scope, plus fulfilled sibling progress. T-0037 consumes
  that evidence for lifecycle ownership and does not reopen worker/loop
  internals.
- An attaching startup obligation queued behind a disjoint sibling rejection is
  admitted exactly once for only its unaffected scope after rejection
  observation, without retrying rejected scope or spinning, and startup settles
  from that run. Overlapping rejection fails startup under existing rules.
- Parked operational obligation/scope is distinct from cause reporting state.
  Each eligible cause is atomically marked reported when propagated and is not
  surfaced again; unresolved work remains parked until matching success or
  lifecycle consumption. Multiple/combined causes retain independent truthful
  scope where possible.
- A later fulfilled start supersedes only records for obligation units it
  actually re-evaluates without rejection; omitted/stopped/unrelated work does
  not clear parked errors.
- Ordinary non-last detach surfaces and consumes its registration-owned errors
  before endpoint dependencies close, retains genuine sibling/shared records,
  and surfaces an orphaned generation-owned record only as a generation
  lifecycle failure. Last detach and environment close consume all remaining
  records through their truthful owner scopes.
- An active rejection encountered during detach is partitioned before
  aggregation. Non-last detach includes only departing-registration records and
  generation records made orphaned by removal; live shared/sibling records stay
  parked. Last detach and environment close include all remaining records once.
- A server-owned environment registration is package-internally exclusive to
  its owning server and rejects any second attachment before registration or
  work admission. Caller-owned environments may accept multiple registrations.
- Environment close serializes its attachment-count check with attach/detach/
  close. Live registrations cause a non-permanent close rejection before
  admission or facilities change; at zero attachments, close becomes permanent
  and follows the accepted quiescence/error/facility order. An owning server
  detaches its sole registration internally before closing its environment.
  Callers close and await attached `RunningServer` instances through public
  `close()`, then retry environment close; there is no public detach operation.
- Last detach and every generation stop use one order: atomically close trigger
  admission/notification, call worker stop, await active work, classify
  rejection, consume/report eligible records/causes, then permanently retire the
  old generation. Stop precedes await so `PAUSED` cannot start another run.
- Attach serializes through the same lifecycle gate. An attach after last detach
  begins waits for complete old-generation quiescence/record consumption/
  retirement, then creates or joins exactly one fresh generation only if the
  environment remains open; it never joins or overlaps the stopping generation.
- Startup overlapping an unresolved generation obligation whose original cause
  is already reported fails with exactly one fresh package-internal plain
  non-empty blocker `Error`. The blocker has no exported type/code/cause/original
  reference, belongs to and is consumed by that failed startup, and never causes
  the original reported cause to surface again.
- Stop prevents new runs and defines whether/how an active run is awaited.
- Shutdown ordering is explicit and does not close transport/storage beneath an
  active run.
- Public monitor/action and scheduler APIs remain deferred.
- T-0034's fixed internal exhaustion outcome remains current and unchanged.
- `CATCH_UP` stays pending/skipped and legacy `IMPORT_EVENT` stays fail-closed.
- The decision identifies one compact first implementation successor and does
  not combine topology, supervision, catch-up, adapters, and public policy.
- The smallest first successor is T-0036 and changes only package-internal
  delivery epoch progress; environment lifecycle wiring is a separate later
  successor, expected as T-0037, and retry timing remains later still.

## Decision Evidence

The decision author inspected the complete current `DeliveryLoop`,
`DeliveryWorker`, `ServerEnvironment`, and `Server` source plus focused loop,
worker-runtime, exhaustion/retry, catch-up, and server/environment lifecycle
tests. Current direct drains and skipped-scan pause streaks are bounded, but a
whole `DeliveryLoop.run()` can remain active under continuous supported writes.
`DeliveryWorkerRun` retains ordered per-shard outcomes while its aggregate
status applies priority, concurrent starts reject, loop `close()` stops future
drains and awaits the active drain, and environment delivery is only an
optionally owned closeable. Multiple servers can reference one caller-owned
environment, but current source has no attachment registry or generation
semantics.

The author also inspected D-0082 through D-0084 and the current T-0032 through
T-0034 task, result, work, and review records; both named local JVM research
notes; and actual Spine JVM `Delivery`, `LocalDispatchingObserver`,
`DeliveryMonitor`, `TargetDelivery`, `RepeatDispatching`, and
`ServerEnvironment` source. JVM evidence places delivery selection in the
environment and notifies delivery after local inbox writes. It also confirms
that public monitor actions and immediate repeat are broader policy, while the
JVM singleton and per-message thread creation are not suitable TS mechanisms.
All required repository, local-doc, and JVM source paths were reachable.

## Accepted Decision Summary

D-0085 names `ServerEnvironment` as the sole framework owner for starting,
retriggering, stopping, and observing delivery runs through a package-internal
lifecycle seam. Startup recovery and post-persist local notification submit
serialized, coalesced requests for one-shot bounded `DeliveryWorker` runs.
`IDLE`, `FAILED`, and `SKIPPED` do not self-trigger. `PAUSED` creates no new
readiness event but continues its already-admitted finite scan epoch from
opaque progress. `FAILED` leaves a retry-readiness obligation for a later
package-internal delay-policy decision to submit to the same owner. Stop closes
generation notification/trigger admission only at last detach or environment
close and awaits active work before dependent contexts, transport, or storage
close; a non-last detach leaves other registrations usable.

One admitted request now remains a finite scan epoch across one-shot runs.
`PAUSED` creates no new readiness event, but retains opaque per-shard progress
to an admission-time high-watermark and continues the same obligation until
that bound is reached, honoring stop between runs. The bound applies to all
skipped and supported work. Mixed results are selective: paused shards continue
the current epoch, failed/skipped shards park until later external readiness,
and idle shards complete. The successor must change the current package
internals so `DeliveryLoop` preserves bounded progress and `DeliveryWorker`
returns package-internal shard dispositions and starts only eligible shards. No
cursor, epoch, or shard-control result becomes public.

Startup worker rejection fails server start before network intake and joins
failed-start cleanup. Notification/retry-triggered rejection is observed
immediately, never becomes unhandled, parks the admitted/coalesced obligation,
and normally resumes only after a later external readiness trigger. A disjoint
attaching startup scope already queued behind sibling rejection is the narrow
exception: it receives exactly one unaffected bounded admission and settles,
without rerunning rejected scope. Each parked operational obligation is
registration-owned when uniquely attributable or generation-owned when it spans
shared/unassignable scope; trigger submission alone never assigns blame. Cause
reporting state is separate, so propagation marks a cause reported once while
unresolved work can remain parked. A later fulfilled start supersedes only the
same obligation units it actually re-evaluates without rejection. Shutdown
continues remaining closes and aggregates only still-unreported eligible causes
while handling every unresolved obligation.

One environment seam accepts package-internal server attachment tokens. A
non-last detach cannot disable the remaining servers. Failed startup atomically
removes only its registration, blocks and awaits work that can still use its
endpoint dependencies before closing them, assigns attributed rejection and
cleanup errors to that failed start, retains shared generation errors while
their sibling obligations remain, and preserves sibling progress/readiness.
Ordinary detach similarly consumes registration-owned errors before dependency
close, retains genuine shared/sibling errors, and surfaces an orphaned shared
error only as generation-owned. Removing the first/sole registration quiesces
the now-empty generation; an owned environment then closes permanently.

Detach-time active rejection is partitioned before inclusion: ordinary
non-last detach consumes only departing-registration and newly orphaned
generation records, retaining live shared/sibling records. Caller-owned
environments may host multiple registrations; a server-owned registration is
exclusive and rejects another attachment before admission. Environment close
rejects non-permanently while registrations remain, serialized against
attach/detach/close, and changes admission/facilities only after observing zero
attachments. Callers close each attached `RunningServer` via public `close()`;
server shutdown detaches internally, after which environment close may be
retried. An owning server internally detaches its sole registration before
close.

Last detach atomically closes admission/notification, stops the worker before
awaiting active work, classifies any rejection, handles eligible
obligations/causes, and permanently retires the generation. Attach uses the same
gate: after stopping begins it waits through complete retirement, then creates
exactly one fresh generation only if environment close has not won. No worker
generations overlap.

When overlapping startup is blocked only by an already-reported shared cause,
the existing failed-start channel receives one fresh internal plain `Error` with
a fixed non-empty message and no link to the original. The blocker is consumed
by that failed startup; the original remains reported and its unresolved
obligation remains parked without duplicate surfacing.

Last detach permanently stops that generation's worker and loops. A reusable
caller-owned environment remains open, but later attachment constructs a fresh
internal worker/loop generation and performs startup recovery rather than
reviving stopped instances. Environment close permanently refuses attachments
and triggers and aggregates all remaining lifecycle work. No public lifecycle
option is added.

The smallest first successor is
`T-0036 Package-Internal Delivery Epoch Progress`. It implements only the
package-internal finite epoch bound, per-shard identity and disposition, opaque
continuation, selective paused-shard starts, fulfilled sibling progress, and
rejected-shard identity with cause/obligation association. It remains explicitly
invoked and adds no public cursor, epoch, result, or lifecycle API. T-0036
excludes
`ServerEnvironment` attachment, startup recovery, post-persist notification,
coalescing, parked lifecycle errors, and shutdown wiring.

A separate later successor, expected as `T-0037` (Environment Delivery
Lifecycle), consumes T-0036's fulfilled/rejected-shard evidence without
reopening worker internals and wires the single environment seam,
attachments/generations, startup recovery, local notification, coalescing,
parked obligation/cause-reporting handling, and stop/shutdown. T-0037 still
excludes retry timing, backoff, jitter, timer values, and public retry policy. No
T-0036 or T-0037 task file is created by this decision-only task.

Both successors exclude public monitor/action or scheduler APIs, supervision,
topology, adapters, and catch-up.
Current runtime remains explicitly started and lacks the successor's full epoch
bound and automatic lifecycle ownership. T-0034, pending/skipped `CATCH_UP`,
and fail-closed legacy `IMPORT_EVENT` remain unchanged.

The active architecture now states the same current/future boundary: direct
drains/pages and the skipped-only `PAUSED` outcome are bounded today, but
`DeliveryLoop` clears its cursor before returning `PAUSED`, so later explicit
starts do not retain finite-epoch continuation. T-0036 supplies the future
package-internal opaque continuation/high-watermark-or-equivalent bound and
selective paused-shard progress without a public cursor or scheduling API.

## Likely Changed Files

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0035-delivery-run-ownership/TASK.md`
- `build-protocol/work-logs/T-0035.md`
- `build-protocol/reviews/T-0035-delivery-run-ownership.md`
- Active architecture docs only if needed to remove a current contradiction.

## Verification Plan

- Lightweight status, duplicate-owner, public-leakage, and future-policy lint.
- Targeted checks for one owner, every worker outcome, startup recovery,
  shutdown ordering, `CATCH_UP`, and `IMPORT_EVENT` boundaries.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check` and untracked-output checks.
- Four independent reviewer lanes after coordinator verification.

## Changed Files

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0035-delivery-run-ownership/TASK.md`
- `build-protocol/work-logs/T-0035.md`
- `build-protocol/reviews/T-0035-delivery-run-ownership.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`

`RUNTIME_ARCHITECTURE.md` now preserves the historical scope of the first
`Server` slice while acknowledging the current explicit `ServerEnvironment`.
It also states that the current optional closeable delivery facility is not an
active delivery scheduler.

## Verification Results

- PASS: `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  rebuilt the workspace declarations required by TypeDoc.
- PASS: `pnpm --config.verify-deps-before-run=false docs:check`; TypeDoc and
  export checks completed with zero errors and the known invalid-`origin`
  source-link warning only. The first attempt failed before that prerequisite
  build because workspace package declarations were absent.
- PASS: `pnpm --config.verify-deps-before-run=false format:check`.
- PASS: targeted status/owner/public-leakage/future-policy/outcome/startup/
  shutdown/`CATCH_UP`/`IMPORT_EVENT` assertions.
- PASS: `git diff --check`, exact four-file changed scope, clean untracked-file
  check, and status inspection.
- NOT RUN: full `pnpm verify`, per explicit task direction.
- PASS: Round 1 `typecheck:build:generated`, fresh `docs:check` with zero
  errors and the known invalid-`origin` warning only, and `format:check`.
- PASS: Round 1 targeted finite-epoch fairness, opaque continuation,
  current-loop/worker successor obligation, rejection/startup/shutdown,
  single-owner, public-policy, T-0034, `CATCH_UP`, `IMPORT_EVENT`, and active
  architecture reconciliation assertions.
- PASS: Round 1 `git diff --check`, status, zero-untracked, and exact five-file
  scope checks.
- NOT RUN: full `pnpm verify` in Round 1, per explicit task direction.
- PASS: Round 2 `typecheck:build:generated`, fresh `docs:check` with zero
  errors and the known invalid-`origin` warning only, and `format:check`.
- PASS: Round 2 targeted mixed per-shard outcome/eligibility, selective start,
  full finite epoch, continuous-supported-write, coalescing/rejection exception,
  retained parked error, shared/reusable environment generation,
  startup/shutdown, single-owner, public-policy, T-0034, `CATCH_UP`, and
  `IMPORT_EVENT` assertions.
- PASS: Round 2 `git diff --check`, status, zero-untracked, and exact four-file
  scope checks. `RUNTIME_ARCHITECTURE.md` remained unchanged in Round 2.
- NOT RUN: full `pnpm verify` in Round 2, per explicit task direction.
- PASS: Pre-review successor-scope fix
  `typecheck:build:generated`, `docs:check` with zero errors and only the known
  invalid-`origin` warning, and `format:check`.
- PASS: Targeted T-0036 internal-only/T-0037 environment-only sequencing,
  finite epoch, mixed outcome, rejection, shared-environment,
  startup/shutdown, public-policy, T-0034, `CATCH_UP`, and `IMPORT_EVENT`
  assertions. No T-0036 or T-0037 task file exists.
- PASS: Pre-review successor-scope `git diff --check`, status, zero-untracked,
  and exact four-file scope checks. `RUNTIME_ARCHITECTURE.md` required no edit.
- NOT RUN: full `pnpm verify` for the pre-review scope fix, per explicit task
  direction.
- PASS: Round 3 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted fresh-generation construction, irreversible old-generation
  stop, registration-scoped startup rollback, endpoint-dependency quiescence,
  rejection/cleanup ownership, sibling-obligation preservation, first/sole and
  owned-environment behavior, T-0036/T-0037 boundary, retry deferral, T-0034,
  `CATCH_UP`, and `IMPORT_EVENT` assertions.
- PASS: The complete work-log event history is chronological; `git diff --check`, status,
  zero-untracked, exact four-file scope, and successor-task-file absence checks
  passed. `RUNTIME_ARCHITECTURE.md` required no edit.
- NOT RUN: full `pnpm verify` in Round 3, per explicit task direction.
- PASS: Round 4 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted registration/generation parked-error ownership, shared-shard
  non-attribution, obligation-scoped supersession, ordinary detach consumption,
  orphaned generation-error handling, failed-start rollback, last-detach/
  environment-close, T-0036/T-0037 boundary, retry deferral, T-0034,
  `CATCH_UP`, and `IMPORT_EVENT` assertions.
- PASS: Complete work-log chronology, `git diff --check`, aligned status, exact
  four-file scope, zero-untracked, and successor-task-file absence checks.
- NOT RUN: full `pnpm verify` in Round 4, per explicit task direction.
- PASS: Round 5 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted detach-time rejection partitioning, non-last/last detach
  inclusion, live shared-record retention, server-owned exclusivity,
  caller-owned sharing, serialized live-attachment close refusal, close-race
  ordering, zero-attachment permanent close, owning-server detach-first,
  T-0036/T-0037 boundary, retry deferral, T-0034, `CATCH_UP`, and `IMPORT_EVENT`
  assertions.
- PASS: Complete chronology, `git diff --check`, aligned status, exact four-file
  scope, zero-untracked, and successor-task-file absence checks.
- NOT RUN: full `pnpm verify` in Round 5, per explicit task direction.
- PASS: Round 6 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted T-0036 rejected-shard/cause/obligation evidence, T-0037
  consume-without-reopening boundary, public `RunningServer.close()` wording,
  disjoint startup one-admission termination, overlapping startup failure,
  operational-obligation/cause-reporting separation, one-time atomic reporting,
  matching-success consumption, multiple/combined causes, retry deferral,
  T-0034, `CATCH_UP`, and `IMPORT_EVENT` assertions.
- PASS: Complete chronology, `git diff --check`, aligned status, exact four-file
  scope, zero-untracked, and successor-task-file absence checks.
- NOT RUN: full `pnpm verify` in Round 6, per explicit task direction.
- PASS: Round 7 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted atomic admission/notification closure, worker-stop-before-
  await, PAUSED continuation prevention, active-rejection classification,
  record/cause handling, permanent generation retirement, attach/last-detach/
  environment-close gate ordering, one fresh non-overlapping generation, and
  deterministic non-causal startup-blocker assertions.
- PASS: T-0036/T-0037 boundary, retry deferral, T-0034, `CATCH_UP`,
  `IMPORT_EVENT`, complete chronology, `git diff --check`, aligned status, exact
  four-file scope, zero-untracked, and successor-task-file absence checks.
- NOT RUN: full `pnpm verify` in Round 7, per explicit task direction.
- PASS: Round 8 `typecheck:build:generated`, fresh `docs:check` with zero errors
  and only the known invalid-`origin` warning, and `format:check`.
- PASS: Targeted source-to-architecture assertions for bounded direct pages,
  bounded skipped-only `PAUSED`, current pre-return cursor clearing, possible
  repeated-start head rescan, absent retained cross-run finite epoch, and future
  T-0036 internal opaque continuation/high-watermark-or-equivalent/selective-
  paused-shard progress without public API.
- PASS: D-0085 alignment without decision edit, complete chronology,
  `git diff --check`, aligned status, exact architecture-plus-three-record scope,
  zero-untracked, and successor-task-file absence checks.
- NOT RUN: full `pnpm verify` in Round 8, per explicit task direction.
- PASS: Coordinator independently repeated the Round 8 generated build,
  docs/API, formatting, source/current-future architecture assertions,
  whitespace, exact scope, chronology, zero-untracked, compatibility, and
  public-API leakage checks.
- PASS: Coordinator independently repeated the Round 7 generated build,
  docs/API, formatting, whitespace, exact scope, zero-untracked, chronology,
  stop order, lifecycle-gate race, fresh-generation, internal blocker,
  compatibility, and public-API leakage checks.
- PASS: Coordinator independently repeated the Round 6 generated build,
  docs/API, formatting, whitespace, exact scope, zero-untracked, chronology,
  rejected-shard evidence boundary, disjoint-startup termination, cause-report
  state, public close wording, compatibility, and public-API leakage checks.
- PASS: Coordinator independently repeated the Round 5 generated build,
  docs/API, formatting, whitespace, exact scope, zero-untracked, chronology,
  detach-time rejection partitioning, ownership exclusivity, serialized close
  refusal/races, zero-attachment close, compatibility, and public-API checks.
- PASS: Coordinator independently repeated the Round 4 generated build,
  docs/API, formatting, whitespace, exact scope, zero-untracked,
  successor-task-file absence, 48-event chronology, ownership, attribution,
  matching-scope supersession, detach/orphan handling, shutdown, compatibility,
  and public-API leakage checks.
- PASS: Coordinator independently repeated the Round 3 generated build,
  docs/API, formatting, whitespace, exact four-file scope, zero-untracked,
  no-successor-task-file, 41-event chronology, fresh-generation, rollback,
  dependency-quiescence, sibling-preservation, retry-deferral, compatibility,
  and public-API leakage checks.
