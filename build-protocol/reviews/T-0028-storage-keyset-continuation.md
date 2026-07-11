# T-0028 Review Log

Status: Round 1 fix verified; five-lane re-review pending

Task: `T-0028 Storage Keyset Continuation For Delivery Scans`

Branch: `task/T-0028-storage-keyset-continuation`

## Required Review Lanes

| Lane                       | Reviewer  | Status                           |
| -------------------------- | --------- | -------------------------------- |
| Code style/maintainability | Nietzsche | Round 1 fix; re-review pending   |
| Documentation              | Rawls     | Round 1 fix; re-review pending   |
| TypeScript/API docs        | Banach    | Round 1 clean; re-review pending |
| Security                   | Singer    | Round 1 fix; re-review pending   |
| Performance/reliability    | Leibniz   | Round 1 clean; re-review pending |

## Review Criteria

- Check the Human-Imposed Requirements Ledger in the task brief.
- Verify the storage continuation seam is the smallest useful extension of
  `RecordQuery`/`RecordStorage`, and existing `offset` behavior remains
  available.
- Verify in-memory storage implements continuation deterministically across
  filters, sorting, ties, limits, masks, and tenant slices.
- Verify delivery scans no longer depend on moving absolute pending-row offsets
  for continuation, while preserving scan bounds, accepted-work limits,
  failure bounds, shard leases, and per-message claims.
- Verify `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT` remain
  the only supported worker replay labels.
- Verify valid `CATCH_UP` rows remain pending/skipped before callback
  invocation, row acceptance, failure recording, and failure-budget
  consumption.
- Verify new `IMPORT_EVENT` writes remain unsupported and legacy stored
  `IMPORT_EVENT` rows fail closed.
- Reject production storage adapters, broad query planners, retry monitors,
  retained attempt history, worker supervision, ZeroMQ topology, durable
  catch-up storage, `ImportBus`, aggregate import/importers, and aggregate
  `@Apply` work.

## Rounds

### Implementation Worker Self-Review - `2026-07-11T06:50:00Z`

- The implementation worker fixed two issues before committing `080a2fda`: a
  stale `Promise<boolean>` return from `Delivery.#tryDrainMessage()` and a
  delivery storage fault fixture type error around the `after` marker.
- These were implementation-worker self-review findings, not substitutes for
  the five required independent review lanes.

### Round 1 Independent Review - `2026-07-11T06:55:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..080a2fda.diff` from task baseline
  `652f75c7` to current HEAD `080a2fda`.
- Code style/maintainability (Nietzsche the 4th): [P2]
  `RecordContinuation.id` is documented as an actual storage slot identifier,
  and `queryEntries()` returns `entry.slotId`, but in-memory continuation
  tie-breaking compares the logical record ID materialized from the stored
  record body. Fix by making in-memory ordering operate on `StoredEntry`, using
  `entry.stored` for configured sort fields and `entry.slotId` for the final
  tie-breaker and continuation comparison. Add a regression for a copied
  storage slot sharing a sort key with another row.
- Documentation (Rawls the 4th): [Major] Review-log durable state prematurely
  marked required lanes clean using implementation-worker rechecks for security
  and performance/reliability. Fix by recording the actual independent reviewer
  identities/results and keeping unresolved findings pending until the full fix
  loop and re-review complete. Public documentation content was otherwise
  clean.
- TypeScript/API docs (Banach the 4th): clean. `RecordContinuation`,
  `RecordContinuationValue`, and `InboxReadContinuation` are exported and
  documented consistently; offset behavior is preserved; API export checks
  passed.
- Security (Singer the 4th): [Medium] Inbox continuation values are
  insufficiently bounded. Apply the same stored-text budget used for inbox
  message IDs to continuation `messageId`, bound `version.toString()` length
  before accepting a bigint, and apply the same bounds to internal delivery
  resume cursor validation.
- Performance/reliability (Leibniz the 4th): clean. Keyset continuation removes
  moving-offset scan hazards while preserving scan budgets, limits, loop
  statuses, leases, active claims, and skipped-row bounds.
- Action: one fix worker will address all Round 1 findings, update durable
  logs, run focused verification, commit, regenerate the review package, and
  rerun all five independent review lanes.

### Round 1 Fix Worker - `2026-07-11T06:54:00Z`

- Code style/maintainability fix: `TenantRecords` ordering now operates on
  `StoredEntry`, using `entry.stored` for configured sort fields and
  `entry.slotId` for the final tie-breaker and `RecordContinuation.id`
  comparison. Added a regression where a copied storage slot shares a sort key,
  page 1 captures the copied slot ID from `queryEntries()`, and page 2
  continues to the next row.
- Security fix: public inbox read continuations now reject oversized
  continuation `messageId` values and oversized `version.toString()` values
  before opening record storage. Internal delivery resume cursor validation
  applies the same 16 KiB stored-text bounds before resuming a scan.
- Documentation/durable-records fix: this review log, task brief, and work log
  now record the Round 1 findings and fix evidence without marking T-0028
  complete or any lane clean after the fix.
- Red checks failed before production edits for the expected reasons: copied
  storage slots were ordered by logical record ID, public inbox continuation
  bounds resolved instead of rejecting, and internal delivery resume cursor
  bounds resolved instead of rejecting.
- Green verification after the fix batch passed for the focused regressions and
  the required suite:
  `pnpm --config.verify-deps-before-run=false exec vitest run
packages/storage/test/memory/in-memory-record-storage.test.ts
packages/server/test/delivery/inbox.test.ts
packages/server/test/delivery/delivery-worker.test.ts
packages/server/test/delivery/delivery-loop.test.ts`,
  `pnpm --config.verify-deps-before-run=false typecheck:build:generated`,
  `pnpm --config.verify-deps-before-run=false docs:check`,
  `pnpm --config.verify-deps-before-run=false format:check`, and
  `git diff --check`.
- Action: commit the verified fix, regenerate the review package, and rerun all
  five independent review lanes. No lane is marked clean by this fix worker.
