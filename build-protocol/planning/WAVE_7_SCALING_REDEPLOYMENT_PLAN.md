# Wave 7: Scaling And Redeployment

Status: Human Q&A in progress; implementation not started

Planning task: `T-0120`

Baseline: `origin/main@e6666605`

## Outcome

Wave 7 will let one standalone Gateway follow a changing set of identical
application nodes on GKE or GCE. Cloud infrastructure performs scaling and
replacement; Spine TS discovers the resulting nodes, connects subscriptions to
all of them, and preserves the durable work already established in Waves 5 and 6.

Cloud Run is not part of the initial offering. Multiple Gateways, operational
logging adapters, the next `validation-ts` upgrade, and storage-layout tuning
belong to Wave 8.

## Approved Package Boundaries

- `@spine-event-engine/deployment` contains platform-neutral node discovery,
  bounded reconciliation, and the storage-backed leased registry contract.
- `@spine-event-engine/deployment-gke` contains GKE-specific assembly,
  Terraform, and guidance. It uses headless-Service DNS rather than the leased
  registry.
- `@spine-event-engine/deployment-gce` contains GCE metadata integration, node
  registration, Terraform, and guidance. It uses the generic leased registry.

Platform packages do not choose domain storage, authentication providers,
business logic, or scaling policy.

## GCE Registry Ownership

The proposed registry is a discovery directory, not a domain repository and
not the Stand subscription registry.

Each running application node maintains exactly its own leased record. The GCE
package attaches a registrar to the application server lifecycle:

1. The application opens its gRPC listener.
2. The registrar obtains a stable GCE instance identity and the endpoint that
   other private-network participants can reach.
3. It writes one record through the explicitly supplied registry
   `StorageFactory`.
4. It renews that record every 20 seconds with a 60-second expiry.
5. On graceful shutdown it conditionally deletes its own record before the
   listener closes. A crashed node cannot delete anything, so its record simply
   expires.

The Gateway is a reader. Every 10 seconds it obtains the complete bounded set
of non-expired records and reconciles its gRPC clients. It does not register
application nodes and does not decide how many nodes should exist.

The internal record needs only a stable node ID, reachable gRPC endpoint,
lease expiry, and an opaque registration identity. Conditional renew/delete by
registration identity prevents an old process from overwriting or deleting a
new process that reused the same node ID. Expired rows are ignored immediately.
Each healthy registrar also performs a finite, idempotent expired-row cleanup
after renewing, so abandoned records do not accumulate. If all application
nodes scale to zero, expired rows are harmless and the first later node resumes
cleanup.

The recommended default endpoint is the GCE instance's private address plus
the configured gRPC port. An explicit endpoint override supports proxies,
private DNS, or other network layouts. Publishing a public address is not a
default.

## GKE Discovery

A headless Kubernetes Service publishes the ready application Pods. The
Gateway resolves that Service and reconciles the complete address set on a
configurable ten-second interval while respecting DNS TTL behavior. Kubernetes
readiness controls whether a Pod appears. No storage-backed node registry or
GCE-style registrar is involved.

## Bounded Discovery

The default accepted application-node count is 32. Implementation load tests
will select and document an absolute supported maximum.

The proposed over-limit behavior is atomic and fail-closed for cluster-wide
subscriptions:

1. If discovery returns more nodes than configured, the Gateway rejects the
   whole new snapshot. It never silently chooses the first or an arbitrary
   subset.
2. Existing streams to the last accepted node set may continue, but the
   Gateway reports degraded discovery and a subscription gap because it can no
   longer claim attachment to every current node.
3. New subscription activation is rejected until discovery returns a valid
   complete set. Commands and queries may continue through reachable nodes from
   the last accepted set because application nodes are functionally identical.
4. If no valid set has ever been accepted, the Gateway is not ready and cannot
   serve backend operations.
5. Discovery retries on its normal bounded interval. It accepts the next
   complete set that falls within the configured limit.

This behavior prevents hidden partial subscription coverage while preserving
safe, already-established command/query service when possible.

## Scaling And Replacement

Spine TS does not scale infrastructure. The GKE and GCE templates expose the
inputs that their platforms' autoscalers need, and the guide explains CPU,
request/load-balancer, and custom-metric examples. Optional autoscaling
resources are disabled until an operator chooses metrics, minimum and maximum
capacity, and thresholds.

The runtime supports:

- scaling one application version up and down, including zero nodes;
- overlap between compatible versions during a rolling replacement;
- stop-all/start-new replacement when business logic or serialized behavior is
  incompatible; and
- single-Gateway replacement with an explicit client interruption.

At zero application nodes, the Gateway reports backend unavailability. Durable
subscriptions and Inbox work remain stored. When nodes return, delivery and
subscription reconciliation resume. A scaling mechanism based only on
application-node CPU cannot wake a zero-node deployment; the platform guide
must use an external request or queue metric when scale-from-zero is required.

Pending Inbox messages may execute under the newly deployed business-logic
version. Wave 7 adds no framework version handshake and no automatic decision
about compatibility.

## Infrastructure And Documentation

Wave 7 supplies reusable Terraform modules and complete beginner guides for:

- GKE: Gateway, application Deployment, headless Service, simple delivery
  server, readiness, scaling, and rolling replacement;
- GCE: Gateway and simple delivery-server placement, managed application
  instances, leased discovery, scaling, and replacement; and
- operator-owned configuration, storage endpoints, secret references,
  monitoring inputs, and rollback.

The minimal GCE topology may colocate one Gateway and the one in-memory simple
delivery server. Production guidance recommends separate failure and resource
boundaries. Templates remain editable examples, not infrastructure enforcement.

## Questions Still Requiring Approval

1. Does the GCE registrar ownership and lifecycle above match the intended
   division of responsibility?
2. Do you approve the exact over-limit behavior above?
3. Do you approve private GCE addresses by default, with an explicit endpoint
   override?
