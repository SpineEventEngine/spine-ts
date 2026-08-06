# GCE registration and discovery

`@spine-event-engine/deployment-gce` registers a ready GCE application process
in a caller-owned `LeasedNodeRegistry` and exposes its live rows to the
standalone Gateway through `ScheduledNodeDiscovery`.

The registry storage factory and namespace are explicit operator decisions. The
package neither selects a storage backend nor creates an authentication,
Terraform, autoscaling, or public-address configuration. Terraform and
beginner deployment procedures arrive in T-0127.

## Application-node assembly

`GceMetadataService` reads the GCE metadata service with the required
`Metadata-Flavor: Google` header. It needs permission to read the current
instance project ID, zone, numeric instance ID, and first private network
interface address. `GceApplicationNode.create()` derives the stable ID
`gce/<project-id>/<zone>/<numeric-instance-id>`.

The default endpoint is an HTTP origin built from the private address and the
configured gRPC port. IPv6 addresses are bracketed. A canonical endpoint and
TLS-server-name can be supplied for private DNS, proxies, or HTTPS; public
address selection is never implicit.

```ts
const metadata = new GceMetadataService();
const node = GceApplicationNode.create(await metadata.read(new AbortController().signal), {
  port: 8080,
  endpoint: "https://app.internal.example",
  tlsServerName: "app.internal.example",
});
const registrar = new GceRegistrar({ registry, node });
```

## Lifecycle and discovery

Attach `registrar.lifecycle()` to the application `Server` before startup. The
server starts it only after its gRPC listener is reachable. Registration uses a
new opaque identity per process, renews every 20 seconds, and sets a 60-second
lease expiry. A lost initial response is read-confirmed before one
same-identity conditional retry. Every metadata or registry operation has a
cooperative deadline; production timers are unref'ed.

```ts
server.addListenerLifecycle(registrar.lifecycle());
```

On shutdown, the lifecycle first cancels scheduling, aborts and joins admitted
metadata/registry work, then conditionally removes only its own lease. Only
after that attempt settles does server listener shutdown continue. Crashed
process rows simply become undiscoverable at expiry; a healthy later registrar
performs finite expired-row cleanup.

For Gateway assembly, pass a `GceRegistryReader` to `ScheduledNodeDiscovery`.
It supplies complete live snapshots (including an empty snapshot) to the
existing dynamic Gateway, whose default refresh interval is ten seconds.

See [REFERENCE.md](REFERENCE.md) for public API contracts and failure details.
