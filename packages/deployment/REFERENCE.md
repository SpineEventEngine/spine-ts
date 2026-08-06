# Deployment reference

`ApplicationNode` validates a stable opaque ID, an HTTP(S) origin, and an optional HTTPS TLS server name. `StaticNodeDiscovery` emits complete snapshots, including empty snapshots; closing its watch stops further delivery. Platform refresh, leases, DNS, and logging are not implemented by this package in T-0121.
