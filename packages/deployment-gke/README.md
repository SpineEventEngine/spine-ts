# GKE DNS discovery

`@spine-event-engine/deployment-gke` lets one standalone Gateway discover ready application Pods through a Kubernetes headless Service. It is for operators and application developers assembling the Gateway; see the [agent reference](REFERENCE.md) for the exact runtime contract.

Create discovery with the Service DNS name and the private gRPC port, then add
it to a standalone Gateway's `browser.discovery` option:

```ts
import { GkeNodeDiscovery } from "@spine-event-engine/deployment-gke";
import { Server } from "@spine-event-engine/server";

declare const gatewayServerOptions: Omit<
  import("@spine-event-engine/server").ServerOptions,
  "port" | "browser"
> & { browser: import("@spine-event-engine/server").BrowserServerOptions };

const discovery = new GkeNodeDiscovery({
  serviceName: "application.default.svc.cluster.local",
  port: 8080,
  scheme: "https",
});
const gateway = Server.atPort(8081, {
  ...gatewayServerOptions,
  browser: { ...gatewayServerOptions.browser, discovery },
});
const runningGateway = await gateway.run();

void runningGateway;
```

The headless Service and Pod readiness determine membership. DNS answers are complete snapshots: a ready Pod entering or leaving the answer adds or removes its Gateway connection and native subscription streams. When all Pods scale to zero, the Gateway remains running and reports backend unavailability until a later valid answer restores routing.

The default refresh interval is ten seconds. Positive DNS TTLs can make the next lookup sooner; empty and name-not-found answers refresh at the configured interval. HTTPS connects to Pod IP addresses while retaining the configured Service name for certificate verification and SNI. No registry, Kubernetes API watch, public-address inference, hard node limit, or count diagnostics API is used.

Kubernetes manifests, Terraform, and beginner deployment procedures are outside
this package. It does not select authentication, storage, application logic, or
autoscaling policy.
