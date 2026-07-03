# T-0012.8: Delivery And Inbox

Status: round-43 fix committed and verified at `4307077`
Start: `2026-07-02 07:52 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Baseline commit: `de3ccc7`

## Goal

Add the first small durable delivery slice after repositories can receive
signals.

## JVM Evidence

- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` says
  `InboxMessage` is the durable delivery record and that delivery deduplicates
  by `(signal_id, inbox_id)`, not by record ID alone.
- The same document says `DeliveryStrategy.determineIndex(entityId,
entityStateType)` returns a zero-based shard index and that all messages for
  one target entity should map to one shard unless a custom strategy
  deliberately changes the trade-off.
- Shard pickup must use compare-and-set semantics in backing storage; Node
  multi-process deployment cannot rely on in-process locks.
- The local JVM source tree under
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/delivery`
  did not contain the concrete delivery Java sources in this session, so the
  checked-in research docs are the source baseline.
- The local delivery proto directory under
  `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/delivery`
  was present in this session but contained no proto files.

## Scope

- Add `packages/server/src/delivery` with small `Inbox`, `Delivery`,
  `InboxStorage`, shard index/session, and delivery status/label concepts as
  needed for this first slice.
- Build durable inbox storage over the existing `StorageFactory` /
  `RecordStorage` seam.
- Support writing inbox messages with target inbox identity, original signal
  identity, label, status, shard, received time, ordering version, and optional
  dedup retention.
- Support deduplication by `(signal ID, inbox ID)` for live inbox writes.
- Support shard pickup/release with a storage-backed record so the API is not
  just an in-process lock.
- Keep worker loops, retry monitors, conveyor/stations, repository invocation,
  `Stand`, gRPC services, transport retries, and example app work out of this
  slice.
- Keep APIs short, JVM-familiar, and source/test files grouped by semantics.
- No exported standalone helpers unless a strong reason is recorded.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Required Verification

- Focused delivery/inbox tests.
- Typecheck, lint, tracked formatting, docs/API, and diff hygiene.
- Broader verification if the implementation touches shared storage behavior.

## Current State

- Implementation sub-agent completed and was closed after committing
  `0f7986a`.
- Review round 1 completed with changes requested across all five required
  lanes.
- All five round-1 reviewer sub-agents were closed after their reports were
  collected.
- Consolidated round-1 fix sub-agent completed and was closed after committing
  `c2553cf`.
- Round-2 review completed with changes requested across all five required
  lanes.
- All five round-2 reviewer sub-agents were closed after their reports were
  collected.
- Consolidated round-2 fix sub-agent completed and was closed after committing
  `59a6530`.
- Round-3 review completed with changes requested in maintainability,
  documentation, security, and performance/reliability. The TypeScript/API docs
  lane was clean.
- All five round-3 reviewer sub-agents were closed after their reports were
  collected.
- Consolidated round-3 fix sub-agent completed and was closed after committing
  `76e9132`.
- Round-4 review package is prepared at
  `.superpowers/sdd/review-60c5412..76e9132.diff`.
- Round-4 review completed with one security finding. The other four required
  lanes were clean.
- All five round-4 reviewer sub-agents were closed after their reports were
  collected.
- Round-4 fix implemented in this worktree: direct inbox writes now reject
  mismatched message ID shard/message shard identities, and stored inbox record
  parsing validates canonical record and inbox keys.
- Round-4 fix committed as `d0d5e0d`.
- Round-5 review package is prepared at
  `.superpowers/sdd/review-f74df5d..d0d5e0d.diff`.
- Round-5 review completed with TypeScript/API docs and performance/reliability
  findings. Maintainability and security were clean. Documentation findings
  were stale against the already committed round-5 prep state.
- All five round-5 reviewer sub-agents were closed after their reports were
  collected.
- Round-5 fix implemented in this worktree: exported delivery docs now state
  the shard invariant, and caller-side shard mismatch uses a plain invariant
  error rather than a storage corruption error.
- Round-5 fix committed as `05f2ca7`.
- Round-6 review package is prepared at
  `.superpowers/sdd/review-f924a17..05f2ca7.diff`.
- Round-6 review completed with one TypeScript/API docs finding. The other
  four required lanes were clean.
- All five round-6 reviewer sub-agents were closed after their reports were
  collected.
- Round-6 fix implemented in this worktree by preserving the
  `DeliveryStorageCorruptionError` contract for direct write shard mismatches.
- Round-6 fix committed as `d8cfb5b`.
- Round-7 review package is prepared at
  `.superpowers/sdd/review-1879916..d8cfb5b.diff`.
- Round-7 review completed with TypeScript/API docs and security findings.
  Maintainability, documentation, and performance/reliability were clean.
- All five round-7 reviewer sub-agents were closed after their reports were
  collected.
- Round-7 fix implemented in this worktree: `InboxMessageError` now represents
  invalid caller-supplied inbox messages, including shard mismatch.
- Round-7 fix committed as `e7f7b05`.
- Round-8 review package is prepared at
  `.superpowers/sdd/review-8a468ff..e7f7b05.diff`.
- Round-8 review completed with one security finding. The other four required
  lanes were clean.
- All five round-8 reviewer sub-agents were closed after their reports were
  collected.
- Round-8 fix implemented in this worktree: direct writes validate the inbox
  message shard invariant before any dedup lookup or duplicate short-circuit.
- Round-8 fix committed as `65e5c72`.
- Round-9 review package is prepared at
  `.superpowers/sdd/review-7ddf9f5..65e5c72.diff`.
- Round-9 review completed with maintainability, security, and
  performance/reliability findings. TypeScript/API docs was clean.
  Documentation findings were stale against the already committed round-9 prep
  state.
- All five round-9 reviewer sub-agents were closed after their reports were
  collected.
- Round-9 fix implemented in this worktree: the shard invariant check is local
  to `InboxStorage.write()` and the shared serializer path, without exporting a
  helper.
- Round-9 fix committed as `1d4db77`.
- Round-10 review package is prepared at
  `.superpowers/sdd/review-b5fa82a..1d4db77.diff`.
- Round-10 review completed with maintainability, security, and
  performance/reliability findings. Documentation and TypeScript/API docs were
  clean.
- All five round-10 reviewer sub-agents were closed after their reports were
  collected.
- Round-10 fix implemented in this worktree: final dedup serializer validates
  the inbox message shard invariant, and direct dedup serializer tests cover
  caller bypass attempts.
- Round-10 fix committed as `d419fd8`.
- Round-11 review package is prepared at
  `.superpowers/sdd/review-fce80b2..d419fd8.diff`.
- Round-11 review completed with a documentation finding because the package
  did not include the already committed review-prep log update `7076ac1`.
  Code style/maintainability, TypeScript/API docs, security, and
  performance/reliability were clean.
- All five round-11 reviewer sub-agents were closed after their reports were
  collected.
- Round-12 review package is prepared at
  `.superpowers/sdd/review-round-12-fce80b2-current.diff`.
- Round-12 review completed with one documentation finding: the Round 10 Fix
  entry in the review log needed to explicitly record commit `d419fd8`. Code
  style/maintainability, TypeScript/API docs, security, and
  performance/reliability were clean.
- All five round-12 reviewer sub-agents were closed after their reports were
  collected.
- Round-13 review package is prepared at
  `.superpowers/sdd/review-round-13-fce80b2-current.diff`.
- Round-13 review completed with one documentation finding:
  `IMPLEMENTATION_REPORT.md` needed to explicitly name the round-13 package
  path. Code style/maintainability, TypeScript/API docs, security, and
  performance/reliability were clean.
- All five round-13 reviewer sub-agents were closed after their reports were
  collected.
- Round-14 review package is prepared at
  `.superpowers/sdd/review-round-14-fce80b2-current.diff`.
- Round-14 review completed cleanly across all five required lanes.
- All five round-14 reviewer sub-agents were closed after their reports were
  collected.
- Final verification found a branch coverage gap: escalated `pnpm verify`
  passed the full test suite but stopped at global branch coverage `88.04%`
  against the `90%` threshold.
- Coverage fix added focused test-only branch coverage for shard index, shard
  registry, and record spec validation/clone behavior. The coverage-fix worker
  was closed after reporting.
- Coverage-fix verification passed with focused tests, typecheck, lint,
  formatting, diff hygiene, and escalated `pnpm test:coverage` (`41` files /
  `377` tests, branch coverage `90%`).
- Round-15 review package is prepared at
  `.superpowers/sdd/review-round-15-fce80b2-current.diff`.
- Round-15 review completed with documentation and maintainability findings.
  TypeScript/API docs, security, and performance/reliability lanes were clean.
- All five round-15 reviewer sub-agents were closed after their reports were
  collected.
- Round-15 fixes reflowed durable-log commands and recorded package-prep
  breadcrumbs across task/report/work logs.
- Round-16 review package is prepared at
  `.superpowers/sdd/review-round-16-fce80b2-current.diff`.
- Round-16 review completed with documentation and performance/reliability log
  findings. Code style/maintainability, TypeScript/API docs, and security lanes
  were clean.
- All five round-16 reviewer sub-agents were closed after their reports were
  collected.
- Round-17 review package is prepared at
  `.superpowers/sdd/review-round-17-fce80b2-current.diff`.
- Round-17 review completed with documentation and performance/reliability log
  findings. TypeScript/API docs and security lanes were clean. Code
  style/maintainability found the same stale work-log/package-prep wording as
  documentation.
- All five round-17 reviewer sub-agents were closed after their reports were
  collected.
- Round-18 review package is prepared at
  `.superpowers/sdd/review-round-18-fce80b2-current.diff`.
- Round-18 review completed with documentation and maintainability log
  findings. TypeScript/API docs, security, and performance/reliability lanes
  were clean.
- All five round-18 reviewer sub-agents were closed after their reports were
  collected.
- Round-18 fixes marked round-18 package prep as completed in
  task/report/work logs.
- Round-19 review package is prepared at
  `.superpowers/sdd/review-round-19-fce80b2-current.diff`.
- Round-19 review completed with documentation, maintainability, and
  performance/reliability log findings. TypeScript/API docs and security lanes
  were clean.
- All five round-19 reviewer sub-agents were closed after their reports were
  collected.
- Round-20 review package is prepared at
  `.superpowers/sdd/review-round-20-fce80b2-current.diff`.
- Round-20 review completed with documentation, maintainability, security, and
  performance/reliability findings. TypeScript/API docs lane was clean.
- All five round-20 reviewer sub-agents were closed after their reports were
  collected.
- Round-20 fixes validate final dedup guard key/target invariants and complete
  the package-prep/current-state breadcrumbs in task/report/work logs.
- Focused inbox verification passed with 16 tests after the round-20 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`.
- Round-21 review package is prepared at
  `.superpowers/sdd/review-round-21-fce80b2-current.diff`.
- Round-21 review completed with security and performance/reliability
  findings. Code style/maintainability, documentation, and TypeScript/API docs
  lanes were clean.
- All five round-21 reviewer sub-agents were closed after their reports were
  collected.
- Round-21 fixes enforce pending dedup payload limits and validate that the
  decoded dedup guard key matches the storage key being read.
- Focused inbox verification passed with 18 tests after the round-21 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`.
- Round-22 review package is prepared at
  `.superpowers/sdd/review-round-22-fce80b2-current.diff`.
- Round-22 was interrupted after only the code style/maintainability reviewer
  ran. That reviewer requested renaming the test-only
  `WrongStorageKeyGuardFactory` because it exceeded the four-component name
  limit. Documentation, TypeScript/API docs, security, and
  performance/reliability lanes were not started in that partial round.
- The round-22 maintainability reviewer sub-agent was closed after its report
  was collected.
- Round-22 fix renamed the test-only factory to `StorageKeyMismatchFactory`.
- Round-23 review package is prepared at
  `.superpowers/sdd/review-round-23-fce80b2-current.diff`.
- Round-23 review completed with maintainability, security, and
  performance/reliability findings. Documentation and TypeScript/API docs lanes
  were clean.
- All five round-23 reviewer sub-agents were closed after their reports were
  collected.
- Round-23 fixes folded storage-key validation into `dedupMessageId()` and
  added read-side payload-size checks for stored inbox and pending dedup
  signals.
- Focused inbox verification passed with 20 tests after the round-23 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`.
- Round-24 review package is prepared at
  `.superpowers/sdd/review-round-24-fce80b2-current.diff`.
- Round-24 review completed with security and performance/reliability
  findings. Code style/maintainability, documentation, and TypeScript/API docs
  lanes had no new required code/API/doc changes.
- All five round-24 reviewer sub-agents were closed after their reports were
  collected.
- Round-24 fixes reject malformed and non-canonical stored signal base64,
  reject oversized inbox/dedup/shard serialized records before UTF-8 decoding
  and JSON parsing, and keep a pending dedup guard when finalization fails
  after the inbox row is durable.
- Focused delivery verification passed with 38 tests after the round-24 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Round-25 review package is prepared at
  `.superpowers/sdd/review-round-25-fce80b2-current.diff`.
- Round-25 review completed with documentation, security, and
  performance/reliability findings. Code style/maintainability and
  TypeScript/API docs were clean. All five round-25 reviewer sub-agents were
  closed after their reports were collected.
- Round-25 fixes narrow the runtime/API docs to the durable inbox slice,
  enforce serialized-size caps on inbox/dedup/shard-session writes, and route
  existing inbox-row collisions through bounded inbox-record decoding.
- Red-first focused regressions captured the missing write-side size checks and
  the corrupt-row collision behavior before implementation.
- Focused delivery verification passed with 42 tests after the round-25 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Round-26 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability was clean. Documentation, TypeScript/API docs,
  security, and performance/reliability requested changes and are now closed.
- Round-26 fixes add the missing public `InboxMessageError` and
  `InboxMessageInput` API docs, validate expected storage keys when inbox/shard
  rows are read by slot, and reject oversized signal/inbox/shard text before
  building large storage keys or serialized JSON.
- Red-first focused regressions captured the missing early text bounds and the
  wrong-slot inbox/shard corruption holes before implementation.
- Focused delivery verification passed with 46 tests after the round-26 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Final round-26 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Controller verification then applied the stricter full touched-file line scan
  and reflowed long touched API/architecture documentation lines before
  preparing the next review package.
- Round-27 review completed from reviewer results supplied to this fix worker.
  Documentation and TypeScript/API docs were clean. Code
  style/maintainability, security, and performance/reliability requested
  changes and are now closed.
- Round-27 fixes reuse the existing parameterized corrupt-guard fixture instead
  of one-off storage factories, add empty/large signal payload round-trip
  regressions, and allow stored signal base64 payloads to be empty while using
  the max-signal-byte-derived base64 text cap on reads.
- Red-first focused inbox verification captured the expected pre-fix failures:
  empty signal payload reads failed with `Inbox signal payload must be a
non-empty string.`, and a valid `20 KiB` signal payload failed with
  `Inbox signal payload exceeds 16384 bytes and cannot be stored.`
- Focused delivery verification passed with 48 tests after the round-27 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Final round-27 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Round-28 review package is prepared at
  `.superpowers/sdd/review-round-28-fce80b2-current.diff`.
- Round-28 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability and TypeScript/API docs were clean.
  Documentation, security, and performance/reliability requested changes and
  are now closed.
- Round-28 fixes add strict UTF-8 validation for stored inbox/dedup and
  shard-session JSON before `JSON.parse()`, and roll back stale pending dedup
  guards when recovery hits a conflicting inbox row before the guarded row is
  durable.
- Red-first focused delivery verification captured the expected pre-fix
  failures: stored inbox rows, pending dedup guards, and shard-session records
  with invalid UTF-8 were accepted, and a recovery-conflict retry stayed
  trapped behind the stale pending guard.
- Focused delivery verification passed with 52 tests after the round-28 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Final round-28 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Round-29 review package is prepared at
  `.superpowers/sdd/review-round-29-fce80b2-current.diff`.
- Round-29 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability was clean. Documentation, TypeScript/API docs,
  security, and performance/reliability requested changes and are now closed.
- Round-29 fixes advance the durable task/report/review/work-log state to the
  round-29 package, clarify `DEVELOPER_API.md` so `Inbox` /
  `InboxStorage` stay framed as low-level delivery storage primitives rather
  than application-facing read/query facades, keep conflicting/corrupt pending
  dedup recovery fail-closed by retaining the canonical pending guard, and
  reject oversized stringified inbox `version` values before inbox/dedup record
  materialization.
- Red-first focused regressions captured the expected pre-fix failures: the
  retry after a conflicting pending-guard recovery still wrote a new
  `message-2` live row, and oversized `version` values still serialized without
  an early rejection.
- Focused delivery verification passed with 53 tests after the round-29 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Final round-29 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Round-30 review package is prepared at
  `.superpowers/sdd/review-round-30-fce80b2-current.diff`.
- Round-30 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability, documentation, security, and
  performance/reliability requested changes. TypeScript/API docs was clean.
  All five round-30 reviewer sub-agents are closed.
- Round-30 fixes split the inbox and shard-session parser hotspots into small
  local semantic helpers, moved inbox corruption/recovery doubles into
  `packages/server/test/delivery/inbox-test-support.ts`, added the narrower
  `packages/server/test/delivery/inbox-records.test.ts` regression file,
  narrowed `RUNTIME_ARCHITECTURE.md` to storage-level delivery primitives
  rather than bus integration, rejected oversized composed inbox/dedup keys at
  write time, and added an explicit pending-dedup aggregate-budget rejection.
- Red-first focused regressions captured the expected pre-fix failures:
  escaped target/signal inputs still serialized composed inbox/dedup keys that
  would later exceed the `64 KiB` read cap, and the oversized pending dedup
  envelope still failed with a generic serialized-record overflow instead of
  an explicit aggregate-budget rejection.
- Focused delivery verification passed with 56 tests after the round-30 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`.
- Final round-30 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Round-31 review package is prepared at
  `.superpowers/sdd/review-round-31-fce80b2-current.diff`.
- Round-31 review completed from reviewer results supplied to this fix worker.
  TypeScript/API docs and performance/reliability were clean. Code
  style/maintainability, documentation, and security requested changes. All
  five round-31 reviewer sub-agents are closed.
- Round-31 fixes localize the inbox-only storage doubles back into
  `packages/server/test/delivery/inbox.test.ts`, replace the catch-all
  `inbox-test-support.ts` with the narrower
  `inbox-message-fixture.ts` / `inbox-record-fixture.ts` helpers, centralize
  inbox message-ID text validation through `InboxMessageIdText`, and extend
  record-storage query results to expose actual storage slot IDs so
  `InboxStorage.read()` rejects copied inbox rows stored under a second backend
  key.
- Red-first focused regressions captured the expected pre-fix failure:
  `pnpm test packages/server/test/delivery/inbox.test.ts` failed because
  `rejects a queried inbox row copied under another backend key` resolved with
  two delivered `message-1` rows instead of rejecting the copied-row replay as
  storage corruption.
- Focused delivery/storage verification passed with 68 tests after the
  round-31 fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`.
- Final round-31 verification also passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Round-32 review package is supplied to this fix worker as
  `.superpowers/sdd/review-round-32-fce80b2-current.diff`.
- Round-32 review completed with documentation, TypeScript/API docs, security,
  and performance/reliability findings. Code style/maintainability was clean.
- Round-32 fixes document `Inbox.storage` as the intentional low-level escape
  hatch, change direct message-key reuse to `InboxMessageError`, validate full
  caller inbox input before duplicate short-circuiting, reject out-of-range
  stored inbox/dedup/shard timestamps as storage corruption, remove the unsafe
  default `RecordStorage.queryRecordEntries()` fallback, and update the durable
  task/report/review/work-log state.
- Round-33 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability and security were clean. Documentation and
  TypeScript/API docs requested durable log/API-contract updates, and
  performance/reliability requested a final dedup guard `keepUntilMs`
  fail-closed regression plus validation. All five round-33 reviewer
  sub-agents are closed.
- Round-33 fixes export `DeliveryStorageCorruptionError` from the public server
  surface, document the delivery error contract beside `InboxMessageError`,
  add a red-first regression for out-of-range final dedup `keepUntilMs`, and
  validate that timestamp in the final dedup guard read path.
- Red-first focused verification failed as expected before the production fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-- --runInBand -t "fails closed when final dedup guard keep-until`
  `timestamps are out of range"`
  resolved `WRITTEN` instead of rejecting corrupt storage.
- Final round-33 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check`, and a
  full touched-file line scan.
- Round-34 review package is supplied to this fix worker as
  `.superpowers/sdd/review-round-34-fce80b2-current.diff`.
- Round-34 review completed with documentation, code style/maintainability,
  TypeScript/API docs, security, and performance/reliability findings. All
  five round-34 reviewer lanes are now closed.
- Round-34 fixes simplify `RecordStorage` down to one real protected query hook
  (`queryRecordEntries()`), remove the exported `InboxMessageIdText` /
  `validateInboxMessageInput` helper sprawl, keep corrupt stored inbox/dedup
  composite-key checks on stored-only validation paths, route caller-side inbox
  payload/date validation through `InboxMessageError`, route caller-side shard
  pickup node/clock validation through plain `Error`, and advance the durable
  task/report/review/work-log state to the round-34 package/current fix.
- Red-first focused verification failed as expected before the production fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  produced the expected wrong-class failures for oversized inbox payloads,
  invalid inbox timestamps, corrupt stored inbox composite keys, and invalid
  shard pickup node/clock validation.
- Focused round-34 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`.
- Final round-34 verification passed with `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check`, `git diff --check`, and a full touched-file line scan.
- Controller verification that also covered
  `packages/server/test/repository/aggregate-storage.test.ts` found that the
  storage-level `EventStore` event-ID guard now rejects corrupt whitespace
  stored event IDs before the aggregate-routing guard. The aggregate storage
  regression was aligned to the new first failing guard.
- Round-35 review package is supplied to this fix worker as
  `.superpowers/sdd/review-round-35-fce80b2-current.diff`.
- Round-35 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability, documentation, security, and
  performance/reliability requested changes. TypeScript/API docs was clean.
  All five round-35 reviewer lanes are closed.
- Round-35 fixes reject invalid shard-shaped caller input and non-`Uint8Array`
  signal payloads before inbox/dedup serialization, fail closed when pending
  dedup guards embed invalid inbox timestamps even if the guarded inbox row
  already exists, restore chronological review-log ordering for rounds 28-34,
  and advance the durable task/report/review/work-log state to the round-35
  package/current fix.
- Red-first focused verification failed as expected before the production fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  failed with the expected three regressions across pending-guard timestamp
  corruption, fake shard-shaped caller input, and non-`Uint8Array` signal
  payload caller input.
- Focused round-35 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`.
- Final round-35 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `git diff --check`, and
  a full touched-file line scan.
- Round-36 review completed from reviewer results supplied to this fix worker.
  Documentation, code style/maintainability, security, and
  performance/reliability requested changes. TypeScript/API docs was clean.
  All five round-36 reviewer lanes are closed.
- Round-36 fixes advance durable breadcrumbs, remove `TenantRecords.query()`,
  place the primary shard-registry declaration before `ShardSession`, route
  inbox writes through one immutable validated snapshot, classify pending
  recovery conflicts with same-key different inbox bytes as storage
  corruption, and key shard pickup from one sanitized shard value.
- Red-first focused verification failed as expected before the production fix:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-- --runInBand -t 'writes one immutable snapshot when caller getters drift`
  `after validation|fails closed when pending dedup recovery finds same-key`
  `conflicting inbox bytes'` and
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'sanitizes shard pickup input once when caller key`
  `disagrees with shard coordinates'`.
  The pre-fix outcomes were drifted caller getter values reaching storage,
  same-key recovery conflict surfacing `InboxMessageError`, and fake shard
  keys claiming the wrong backend slot.
- Focused round-36 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand`
  `-t 'writes one immutable snapshot when caller getters drift after`
  `validation|fails closed when pending dedup recovery finds same-key`
  `conflicting inbox bytes'` and
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'sanitizes shard pickup input once when caller key`
  `disagrees with shard coordinates'`.
- Final round-36 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`,
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `git diff --check fce80b2..HEAD`, and a touched-file line scan.
- Round-37 review completed from reviewer results supplied to this fix worker.
  Code style/maintainability, documentation, TypeScript/API docs, security,
  and performance/reliability requested changes. All five round-37 reviewer
  lanes are closed.
- Round-37 fixes make the work log current after commit `c0c319b`, restore the
  implementation report tail to chronological order, add public TSDoc for
  `ShardIndex` and `ShardSession` constructor-parameter properties, capture
  signal payloads once before inbox-record serialization, enforce the signal
  payload cap inside `packSignal()`, and validate shard pickup input before
  storage access.
- Red-first focused verification failed as expected before the production fix:
  `pnpm test packages/server/test/delivery/inbox-records.test.ts`
  `-- --runInBand -t 'rejects signal payloads that grow after validation'`
  did not throw, and
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'rejects invalid pickup inputs before opening shard`
  `storage'` observed two storage opens before validation.
- Focused round-37 verification passed with
  `pnpm test packages/server/test/delivery/inbox-records.test.ts`
  `-- --runInBand -t 'captures one signal payload before validation and`
  `serialization'` and
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'rejects invalid pickup inputs before opening shard`
  `storage'`.
- Final round-37 focused-suite verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` (`113` tests).
- Final round-37 hygiene verification passed with `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `git diff --check fce80b2..HEAD`, and a
  touched-file line scan.
- Round-37 fixes were committed as `4a97dd9`.
- Round-38 review completed from reviewer results supplied to this fix worker.
  TypeScript/API docs, documentation, security, and performance/reliability
  requested changes. Code style/maintainability was clean. All five round-38
  reviewer lanes are closed.
- Round-38 fixes add the missing public `DeliveryStorageCorruptionError`
  API-doc expectation, refresh durable round-37 breadcrumbs, snapshot mutable
  caller inbox fields before durable parsing, explicitly validate public
  `version` and `Date` inputs, and make live final dedup guard
  status/retention block consistently.
- Red-first round-38 verification failed for the intended regressions:
  `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'uses caller getter drift as one inbox input snapshot|rejects structural`
  `caller timestamps as inbox message errors|rejects structural caller`
  `versions before building inbox or dedup records|blocks on a live final`
  `dedup guard even when the inbox row is expired'`.
  The pre-fix outcomes were accepted structural date/version values, drifted
  caller inbox target values reaching storage, and a live final dedup guard
  being replaced with a new written message.
- Focused round-38 verification passed with the same red-first regression
  command after the production fix.
- Final round-38 focused-suite verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` (`117` tests).
- Final round-38 hygiene verification passed with `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `git diff --check fce80b2..HEAD`, and a
  touched-file line scan.
- Round-38 fixes were committed as `0efeccb`.
- Round-39 review completed from reviewer results supplied to this fix worker.
  Documentation and maintainability requested durable log state updates,
  TypeScript/API docs requested adding public `RecordEntry` storage export
  expectations, performance/reliability requested pending dedup guard byte
  equality before finalization, and security requested immutable canonical
  shard-session release snapshots.
- Red-first round-39 verification failed for the intended regressions:
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'fails closed when pending dedup guard and visible`
  `inbox row bytes differ|uses one canonical release snapshot when caller`
  `session shard drifts'`. The pre-fix outcomes were a `DUPLICATE` result
  from conflicting pending/inbox bytes and `release()` returning `false` after
  caller session shard drift.
- Round-39 fixes add `RecordEntry` to storage API docs/expectations, verify
  pending guard canonical inbox bytes against the visible inbox row before
  finalization, and snapshot release session shard/id/node once through
  bounded canonical input validation.
- Focused round-39 verification passed with the same red-first regression
  command after production changes.
- Final round-39 focused-suite verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` (`119` tests).
- Final round-39 hygiene verification passed with `pnpm typecheck`,
  `pnpm lint`, `pnpm format:check`, `node scripts/check-api-docs.mjs`,
  `git diff --check fce80b2..HEAD`, and a touched-file line scan.
- No blocking human question is known.
- Round-39 fixes were committed as `72df1a4`.
- Round-40 review completed from reviewer results supplied to this fix worker.
  Documentation requested current durable state for committed round 39 and the
  round-40 pass. Maintainability requested removing the unused exported
  `dedupMessageId()` helper and moving primary declarations before support
  declarations in inbox/storage files. Security requested validating
  `InboxStorage` clock values before dedup retention decisions so invalid
  clocks fail closed instead of unblocking live dedup guards. TypeScript/API
  docs and reliability lanes were clean.
- Round-40 fixes add a red-first regression for invalid `InboxStorage.now()`
  behavior, validate the injected inbox storage clock before dedup
  retention decisions or dedup recovery/finalization mutations, remove the
  unused exported `dedupMessageId()` helper, and place primary declarations
  first in the inbox, record-storage, and tenant-records files.
- Red-first focused verification failed for the intended round-40 regression:
  `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'rejects invalid storage clocks before live dedup retention decisions'`.
  The pre-fix path resolved `WRITTEN` for the duplicate message instead of
  rejecting the invalid storage clock.
- Focused round-40 verification passed with the same red-first command after
  production changes.
- Final round-40 verification passed with
  `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` (`120` tests),
  `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `node scripts/check-api-docs.mjs`, `git diff --check fce80b2..HEAD`, and a
  touched-file line scan. `node scripts/check-api-docs.mjs` still emitted the
  existing invalid `origin` TypeDoc source-link warning, but exited
  successfully.
- Round-40 fixes were committed as `3a05e4b` after verification.
- Round-41 review completed from reviewer results supplied to this fix worker.
  Documentation requested naming committed round-40 fix commit `3a05e4b`
  explicitly in durable logs. Code style/maintainability, TypeScript/API docs,
  security, and performance/reliability lanes were clean.
- Round-41 documentation-only fixes name `3a05e4b` in the current round-40
  state and record this docs-only fix trail.
- Round-41 documentation-only fixes were committed as `e55c26f`.
- Round-42 review completed from reviewer results supplied to this fix worker.
  Documentation requested current durable state for committed round 41 and the
  current round-42 pass. Performance/reliability requested failing closed when
  final dedup guard status/retention metadata disagrees with the visible inbox
  row. Code style/maintainability, TypeScript/API docs, and security lanes were
  clean.
- Round-42 fixes add a red-first regression for corrupt final dedup metadata,
  require final dedup guard status/retention metadata to match the visible row,
  and refresh durable logs through committed round 41.
- Round-42 fixes were committed as `0235f0b`.
- Round-43 review completed from reviewer results supplied to this fix worker.
  Documentation and maintainability requested durable-log state corrections for
  committed round 42. Security requested classifying proxy-backed caller signal
  payload and timestamp failures as `InboxMessageError` before durable writes.
  Code style/maintainability, TypeScript/API docs, and
  performance/reliability were otherwise clean.
- Round-43 fixes add red-first proxy payload/timestamp regressions, wrap caller
  byte and timestamp validation failures as `InboxMessageError`, and refresh
  durable logs for committed round 42 plus the round-43 handoff state.
- Round-43 fixes were committed as `4307077` after controller verification.
- Post-round-43 durable-log fix updates task/report/review/work logs to name
  `4307077` as the committed and verified round-43 state. This docs-only
  commit intentionally does not try to pre-record its own future hash; reviewers
  should identify it from package HEAD or `git log`.
