# MessageBoard deployment references

This guide is for people running the local MessageBoard deployment examples.
Agents should use the nearby [reference](REFERENCE.md) for exact guarantees.

Build the local-only images first:

```bash
pnpm typecheck:build
pnpm images:build:local
```

Create the signing key once; keep this file out of source control:

```bash
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out session-key.pem
export MESSAGE_BOARD_SESSION_PRIVATE_KEY="$(cat session-key.pem)"
```

Set a P-256 PKCS#8 private key, then start the combined reference:

```bash
docker compose --file examples/message-board/deploy/compose/combined.compose.yaml up --detach
docker compose --file examples/message-board/deploy/compose/combined.compose.yaml down --volumes --remove-orphans
```

Use `standalone.compose.yaml` when running two application replicas. It starts
two application processes, two gateways, Envoy, one shared registry namespace,
and exactly one in-memory delivery server. Stop either topology with the same
command plus `down --volumes --remove-orphans`.

The Kubernetes YAML files are storage-neutral references. Build/publish the
`spine-ts/*:local` images to a registry reachable by the cluster, then replace
the image names. Before applying, create `message-board-storage` with the
application-selected storage values, `message-board-runtime` with the shared
P-256 session key, and `message-board-envoy-tls` with `tls.crt` and `tls.key`.
Every application and gateway uses the same issuer, audience, key ID, private
key, and registry namespace; separate values break authenticated failover.

```bash
kubectl apply --filename examples/message-board/deploy/kubernetes/combined.yaml
```

For replicated applications, apply `standalone.yaml`. Its public LoadBalancer
service exposes Envoy only; Envoy discovers gateway replica endpoints through a
headless Service and keeps a signed session on one gateway hash-ring member.
The registry is durable and cancellation-fenced, but update delivery remains
best effort: reconnecting clients must re-query authoritative state.
