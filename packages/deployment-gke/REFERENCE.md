# Reference

The [deployment guide](README.md) is for people deploying an application. This
reference records the exact package and Terraform-template contract for agents.

## Discovery package

`GkeNodeDiscovery` implements `NodeDiscovery`. It reads A and AAAA answers for
a headless-Service DNS name and publishes each successful answer as a complete
application-node snapshot. Its default refresh interval is 10 seconds. A
positive DNS TTL can schedule an earlier refresh; zero, missing, and unusable
TTLs use the configured interval. Empty and name-not-found answers publish an
empty snapshot immediately and retry at the configured interval.

HTTPS connects to Pod IP addresses while retaining the configured Service name
for TLS server-name verification. Resolver failures retain the last valid
membership until its deadline, then publish one empty snapshot while retries
continue. `close()` cancels timers and resolver work, waits for admitted work,
and prevents later snapshots.

## Terraform template

`terraform/` targets an existing Kubernetes context. It does not provision a
GKE cluster. The module uses versioned Kubernetes-provider resources and keeps
the three process Services private. `application` is headless with
`publish_not_ready_addresses = false`; its ready endpoint addresses are the
Gateway discovery source. `gateway` and `delivery` each have exactly one
replica. The delivery server is in-memory and not highly available.

The module creates no Kubernetes Secret and accepts only the names of
operator-created application and Gateway Secrets. It selects no storage engine,
identity provider, public load balancer, TLS certificate, Cloud Run service, or
application command. Application code configures `GkeNodeDiscovery` and its
own storage, identity, and public-edge integration.

`autoscaling_enabled` defaults to `false`. When true, the module creates one
external-metric HPA with the operator's metric, target, minimum, and maximum
and omits the Deployment replica value, leaving capacity ownership with the
HPA. When false, Terraform manages `application_replicas`. The HPA is not a
scale-to-zero mechanism; external request or queue activation such as
operator-managed KEDA is required for that behavior on Standard GKE.
