# @spine-event-engine/storage-datastore reference

This reference is for agents configuring the Google Cloud Datastore adapter.

## Public entry point

Import `DatastoreStorageFactory`, `DatastoreQueryLimitError`,
`DatastoreStorageOptions`, `DatastoreStorageFactoryInput`, and
`DatastoreEntityStorageHandle` from `@spine-event-engine/storage-datastore`.
The adapter depends on the public storage contract and the official
`@google-cloud/datastore` client.

## Factory and lifecycle

`new DatastoreStorageFactory({ client, maxClientSideScan? })` uses a
caller-owned `Datastore` client. `DatastoreStorageFactory.create(options)`
creates a client from official client options. The scan bound defaults to 1000
and must be a positive finite integer. Closing the factory prevents new storage
creation; it does not close an injected client. Record handles are independently
closeable through the base storage contract.

For a multitenant `StorageContext`, the tenant ID selects the Datastore
namespace. The adapter stores record payload bytes and materialized columns in
private entities. Indexed column values permit strings, finite
Datastore-compatible numbers, booleans, `null`, and exact signed 64-bit
bigints. An out-of-range bigint fails before an RPC.

## Queries and writes

The adapter pushes down provider-legal ID filters, equality filters, and order.
Plans needing reconciliation use a provider sentinel of
`maxClientSideScan + 1`. If the matching row set exceeds the bound, it throws
`DatastoreQueryLimitError` before local filtering, ordering, continuation,
offset, or semantic limit can return a partial result. It has no unlimited scan
option and no adapter-specific generic cursor.

`writeAll()` groups at most 500 mutations. A later group failure can leave an
earlier group durable. Current-record writes and entity-history operations are
separate calls and are not one transaction.

## Entity history seam

`createEntityStorage(input)` returns the framework/provider-only structural
handle containing `current`, `states`, and `events`. It binds layout
compatibility before access and is independently closeable. State and event
history reads are immutable, asynchronous, newest-first, and bounded. The API
does not expose an application-facing history route.

Appending immutable state or event data with identical identity and content is
safe to retry; divergent content fails. State trim and truncate work in bounded
chunks. Completed chunks can remain durable after a later failure, so callers
retry maintenance as needed.

The internal atomic Entity commit port combines current state, configured
histories, framework delivery events, and a receipt in one Datastore
transaction. Its receipt records the committing invocation owner so an
ambiguous acknowledgement still returns `committed` to exactly that invocation;
later callers receive `replayed`. Standalone history operations remain separate.

## Operations and errors

Malformed stored payloads cause a redacted decoding error. Datastore provider
and configuration failures propagate through the adapter operations. Deploy the
provided history indexes and any application-specific composite indexes before
using the corresponding query combinations.
