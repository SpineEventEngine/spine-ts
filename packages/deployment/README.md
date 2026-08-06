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
