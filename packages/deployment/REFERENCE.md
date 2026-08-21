# Deployment reference

Read the [deployment guide](README.md) for the fixed-list-to-leased-discovery
journey. This reference defines the exact discovery and lease limits.

`ApplicationNode` validates stable opaque IDs, canonical HTTP(S) origins, and optional HTTPS DNS TLS authorities; IDNs normalize to ASCII lowercase and IP literals are rejected as TLS authorities. `StaticNodeDiscovery` emits initial and replacement complete snapshots, including empty snapshots. `ScheduledNodeDiscovery` manages its injected schedule and aborts its current reader on close. Consumers retain only the latest complete snapshot and reconcile in bounded batches; closing the consumer stops later work. The expected 32 nodes is an operational expectation, not a cap.

A consumer treats conflicting descriptors for one stable ID in one snapshot as an invalid snapshot. The dynamic unary consumer contains that invalid input, keeps its last valid membership, and waits for a later complete snapshot; it does not emit operational logging in this package.

`ScheduledNodeDiscovery` permits one active watch. It is terminal after close: close is idempotent, cancels and joins its active read, and later `watch()` calls reject.

## Backend membership SPI

Framework gateway integrations import `BackendMembershipKernel`,
`BackendMemberClient`, and `BackendMembershipKernelOptions` from
`@spine-event-engine/deployment/spi/backend-membership`. The SPI owns ephemeral
member reconciliation and child subscriptions; callers retain logical
subscription persistence and do not use it as an application discovery API.

## Leased node registry

`LeasedNodeRegistry` persists application-node discovery leases through an
explicit caller-supplied `StorageFactory` and a non-empty operator-configured namespace.
It requires atomic compare-and-set storage at construction. It stores the
approved `spine.deployment.ApplicationNodeLease` record, using its
`spine.server.NodeId` message as the storage ID and its `NodeRegistrationId`
message as the fencing identity. A lease contains only a stable node ID,
canonical endpoint, epoch-millisecond expiry, and opaque registration identity.
Its `when_expires` field is a `google.protobuf.Timestamp`: the registry accepts
exact integer milliseconds from 0 through 253,402,300,799,999 and rejects
values outside that range or stored sub-millisecond values.

`register()` only creates an absent row. `renew()` and `remove()` compare the
stored registration identity, fencing a stale process after node-ID reuse.
`read(now)` validates the complete stored snapshot before it returns any live
nodes, then excludes expiry values less than or equal to `now`. Malformed rows
fail the entire read and are neither deleted nor rewritten. This package has no
migration, compatibility, dual-read, or dual-write path.

`cleanup(now)` conditionally removes one finite batch of at most 256 expired
rows. Its configured batch size must be from 1 through 256; the default is 32.
It is safe to repeat and to call concurrently; expiry makes abandoned
scale-to-zero rows immediately undiscoverable even before a later healthy node
resumes physical cleanup. `close()` is idempotent, closes this registry's storage handle,
fences later operations, and waits for already-started operations to settle
before it closes the handle. It never closes the caller's factory. The typed
lease record preserves an explicit normalized HTTPS TLS authority alongside its
canonical origin, so a read returns the same `ApplicationNode` descriptor that
was registered.

## Provider layout selection

Provider configuration selects the `ApplicationNodeLease` record family. For
MySQL, use the record-only table-name registration because this lease has the
same source and record type:

<!-- docs-snippet-path: packages/deployment/src/index.ts -->

```ts
import { ApplicationNodeLeaseSchema } from "@spine-event-engine/proto/generated/spine/deployment/node_discovery_pb.js";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";

MysqlStorageFactory.newBuilder().setTableName(
  ApplicationNodeLeaseSchema,
  "application_node_leases",
);
```

For Datastore, use the same record family with `organizeRecords()` to select a
kind, or `useRecordStorage()` to supply an application storage adapter.
Both APIs take `ApplicationNodeLeaseSchema` as their record-only selector.
