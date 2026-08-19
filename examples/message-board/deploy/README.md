# Message Board deployment references

Use this guide to run the local Message Board deployment examples. The nearby
[reference](REFERENCE.md) holds exact guarantees and environment contracts.

## 🧭 Choose a topology

```mermaid
flowchart LR
  Browser --> Gateway[Public-demo Gateway]
  Gateway --> Coordinator[Node Coordinator]
  Coordinator -->|one request| AppOne[Complete replica 1]
  Coordinator -->|one request| AppTwo[Complete replica 2]
  Gateway -->|subscription fan-in| Coordinator
```

The two application connections shown for unary routing are alternatives, not
fan-out: one command or query is sent to one selected backend without retry.

Combined mode runs one Message Board application and public-demo browser
gateway in the same process. Use it to understand the smallest browser-facing
deployment. Standalone mode runs a managed application node separately from one
Gateway; Envoy is the only public service and the Gateway reaches its private
Coordinator, never a child listener.

Both modes require application-selected storage and a delivery server. The
Gateway admits this example's requests from their request actor and uses one
subscription-registry namespace per topology.
The Gateway remembers each logical subscription, such as “Ada watches board
`general`,” in durable storage. It does **not** store a history of every update
sent to Ada's browser. If the browser disconnects while a message is posted, it
may miss that notification. After reconnecting, the browser queries the current
board, replaces its local copy, and then continues listening. Receiving the same
complete board twice is harmless for the same reason. This is what the reference
means by _best-effort subscription updates_. The supplied simple delivery server
is in-memory and not highly available.

For the smaller runnable development topology of exactly two identical
applications and one Gateway, use
[Distributed Message Board](../../distributed-message-board/README.md). The
standalone reference below is intentionally replica-oriented: it demonstrates
separately scalable application and Gateway processes.

## 🚀 Run the references

Build the local-only images first:

```bash
pnpm typecheck:build
pnpm images:build:local
```

```bash
docker compose --file examples/message-board/deploy/compose/combined.compose.yaml up --detach
```

Open the stock browser UI at http://localhost:8080. Stop it with:

```bash
docker compose --file examples/message-board/deploy/compose/combined.compose.yaml down --volumes --remove-orphans
```

Use `standalone.compose.yaml` for one managed node with two complete replicas.
It sets `PROCESS_COUNT=2` and `DELIVERY_SHARD_COUNT=2` independently, then
starts one Coordinator, one Gateway, Envoy, one shared registry namespace, and
exactly one in-memory delivery server. `BACKEND_URLS` names that Coordinator in
this local-only static fixture, not a child listener.

Start it with:

```bash
docker compose --file examples/message-board/deploy/compose/standalone.compose.yaml up --detach
```

Open http://localhost:8080, then stop it with the matching `down --volumes --remove-orphans` command.

The Kubernetes YAML files are static references, not local-Kubernetes
instructions. They deploy the same stock UI behind Envoy and set its sole
runtime RPC URL (`MESSAGE_BOARD_GATEWAY_URL`) to the public Envoy origin. They
leave image distribution, storage provisioning, and TLS material to the cluster
operator.

```bash
kubectl apply --filename examples/message-board/deploy/kubernetes/combined.yaml
```

Application and Gateway processes use the same Datastore configuration and
registry namespace for their topology. Each process creates its Datastore client
and passes that exact client to its storage factory.

For multiple managed nodes, apply `standalone.yaml`. Each pod chooses its own
explicit process and shard counts. Its public LoadBalancer service exposes Envoy
only; the one Gateway uses `GkeNodeDiscovery` against the application headless
Service and follows ready Coordinator DNS membership rather than fixed child
backend lists.
The durable Gateway registry remembers **what** each client watches, not every
notification the client has seen. A reconnect restores the watch. A normal
query restores the current board if a notification was missed or repeated.
The references use TCP startup/readiness only and intentionally omit liveness
probes and application health endpoints.
