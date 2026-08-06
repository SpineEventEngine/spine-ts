# Deployment reference

`ApplicationNode` validates stable opaque IDs, canonical HTTP(S) origins, and optional HTTPS DNS TLS authorities; IDNs normalize to ASCII lowercase and IP literals are rejected as TLS authorities. `StaticNodeDiscovery` emits initial and replacement complete snapshots, including empty snapshots. `ScheduledNodeDiscovery` owns its injected schedule and aborts its current reader on close. Consumers retain only the latest complete snapshot and reconcile in bounded batches; closing the consumer stops later work. The expected 32 nodes is an operational expectation, not a cap.

A consumer treats conflicting descriptors for one stable ID in one snapshot as an invalid snapshot. The dynamic unary consumer contains that invalid input, keeps its last valid membership, and waits for a later complete snapshot; it does not emit operational logging in this package.

`ScheduledNodeDiscovery` permits one active watch. It is terminal after close: close is idempotent, cancels and joins its active read, and later `watch()` calls reject.
