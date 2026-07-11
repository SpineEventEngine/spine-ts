# T-0035: Delivery Run Trigger And Lifecycle Ownership Decision

Status: Decision author assigned
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
- Stop prevents new runs and defines whether/how an active run is awaited.
- Shutdown ordering is explicit and does not close transport/storage beneath an
  active run.
- Public monitor/action and scheduler APIs remain deferred.
- T-0034's fixed internal exhaustion outcome remains current and unchanged.
- `CATCH_UP` stays pending/skipped and legacy `IMPORT_EVENT` stays fail-closed.
- The decision identifies one compact implementation successor and does not
  combine topology, supervision, catch-up, adapters, and public policy.

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
