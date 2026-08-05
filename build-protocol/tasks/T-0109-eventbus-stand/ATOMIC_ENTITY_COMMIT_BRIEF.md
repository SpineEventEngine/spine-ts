# T-0109 Atomic Entity Commit Brief

## Problem

Stand currently writes the latest Entity state before later history and
Aggregate EventStore writes. If a later write fails, cancellation only settles
the in-process operation; it cannot hide or restore the already visible state.
Reordering the current-state write would merely move partial visibility to the
other records.

## Required Internal Contract

Add one provider-internal `createEntityCommitStorage(input)` capability to the
structural storage-factory SPI. It is not a general application transaction API
and is not exported from the end-user storage root. The returned provider handle
owns direct atomic mutation of the same physical current/history and framework
EventStore records that the existing independently closeable read/maintenance
handles expose. One commit unit contains:

- a commit ID scoped by source signal, Entity family, Entity ID, context, and
  tenant;
- the expected and next current Entity record;
- optional state-history and diagnostic-event-history records;
- Aggregate delivery EventStore records when applicable; and
- a durable commit receipt.

The provider atomically returns `committed`, `replayed`, or `conflict`.
`committed` makes the complete unit and receipt visible once. `replayed` means
the same scoped content already committed and performs no writes. Reuse of a
commit ID with different content fails closed. `conflict` changes nothing.
Inputs are cloned and provider limits are checked before mutation. An adapter
without this capability fails repository assembly; there is no non-atomic
fallback.

The common storage package must factor the canonical EventStore record layout,
ID validation, and record materialization into its provider-only internal
subpath. The commit provider writes those records directly inside its own
transaction; repositories must not open a separate `EventStore` for the commit.
The existing public `EventStore` API remains unchanged for its other consumers.

## Provider Requirements

- In-memory uses one backend-scoped keyed commit lock and applies all records
  and the receipt as one snapshot operation across compatible handles.
- MySQL uses one leased InnoDB transaction and appropriate row or advisory
  serialization.
- Datastore uses one bounded provider transaction, rejects oversized commits
  before mutation, and reconciles ambiguous acknowledgement through the exact
  receipt and committed records. Google currently documents a 10 MiB
  transaction-size limit and 270-second transaction lifetime. The 25
  entity-group limit applies specifically to legacy/`OPTIMISTIC_WITH_ENTITY_GROUPS`
  concurrency mode, so the portable implementation must remain within that
  bound without claiming it constrains every Datastore-mode database. See the
  official [limits](https://docs.cloud.google.com/datastore/docs/concepts/limits)
  and [transaction](https://docs.cloud.google.com/datastore/docs/concepts/transactions)
  documentation.
- Future PostgreSQL can implement the same port with one SQL transaction and
  row or advisory serialization; no public framework redesign is allowed.

The unit is limited to one backing provider, storage context/tenant, and Entity
commit. It does not promise distributed or cross-provider transactions.

## Runtime Sequencing

Stand's internal deferred update becomes notification-only: it captures
independent old and new states plus the subscriber snapshot without writing.
The public low-level `Stand.update()` retains its single-current-record direct
write and then notifies; it does not participate in repository history or
EventStore transactions. The repository
executes the provider commit and notifies Stand, publishes
`EntityStateChanged`, and dispatches domain events only for `committed`.
`replayed`, `conflict`, and failure settle without notification or dispatch.

Apply the same boundary to Aggregate, Projection, and Process Manager. The
process-crash gap after durable commit but before in-memory/EventBus publication
remains explicitly best effort; closing that gap requires a durable outbox and
is outside T-0109.

## Required Evidence

1. Failure at every former post-current step leaves the old/absent current
   state, histories, and EventStore unchanged and emits no domain or system
   notification.
2. A retry with a new command ID produces exactly one complete commit and one
   `EntityStateChanged`; tests use bounded conditions rather than sleeps.
3. Replay of a committed signal produces no second commit, history record,
   delivery event, or system event. Divergent commit-ID reuse fails closed.
4. Two compatible handles racing from the same expected state yield exactly
   one commit and one conflict, with no loser writes or notification.
5. Ambiguous acknowledgement reconciles to one commit and later invocation is
   a replay.
6. One shared conformance matrix covers in-memory, Datastore emulator, and
   MySQL, including cloning, tenant/scope isolation, provider preflight, and
   close behavior.
7. Projection state-history and Process Manager state/diagnostic-history
   failures prove they use the same atomic unit.

## Exclusions

- No durable notification outbox.
- No distributed or arbitrary user-facing transaction API.
- No non-atomic fallback.
- No unrelated `RecordStorage` redesign.
