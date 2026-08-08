# Deployment

For operators assembling a Spine Gateway with application-node discovery. For implementation contracts, read the [reference for agents](REFERENCE.md).

This package is currently private to this workspace rather than published for npm installation. Workspace consumers create `ApplicationNode` values and publish initial and replacement complete sets with `StaticNodeDiscovery`. Each snapshot is authoritative membership input; the consumer reconciler compares stable IDs, canonical HTTP(S) origins, and HTTPS TLS names. The expected 32 nodes is an operational expectation, never a routing cap.

```ts
import { ApplicationNode, StaticNodeDiscovery } from "@spine-event-engine/deployment";

const discovery = new StaticNodeDiscovery([
  new ApplicationNode({ id: "node/a", endpoint: "http://10.0.0.1:8080" }),
]);

discovery.replace([]);
```

For storage-backed GCE-style discovery, create `LeasedNodeRegistry` with both
the application's chosen `StorageFactory` and a separate operator-chosen
namespace. The registry is a discovery directory, not a domain repository or
Stand subscription registry. It persists the approved application-node lease
record with a typed node identity, registration fence, and exact millisecond
expiry. Read its [reference contract](REFERENCE.md) before assembling a
registrar or selecting a MySQL or Datastore layout.

```ts
import { ApplicationNode, LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

const factory = new InMemoryStorageFactory(); // The application owns this factory.
const registry = new LeasedNodeRegistry({ factory, namespace: "gateway-nodes" });

try {
  await registry.register({
    node: new ApplicationNode({ id: "node/a", endpoint: "https://10.0.0.1" }),
    registrationId: "process-startup-identity",
    expiresAt: Date.now() + 30_000,
  });
  const liveNodes = await registry.read(Date.now());
  await registry.cleanup(Date.now()); // Expiry filtering works even without cleanup.
} finally {
  await registry.close(); // Closes this registry handle; the caller still owns factory.close().
}
```
