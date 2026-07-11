# T-0035: Delivery Run Trigger And Lifecycle Ownership Decision

Status: Round 2 findings pending fix
Started: `2026-07-11T22:40:30Z`
Baseline commit: `9200dcce`
Branch: `task/T-0035-delivery-run-ownership`
Worktree: `.worktrees/T-0035-delivery-run-ownership`

## Objective

Decide which framework-owned lifecycle component starts, retriggers, observes,
and stops bounded `DeliveryWorker` runs after T-0034, without implementing a
public monitor or scheduler API.

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
- Current behavior is accurately described as explicitly started bounded runs
  with no automatic restart guarantee.
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
- Stop prevents new runs and defines whether/how an active run is awaited.
- Shutdown ordering is explicit and does not close transport/storage beneath an
  active run.
- Public monitor/action and scheduler APIs remain deferred.
- T-0034's fixed internal exhaustion outcome remains current and unchanged.
- `CATCH_UP` stays pending/skipped and legacy `IMPORT_EVENT` stays fail-closed.
- The decision identifies one compact implementation successor and does not
  combine topology, supervision, catch-up, adapters, and public policy.

## Decision Evidence

The decision author inspected the complete current `DeliveryLoop`,
`DeliveryWorker`, `ServerEnvironment`, and `Server` source plus focused loop,
worker-runtime, exhaustion/retry, catch-up, and server/environment lifecycle
tests. Current behavior is one explicitly started bounded worker run;
concurrent starts reject, loop `close()` stops future drains and awaits the
active drain, and environment delivery is only an optionally owned closeable.

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
notification/trigger admission and awaits active work before contexts,
transport, or storage close.

One admitted request now remains a finite scan epoch across one-shot runs.
`PAUSED` creates no new readiness event, but retains opaque per-shard progress
to an admission-time high-watermark and continues the same obligation until
that bound is reached, honoring stop between runs. The successor must change
the current package internals so `DeliveryLoop` no longer discards all paused
progress and `DeliveryWorker` can preserve that opaque obligation across
starts. No cursor or epoch becomes public.

Startup worker rejection fails server start before network intake and joins
failed-start cleanup. Notification/retry-triggered rejection is observed
immediately, never becomes unhandled, parks the admitted/coalesced obligation,
and resumes only after a later external readiness trigger. Shutdown awaits an
active rejection, continues remaining closes, and propagates/aggregates it
through the existing close-error model.

The smallest successor implements that environment-owned package-internal
seam, startup trigger, local notification, coalescing, finite `PAUSED`
continuation, rejection handling, and stop/await ordering only. It does not
implement timer values, backoff, public monitor/action or scheduler APIs,
supervision, topology, adapters, or catch-up.
Current runtime remains explicit one-shot bounded runs until that successor
lands. T-0034, pending/skipped `CATCH_UP`, and fail-closed legacy
`IMPORT_EVENT` remain unchanged.

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
