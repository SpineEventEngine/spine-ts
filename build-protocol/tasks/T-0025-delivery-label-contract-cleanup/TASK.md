# T-0025: Delivery Label Contract Cleanup

Status: integrated into main; post-merge verification passed
Started: `2026-07-10T03:08:00Z`
Baseline commit: `1a9804c0`
Branch: `task/T-0025-delivery-label-contract-cleanup`
Worktree:
`.worktrees/T-0025-delivery-label-contract-cleanup`

## Objective

Align the public delivery label contract with ADR 0001 and T-0024: event import
is not supported runtime work, so new `IMPORT_EVENT` inbox writes must be
rejected while legacy stored/wire rows remain recognizable as deprecated
compatibility data.

## Scope

- Remove `IMPORT_EVENT` from supported public delivery input labels.
- Reject new `IMPORT_EVENT` writes through `Inbox.receive()` and
  `InboxStorage.write()` before durable storage mutation.
- Preserve a narrow internal legacy decode policy for stored `IMPORT_EVENT`
  rows so they are not misclassified as unknown corrupt labels.
- Keep `CATCH_UP` and `TO_CATCH_UP` unchanged in this slice.
- Update package/API/spec docs and durable logs for the supported label set.

## Out Of Scope

- Implementing event import, `ImportBus`, aggregate importers, or `@Apply`
  delivery.
- Removing wire/proto compatibility references to `IMPORT_EVENT`.
- Narrowing `CATCH_UP` or `TO_CATCH_UP`.
- Transport worker, scheduler, retry, retained attempt history, or production
  delivery policy changes.

## Splitter Result

The requirements splitter `019f49f9-528f-7bd3-a111-68619d826f44` recommended
the narrowest safe slice:

- `DeliveryLabel` should mean supported runtime labels only:
  `HANDLE_COMMAND`, `UPDATE_SUBSCRIBER`, `REACT_UPON_EVENT`, and `CATCH_UP`.
- New `IMPORT_EVENT` writes should fail with `InboxMessageError`.
- Stored/wire decode should recognize `IMPORT_EVENT` as a deprecated legacy
  label but never silently deliver it.
- `CATCH_UP` and `TO_CATCH_UP` remain because ADR 0001 import removal does not
  remove projection/read-side catch-up.

## Acceptance Criteria

- Ordinary TypeScript callers cannot use `IMPORT_EVENT` as
  `InboxMessageInput.label` without an explicit unsafe cast.
- `Inbox.receive()` rejects `IMPORT_EVENT` before durable rows are written.
- `InboxStorage.write()` rejects `IMPORT_EVENT` before durable rows are written.
- Existing supported labels still write, read, deduplicate, and mark delivered.
- Legacy stored `IMPORT_EVENT` rows are recognized as known deprecated
  compatibility data and fail closed rather than being delivered as ordinary
  supported work.
- Docs state that supported runtime labels exclude `IMPORT_EVENT`; import label
  compatibility cleanup remains separate from import implementation.

## Verification Plan

- Red/green focused delivery tests for rejected `IMPORT_EVENT` writes and
  legacy stored-row recognition.
- Focused delivery/inbox tests.
- Typecheck for the public `DeliveryLabel` contract.
- Docs/API checks or focused scans for stale supported-label wording.
- `format:check` and `git diff --check`.

## Review Plan

Run the required independent review lanes after implementation:

- code style/maintainability;
- documentation completeness;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed findings to a fix worker and repeat until all lanes are clean.
