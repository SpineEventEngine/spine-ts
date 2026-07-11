# T-0034: Mark Exhausted Delivery Rows

Status: Implementation in progress
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

## Scope

- Apply only to supported `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and
  `REACT_UPON_EVENT` rows already classified exhausted.
- Claim the exact row, synchronize it with the live shard fence, and finalize
  through the internal claimed-row `markDelivered` path.
- Share the same exhaustion action between shard and exact-message drains.
- Reconcile active public/protocol docs that currently say exhausted rows stay
  pending.

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
- Failed exhaustion marking reports one bounded, frozen, stack-free sanitized
  failure, counts failure budget once, reports accepted/delivered 0, leaves the
  authoritative row `TO_DELIVER`, and writes no attempt.
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
