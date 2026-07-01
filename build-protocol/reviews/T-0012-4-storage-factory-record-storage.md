# Review Log: T-0012.4 Storage Factory And Record Storage Reset

Status: round 1 follow-up complete
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
