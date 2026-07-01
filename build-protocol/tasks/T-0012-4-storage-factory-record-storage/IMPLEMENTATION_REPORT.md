# Implementation Report: T-0012.4 Storage Factory And Record Storage Reset

Status: implementation selected
Branch: `task/T-0012-4-storage-factory-record-storage`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-4-storage-factory-record-storage`
Baseline commit: `1b855fd`

## Summary

Implementation has not yet started. The baseline was verified after dependency
setup and after bringing the worktree forward to the formatted parent commit.

The current storage package is intentionally being replaced because it exposes a
large `StorageAdapter` with delivery records, diagnostics, tenant index, and
aggregate-event abstractions before the corrected roadmap reaches those
features.

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

## Changed Files

Pending implementation.
