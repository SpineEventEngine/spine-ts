# T-0133: Histories And Event Store

Status: Complete on the reviewed integration train; merge deferred until T-0142

## Objective

Stores Entity state history, Entity event history, and the Bounded Context Event
Store as distinct JVM-style record families. Removes commit receipts and
receipt-driven replay behavior without reconstructing current Entity state from
events.

## Classification

High-risk because the task changes provider-facing storage grouping, history
record identity, repository commit semantics, retention behavior, and the
atomic in-memory implementation.

## Baseline And Ownership

- Baseline: reviewed integration-train commit `7aaa2699`.
- Branch: `task/T-0133-histories-event-store`.
- Worktree: `.worktrees/T-0133-histories-event-store`.
- Production ownership: `packages/storage/src/{entity,event,internal,memory,
storage}/**`, repository commit/history paths, and the narrow public export
  surface required for JVM-style storage groups.
- Frozen-Proto supporting ownership: the exact current JVM
  `spine/server/entity/state_key.proto` source plus manifest/checksum/contract
  integration. T-0132 copied `entity.proto` but the separately defined
  `EntityStateKey` required by state history was not in the approved source set.
- Test ownership: mirrored storage/Event Store/repository tests and compile
  contracts for the changed provider seam.
- Later MySQL, MariaDB, Datastore, delivery, subscription, deployment, and
  example consumers remain assigned to their existing Wave 8 tasks.

## Acceptance

1. `StorageGroup` follows the JVM concept: a named group distinguishes record
   storages with otherwise equal source and record types. Record storage can be
   created without a group or with one explicit group; provider implementations
   receive the group without placing it in `RecordSpec`.
2. State history stores generated `EntityRecord` values under generated
   `EntityStateKey` values. Its source is the Entity state type, its group is
   named after that state type, and its materialized columns are packed Entity
   ID, creation timestamp, and version number.
   `state_key.proto` must be copied byte-for-byte from current core-jvm commit
   `0779b5fa42ca5cebd0d2935fc3a3489ab47846dc`; no JVM build or source edit is
   allowed.
3. Event history stores generated `Event` values under `EventId`, grouped by
   the served Entity state type. Its `RecordSpec` source and record type are
   both `Event`, matching the current JVM implementation; the state type is the
   external group, not the spec source. Its materialized columns are
   `entity_id` (producer ID), `created` (event timestamp), and `version`.
4. The Bounded Context Event Store remains an independent, ungrouped,
   append-oriented `EventId`/`Event` record family with JVM column names
   `type` and `created`. It must not share physical records with any Entity
   event history. Existing Event Store convenience APIs are not removed merely
   because JVM lacks them; T-0144 owns the repository-wide invention audit.
5. Histories are opened and written only when their repository feature is
   enabled. Disabled histories allocate no grouped backing storage and receive
   no writes. Double-dispatch behavior continues to use explicitly enabled
   event history where required.
6. Backward reads, `stateAt`, trimming, truncation, ordering, tenant isolation,
   defensive copies, and close behavior remain correct. State history is never
   used to load current state, and event history is never used to reconstruct
   current state.
7. Remove commit IDs, commit/replay receipts, receipt maps/tables/digests, the
   `"replayed"` result, receipt-scoped rebuild behavior, and every dependent
   code path without aliases or replacement markers. Commit outcome is only a
   successful commit or a current-record conflict.
8. In-memory commits remain atomic across the current record, enabled history
   rows, and Event Store rows by staging then publishing all affected maps.
   Tests assert this only for the in-memory provider; no generic cross-storage
   atomicity claim is introduced.
9. Preserve the integration train: direct storage/server consumers owned here
   must compile and pass focused tests; downstream provider and framework
   consumers may remain only as an exact recorded failure inventory.

## Implementation Assignment

- Owner: existing implementer role.
- Expected profile: explicitly dispatched `gpt-5.6-terra` / `medium`.
- Required method: RED-first group isolation, state/event history record spec,
  disabled-history non-allocation, receipt removal, Event Store isolation,
  ordering/retention, and atomic failure tests before production changes.
- The owner must not spawn subagents, commit, push, merge, build JVM code,
  access the migration remote, or modify later Wave 8 provider/task scopes.

## Exploration Assignments

- TypeScript storage/receipt inventory: orchestrator-dispatched read-only
  explorer, explicitly `gpt-5.6-terra` / `medium`. The preferred Luna profile
  was explicitly attempted and rejected because this dispatch endpoint exposes
  only Sol and Terra.
- Current core-jvm source comparison: orchestrator-dispatched read-only
  explorer, explicitly `gpt-5.6-terra` / `medium`; source inspection only, no
  JVM build. The same unavailable-Luna limitation applies.

The desktop surface exposes configured role/profile metadata but no independent
runtime self-introspection. That limitation is recorded honestly; a visible
profile mismatch or omitted explicit dispatch is rejected.

## Architecture Block Assignment

- Demonstrated block: grouped generic history records are opened by
  `InMemoryStorageFactory`, while atomic Entity commits currently stage bespoke
  history maps owned by `MemoryEntityStorageFactory`. The implementation owner
  cannot safely make disabled histories lazy and preserve atomic staging without
  choosing one shared ownership seam.
- Existing requirements-splitter role is dispatched once, explicitly as
  `gpt-5.6-sol` / `high`, to return a minimal file-level design. It is read-only,
  must use existing abstractions, and may not broaden T-0133 or create a new
  subsystem.

### Accepted architecture decision

- `InMemoryStorageFactory` is the single owner of history record opening and
  exact generic-record backing access. `MemoryEntityStorageFactory` retains only
  current Entity records.
- Enabled history ports delegate to grouped generated `RecordStorage`; disabled
  ports perform no group open/bind and fail fast on an impossible append.
- The commit payload carries generated `EntityRecord` state rows and generated
  `Event` diagnostic rows, not persistence DTOs.
- In-memory commit staging snapshots the exact live current map, only the
  enabled grouped history `TenantRecords`, and the ungrouped Event Store records
  when present. It validates/writes staged handles, then replaces all live maps
  only after success. Event Store participation shares its context lock so a
  concurrent direct append cannot be overwritten.
- Runtime false-to-true state-history enablement invalidates/reopens cached
  Entity handles if that existing switch remains supported.

## Review And Verification

- Required concerns: style/maintainability, TypeScript/API docs, and
  performance/reliability.
- Documentation is required if narrow public storage-group claims change;
  broad package/user documentation remains T-0143.
- Security is N/A unless implementation introduces a new trust boundary.
- Run focused storage/server/Event Store typechecking and changed-source
  coverage. The shared task profile may stop only on the exact downstream
  integration-train inventory.

## Human-Imposed Requirements Ledger

## 2026-08-07 Correction Batch

- The existing implementer is correcting the accepted Wave 1 findings under
  the explicitly configured `gpt-5.6-terra` / `medium` profile. The execution
  surface exposes no independent runtime-model introspection; the configured
  profile is the available metadata and no mismatch was visible.
- Acceptance evidence: commits, direct current/state/event-history mutations,
  and staged map publication share one Entity-scope FIFO sequence; direct
  event-history divergent writes reject atomically. History record operations
  issue bounded RecordStorage windows. Provider SPI retains only the canonical
  history RecordSpec builders, and the beginner group example is runnable.

- Use the current Spine JVM record/group concepts without building or modifying
  JVM sources.
- Persist only approved Proto records; add no JSON-in-`Any`, receipt, marker,
  fingerprint, replay map, or alternative history record invention.
- Keep current Entity state, state history, Entity event history, and Event
  Store physically distinct.
- Do not reconstruct current Entity state from events and do not claim
  unsupported provider atomicity.
- Preserve later-task ownership and push the reviewed checkpoint immediately
  after its commit.

## 2026-08-07 Final Paging Correction

- Exact bounded paging is complete: all history RecordStorage reads use finite
  stable keyset pages, while backward continuation, `stateAt`, trim, and both
  truncates traverse every required page. State truncate remains inside the
  shared Entity FIFO, with deterministic truncate-versus-commit coverage.
- Full changed-storage-file lint, TSDoc, documentation audience, format, diff,
  focused tests, and storage typecheck pass. Focused coverage exercises the
  changed history adapter at 95.91% statements and 96.37% lines; its global
  threshold process failure is a whole-repository denominator limitation.
