# MessageBoard deployment references

This guide is for people running the local MessageBoard deployment examples.
Agents should use the nearby [reference](REFERENCE.md) for exact guarantees.

Build the local-only images first:

```bash
pnpm typecheck:build
pnpm images:build:local
```

Set a P-256 PKCS#8 private key, then start the combined reference:

```bash
export MESSAGE_BOARD_SESSION_PRIVATE_KEY="$(cat session-key.pem)"
docker compose --file examples/message-board/deploy/compose/combined.compose.yaml up --detach
```

Use `standalone.compose.yaml` when running two application replicas. It starts
two application processes, two gateways, Envoy, one shared registry namespace,
and exactly one in-memory delivery server. Stop either topology with the same
command plus `down --volumes --remove-orphans`.

The Kubernetes YAML files are storage-neutral references. Supply the required
`message-board-storage` and Envoy TLS Secrets, then apply either one:

```bash
kubectl apply --filename examples/message-board/deploy/kubernetes/combined.yaml
```

For replicated applications, apply `standalone.yaml`. Its public LoadBalancer
service exposes Envoy only; Envoy discovers gateway replica endpoints through a
headless Service and keeps a signed session on one gateway hash-ring member.
