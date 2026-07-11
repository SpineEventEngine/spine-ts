# T-0034: Mark Exhausted Delivery Rows

Status: Round 8 runtime findings pending fix
Started: `2026-07-11T21:25:00Z`
Baseline commit: `da75f11e`
Branch: `task/T-0034-mark-exhausted-delivery-rows`
Worktree: `.worktrees/T-0034-mark-exhausted-delivery-rows`

## Objective

Implement only D-0084's fixed `MARK_DELIVERED` outcome for supported inbox
rows already classified as exhausted before callback invocation.

## Human-Imposed Requirements Ledger

- Continue autonomously until all tasks complete or a real blocker appears.
- Use one branch/worktree per task, one implementation worker, and four
  independent reviewer lanes: code style/maintainability, documentation,
  TypeScript/API docs, and performance/reliability.
- Security review is deferred to final project readiness.
- Feed all findings to one fix worker and repeat all four lanes until clean.
- Close every subagent.
- Do not touch or rely on `human-review-1-jul.md`.
- Update durable task/work/review records with every change.
- Keep review packages and task scope small; run lightweight docs/status lint
  before reviewers and focused tests in inner loops.
- Reserve full `pnpm verify` for final and post-merge gates.
- Preserve Protobuf contracts and keep generated output out of VCS.
- Preserve end-user API constraints, removed aggregate import/`ImportBus`/
  aggregate `@Apply` roadmap, unsupported new `IMPORT_EVENT` writes, and
  pending/skipped `CATCH_UP`.
- Inspect relevant Spine JVM server source before implementation.

## Splitter Result

Requirements splitter `019f52ce-3b86-7a73-a69e-30208f5078b1` found no
blocker and recommended this as the smallest complete implementation after
T-0033. Existing delivery code already provides retry classification, active
claims, shard-fence synchronization, and internal claimed-row finalization.

## Implementation Skill Check

Implementation worker `019f52d4-d264-77e0-9469-48ff5950328a` completed the
canonical applicability check before test or production edits. Evidence came
from the session inventory, this task and prompt, `EXPECTED_SKILLS.md`, the full
readable `~/.agents/skills` entrypoint listing, and relevant entries in
`~/.agents/.skill-lock.json`; no source was unreachable.

Fully read and selected: `test-driven-development` for mandatory red-green
cycles; `implement` for scoped implementation, focused typechecks, verification,
and commit; `systematic-debugging` for root-cause investigation of unexpected
failures; `typescript-advanced-types` for strict type-safe narrowing without
assertion-heavy design; `javascript-testing-patterns` for focused Vitest
coverage; `receiving-code-review` for technically validating any later
findings; and `verification-before-completion` for fresh evidence before the
implementation commit. The duplicate `tdd` entrypoint was skipped in favor of
the explicitly required `test-driven-development`; `requesting-code-review` and
`subagent-driven-development` were skipped because this worker is explicitly
forbidden to spawn reviewers or subagents; `using-git-worktrees` was skipped
because the coordinator supplied and gated the existing worktree; and
`planning-with-files` and `architecture-decision-records` were skipped because
the task already has durable protocol records and requires a current-state
decision-log reconciliation, not a new decision or ADR.

## Scope

- Apply only to supported `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and
  `REACT_UPON_EVENT` rows already classified exhausted.
- Claim the exact row, synchronize it with the live shard fence, and finalize
  through the internal claimed-row `markDelivered` path.
- Share the same exhaustion action between shard and exact-message drains.
- Reconcile active public/protocol docs that currently say exhausted rows stay
  pending.

## Implementation Evidence

Before runtime edits, the implementation worker read the task-relevant delivery
notes in `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` and the actual
Spine JVM `DeliveryMonitor`, `FailedReception`, and `TargetDelivery` sources.
JVM `DeliveryMonitor.onReceptionFailure()` defaults to
`FailedReception.markDelivered()`, whose action marks the conveyor-owned row;
`TargetDelivery.MonitoringDispatcher` executes the selected action after a
failed dispatch outcome. The TypeScript implementation therefore uses only the
existing package-internal claimed-row finalizer after exact-row claim and live
shard-fence synchronization. It does not add the JVM public monitor, action,
repeat-dispatch, or conveyor API.

## Out Of Scope

- Retryable callback sequencing, attempt retention/storage/capacity, summary or
  classification changes, inbox storage contracts, public monitor/action APIs,
  immediate repeat, backoff/schedulers, dead-letter, cancellation, supervision,
  topology, adapters, catch-up execution, or Protobuf/API exports.

## Acceptance Criteria

- Exhausted rows are claimed and fence-synchronized before status mutation.
- Live competing claims skip without callback, attempt write, or unfenced
  mutation.
- Successful action invokes no callback, records no attempt, marks
  `DELIVERED`, and reports accepted 0, delivered 1, failed 0.
- Success consumes neither endpoint-work limit nor failure budget; later
  retryable work can run.
- Exact-message and shard drains use the same action.
- Failed exhaustion marking with successful cleanup reports one frozen,
  bounded, stack-free facts object and writes no attempt. If cleanup also
  fails, it preserves one `CLEANUP` result whose `AggregateError` contains the
  original mark error plus cleanup error, along with its existing retained-
  attempt behavior; that error has no frozen, bounded, or stack-free guarantee.
  Both paths count the failure budget once, report accepted/delivered 0, and
  leave the authoritative row `TO_DELIVER`.
- Claim/lease failures and retained-state corruption preserve current
  accounting/fail-closed behavior.
- Regressions preserve callback cleanup/finalization/one-attempt sequencing,
  attempt 100, and callback-success `STATUS_UPDATE` behavior.
- `CATCH_UP` and legacy `IMPORT_EVENT` behavior remain unchanged.
- No public export, Protobuf, generated-output, or end-user API change.

## Likely Files

- `packages/server/src/delivery/delivery.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `packages/server/test/delivery/delivery-loop.test.ts`
- delivery docs/TypeDocs that describe exhausted-row behavior
- `build-protocol/DECISION_LOG.md` and T-0034 durable records

## Verification Plan

- Focused worker/loop Vitest for exhaustion, retryable, cleanup, status update,
  claim/renewal, `CATCH_UP`, and legacy `IMPORT_EVENT`.
- `typecheck:build:generated`, `typecheck:tooling`, `docs:check`,
  `format:check`, `git diff --check`, and untracked-output check.
- Full `pnpm verify` only after clean four-lane review.

## Implementation Result

Worker `019f52d4-d264-77e0-9469-48ff5950328a` implemented the fixed internal
action with one shared shard/exact-message path. Exhausted supported rows are
claimed and synchronized to the live shard fence before the existing internal
claimed-row finalizer marks them delivered. Success invokes no endpoint,
retains no attempt, reports accepted 0 / delivered 1 / failed 0, and consumes
neither limit nor failure budget. Competing claims skip unchanged. A marker
failure followed by successful cleanup reports one frozen, bounded, stack-free
exhaustion-facts object and retains no attempt. Failed cleanup instead preserves
one `CLEANUP` result whose `AggregateError` contains the mark and cleanup errors,
along with its existing retained attempt, without promising that error is
frozen, bounded, or stack-free. Both paths consume one failure and leave
authoritative `TO_DELIVER`; claim/lease failures preserve existing bounded
attempt accounting. Broader failure-policy facilities remain deferred.

The coordinator-assigned pre-review payload fix now records exhausted
claim/lease/cleanup attempts from the existing payload-free exhaustion snapshot
instead of cloning the endpoint `Any.value`. Label/status validation and all
attempt/failure accounting remain unchanged. A maximum-payload regression keeps
the successful exhaustion coverage and proves the claim-failure retention path
also performs zero payload copies.

Round 1 fixes deepen active-claim finalization so the in-memory cleanup handle
is cleared only after a defined successful durable result. Thrown marks can be
cleaned and immediately redrained; an undefined mark followed by failed cleanup
retains one aggregated `CLEANUP` attempt/failure and consumes the loop budget
once. Successful callback `STATUS_UPDATE`, renewal/fencing, and concurrency
semantics remain unchanged. TypeDocs now cover callback-free delivered counts
and successful-exhaustion failure-budget exclusion, and snapshot docs distinguish
ordinary payload copies from payload-free exhaustion failures.

Focused worker/loop tests, build/tooling typechecks, focused ESLint, docs/API,
format, diff, and untracked-output checks are recorded in the implementation
report and work log. Full `pnpm verify` was not run, as directed.

The Round 6 documentation fix reconciles D-0084's final reviewer guidance with
T-0034: only the fixed internal pre-callback exhausted-row `MARK_DELIVERED`
outcome is executable/current. Public monitor and custom actions, repeat
dispatch, scheduler/backoff, dead-letter, supervision, topology, adapters, and
broader policy remain deferred. Fresh four-lane re-review is pending.

The Round 7 documentation fix qualifies the exhaustion mark-failure guarantee
throughout active TypeDoc/API prose. Successful cleanup exposes the frozen,
bounded, stack-free exhaustion facts. Failed cleanup instead preserves the
existing single `CLEANUP` result whose `AggregateError` contains both errors
without those guarantees. In both cases the authoritative row remains
`TO_DELIVER` and failure accounting remains one. Fresh four-lane re-review is
pending.
