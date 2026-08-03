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
and exactly one in-memory, non-HA delivery server. Combined mode is for one
application/gateway process; multiple application replicas require standalone
mode. Stop either topology with the same command plus `down --volumes
--remove-orphans`.

The Kubernetes YAML files are storage-neutral references. Image distribution is
operator-owned and out of scope: for Kind, load local images instead of
publishing them; for Minikube, load the same local tags:

```bash
kind load docker-image spine-ts/message-board:local spine-ts/standalone-gateway:local spine-ts/simple-delivery-server:local
minikube image load spine-ts/message-board:local spine-ts/standalone-gateway:local spine-ts/simple-delivery-server:local
```

Create the operator-owned prerequisites in the target namespace before applying
the references:

```bash
kubectl create secret generic message-board-storage --from-literal=DATASTORE_PROJECT_ID=message-board-production
# Add DATASTORE_EMULATOR_HOST only for a local emulator test.
kubectl create secret generic message-board-runtime --from-file=MESSAGE_BOARD_SESSION_PRIVATE_KEY=session-key.pem
kubectl create secret tls message-board-envoy-tls --cert=tls.crt --key=tls.key
```

Every application and gateway uses the same issuer, audience, key ID, private
key, and registry namespace; separate values break authenticated failover.
The registry is gateway-owned durable storage, separate from the
application-selected MessageBoard data and session-revocation storage.

```bash
kubectl apply --filename examples/message-board/deploy/kubernetes/combined.yaml
```

For replicated applications, apply `standalone.yaml`. Its public LoadBalancer
service exposes Envoy only; Envoy discovers gateway replica endpoints through a
headless Service and keeps a signed session on one gateway hash-ring member.
The registry is durable and cancellation-fenced, but update delivery remains
best effort: reconnecting clients must re-query authoritative state; gaps,
duplicates, and no complete update history remain possible. The references use
TCP startup/readiness only and intentionally omit liveness probes and
application health endpoints.
