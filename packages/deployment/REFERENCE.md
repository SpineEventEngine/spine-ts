# Deployment reference

`ApplicationNode` validates stable opaque IDs, canonical HTTP(S) origins, and optional HTTPS DNS TLS authorities; IDNs normalize to ASCII lowercase and IP literals are rejected as TLS authorities. `StaticNodeDiscovery` emits initial and replacement complete snapshots, including empty snapshots. `ScheduledNodeDiscovery` owns its injected schedule and aborts its current reader on close. Consumers retain only the latest complete snapshot and reconcile in bounded batches; closing the consumer stops later work. The expected 32 nodes is an operational expectation, not a cap.
