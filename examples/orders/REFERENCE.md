# Orders example reference

This reference describes the current Orders code for agents and maintainers.
The [README](README.md) starts with the runnable memory workflow.

## Assemblies

`configureOrdersEnvironment({ storageFactory, tenants })` opens a
`PersistentTenantIndex`, registers only the supplied complete `TenantId`
messages, and configures `ServerEnvironment` once. Assemble Bounded Contexts
after this call. Close a running server before calling `setup.close()`, which
closes the index and environment facilities. `startOrdersServer(options)`
returns a `RunningServer`; its close drains and closes the Orders Bounded
Context. A failed server start closes the assembled context.

`createOrdersContext()` registers two Aggregates, ten Projections, and two
Process Managers. `OrderReviewContexts.create()` returns `Catalog` and
`Ordering` as separate Bounded Contexts. `OrderCardContext.create()` registers
the order-card routing demonstration. All four assemblies call
`BoundedContext.multitenant` and consume the configured environment. None
reconfigures the process singleton.

The supported stable tenant values are `ordersTenants.northwind` and
`ordersTenants.contoso`. Membership and storage routing are separate. Commands,
queries, and subscriptions require the complete tenant identity. Missing or
unknown tenants fail without adding membership or writing order state.

`OrderReview.onOrderCreated` reads `SkuCatalogQuery` through the Process Manager
`select(query)` API. The read uses the triggering tenant. The catalog row is
eventually consistent, so a missing row yields an empty captured name.
`OrderCardContext` routes `SkuRegistered` by querying `OrderCard` rows within
the Event tenant. `OrderCard.needsSkuName()` avoids unnecessary updates. Neither
demonstration changes the fourteen-repository load topology.

`OrderSalesManager.onOrderCreated` is a state-only `@React` handler returning
`undefined`. The framework persists its counter without an outgoing Event.
Other subscription handlers use `void`.

## Load runner

`runOrdersLoad` accepts exactly 10, 100, or 1000 users and a nonempty tenant
list. It assigns users round robin across the supplied tenants. Each user has
a fresh order ID and command/query/subscription identity. The actor context
carries the selected tenant to all three gRPC services. The result includes
aggregate counts, latency percentiles, throughput, failure classifications,
and per-tenant counts. Existing client behavior shares at most 16 HTTP/2
sessions and runs users in waves of at most 10; each visibility operation uses
the existing deadline and abort controller.

## Provider boundary

The bootstrap accepts a `StorageFactory`; provider-specific construction stays
outside domain handlers. For Datastore, a complete tenant selects its namespace,
a record family selects a kind, and a record ID selects the key. The memory
factory supports local execution but the memory directory is not durable.
PostgreSQL runtime configuration and persisted-membership restart checks are
pending the next slice.

Generated Protobuf and handler files are build outputs. Regenerate them through
workspace scripts and do not edit them directly.

## Focused verification

```bash
pnpm exec tsc -b examples/orders --pretty false
pnpm exec vitest run examples/orders/test --maxWorkers=1
```

The current focused tests use memory and loopback gRPC. They do not establish
PostgreSQL restart persistence or Datastore emulator behavior.
