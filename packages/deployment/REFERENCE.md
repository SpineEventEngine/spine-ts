# Deployment reference

`ApplicationNode` validates stable opaque IDs, canonical HTTP(S) origins, and optional HTTPS DNS TLS authorities; IDNs normalize to ASCII lowercase and IP literals are rejected as TLS authorities. `StaticNodeDiscovery` emits initial and replacement complete snapshots, including empty snapshots. `ScheduledNodeDiscovery` owns its injected schedule and aborts its current reader on close. Consumers retain only the latest complete snapshot and reconcile in bounded batches; closing the consumer stops later work. The expected 32 nodes is an operational expectation, not a cap.

A consumer treats conflicting descriptors for one stable ID in one snapshot as an invalid snapshot. The dynamic unary consumer contains that invalid input, keeps its last valid membership, and waits for a later complete snapshot; it does not emit operational logging in this package.

`ScheduledNodeDiscovery` permits one active watch. It is terminal after close: close is idempotent, cancels and joins its active read, and later `watch()` calls reject.

## Leased node registry

`LeasedNodeRegistry` persists application-node discovery leases through an
explicit caller-owned `StorageFactory` and a non-empty operator-owned namespace.
It requires atomic compare-and-set storage at construction. A lease contains
only a stable node ID, canonical endpoint, epoch-millisecond expiry, and opaque
registration identity. The v1 layout uses the storage key
`spine.deployment.ApplicationNodeLease:v1`.

`register()` only creates an absent row. `renew()` and `remove()` compare the
stored registration identity, fencing a stale process after node-ID reuse.
`read(now)` validates the complete stored snapshot before it returns any live
nodes, then excludes expiry values less than or equal to `now`. Malformed or
unknown-version rows fail the entire read and are neither deleted nor rewritten.
Future incompatible records use another versioned storage key; this package has
no migration, compatibility, dual-read, or dual-write path.

`cleanup(now)` conditionally removes one finite batch of expired rows. It is
safe to repeat and to call concurrently; expiry makes abandoned scale-to-zero
rows immediately undiscoverable even before a later healthy node resumes
physical cleanup. `close()` is idempotent, closes this registry's storage handle,
and rejects later operations without closing the caller's factory.
