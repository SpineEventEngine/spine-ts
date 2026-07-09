# T-0017i Review Log

Status: approved

Scope: durable subscription records, recovery across `SpineServices` restarts,
activation/cancellation semantics, read-side segregation, docs/API updates, and
verification evidence.

## Required Lanes

| Lane                       | Reviewer ID                          | Status | Result   |
| -------------------------- | ------------------------------------ | ------ | -------- |
| Code style/maintainability | 019f462e-79f9-7da2-89be-cb5eebc30374 | Clean  | Approved |
| Documentation completeness | 019f4633-7f4f-77c0-aed8-dd48660416ba | Clean  | Approved |
| TypeScript/API docs        | 019f462e-e319-7882-8361-aaa88aa4942b | Clean  | Approved |
| Security                   | 019f462f-0e3c-7792-a6a6-04270433f49a | Clean  | Approved |
| Performance/reliability    | 019f462f-3bbe-76f0-904e-fb2190a63e8d | Clean  | Approved |

## Review Requirements

- Reviewers must explicitly check the task
  `Human-Imposed Requirements Ledger`.
- Reviewers must check that durable subscription recovery remains a read-side
  service concern and does not route through command/event buses or delivery
  inbox.
- Reviewers must check that recovered activation preserves tenant isolation,
  topic validation, and duplicate activation behavior.
- Reviewers must check that public docs distinguish durable inactive
  subscription records from process-local active streams and queued updates.

## Findings

Implementation sub-agent completed the first durable subscription recovery
slice. Reviewers should inspect:

- `packages/server/src/services/subscription-records.ts` for the private
  service-owned durable inactive subscription record codec and `RecordSpec`.
- `packages/server/src/services/spine-services.ts` for subscribe persistence,
  lazy recovered activation, cancellation/TTL/stream cleanup deletion, and
  preservation of read-side service ownership.
- `packages/server/src/context/bounded-context.ts` for the internal
  storage-factory accessor used by service adapters.
- `packages/server/test/services/spine-services.test.ts` for recovery,
  cancellation, TTL, duplicate activation, tenant, and existing subscription
  behavior coverage.
- `docs/USER_GUIDE.md`, `docs/api/README.md`,
  `docs/architecture/README.md`, and `packages/server/README.md` for the
  documented inactive-record durability boundary and active-stream/queued
  update non-goals.

Verification evidence recorded in
`build-protocol/work-logs/T-0017i.md`: typecheck passed, focused recovery tests
passed, subscription-focused tests passed with native loopback execution, docs
check passed with only the existing TypeDoc invalid-remote warning, whole-repo
`format:check` passed, and `git diff --check` passed.

## First-Round Reviewer Findings

1. Critical: recovered durable records remained in storage after activation, so
   another `SpineServices` adapter could recover the same subscription ID while
   the first stream was active.
2. Important/security: malformed durable records could throw out of recovery
   and remain poisoned for repeated failures. Recovery also needed to reject
   `stored.targetType` versus `stored.subscription.topic.target.type`
   inconsistency.
3. Important/API: `subscription-records.ts` used a public-looking
   `type.spine.io/spine.server.DurableSubscriptionRecord` type URL for an
   internal JSON-in-`Any` record instead of the repo's internal namespace
   pattern.
4. Docs: user-guide and API/architecture summaries needed to mention durable
   inactive subscription recovery explicitly and use "same storage factory"
   instead of loose "same context storage" phrasing where that boundary was
   intended.
5. Re-review follow-up: local in-memory activation also needed to consume the
   durable row before attachment, and recovered rows needed to reject tenant
   sidecar/topic mismatches.

## Fix Pass

- Addressed pending re-review: recovered activation now consumes the durable
  row with `RecordStorage.compareAndSet(id, durable, undefined)` before the
  live attachment is remembered.
- Addressed pending re-review: malformed, expired, and inconsistent durable
  rows now fail closed by deletion; no recovery exception escapes for those
  cases.
- Addressed pending re-review: the internal durable-record codec now uses
  `type.spine-ts.dev/internal/DurableSubscriptionRecord`.
- Addressed pending re-review: docs now describe the inactive-record durability
  boundary, the storage-factory requirement, and durable-row consumption on
  activation.
- Addressed pending re-review follow-up: local in-memory activation now
  consumes the durable row before attachment, preventing stale original-adapter
  replay after another adapter attempts recovery.
- Addressed pending re-review follow-up: recovered rows now reject and delete a
  tenant sidecar/topic mismatch.

## Verification Follow-Up

- Added regression coverage for cross-adapter duplicate activation after
  recovery, malformed durable-row cleanup, and stored-target-type mismatch
  cleanup.
- Red verification before the fix:
  - malformed-row recovery threw `Durable subscription record type URL is invalid.`
  - inconsistent stored-target/topic mismatch hung until timeout
  - cross-adapter duplicate recovery stayed active and timed out
- Green verification after the fix:
  - focused regressions passed
  - `pnpm --config.verify-deps-before-run=false typecheck:build` passed
  - `pnpm --config.verify-deps-before-run=false format:check` passed
  - `git diff --check` passed
  - required native coordinator rerun
    `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/services/spine-services.test.ts -t "subscription"`
    passed with 51 tests and 44 skipped tests
- Green verification after re-review follow-up:
  - focused second-pass regressions passed with 2 tests
  - full subscription-focused native coordinator rerun passed with 52 tests and
    45 skipped tests
  - `pnpm --config.verify-deps-before-run=false typecheck:build` passed
  - `pnpm --config.verify-deps-before-run=false format:check` passed
  - `git diff --check` passed

## Final Re-Review

- Code style/maintainability approved with no Critical, Important, or Minor
  findings.
- TypeScript/API docs approved with no Critical, Important, or Minor findings.
- Security approved with no Critical, Important, or Minor findings.
- Performance/reliability approved with no Critical, Important, or Minor
  findings.
- Documentation approved after a docs-only follow-up narrowed deferred
  subscription work to retained replay/cross-process stream ownership and
  rewrote the historical `format:check` note.
