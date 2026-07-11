# T-0028 Review Log

Status: Merged to main; post-merge verification passed

Task: `T-0028 Storage Keyset Continuation For Delivery Scans`

Branch: `task/T-0028-storage-keyset-continuation`

## Required Review Lanes

| Lane                       | Reviewer            | Status                  |
| -------------------------- | ------------------- | ----------------------- |
| Code style/maintainability | Wegener the 5th     | Post-final review clean |
| Documentation              | Leibniz the 5th     | Log-only fix verified   |
| TypeScript/API docs        | Locke the 5th       | Post-final review clean |
| Security                   | Kierkegaard the 5th | Post-final review clean |
| Performance/reliability    | Peirce the 5th      | Post-final review clean |

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

### Round 4 Independent Review - `2026-07-11T07:35:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..008cdf29.diff` from task baseline
  `652f75c7` to current HEAD `008cdf29`.
- Code style/maintainability (Hubble the 5th): [P3] the durable logs did not
  record the coordinator commit `008cdf29` after the Round 3 fix worker. The
  code spot checks were clean:
  `RecordQuery.ids` now says "Exact storage slot identifier filter", slot-ID
  filtering and copied-slot continuation remain correct, and the continuation
  seam is still small.
- Documentation (Boole the 5th): [P2] the durable logs stop at "No commit was
  made by this fix worker" and miss the post-fix coordinator commit plus fresh
  Round 4 review package generation; [P3] the required review-lane table is
  stale and still lists Round 2 statuses. Public docs and TypeDoc wording were
  otherwise clean and did not overclaim out-of-scope work.
- TypeScript/API docs (Epicurus the 5th): clean. `RecordQuery.ids` now matches
  storage slot-ID behavior; continuation types and `InboxReadContinuation`
  remain documented, exported, and API-check-listed; `offset` remains distinct;
  generated Protobuf output is absent; `git diff --check 652f75c7..008cdf29`
  was clean.
- Security (Zeno the 5th): clean. Continuation bounds, tenant/shard/status
  isolation, slot-ID query semantics, `CATCH_UP` skipping, legacy
  `IMPORT_EVENT` fail-closed behavior, and DoS bounds remain intact. Focused
  Vitest passed with 4 files and 211 tests.
- Performance/reliability (Goodall the 5th): clean. Pending scans use keyset
  `after` continuations instead of offsets, budgets and statuses remain
  bounded, storage ordering/filtering is slot-aware, focused Vitest passed with
  4 files and 211 tests, and `git diff --check 652f75c7..008cdf29` passed.
- Action: one fix worker will correct the durable-log commit/package evidence
  and required review-lane table, run required verification, commit, regenerate
  the review package, and rerun all five independent review lanes.

### Round 4 Log-Only Fix Worker - `2026-07-11T07:40:00Z`

- Status: verified. This worker is limited to durable-log files and is not
  editing code.
- Fix evidence is being recorded before/in the same work step as the table and
  status corrections. The chronology now explicitly records that the Round 3
  fix worker did not commit, then the coordinator committed
  `008cdf29` (`Clarify T-0028 storage query ids docs`) and generated
  `.superpowers/sdd/review-652f75c7..008cdf29.diff` for Round 4 review.
- The required review-lane table has been updated from stale Round 2 statuses
  to the Round 4 reviewer identities/results: code style/maintainability and
  documentation had log-only findings, while TypeScript/API docs, security,
  and performance/reliability were clean.
- Verification passed after the log-only fix:
  `pnpm --config.verify-deps-before-run=false format:check` passed, and
  `git diff --check` passed. T-0028 remains open for a fresh five-lane
  re-review; no code was edited and no commit was made by this worker.

### Round 5 Independent Review - `2026-07-11T07:50:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..6460e5aa.diff` from task baseline
  `652f75c7` to current HEAD `6460e5aa`.
- Code style/maintainability (Mendel the 5th): [P2] the durable logs did not
  record the coordinator commit `6460e5aa Record T-0028 Round 4 log review
fixes` or fresh Round 5 package generation after the Round 4 log-only worker.
  Code spot checks were clean: `RecordQuery.ids` says storage slot identifier,
  in-memory `ids` filtering compares `entry.slotId`, continuation tie-breaking
  uses storage slot IDs, and copied-slot tests cover the risks.
- Documentation (Hilbert the 5th): [P2] the durable logs did not record the
  Round 4 coordinator commit and Round 5 package. Round 3 chronology now
  records `008cdf29`, the lane table reflects Round 4 results, and no false
  completion or public-doc overclaim was found.
- TypeScript/API docs (Confucius the 5th): clean. `RecordQuery.ids`,
  `RecordContinuation.id`, and `InboxReadContinuation` docs match the public
  API; continuation exports and API checks are intact; no generated Protobuf
  output is present; `docs:check` passed with only the known TypeDoc invalid
  origin warning.
- Security (Rawls the 5th): clean. Continuation bounds, tenant/shard/status
  isolation, slot-ID query semantics, `CATCH_UP` skip behavior, legacy
  `IMPORT_EVENT` fail-closed behavior, and DoS scan bounds remain intact.
  Focused Vitest passed with 4 files and 211 tests.
- Performance/reliability (Fermat the 5th): clean. Keyset continuation replaces
  moving offset continuation in the delivery scan path; budgets, statuses,
  leases, claims, and slot-ID ordering/index semantics remain correct. Focused
  Vitest passed with 4 files and 211 tests.
- Action: one log-only fix worker will correct the current coordinator
  commit/package evidence and clarify log-only commit chronology, then run
  required verification. This worker will not commit or regenerate the package;
  after any future coordinator commit exists, that coordinator commit and fresh
  package must be recorded in the following review/fix entry before the next
  five-lane independent re-review is evaluated.

### Round 5 Log-Only Fix Worker - `2026-07-11T07:55:00Z`

- Status: verified. This worker is limited to durable-log files and is not
  editing code or committing.
- Chronology corrected: the Round 4 log-only fix worker did not commit. After
  that worker's verification passed, the coordinator committed
  `6460e5aa Record T-0028 Round 4 log review fixes`, generated fresh package
  `.superpowers/sdd/review-652f75c7..6460e5aa.diff`, and ran the Round 5
  five-lane independent review.
- Round 5 results are now reflected in the required review-lane table: code
  style/maintainability and documentation found the durable-log gap described
  above; TypeScript/API docs, security, and performance/reliability were clean.
- This entry deliberately does not name a future commit hash. Coordinator
  commits are recorded in the following review/fix entry after the hash exists;
  this Round 5 worker will leave the task open for coordinator action and fresh
  five-lane independent re-review.
- Verification passed after this log-only fix:
  `pnpm --config.verify-deps-before-run=false format:check` passed, and
  `git diff --check` passed. No code was edited and no commit was made by this
  worker.

### Round 6 Independent Review - `2026-07-11T08:05:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..ec6e515c.diff` from task baseline
  `652f75c7` to current HEAD `ec6e515c`.
- Code style/maintainability (Huygens the 5th): clean. Prior slot-ID
  filtering, continuation tie-break, copied-slot, and TypeDoc findings remain
  fixed. Durable logs now clearly state that log-only workers do not name a
  future commit hash and coordinator commit/package evidence is recorded in a
  following entry after the hash exists; `git diff --check
652f75c7..ec6e515c` passed.
- Documentation (Raman the 5th): clean. Round 3/4/5 chronology is coherent,
  lane table and statuses are not falsely complete, and public docs preserve
  offset support without overclaiming production adapters, retry, supervision,
  or broader delivery scope.
- TypeScript/API docs (Singer the 5th): clean. `RecordQuery.ids`,
  `RecordContinuation.id`, continuation exports, `InboxReadContinuation`,
  offset distinction, API docs, and generated-output hygiene are correct; `git
diff --check 652f75c7..HEAD` passed.
- Security (Euclid the 5th): clean. Continuation bounds, tenant/shard/status
  isolation, slot-ID query semantics, `CATCH_UP` skip behavior, legacy
  `IMPORT_EVENT` fail-closed behavior, and scan DoS bounds remain intact.
  Focused Vitest passed with 4 files and 211 tests.
- Performance/reliability (Helmholtz the 5th): clean. Delivery scans page with
  `after` rather than moving offsets, scan/read budgets remain bounded, loop
  cursors clear correctly, slot-ID ordering/filtering and logical record
  indexing remain correct, focused Vitest passed with 4 files and 211 tests,
  and `git diff --check 652f75c7..HEAD` passed.
- Action: proceed to final coordinator verification for T-0028.

### Post-Final-Fix Independent Review - `2026-07-11T08:25:00Z`

- Review package:
  `.superpowers/sdd/review-652f75c7..6e841c4e.diff` from task baseline
  `652f75c7` to current HEAD `6e841c4e`.
- Code style/maintainability (Wegener the 5th): clean. Obsolete test casts are
  removed except intentional invalid-input casts, public validation tests cover
  continuation mismatch branches, storage continuation uses slot IDs
  consistently, delivery scans continue with `after` keysets, full final
  verification evidence is recorded, self-hash convention is intact, and `git
diff --check 652f75c7..HEAD` passed.
- Documentation (Leibniz the 5th): [P2] work-log header was stale and still
  said Round 5; [P2] required review-lane table still showed Round 6 clean
  lanes even though final verification changed test files after Round 6. Public
  docs did not overclaim production adapters, retry/supervision, durable
  catch-up, or broader delivery scope; self-hash convention remained coherent.
- TypeScript/API docs (Locke the 5th): clean. `RecordQuery.ids` and
  `RecordStorage` docs match slot-ID semantics, `RecordQuery.after` remains
  distinct from `offset`, continuation types are exported and API-check-listed,
  remaining test casts are intentional negative runtime-validation inputs, no
  generated Protobuf output is present, focused ESLint on touched tests passed,
  and `git diff --check` passed.
- Security (Kierkegaard the 5th): clean. Continuation bounds, invalid-input
  tests, tenant/shard/status isolation, slot-ID semantics, `CATCH_UP` skip,
  legacy `IMPORT_EVENT` fail-closed behavior, DoS bounds, and unsafe-cast
  checks were clean. Focused Vitest passed with 4 files and 222 tests.
- Performance/reliability (Peirce the 5th): clean. Delivery scans remain
  bounded and offset-free, slot-ID query/index behavior is sound, coverage tests
  are meaningful rather than brittle, and full `verify` evidence is adequate:
  59 test files, 1239 tests, 90.02% branch coverage, and docs/API checks with
  only the known TypeDoc warning.
- Log-only fix: updated the work-log header, task/review statuses, and
  required review-lane table to reflect the post-final review. No code files
  were edited. Proceed to final coordinator verification.
