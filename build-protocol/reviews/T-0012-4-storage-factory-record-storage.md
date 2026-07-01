# Review Log: T-0012.4 Storage Factory And Record Storage Reset

Status: round 2 follow-up complete
Branch: `task/T-0012-4-storage-factory-record-storage`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-4-storage-factory-record-storage`
Baseline commit: `1b855fd`

## Required Review Lanes

Every review round must run these separate reviewer sub-agents:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- broad adapter surfaces that replace `StorageFactory`/`RecordStorage`;
- delivery, inbox, catch-up, stand, gRPC, bus, repository dispatch, or runtime
  behavior in this task;
- in-memory-specific details leaking into the general storage contract;
- standalone helper exports without a strong reason;
- long names violating the four-component limit;
- generated Protobuf helper cloning that ignores generated `.clone()` where it
  is available;
- tests co-located under `src`;
- missing docs for public API changes.

## Rounds

## Round 1 Review

Reviewer lanes:

- Code style/maintainability: comments remain. Important findings: record-layer
  helpers were exported as standalone functions without strong justification;
  primary declarations did not lead `record-query.ts`, `record-mask.ts`, and
  `record-spec.ts`; the storage-factory test folder did not mirror
  `src/storage/storage-factory.ts`.
- Documentation: comments remain. Medium findings: `TASK.md` still said
  `implementation selected`; storage docs did not state that `EventStore` is
  storage-only and does not implement dispatch or delivery behavior.
- TypeScript/API docs: comments remain. High finding: `EventStore` synthesized
  missing `EventId` values instead of failing fast. Medium findings:
  `RecordSpec.idSchema` was typed against `GenMessage<Message>` instead of the
  ID generic, and `scripts/check-api-docs.mjs` did not reject unexpected
  storage-root exports.
- Security: no remaining comments.
- Performance/reliability: comments remain. Important findings: `writeAll`
  could partially persist earlier records if later ID extraction or column
  materialization failed, and query ordering was not stable when sort keys tied.

All Round 1 reviewer agents are closed. Author follow-up must address the
remaining findings before re-review.

## Round 1 Author Follow-up

Follow-up fixes are authored for all Round 1 findings:

- Record helper behavior now lives under semantic owners instead of exported
  standalone helpers: `RecordSpec` owns cloning/materialization,
  `RecordQuery.validate()` owns query validation, `RecordMask.apply()` owns
  masking, and in-memory value normalization is internal to `TenantRecords`.
- `RecordSpec`, `RecordQuery`, and `RecordMask` now lead their files; the
  storage-factory regression test moved to
  `packages/storage/test/storage/storage-factory.test.ts`.
- `RecordStorage.writeAll()` materializes every record before mutation, and the
  in-memory adapter now writes prepared entries atomically per batch. Stable
  query ordering now falls back to record ID before `limit` is applied.
- `EventStore` now rejects missing `event.id` values instead of synthesizing
  them, and the regression suite verifies the batch leaves storage unchanged.
- `RecordSpec.idSchema` is now typed against the ID generic, and
  `scripts/check-api-docs.mjs` now rejects unexpected `@spine-ts/storage` root
  exports the same way it already did for `@spine-ts/server`.
- Durable docs now mark the task as implemented and explicitly document that
  `EventStore` is storage-only for this slice.

Focused regression evidence and final verification are recorded in
`build-protocol/tasks/T-0012-4-storage-factory-record-storage/IMPLEMENTATION_REPORT.md`.

## Round 2 Review

Reviewer findings for the second fix round:

- Documentation (P2): `docs/api/README.md`, `docs/USER_GUIDE.md`, and
  `docs/architecture/README.md` still documented removed storage-adapter APIs
  such as `StorageAdapter`, `WriteSideRecordStore`, `ReadSideRecordStore`,
  aggregate histories/snapshots, delivery stores, tenant/diagnostic stores,
  `InMemoryStorageAdapter`, and `createInMemoryStorageAdapter()`.
- Maintainability (P2): `packages/storage/src/storage/storage-factory.ts`
  still imported `EventStore` and exposed `createEventStore()`, making the
  foundational storage factory depend upward on the event layer.
- Maintainability (P2): `packages/storage/test/index.test.ts` still carried
  `RecordMask.apply()` behavior coverage at the package root instead of under a
  semantic `record` test folder.
- TypeScript/API docs (Medium): `scripts/check-api-docs.mjs` still validated
  only storage root exports, while TypeDoc continued to expose internal storage
  symbols such as `RecordSpecInput`, `RecordEntry`, `RecordIdSchema`,
  `RecordMaskApi`, `RecordQueryApi`, and `StorageObject`.
- Reliability (P1/P3): the in-memory sort comparator still compared normalized
  JSON strings, so numbers and bigints sorted lexically (`10` before `2`);
  there was also no regression proving `StorageFactory.createRecordStorage()`
  fails after `factory.close()`.

## Round 2 Author Follow-up

All second-round findings are addressed in this worktree:

- Storage docs now describe only the current `StorageFactory` /
  `RecordStorage` / `RecordSpec` / `InMemoryStorageFactory` / `EventStore`
  seam, remove stale adapter/store APIs, and explicitly state that `EventStore`
  is storage-only with no dispatch or delivery behavior yet.
- `StorageFactory` now owns only `createRecordStorage(context, spec)`. The
  `EventStore` delegate remains a direct framework construction
  (`new EventStore(context, factory)`), keeping the foundational storage seam
  independent of the event layer.
- `RecordMask.apply()` coverage moved to
  `packages/storage/test/record/record-mask.test.ts`, and the package-root test
  is back to export-surface smoke only.
- TypeDoc leakage is reduced at the source by removing `StorageObject` from the
  public hierarchy and internal helper names from storage signatures where
  possible. `scripts/check-api-docs.mjs` now rejects internal or removed
  storage TypeDoc symbols such as `RecordSpecInput`, `RecordEntry`,
  `RecordIdSchema`, `RecordMaskApi`, `RecordQueryApi`, `StorageObject`, and
  `createEventStore`.
- The in-memory comparator now sorts numbers and bigints numerically while
  keeping deterministic ordering for the other normalized storage value kinds.
  Regression coverage now includes `10` vs `2`, `10n` vs `2n`, mixed-kind
  ordering, NaN handling, and deterministic tie fallback for `undefined` /
  `null`.
- `StorageFactory` close-guard coverage now proves that
  `createRecordStorage()` throws after `factory.close()`.

Fresh evidence for the second-round follow-up is recorded in
`build-protocol/tasks/T-0012-4-storage-factory-record-storage/IMPLEMENTATION_REPORT.md`.
