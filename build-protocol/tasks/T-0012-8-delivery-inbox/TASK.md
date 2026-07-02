# T-0012.8: Delivery And Inbox

Status: round-17 review prep
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
- Round-17 review package is being prepared at
  `.superpowers/sdd/review-round-17-fce80b2-current.diff`.
- No blocking human question is known.
