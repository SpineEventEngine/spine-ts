# GCE registration and discovery

`@spine-event-engine/deployment-gce` lets a GCE application process publish its
ready gRPC listener in a caller-owned leased registry. A standalone Gateway
reads that registry as complete live-node snapshots for routing and durable
subscriptions.

The application process owns its registrar and the Gateway process owns its
discovery. Both processes receive the same explicit storage factory and
registry namespace. This package does not choose a storage backend,
authentication provider, public address, Terraform module, deployment
procedure, or autoscale policy. Use the separate project deployment guide for
Terraform modules and deployment procedures.

## Application process

The Compute Engine metadata server is available to software running on the VM.
It is not an identity boundary: any process that can run on that VM can request
its metadata. Treat VM process access and the private network as trusted
operator-controlled boundaries. `GceMetadataService` sends the required
`Metadata-Flavor: Google` header, then derives the stable node ID
`gce/<project-id>/<zone>/<numeric-instance-id>` from the current VM.

Create the registry with your storage factory and a namespace shared by all
application nodes and the Gateway. Attach the registrar before startup; the
server starts it only after the gRPC listener is reachable.

```ts
import { LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { GceMetadataService, GceRegistrar } from "@spine-event-engine/deployment-gce";
import { Server } from "@spine-event-engine/server";

const registry = new LeasedNodeRegistry({
  factory: storageFactory, // your StorageFactory
  namespace: "production-application-nodes",
});
const registrar = new GceRegistrar({
  registry,
  metadata: new GceMetadataService(),
  port: 8080,
});
const application = Server.atPort(8080, applicationServerOptions);
application.addListenerLifecycle(registrar.lifecycle());
const runningApplication = await application.run();
```

By default the published endpoint is private-address HTTP plus `port`; IPv6 is
bracketed. For private DNS, a proxy, or HTTPS, create the node explicitly with
`GceApplicationNode.create(metadata, { port, endpoint, tlsServerName })` and
pass it as `node`. Public-address selection is never implicit.

Registration uses a new opaque identity per process, renews every 20 seconds,
and expires after 60 seconds. An unknown initial write is read-confirmed before
a same-identity retry. Each metadata and registry operation is deadline-bound;
production timers do not keep Node.js alive on their own.

## Standalone Gateway process

Give the Gateway a registry reader with the same factory/namespace and put it
in `browser.discovery` within your existing standalone Gateway options. The
reader publishes complete snapshots—including empty membership—to the Gateway.
`ScheduledNodeDiscovery` refreshes every ten seconds by default.

```ts
import { LeasedNodeRegistry, ScheduledNodeDiscovery } from "@spine-event-engine/deployment";
import { GceRegistryReader } from "@spine-event-engine/deployment-gce";
import { Server } from "@spine-event-engine/server";

const registry = new LeasedNodeRegistry({
  factory: storageFactory,
  namespace: "production-application-nodes",
});
const discovery = new ScheduledNodeDiscovery({
  reader: new GceRegistryReader(registry),
});
const gateway = Server.atPort(8081, {
  ...gatewayServerOptions,
  browser: { ...gatewayServerOptions.browser, discovery },
});
const runningGateway = await gateway.run();
```

When every lease expires, discovery publishes an empty set and the Gateway
reports backend unavailability while continuing refreshes. A later registered
node restores routing and subscription reconciliation. Healthy registrars also
perform finite cleanup of abandoned expired rows.

On application shutdown, call `runningApplication.close()`: the listener
lifecycle first stops scheduling, aborts and joins admitted work, and
conditionally removes only its own lease before listener network close. Close
the Gateway's running server and its registry when that process exits; close
the storage factory only when its owning process no longer needs it.

See [REFERENCE.md](REFERENCE.md) for API contracts and metadata failure
semantics. The separate project deployment guide supplies Terraform modules and
deployment procedures.
