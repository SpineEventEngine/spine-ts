# Implementation Report: T-0012.4 Storage Factory And Record Storage Reset

Status: implemented
Branch: `task/T-0012-4-storage-factory-record-storage`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-4-storage-factory-record-storage`
Baseline commit: `1b855fd`

## Summary

Replaced the flat `StorageAdapter` package surface with a smaller JVM-like seam:
`StorageFactory`, `RecordStorage`, `RecordSpec`, `RecordColumn`,
`InMemoryStorageFactory`, `InMemoryRecordStorage`, and `EventStore`.

The implementation deletes delivery, diagnostics, tenant-index, aggregate
history, snapshot, and broad adapter concepts from `@spine-ts/storage`. Source
and tests now live under semantic folders, and the package root `src/index.ts`
only re-exports public API.

Round 1 review follow-up tightened the slice further: record helper behavior is
grouped under semantic owners instead of exported standalone helpers, batch
writes materialize all records before mutation, query ties break by record ID,
`EventStore` rejects missing `event.id` values, and storage docs now state
explicitly that `EventStore` is storage-only for now.

Round 2 follow-up closes the remaining review findings: storage docs now
describe only the current record-storage seam, `StorageFactory` no longer
depends upward on `EventStore`, `RecordMask` behavior coverage lives under the
semantic `record/` test folder, TypeDoc checks now reject internal storage
symbols beyond the root export list, the in-memory comparator sorts numbers and
bigints numerically, and `StorageFactory.close()` is verified to block further
storage creation.

## JVM Alignment

The selected design follows the JVM storage seam:

- an adapter implements `StorageFactory.createRecordStorage(context, spec)`;
- higher-level storages are framework delegates over `RecordStorage`;
- `EventStore` is one such delegate and persists `Event` records through a
  `RecordStorage<EventId, Event>`.

No new ADR is needed. `D-0047` supersedes the previous storage direction, and
this task implements the first step of the corrected order.

## Verification

Baseline:

- `env CI=true corepack pnpm verify` passed.
- 28 test files and 291 tests passed.
- Coverage: statements 96.5%, branches 91.22%, functions 99.31%, lines 96.44%.
- Docs/API checks passed with the existing invalid-`origin` TypeDoc warning.
- Proto lint/generate and generated-clean comparison passed.

Implementation:

- RED: `corepack pnpm vitest run packages/storage/test/factory/storage-factory.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts packages/storage/test/event/event-store.test.ts`
  failed before implementation because `InMemoryStorageFactory` did not exist.
- GREEN focused:
  `corepack pnpm vitest run packages/storage/test/index.test.ts packages/storage/test/factory/storage-factory.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts packages/storage/test/event/event-store.test.ts`
  passed with 4 files and 10 tests.
- Build check: `corepack pnpm exec tsc -b packages/proto packages/storage`
  passed.
- Full verify: escalated `corepack pnpm verify` passed with 31 test files and
  286 tests, coverage statements 95.59%, branches 90.03%, functions 98.49%,
  lines 95.58%, TypeDoc/API checks, proto lint/generate, and generated-clean
  comparison. Existing warning only: local `origin` remote is invalid for
  source links.

Round 1 fix follow-up:

- Focused regressions:
  `corepack pnpm vitest run packages/storage/test/index.test.ts packages/storage/test/storage/storage-factory.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts packages/storage/test/event/event-store.test.ts`
  passed with 4 files and 14 tests, covering missing `event.id`, atomic failed
  batches, stable tied ordering, and the moved storage-factory seam test.
- Build check:
  `corepack pnpm exec tsc -b packages/proto packages/storage`
  passed after the `RecordSpec.idSchema` generic tightening and helper
  refactor.
- Full verify:
  escalated `env CI=true corepack pnpm verify` passed with 31 files / 290
  tests, coverage statements 95.48%, branches 90.03%, functions 98.06%, lines
  95.54%, TypeDoc/API checks, proto lint/generate, and generated-clean
  comparison. Existing warning only: the local `origin` remote is invalid for
  TypeDoc source links.

Round 2 fix follow-up:

- Focused storage regressions:
  `corepack pnpm vitest run packages/storage/test/index.test.ts packages/storage/test/record/record-mask.test.ts packages/storage/test/storage/storage-factory.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts packages/storage/test/event/event-store.test.ts`
  passed with 5 files / 18 tests, covering moved `RecordMask` behavior,
  numeric/bigint sort ordering (`10` vs `2`, `10n` vs `2n`), deterministic
  mixed-kind ordering, NaN/null/undefined tie behavior, and the
  `StorageFactory.close()` guard.
- Build check:
  `corepack pnpm exec tsc -b packages/proto packages/storage`
  passed after removing the public `StorageObject` hierarchy from storage types
  and simplifying storage helper signatures.
- Docs/API check:
  `node scripts/check-api-docs.mjs` passed and now rejects internal or removed
  `@spine-ts/storage` TypeDoc symbols beyond root-export drift.
- Full verify:
  sandboxed `env CI=true corepack pnpm verify` reproduced the expected local
  IPC `Operation not permitted` failure in transport smoke tests; escalated
  rerun of the same command passed with 32 files / 294 tests, coverage
  statements 95.64%, branches 90.44%, functions 98.31%, lines 95.64%, TypeDoc
  / API checks, proto lint/generate, and generated-clean comparison. Existing
  warning only: the local `origin` remote is invalid for TypeDoc source links.

Round 3 documentation follow-up:

- Corrected the replacement storage example in `docs/USER_GUIDE.md` so
  `eventStore.append(create(...))` is syntactically valid.
- Focused `corepack pnpm docs:check` passed with only the existing
  invalid-`origin` TypeDoc source-link warning.
- Final documentation re-review passed clean after the report grouping fix.

Final task verification:

- Escalated `env CI=true corepack pnpm verify` passed with 32 files / 294
  tests, coverage statements 95.64%, branches 90.44%, functions 98.31%, lines
  95.64%, TypeDoc/API checks, proto lint/generate, and generated-clean
  comparison. Existing warning only: the local `origin` remote is invalid for
  TypeDoc source links.

## Changed Files

- `packages/storage/package.json`
- `packages/storage/README.md`
- `packages/storage/src/index.ts`
- `packages/storage/src/event/event-store.ts`
- `packages/storage/src/memory/in-memory-record-storage.ts`
- `packages/storage/src/memory/in-memory-storage-factory.ts`
- `packages/storage/src/memory/tenant-records.ts`
- `packages/storage/src/record/record-column.ts`
- `packages/storage/src/record/record-mask.ts`
- `packages/storage/src/record/record-query.ts`
- `packages/storage/src/record/record-spec.ts`
- `packages/storage/src/record/record-storage.ts`
- `packages/storage/src/storage/storage-factory.ts`
- `packages/storage/src/storage/storage-object.ts`
- `packages/storage/src/storage/storage.ts`
- `packages/storage/test/index.test.ts`
- `packages/storage/test/event/event-store.test.ts`
- `packages/storage/test/memory/in-memory-record-storage.test.ts`
- `packages/storage/test/record/record-mask.test.ts`
- `packages/storage/test/storage/storage-factory.test.ts`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0012-4-storage-factory-record-storage/TASK.md`
- `build-protocol/reviews/T-0012-4-storage-factory-record-storage.md`
- `build-protocol/tasks/T-0012-4-storage-factory-record-storage/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0012-4.md`
- `scripts/check-api-docs.mjs`
