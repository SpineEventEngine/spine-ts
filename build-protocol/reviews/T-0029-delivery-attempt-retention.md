# T-0029 Review Log

Status: Round 3 fixes verified; pending re-review

Task: `T-0029 Delivery Attempt Retention`

Branch: `task/T-0029-delivery-attempt-retention`

## Required Review Lanes

| Lane                       | Reviewer       | Status   |
| -------------------------- | -------------- | -------- |
| Code style/maintainability | Bacon the 5th  | Findings |
| Documentation              | Parfit the 5th | Findings |
| TypeScript/API docs        | Volta the 5th  | Findings |
| Security                   | Dalton the 5th | Clean    |
| Performance/reliability    | Erdos the 5th  | Clean    |

## Review Criteria

- Check the Human-Imposed Requirements Ledger in the task brief.
- Verify retained delivery-attempt history is internal, bounded, and sanitized.
- Verify retained records do not include raw `Any.value` payload bytes, user
  error objects, stack traces, or unbounded exception text.
- Verify failed rows remain `TO_DELIVER` and the task does not add immediate
  retry, backoff, scheduler policy, monitor callbacks, cancellation, or worker
  supervision.
- Verify `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, and `REACT_UPON_EVENT` are the
  only supported endpoint labels that can produce endpoint attempt records.
- Verify valid worker-unsupported `CATCH_UP` rows remain pending/skipped and do
  not create retained endpoint attempts.
- Verify new `IMPORT_EVENT` writes remain unsupported and legacy stored
  `IMPORT_EVENT` rows fail closed without retained attempts.
- Verify docs accurately name retained attempt history as present while keeping
  retry monitors, production supervision, topology, durable catch-up storage,
  production storage adapters, import work, and aggregate `@Apply` delivery out
  of scope.

## Rounds

### Round 1 Independent Review - `2026-07-11T08:05:00Z`

- Review package:
  `.superpowers/sdd/review-3820e76d..d1d31e7c.diff` from task baseline
  `3820e76d` to current HEAD `d1d31e7c`.
- Code style/maintainability (Cicero the 5th): [P2] durable logs did not
  demonstrate ledger compliance because participants/review state were stale;
  [P2] malformed durable attempt records used plain `Error` instead of the
  delivery storage corruption pattern; [P3] `Delivery.drain()` TypeDoc still
  said endpoint attempt history is not retained.
- Documentation (Pascal the 5th): [P1] stale `Delivery.drain()` API docs still
  said attempt history is not retained; [P1] task/review logs were stale and
  the work log falsely claimed completion while required reviews were pending;
  [P2] the work-log commit ledger did not name `7b07cacd` and `d1d31e7c`.
- TypeScript/API docs (Laplace the 5th): [P2] stored attempt reads decode and
  parse `Any.value` before a total byte-size cap; [P3] stored timestamps can
  rehydrate to invalid `Date` values; [P3] `Delivery.drain()` TypeDoc
  contradicts the new retention behavior. No accidental public
  `DeliveryMonitor`, `FailedReception`, or retry API was found.
- Security (Lovelace the 5th): [High] retained attempt history and sequence
  lookup are unbounded for repeatedly failing rows; [Medium] corrupt attempt
  records decode/parse unbounded `Any.value` before size rejection; [Medium]
  stored attempt identity is not cross-checked for internal consistency.
  Payload bytes, raw user errors, stacks, `CATCH_UP`, and legacy
  `IMPORT_EVENT` paths otherwise looked clean.
- Performance/reliability (Hegel the 5th): [P1] attempt-recording failure can
  bypass delivery failure accounting because `#recordFailedAttempt()` is
  awaited before building `DeliveryRun` failures or recording loop progress;
  [P1] attempt writes are unbounded for repeatedly failing rows because
  `nextSequence()` reads all prior attempts without a limit.
- Action: one fix worker will address all Round 1 findings, update durable
  logs, run focused verification, commit, regenerate the review package, and
  rerun all five independent review lanes.

### Round 1 Fix Worker Start - `2026-07-11T08:06:00Z`

- Coordinator committed the Round 1 findings as
  `adf215f3 Record T-0029 Round 1 review findings`.
- Fix worker started from `adf215f3` with the complete findings list from all
  five lanes. Current review state remains pending until a verified fix commit
  is produced and a fresh re-review is requested.

### Round 1 Fix Worker Local Verification - `2026-07-11T08:08:00Z`

- Fix worker addressed the full Round 1 findings list and ran focused red/green
  regressions plus the required verification commands. The task remains pending
  re-review; no review lane is marked clean by this log entry.
- Fix worker committed the verified fix batch as
  `ecb9f3d9 Fix T-0029 delivery attempt retention findings`. A fresh package
  and all five review lanes remain required.

### Round 2 Independent Review - `2026-07-11T08:19:59Z`

- Review package:
  `.superpowers/sdd/review-3820e76d..1faafdb0.diff` from task baseline
  `3820e76d` to current HEAD `1faafdb0`.
- Code style/maintainability (Descartes the 5th): [P2] the task brief still
  said the Round 1 fix worker was in progress even though `ecb9f3d9` had been
  committed and the worker had been closed. The malformed-attempt corruption
  error pattern, `Delivery.drain()` TypeDoc, and scope boundaries otherwise
  looked clean.
- Documentation (Aristotle the 5th): [P1] durable logs omitted the current
  `1faafdb0` coordinator commit and still described the next step as generating
  a fresh review package even though
  `.superpowers/sdd/review-3820e76d..1faafdb0.diff` had already been generated;
  [P2] the task current-review state still described the Round 1 fix worker as
  in progress. Public docs and `Delivery.drain()` TypeDoc otherwise looked
  accurate.
- TypeScript/API docs (Sartre the 5th): clean. Stored-attempt byte caps,
  timestamp validation, TypeDoc, public exports, root TypeDoc entrypoints,
  supported labels, `Date`/`Any` handling, bounded retention, and generated
  Protobuf hygiene looked sound.
- Security (`019f503c-f60c-7a32-9471-8eb77648a9ee`): clean. Bounded retention,
  byte caps before decode/parse, identity validation, storage-corruption
  errors, sanitization, tenant scoping, `CATCH_UP`, and legacy `IMPORT_EVENT`
  handling looked sound. The reviewer also passed a focused sanity slice
  covering attempts, unsupported labels, and live ownership.
- Performance/reliability (Dirac the 5th): [P2] `DeliveryAttempts.nextSequence()`
  still uses `queryEntries({ filters: messageKey, sort: sequence desc, limit:
1 })`; the query result is bounded, but the current in-memory adapter
  materializes, filters, and sorts records before applying `limit`, making each
  failed-delivery hot path scan global retained-attempt storage. Attempt-write
  failure accounting, `TO_DELIVER` semantics, unsupported label skips,
  fail-closed `IMPORT_EVENT`, failure classifications, and scope boundaries
  otherwise looked clean.
- Action: one Round 2 fix worker will update durable logs, replace the
  sequence lookup with bounded slot reads or equivalent bounded behavior, run
  focused verification, commit, regenerate the review package, and rerun all
  five independent review lanes.

### Round 2 Fix Status

- Starting point: `02917d0d Record T-0029 Round 2 review findings`.
- Fix worker scope: update durable logs and replace
  `DeliveryAttempts.nextSequence()` hot-path attempt-storage query with bounded
  per-message slot reads. No storage adapter query-planner work, retry monitor,
  scheduler, production adapter, durable catch-up, public API, or
  `IMPORT_EVENT` support is part of this fix.
- Regression evidence so far: the focused test
  `uses bounded slot reads when recording repeated attempts` failed before
  production edits because two `limit: 1` attempt-storage `queryEntries` calls
  were observed, then passed after sequence discovery switched to direct reads
  of the 100 known per-message retention slots.
- Verification: required focused Vitest, `typecheck:build:generated`,
  `docs:check`, `format:check`, and `git diff --check` passed after the Round
  2 fix; `docs:check` emitted only the existing TypeDoc invalid-origin warning.
- Status: after the Round 2 fix commit, T-0029 remains pending a fresh review
  package and re-review.

### Round 2 Fix Commit Record

- Round 2 fix worker committed `0070e853 Fix T-0029 round 2 attempt retention`
  and was closed after reporting `DONE`.
- The fix replaced retained-attempt sequence discovery with bounded direct
  reads of the 100 known per-message retention slots and tightened regression
  coverage so repeated failed deliveries must not call attempt-storage
  `queryEntries` on the hot path.
- Status: pending fresh review package and all five independent review lanes.

### Round 3 Independent Review - `2026-07-11T08:35:00Z`

- Review package:
  `.superpowers/sdd/review-3820e76d..68e0d96c.diff` from task baseline
  `3820e76d` to current HEAD `68e0d96c`.
- Code style/maintainability (Bacon the 5th): [P2] durable logs still did not
  reflect current review package/head `68e0d96c` and still described a fresh
  review package as pending. Bounded slot reads, public API boundaries, and
  generated Protobuf hygiene looked clean.
- Documentation (Parfit the 5th): [P1] durable logs omitted coordinator commit
  `68e0d96c`; [P2] work-log timestamps around the Round 2 fix mixed local
  `09:xx` values with a `Z` suffix, making the fix appear to commit before it
  started. Public docs and `Delivery.drain()` TypeDoc looked accurate.
- TypeScript/API docs (Volta the 5th): [P2] `requireSequence()` accepts any
  finite integer instead of requiring a safe integer, so corrupt stored attempt
  records can pass identity validation with imprecise sequence arithmetic.
  Bounded slot reads, ring keys, identity checks, `Date`/`Any` handling,
  supported labels, public exports, TypeDoc, and generated Protobuf hygiene
  otherwise looked sound.
- Security (Dalton the 5th): clean. Bounded slot reads, byte caps,
  identity/shard/inbox validation, sanitization, tenant scoping, unsupported
  labels, `CATCH_UP`, legacy `IMPORT_EVENT`, and observational attempt
  recording looked sound.
- Performance/reliability (Erdos the 5th): clean. The hot-path query scan is
  fixed with direct slot reads; attempt writes remain bounded, failure
  accounting and `TO_DELIVER` semantics are preserved, skip paths do not retain
  attempts, and no public retry/topology/scheduler behavior was introduced.
- Action: one Round 3 fix worker will update durable logs, add fail-closed
  safe-integer sequence validation with focused regression coverage, run
  focused verification, commit, regenerate the review package, and rerun all
  five independent review lanes.

### Round 3 Fix Status

- Starting point: `b286ba05 Record T-0029 Round 3 review findings`.
- Fix worker scope: update durable logs and make stored retained-attempt
  sequence validation reject unsafe integers with
  `DeliveryStorageCorruptionError`. No retry monitor, scheduler, public API,
  production adapter, topology, durable catch-up, generated Protobuf output, or
  `IMPORT_EVENT` support is part of this fix.
- Regression evidence: the focused test
  `fails closed when stored delivery attempt sequences are unsafe integers`
  first failed because an unsafe sequence with a matching retention slot
  resolved as a retained attempt, then passed after `requireSequence()` started
  using `Number.isSafeInteger()` before the positive-sequence check.
- Verification: required focused Vitest passed with 2 files, 19 tests run, and
  161 skipped. `typecheck:build:generated` passed. `docs:check` passed with
  the existing TypeDoc invalid-origin warning only. Generated Protobuf output
  remains out of VCS.
- Status: fix commit recorded; pending fresh review package and re-review.

### Round 3 Fix Commit Record

- Round 3 fix worker committed `2d3ca14d Fix T-0029 round 3 attempt retention`
  and was closed after reporting `DONE`.
- The fix added fail-closed `Number.isSafeInteger()` validation for stored
  retained-attempt sequences and focused regression coverage for unsafe
  sequence corruption.
- Status: pending fresh review package and all five independent review lanes.
