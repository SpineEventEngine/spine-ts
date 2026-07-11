# T-0028 Review Log

Status: Reviewed

Task: `T-0028 Storage Keyset Continuation For Delivery Scans`

Branch: `task/T-0028-storage-keyset-continuation`

## Required Review Lanes

| Lane                       | Reviewer                      | Status |
| -------------------------- | ----------------------------- | ------ |
| Code style/maintainability | Codex diff reviewer           | Fixed  |
| Documentation              | Codex diff reviewer           | Clean  |
| TypeScript/API docs        | Codex diff reviewer           | Fixed  |
| Security                   | Implementation worker recheck | Clean  |
| Performance/reliability    | Implementation worker recheck | Clean  |

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

### Round 1

- Code style/maintainability found a stale `Promise<boolean>` return from
  `Delivery.#tryDrainMessage()` after the keyset scan stopped consuming that
  result. Fixed by making the helper return `Promise<void>` and rely on
  `DrainProgress` for scan state.
- Documentation reviewed the changed build-protocol docs, API docs, package
  READMEs, user guide, architecture docs, and work log. No findings.
- TypeScript/API docs found the delivery storage fault fixture assigned an
  `after` marker to a locally narrowed object type. Fixed the builder type and
  reran `pnpm --config.verify-deps-before-run=false typecheck` successfully.
- Security recheck found no new secret/logging paths, tenant-slice broadening,
  shard broadening, or fail-open `IMPORT_EVENT` path. Inbox continuation input
  remains validated before constructing the storage continuation.
- Performance/reliability recheck found the delivery worker now pages pending
  durable inbox scans by stable inbox row continuation instead of moving
  absolute offsets, keeps the storage read cap plus callback limit scan budget,
  preserves skipped-row bounds, and clears skipped-only stale loop resume state
  before a later external run.
