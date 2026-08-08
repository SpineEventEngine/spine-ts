# T-0138: Authenticated Gateway Subscription Persistence

Status: Complete on stacked branch; shared verification awaits T-0139 and T-0142 consumers

## Objective

Persists one approved `spine.auth.GatewayAuthenticatedSubscription` per
authenticated subscription instead of invented Gateway binding, quota,
reservation, cleanup, fence, receipt, and fingerprint coordination records.

## Classification

High-risk. This task changes a serialized authentication record, expiry,
single-Gateway restart behavior, and provider customization across Auth and
Server packages.

## Baseline And Ownership

- Baseline: pushed T-0137 commit `258435c0`.
- Branch: `task/T-0138-authenticated-subscriptions`.
- Worktree: `.worktrees/T-0138-authenticated-subscriptions`.
- Ownership: authenticated-subscription code under `packages/auth/**`,
  `packages/server/src/server/durable-subscription-bindings.ts`, browser-server
  integration, narrow root exports, mirrored Server/Browser/Gateway tests,
  affected docs, and T-0138 records.
- Do not edit later delivery consumers, examples, JVM code, or introduce
  multiple-Gateway coordination.

## Frozen Human Requirements

- Persist the approved `GatewayAuthenticatedSubscription` directly.
- Its subscription ID, full subscription, and `when_expires` round-trip.
- Preserve the resolved Actor and Tenant in the Topic.
- Preserve expiry and single-Gateway restart behavior.
- Prove MySQL and Datastore customization reaches this record family.
- Remove quota, cleanup coordination, reservations, fences, admission tokens,
  principal fingerprints, receipts, and all other unapproved persistence.

## Architecture Assignment

- Existing role: `requirements_splitter`.
- Expected and explicitly dispatched profile: `gpt-5.6-sol` / `high`.
- Freeze the exact RecordSpec/ID/columns, create/read/delete/expiry/restart
  transitions, concurrency/idempotency behavior, provider selector keys,
  lifecycle, removal inventory, and precise disposition of current Gateway
  quota/cleanup options.
- Read-only; no edits, subagents, JVM work, or new public coordination API.

### Lifecycle Correction Assignment

- Existing role: `requirements_splitter`.
- Expected and explicitly dispatched profile: `gpt-5.6-sol` / `high`.
- Resolve only the demonstrated conflict between the finite per-ID pending
  bound and the mandatory Cancel-after-active cleanup sequence, while freezing
  operation timeout, shutdown joining, and admitted-operation tracking for the
  direct durable store.
- Read-only; no API expansion beyond the existing process-control limits, no
  persisted coordination, no subagents, and no JVM work.

### Lifecycle Correction Decision

- Mirror the existing in-memory admission rule: `pendingOperationLimit` counts
  queued work in addition to the currently running operation. With the default
  value `1`, one active operation and one queued Cancel are admitted; a third
  operation rejects as `binding-busy`. Cancel therefore retains its mandatory
  cleanup path without permitting an unbounded queue.
- Durable bindings reuse the three relevant fields from
  `SubscriptionGatewayLimits`: pending-operation, operation-timeout, and
  shutdown-timeout. They validate the same positive-safe-integer invariant.
  Request and backend-envelope byte limits remain owned by the Gateway; no
  durable-only named limit type or record is added.
- `operationTimeoutMs` bounds backend activation and cleanup callbacks using an
  AbortController. Storage operations are tracked but not timed individually,
  because an uncertain storage write cannot safely be treated as absent.
- Create, purge, recovery, and per-ID transitions register their outer promise
  in one running-work set. Close rejects new admission, aborts active backend
  callbacks, and waits for a snapshot of admitted work for at most
  `shutdownTimeoutMs`; timeout rejects rather than hanging, then closes only
  this record-storage handle. Durable rows are never deleted merely because
  shutdown timed out.
- Required RED cases prove: active plus queued Cancel succeeds; a third same-ID
  request is `binding-busy`; a timed-out callback is aborted and its row stays;
  close joins cooperative create/purge/recovery work; non-cooperative work
  produces a bounded shutdown failure; and no post-close work is admitted.

### Lifecycle Correction Implementation Handoff

- Existing role: `implementer`.
- Expected and explicitly dispatched profile: `gpt-5.6-terra` / `medium`.
- A fresh bounded implementation context owns only the unfinished outer-work
  tracking, close regressions, documentation/API corrections, and final scoped
  verification after the original context repeatedly stopped at the same
  close-tracking boundary.

## Implementation Acceptance Criteria

- A Gateway retains the approved record with the cloned subscription ID, full
  subscription (including trusted Actor and Tenant), and exact expiry timestamp.
- Create, cleanup-before-delete cancel, expiry, and restart recovery use the
  direct record with compare-and-set, and never retain a coordination row.
- Gateway operations continue to authenticate and compare the supplied Actor
  and Tenant with the resolved trusted context; an authenticated caller cannot
  operate a record for another context.
- MySQL and Datastore record selectors target only
  `GatewayAuthenticatedSubscriptionSchema`; no legacy selector remains.
- The public Auth contract no longer exposes fingerprints, reservations,
  capacity quotas, leases, fences, receipts, or durable control APIs.

## Skill Applicability

- Session inventory and task prompt were checked on 2026-08-08. Selected
  `test-driven-development` and `tdd` from
  `/Users/armiol/.agents/skills/` because this is a runtime behavior change;
  both bodies were read before code changes. The project manifest at
  `build-protocol/skills/EXPECTED_SKILLS.md`, a bounded installed-skill scan,
  and `/Users/armiol/.agents/.skill-lock.json` were also available.
- `using-git-worktrees` is N/A because the orchestrator already supplied the
  dedicated worktree. `subagent-driven-development` and
  `requesting-code-review` are N/A to this implementer role: no subagents may
  be spawned and review dispatch belongs to the orchestrator. Other expected
  skills do not govern this bounded runtime replacement.

## Verification And Review

- Required reviews: documentation, TypeScript/API docs,
  performance/reliability, and style/maintainability. Security is N/A unless a
  trust, credential, or authorization boundary changes.
- Required verification: focused TypeScript/tests, changed-source coverage at
  least 90% in every metric, approved-record/provider behavior, documentation
  gates, and one focused `verify:task` after convergence.

## Frozen Architecture Result

- Store exactly one `GatewayAuthenticatedSubscription` family under the cloned
  `SubscriptionId`. Source and record type are the approved schema; the sole
  provider column is numeric `when_expires`.
- Require record ID and subscription ID equality, preserve the full
  Subscription and exact Timestamp, and require atomic compare-and-set.
- Create is absent-to-present CAS with byte-equivalent uncertain-write
  reconciliation. Cancel invokes backend cleanup before exact CAS deletion;
  failure retains the row. Activate reads the canonical retained definition
  and does not mutate persistence.
- Expiry considers at most 25 earliest records ordered by `when_expires` then
  ID. Restart scans the complete family, removes expired rows after cleanup,
  and rehydrates every unexpired definition. Close joins local work and
  preserves durable rows.
- Keep one-Gateway per-ID operation serialization. Multiple Gateway processes
  remain unsupported; no persisted coordination is retained or invented.
- MySQL record-only `setTableName(GatewayAuthenticatedSubscriptionSchema, ...)`
  and Datastore record-only `useRecordStorage(...)` must reach the registry.
- Remove reservation/capacity APIs, binding limits, fingerprints, separate
  tenant fields, callback guards, quota/cleanup/control records, type URLs,
  revisions, phases, admission tokens, owners, leases, fences, cursors,
  backoffs, reasons, encoded-definition fields, receipts, and markers.
- Keep request/backend byte limits, per-ID pending-operation limit, operation
  timeout, and shutdown timeout because they are process resource controls.
- Security remains N/A: authentication, authorization, and trusted Actor/Tenant
  comparison are unchanged; only redundant durable identity is removed.

## 2026-08-08 Correction Closure

- Close now admits and tracks create, expiry purge, recovery, and per-ID work;
  it rejects later work, aborts active callbacks, joins cooperative work, bounds
  noncooperative work by `shutdownTimeoutMs`, closes its record-storage handle
  once, and retains durable rows.
- The accepted documentation/API corrections describe one direct
  `GatewayAuthenticatedSubscription`, trusted Actor/Tenant ownership,
  single-Gateway scope, the returned public Subscription, and the removed
  reservation export. They no longer describe cleaner takeover/fences, private
  binding envelopes, or a 100-binding capacity quota.
- Focused runtime coverage is above 90% in all metrics. Shared Server checks
  remain blocked only by the recorded later RecordSpec and browser-server
  diagnostics; TSDoc remains blocked only by recorded storage-rdbms debt.

## 2026-08-08 Final Reliability Correction

- Every direct read validates the requested storage ID against the retained
  record ID and nested Subscription ID. Purge and recovery validate each query
  slot before cleanup, deletion, or rehydration. A mismatch fails closed.
- Create validates its constructed approved record before CAS, preventing an
  actor-less Topic or unsafe expiry from becoming durable state.

## 2026-08-08 Final Review Corrections

- Invalid durable process limits now reject before storage opens. The temporary
  Auth limit-helper export was removed, so the public API inventory has no
  accidental addition.
- The User Guide and GKE deployment guide no longer configure the removed
  principal fingerprint collaborator. Server documentation now states the
  exact production `DurableSubscriptionBindings` requirement, and recovery
  TSDoc documents its expiry argument in epoch milliseconds.
- Per-ID queue capacity is released when queued work starts. The regression
  proves a new operation can queue behind the now-active operation while a
  further request still receives `binding-busy`.
- Durable options accept only the three process limits they use. Request and
  backend-envelope byte limits remain Gateway-owned.
