# GCE registration and discovery

Use this package when a GCE application process must publish itself after its gRPC listener is reachable. It derives a stable node ID from trusted instance metadata, publishes a private HTTP endpoint by default, and renews a lease every 20 seconds with a 60-second expiry.

Create the generic leased registry with your application's storage factory and namespace, create the node from metadata, and start the registrar only after the listener is ready. Close the registrar before closing the listener so its owned lease is removed first.

```ts
const node = GceApplicationNode.create(metadata, { port: 8080 });
const registrar = new GceRegistrar({ registry, node, identity, scheduler, now: Date.now });
await registrar.start();
// On shutdown: await registrar.close(); then close the listener.
```

An explicit endpoint and TLS server-name override supports private DNS or proxies. The package never selects a public address, storage backend, authentication method, or infrastructure configuration. For lifecycle and API details, see the [reference](REFERENCE.md).
