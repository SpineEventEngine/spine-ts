# T-0033: Delivery Reception Failure Policy Decision

Status: Round 2 coordinator lint passed; fresh re-review pending
Started: `2026-07-11T19:08:00Z`
Baseline commit: `020c8f26`
Branch: `task/T-0033-delivery-reception-policy`
Worktree: `.worktrees/T-0033-delivery-reception-policy`

## Objective

Decide the smallest framework-owned durable outcome policy for supported
endpoint callback failures after retryable classification and the existing
100-attempt exhaustion result before runtime code changes inbox outcomes.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks are done or a real blocker appears.
- Use one feature branch and worktree per coding task or sub-task.
- Spawn a requirements-splitting sub-agent before implementation.
- Use one implementation/authoring sub-agent for this task.
- Run independent reviewer sub-agents for code style/maintainability,
  documentation, TypeScript/API docs, and performance/reliability.
- Run security review only at final project readiness or by explicit human
  request.
- Feed reviewer comments back to one authoring/fix sub-agent and repeat until
  all lanes are clean.
- Close every participating sub-agent once its role is complete.
- Do not modify or rely on `human-review-1-jul.md`.
- No change may be made without updating the relevant durable log before or in
  the same atomic work step.
- Keep task slices and review packages deliberately small.
- Run the lightweight docs/status lint before reviewer dispatch.
- Use focused checks in inner loops; reserve full `pnpm verify` for final
  gates.
- Keep generated Protobuf output out of VCS and preserve Spine Protobuf
  contracts, type URLs, options, and modeling conventions.
- Keep end-user code free of framework `Event` envelopes, manual transactions,
  `@Apply`, schema-bearing decorators, and app-owned handler materialization.
- Aggregate import/importers, `ImportBus`, and aggregate `@Apply` delivery are
  removed from the active roadmap.
- `IMPORT_EVENT` is unsupported for new inbox writes; legacy stored rows fail
  closed.
- Valid `CATCH_UP` rows remain pending/skipped unless a later catch-up task
  explicitly owns their execution.
- For server-module decisions, inspect relevant Spine JVM `core-jvm/server`
  docs and source and avoid over-engineering.

## Splitter Result

Requirements splitter `019f528e-7ee6-7063-bbd4-6add1fe5ae80` returned no
blocker and recommended this docs/decision-only task as the smallest useful
slice after T-0032. T-0029 through T-0032 provide retained sanitized failure
facts, exact-message summaries, retry classification, and an internal
exhaustion gate. The unresolved boundary is the durable action selected after a
supported row classified as retryable fails in its endpoint callback versus
pre-callback exhaustion.

The splitter rejected a runtime callback/action interface before policy is
accepted, and rejected immediate repeat, scheduler/backoff, dead-letter,
monitor, supervision, topology, and catch-up work as broader follow-up slices.

## Scope

- Add one accepted decision, expected as D-0084.
- Decide supported endpoint callback failure after retryable classification
  and pre-callback exhaustion separately.
- Define the default durable row outcome for each case.
- Define the smallest internal action vocabulary needed by the next
  implementation slice without adding TypeScript declarations.
- Define action ownership and execution order relative to claim/fencing,
  retained-attempt persistence, and delivery status changes.
- Preserve existing cleanup reporting when `KEEP_PENDING` claim release fails,
  and define how exhaustion-time `MARK_DELIVERED` failure is reported and
  which durable row state remains authoritative.
- Preserve existing outcomes for claim, lease/fencing, attempt-retention
  infrastructure, cleanup, and status-update failures; those stages are not
  action-selection inputs for D-0084.
- State whether immediate repeat is supported or deferred.
- Reconcile only active roadmap/status text that would contradict the accepted
  decision while keeping unimplemented policy explicitly future work.

## Out Of Scope

- Runtime source, tests, package exports, TypeScript declarations, generated
  output, Protobuf contracts, examples, or public end-user APIs.
- Public `DeliveryMonitor`, `FailedReception`, custom monitor callbacks,
  repeat-dispatch, dead-letter storage, scheduler/backoff, timers,
  cancellation, shard-pickup policy, lifecycle hooks, worker supervision,
  transport topology, production adapters, or durable catch-up execution.
- Security review before final project readiness.
- New `IMPORT_EVENT` support or changed `CATCH_UP` behavior.

## Evidence To Use

- T-0029 through T-0032 task, work, review, and decision records.
- Current delivery and inbox storage implementation under
  `packages/server/src/delivery/`.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`.
- Spine JVM `DeliveryMonitor`, `FailedReception`, `TargetDelivery`,
  `RepeatDispatching`, and reception-failure tests.

Spine JVM defaults failed reception to `markDelivered()`, permits a
monitor-selected immediate repeat, and executes the selected action after a
failed dispatch outcome. Spine TS currently retains sanitized attempts, retries
pending rows up to the internal capacity, and leaves exhausted rows pending.
The accepted decision must acknowledge that difference rather than claim
unimplemented JVM parity.

## Acceptance Criteria

- One accepted decision covers supported endpoint callback failure after
  retryable classification and pre-callback exhaustion separately.
- The default durable row outcome is explicit for both cases.
- Action ownership, execution order, failure accounting, and authoritative
  fallback row state are explicit.
- Claim, lease/fencing, attempt-retention infrastructure, cleanup, and
  status-update failures preserve their existing outcomes. Callback success
  followed by status-update failure is explicitly outside D-0084.
- Failed `KEEP_PENDING` claim release uses existing `CLEANUP` classification:
  aggregate callback and cleanup errors, return one public `DeliveryFailure`,
  consume the existing failure budget once, and preserve existing retained-
  attempt facts/accounting without a second action failure or separate action-
  failure facts.
- The same cleanup rule applies when the callback failure retains attempt 100;
  exhaustion is observed only on a later claimed pass.
- Retained attempts remain bounded, sanitized, and free of payload bytes, user
  error objects, stack traces, and unbounded text.
- Immediate repeat is explicitly supported or deferred; if deferred, no prose
  implies scheduler or recursive retry behavior exists.
- Current runtime behavior remains unchanged until a later implementation task
  lands, and active docs do not claim the decision is executable.
- `CATCH_UP` remains pending/skipped and legacy `IMPORT_EVENT` remains
  fail-closed.
- No public monitor/action or future production-policy API is promised.
- New exhaustion-time `MARK_DELIVERED` action-failure facts or error details
  are bounded and sanitized without claiming the enclosing existing
  `DeliveryFailure` is payload-free or changing its public row-snapshot/
  `unknown` error contract.

## Accepted Decision Summary

D-0084 accepts a fixed internal policy for a later implementation task:

- a row classified retryable before callback whose callback then fails retains
  one bounded sanitized failure attempt, then keeps the claimed row pending
  `TO_DELIVER`, including when that attempt fills slot 100; claim release uses
  existing cleanup, whose failure remains one aggregated `CLEANUP` failure
  with existing attempt and failure-budget accounting;
- pre-callback exhaustion selects framework-owned `MARK_DELIVERED` after
  exact-message classification and while the row remains claim/fence owned;
- immediate repeat remains deferred;
- failed exhaustion-time `MARK_DELIVERED` leaves the authoritative durable row
  pending `TO_DELIVER`, and only its newly introduced action-failure facts or
  error details must be bounded and sanitized.

The minimal prose-only action vocabulary is `KEEP_PENDING` and
`MARK_DELIVERED`. It creates no TypeScript declaration, package export, public
monitor API, custom action extension point, or scheduler promise. D-0084 is not
executable until a later runtime implementation task lands; current D-0083
pending/skip behavior remains active in the source.

## Decision Report

The supplied conservative candidate was validated against the current TS
claim/status path and the JVM monitor/action path. It was accepted because it
preserves the TS bounded retry investment for endpoint callback failures after
retryable classification, adopts the JVM's conservative default terminal
outcome only at exhaustion, and keeps all status changes under the existing
claimed-row/fence boundary. T-0017h was not
edited: its complete historical task wording describes the behavior delivered
by that earlier slice and does not claim to override later accepted decisions.

No runtime source, tests, public docs, API declarations, Protobuf/generated
files, examples, or `human-review-1-jul.md` changed in this decision-only task.
Valid `CATCH_UP` remains pending/skipped and legacy stored `IMPORT_EVENT`
remains fail-closed.

## Likely Changed Files

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0033-delivery-reception-policy/TASK.md`
- `build-protocol/work-logs/T-0033.md`
- `build-protocol/reviews/T-0033-delivery-reception-policy.md`
- `build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md` only if its
  active status would otherwise contradict the decision.

## Verification Plan

- Lightweight docs/status lint for stale status, duplicate policy constants,
  public API leakage, and future-policy overclaim.
- Targeted `rg` checks for current pending-on-failure wording, public monitor
  claims, and forbidden revived concepts.
- `pnpm --config.verify-deps-before-run=false docs:check`.
- `pnpm --config.verify-deps-before-run=false format:check`.
- `git diff --check`.
- `git ls-files --others --exclude-standard`.
