# Message Board deployment reference

This reference records the deployment contract. Start with the
[deployment guide](README.md) to choose and run a supported shape.

Compose and Kubernetes use `DELIVERY_SERVER_URL` as the only delivery-client
setting. Compose resolves `delivery:8484`; Kubernetes resolves
`simple-delivery-server:8484`. The simple delivery server is in-memory, runs as
one replica, and is not highly available or durable.

Combined mode runs one application/gateway process. Standalone Kubernetes mode
has two managed application nodes and one Gateway. Each managed node starts two
complete child replicas, for four application replicas in total. The Gateway's
durable subscription registry uses one namespace and cancellation fencing.
Replicated application deployments require standalone mode. All application
replicas use the same application-selected storage configuration; deployment
does not select a storage provider.

The Kubernetes public Service selects Envoy. Envoy permits only the documented
browser RPCs, applies a 30-second timeout to unary calls, leaves Activate
unbounded, and forwards to the one standalone Gateway. That Gateway uses GKE
headless-Service DNS discovery for application Pods. Only the application Pods
wait for the delivery server before startup; the Gateway does not use Delivery.
References use TCP startup/readiness probes and deliberately omit liveness
probes and application health endpoints.

All browser processes use one shared signed-session issuer, audience, key ID,
and P-256 private key. The Gateway preserves the logical definition of what a
client watches, but not a history of every update delivered to that client.
After an interruption, clients reconnect and query the current Projection state.

`message-board-storage`, `message-board-runtime`, and `message-board-envoy-tls`
are external Secrets managed by the operator; the reference YAML deliberately does not
create or overwrite them. Local cluster image loading is supported, while image
publishing and registry configuration remain out of scope.
