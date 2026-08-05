# T-0116 Lifecycle Implementation Map

## Frozen Boundary

All repository families emit lifecycle System events only after
`EntityCommitStorage.commit()` returns `committed`. The paired System EventBus
is the sole destination. Domain EventBus/EventStore access is forbidden.

## Transition Model

- Creation: no prior durable record and a first durable record commits.
- State change: the transaction changed the state value. A lifecycle-only
  transition is not a state change.
- Archive/unarchive: prior and next `archived` flags differ.
- Delete/restore: prior and next `deleted` flags differ.
- Current logical deletion uses `marked_as_deleted = true`; physical removal is
  not emitted because Spine TS has no corresponding committed operation.
- Rejection, rollback, conflict, duplicate/no-op lifecycle assignment, and an
  unchanged transaction emit no lifecycle System event.

## Field Sources

- `entity`: repository ID descriptor packing plus the Entity state type URL.
- `kind`: frozen Entity metadata for Aggregate, Process Manager, or Projection.
- `signal_id`: the accepted Command/Event ID and signal type URL already used
  by `EntityStateChangePublishing`.
- `when` and Event context: the existing `SignalMetadata` result for the
  causing signal; no new clock is introduced.
- `version`: the committed next record version.
- state fields: packed prior/next committed Entity state as required by each
  frozen lifecycle schema.
- Event IDs: existing `SignalMetadata.eventFromCommand/eventFromEvent` ordinal
  generation. Ordinals follow the deterministic event order below.

## Per-commit Order

1. `EntityCreated` when applicable.
2. `EntityStateChanged` when the state value changed.
3. `EntityArchived` or `EntityUnarchived` when applicable.
4. `EntityDeleted` or `EntityRestored` when applicable.

Only applicable events consume ordinals, producing stable unique IDs without a
new ID policy.

## Subscription Rendering

System Stand observes `EntityStateChanged`, archive, unarchive, delete, and
restore schemas. State changes preserve current matching/no-longer-matching
rendering. Archive/delete render removal updates. Unarchive/restore unpack their
state and render a matching state update or no-longer-matching update under the
existing topic filters. Creation does not create a second wire update because
the committed first state change carries the row.

## RED Sequence

1. Repository routing tests cover exact schema/order/fields for one committed
   command and event path, then every Aggregate/Process Manager/Projection
   family.
2. Failure/no-op tests prove rollback, conflict, rejection, and unchanged
   lifecycle assignments emit nothing.
3. Multitenant tests prove Event context/registry isolation and tenant-correct
   updates.
4. Stand observer/runtime/service tests prove archive/delete removal and
   unarchive/restore delivery through only the System EventBus.
5. Injected System-post failure proves committed domain work is not rolled back
   or repeated.

## Compatibility Traps

- Do not infer state change from a generic `repositoryChanged` flag when only a
  lifecycle flag changed.
- Do not emit `removed_from_storage`, `EventImported`, `MigrationApplied`, or
  T-0117 dispatch diagnostics.
- Do not add a domain dispatcher/schema or fall back from System to domain bus.
- Do not invent a clock, event-ID generator, public lifecycle API, or new wire
  message.
