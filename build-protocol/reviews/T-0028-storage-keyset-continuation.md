# T-0028 Review Log

Status: Round 3 TypeDoc fix verified; five-lane re-review pending

Task: `T-0028 Storage Keyset Continuation For Delivery Scans`

Branch: `task/T-0028-storage-keyset-continuation`

## Required Review Lanes

| Lane                       | Reviewer      | Status                           |
| -------------------------- | ------------- | -------------------------------- |
| Code style/maintainability | Planck        | Round 2 fix; re-review pending   |
| Documentation              | Chandrasekhar | Round 2 fix; re-review pending   |
| TypeScript/API docs        | Hubble        | Round 2 clean; re-review pending |
| Security                   | Maxwell       | Round 2 clean; re-review pending |
| Performance/reliability    | Jason         | Round 2 clean; re-review pending |

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

### Round 1 Fix Worker - `2026-07-11T06:56:00Z` (corrected approximate)

- This corrected approximate timestamp replaces the earlier pre-review
  timestamp and preserves the durable order: Round 1 independent review,
  fix-worker red checks, fix implementation, required verification, commit,
  coordinator verification, then fresh re-review.
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

### Round 2 Independent Review - `2026-07-11T07:05:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..080aa1ab.diff` from task baseline
  `652f75c7` to current HEAD `080aa1ab`.
- Code style/maintainability (Planck the 4th): [P2] `RecordQuery.ids` still
  filters against the logical record ID inside the slot-aware in-memory query
  path. `queryEntries()` and continuation now expose/use `entry.slotId`, but
  `matchesIds()` still compares `query.ids` to `StoredRecord.id`. Fix by
  passing `StoredEntry` into matching and comparing `RecordQuery.ids` against
  `entry.slotId`. Add a regression where a copied storage slot is selected
  through `queryEntries({ ids: [copiedSlotId] })`.
- Documentation (Chandrasekhar the 4th): [Major] durable review chronology is
  still inconsistent. Round 1 independent review is recorded at
  `2026-07-11T06:55:00Z`, but the Round 1 fix-worker red/green/final
  verification entries are recorded at `06:53Z` and `06:54Z`. Fix by correcting
  the fix-worker timestamps or explicitly marking them corrected/approximate
  while preserving the ordering: independent review, fix worker, verification,
  fresh re-review pending.
- TypeScript/API docs (Hubble the 4th): clean. Continuation types are minimal,
  documented, exported, API-check-listed, distinct from `offset`, and generated
  outputs are not in the diff.
- Security (Maxwell the 5th): clean. Public and internal continuation values
  are bounded before storage access, tenant/shard/status isolation remains
  intact, `CATCH_UP` still skips before endpoint accounting, and legacy
  `IMPORT_EVENT` remains fail-closed.
- Performance/reliability (Jason the 5th): clean. Delivery scans use keyset
  continuation, scan bounds and loop statuses are preserved, and tests cover
  copied slots, disappearing rows, claimed rows, unsupported rows, corruption,
  tenant/filter ordering, continuation bounds, and skipped-scan pause/resume.
- Action: one fix worker will address both Round 2 findings, update durable
  logs, run focused verification, commit, regenerate the review package, and
  rerun all five independent review lanes.

### Round 2 Fix Worker - `2026-07-11T07:10:00Z`

- Status: in progress. The fix worker started after the Round 2 independent
  review and added the copied-slot `RecordQuery.ids` regression before
  production edits.
- Focused red verification failed for the expected reason:
  `queryEntries({ ids: [copiedSlotId] })` returned `[]` for a copied storage
  slot. The production fix now passes `StoredEntry` into query matching and
  compares `RecordQuery.ids` against `entry.slotId`, while keeping
  `resolveValue(..., "id")` behavior unchanged.
- Focused green verification passed for the same copied-slot ids regression.
- Required verification passed after the Round 2 fix batch:
  `pnpm --config.verify-deps-before-run=false exec vitest run
packages/storage/test/memory/in-memory-record-storage.test.ts
packages/server/test/delivery/inbox.test.ts
packages/server/test/delivery/delivery-worker.test.ts
packages/server/test/delivery/delivery-loop.test.ts` passed with 4 files and
  211 tests; `pnpm --config.verify-deps-before-run=false
typecheck:build:generated` passed; `pnpm --config.verify-deps-before-run=false
docs:check` passed with the known TypeDoc invalid-origin source-link warning;
  `pnpm --config.verify-deps-before-run=false format:check` passed after
  formatting the work log; and `git diff --check` passed.
- T-0028 remains open for fresh five-lane independent re-review; no lane is
  marked clean by this fix worker.

### Round 3 Independent Review - `2026-07-11T07:25:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..de1b9218.diff` from task baseline
  `652f75c7` to current HEAD `de1b9218`.
- Code style/maintainability (Halley the 5th): [P3] `RecordQuery.ids` still
  says only "Exact identifier filter" in the canonical public property
  TypeDoc. The implementation now correctly filters storage slot IDs, and
  `RecordStorage.query()` / `queryEntries()` document that behavior. Tighten
  the property comment to say "Exact storage slot identifier filter" or
  equivalent.
- Documentation: clean. Durable chronology now preserves review, fix,
  verification, and re-review order; status does not mark T-0028 complete; and
  public docs do not overclaim production adapters or out-of-scope delivery
  work.
- TypeScript/API docs: clean. Continuation types and `InboxReadContinuation`
  are exported, documented, and API-check-listed; `offset` remains distinct;
  API docs passed with only the known TypeDoc invalid-origin warning; no
  generated Protobuf output is present.
- Security: clean. Continuation bounds, tenant/shard/status isolation,
  `CATCH_UP` skip semantics, legacy `IMPORT_EVENT` fail-closed behavior, and
  scan DoS bounds remain intact.
- Performance/reliability: clean. Keyset continuation removes moving-offset
  hazards, scan/read budgets remain bounded, leases/claims/statuses are
  preserved, slot-ID filtering does not regress ordering/index behavior, and
  focused Vitest passed with 4 files and 211 tests.
- Action: one fix worker will update the `RecordQuery.ids` property TypeDoc,
  run required verification, commit, regenerate the review package, and rerun
  all five independent review lanes.

### Round 3 Fix Worker - `2026-07-11T07:30:00Z`

- Status: verified. The fix worker started after the Round 3 independent
  review and updated the canonical `RecordQuery.ids` property TypeDoc from
  "Exact identifier filter" to "Exact storage slot identifier filter."
- This is a docs/API comment-only fix. Required focused verification passed:
  `pnpm --config.verify-deps-before-run=false docs:check` passed with the known
  TypeDoc invalid-origin source-link warning; `pnpm
--config.verify-deps-before-run=false format:check` passed; and `git diff
--check` passed.
- No commit was made by this fix worker.
- T-0028 remains open for fresh five-lane independent re-review; no lane is
  marked clean by this fix worker.
