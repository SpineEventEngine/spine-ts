# MessageBoard deployment reference

This reference records the deployment contract. Beginners should start with the
[deployment guide](README.md).

Compose and Kubernetes use `DELIVERY_SERVER_URL` as the only delivery-client
setting. Compose resolves `delivery:8484`; Kubernetes resolves
`simple-delivery-server:8484`. The simple delivery server is in-memory, runs as
one replica, and is not highly available or durable.

Combined mode runs one application/gateway process. Standalone mode has two
application replicas and two gateways; its durable subscription registry uses
one namespace and cancellation fencing. Replicated application deployments
require standalone mode. Both application replicas use the same
application-selected storage configuration; deployment does not select a
storage provider.

The Kubernetes public Service selects Envoy. Envoy permits only the documented
browser RPCs, applies a 30-second timeout to unary calls, leaves Activate
unbounded, and uses strict DNS plus authorization-header ring hashing for
standalone gateways. Application and gateway Pods wait for the delivery server
before startup. References use TCP startup/readiness probes and deliberately
omit liveness probes and application health endpoints.

All browser processes use one shared signed-session issuer, audience, key ID,
and P-256 private key. Cross-node update delivery is best effort: clients
reconnect and re-query authoritative Projection state after interruption.
