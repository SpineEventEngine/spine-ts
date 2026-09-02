# Application-node discovery for Spine TS

`@spine-event-engine/deployment` helps a Gateway learn which application nodes
are ready. It is for operators and application-infrastructure developers
deploying a combined or distributed Spine TS application.

This is an experimental snapshot package. You need Node 24 or newer, an
application node endpoint, and—only for leased discovery—a configured
`StorageFactory`. Read the [reference](REFERENCE.md) before production work;
it defines discovery, lease, and shutdown semantics.

## Install

```sh
pnpm add @spine-event-engine/deployment@snapshot
```

The `snapshot` tag can change before a stable release.

## First success: publish one known node

Use static discovery for local development or a combined deployment. Each
replacement is the complete authoritative membership set, not an incremental
update.

<!-- docs-snippet-path: packages/deployment/src/index.ts -->

```ts
import { ApplicationNode, StaticNodeDiscovery } from "@spine-event-engine/deployment";

const discovery = new StaticNodeDiscovery([
  new ApplicationNode({ id: "node/a", endpoint: "http://127.0.0.1:8080" }),
]);

let published: readonly ApplicationNode[] = [];
const stop = discovery.watch((nodes) => {
  published = nodes;
});
try {
  if (published[0]?.id !== "node/a") throw new Error("The static node was not published.");
} finally {
  await stop();
}
```

## When nodes are independently replaced

Use `LeasedNodeRegistry` with the application's `StorageFactory` and an
operator-chosen namespace. A registration identity is a fence: an older process
cannot renew or remove a newer lease after a node ID is reused.

```ts
import { ApplicationNode, LeasedNodeRegistry } from "@spine-event-engine/deployment";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

const factory = new InMemoryStorageFactory();
const registry = new LeasedNodeRegistry({ factory, namespace: "gateway-nodes" });

try {
  await registry.register({
    node: new ApplicationNode({ id: "node/a", endpoint: "https://10.0.0.1" }),
    registrationId: "process-startup-identity",
    expiresAt: Date.now() + 30_000,
  });
  const liveNodes = await registry.read(Date.now());
  void liveNodes;
} finally {
  await registry.close();
  factory.close();
}
```

## Limits and next steps

Discovery is not a domain repository, a Stand subscription registry, or a
routing cap; an expected node count is only an operational expectation. The
registry does not provide a public deployment API or select storage settings
for you. Read the [reference](REFERENCE.md) for expiry, cleanup, TLS-origin,
and reconciliation rules, then choose [Datastore](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/storage-datastore/README.md)
or [MySQL](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/storage-rdbms/README.md) when durable leases are required.
