import { create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  BoundedContext,
  ProcessManager,
  Projection,
  Server,
  Subscribe,
  type RunningServer,
} from "@spine-event-engine/server";

export { datastoreOrdersProtoModule } from "../generated/proto-module.js";
import type { StorageFactory } from "@spine-event-engine/storage";
import {
  DatastoreStorageFactory,
  type DatastoreStorageOptions,
} from "@spine-event-engine/storage-datastore";

import {
  type CreateOrder,
  type RegisterSku,
} from "../generated/spine/example/datastore_orders/v1/commands_pb.js";
import {
  OrderSchema,
  SkuSchema,
} from "../generated/spine/example/datastore_orders/v1/entities_pb.js";
import {
  OrderCreatedSchema,
  SkuRegisteredSchema,
  type OrderCreated,
  type SkuRegistered,
} from "../generated/spine/example/datastore_orders/v1/events_pb.js";
import {
  InventoryViewSchema,
  OrderAuditViewSchema,
  OrderSalesManagerSchema,
  OrderSkuViewSchema,
  OrderSummarySchema,
  SalesFeedSchema,
  SalesSkuIndexSchema,
  SalesSummarySchema,
  SkuAuditViewSchema,
  SkuCatalogSchema,
  SkuSalesManagerSchema,
  SkuSalesViewSchema,
} from "../generated/spine/example/datastore_orders/v1/read_models_pb.js";

export class OrderAggregate extends Aggregate<string, typeof OrderSchema> {
  @Assign createOrder(command: CreateOrder): OrderCreated {
    this.update((draft) =>
      Object.assign(draft, create(OrderSchema, { id: this.id, skuId: command.skuId })),
    );
    return create(OrderCreatedSchema, { id: this.id, skuId: command.skuId });
  }
}

export class SkuAggregate extends Aggregate<string, typeof SkuSchema> {
  @Assign registerSku(command: RegisterSku): SkuRegistered {
    this.update((draft) =>
      Object.assign(draft, create(SkuSchema, { id: this.id, displayName: command.displayName })),
    );
    return create(SkuRegisteredSchema, { id: this.id, displayName: command.displayName });
  }
}

export class OrderSummaryProjection extends Projection<string, typeof OrderSummarySchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderSummarySchema, { id: event.id, value: event.skuId })),
    );
  }
}
export class SalesSummaryProjection extends Projection<string, typeof SalesSummarySchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesSummarySchema, { id: event.id, value: event.skuId })),
    );
  }
}
export class OrderSkuViewProjection extends Projection<string, typeof OrderSkuViewSchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderSkuViewSchema, { id: event.id, value: event.skuId })),
    );
  }
}
export class OrderAuditViewProjection extends Projection<string, typeof OrderAuditViewSchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderAuditViewSchema, { id: event.id, value: event.skuId })),
    );
  }
}
export class SalesFeedProjection extends Projection<string, typeof SalesFeedSchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesFeedSchema, { id: event.id, value: event.skuId })),
    );
  }
}
export class SkuCatalogProjection extends Projection<string, typeof SkuCatalogSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuCatalogSchema, { id: event.id, value: event.displayName })),
    );
  }
}
export class SkuSalesViewProjection extends Projection<string, typeof SkuSalesViewSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuSalesViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}
export class SkuAuditViewProjection extends Projection<string, typeof SkuAuditViewSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuAuditViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}
export class InventoryViewProjection extends Projection<string, typeof InventoryViewSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(InventoryViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}
export class SalesSkuIndexProjection extends Projection<string, typeof SalesSkuIndexSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesSkuIndexSchema, { id: event.id, value: event.displayName })),
    );
  }
}

export class OrderSalesManager extends ProcessManager<string, typeof OrderSalesManagerSchema> {
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(OrderSalesManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}
export class SkuSalesManager extends ProcessManager<string, typeof SkuSalesManagerSchema> {
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(
        draft,
        create(SkuSalesManagerSchema, { id: this.id, updates: draft.updates + 1 }),
      ),
    );
    void event;
  }
}

export const datastoreOrdersTopology = {
  aggregates: ["OrderAggregate", "SkuAggregate"],
  processManagers: ["OrderSalesManager", "SkuSalesManager"],
  projections: [
    "OrderSummaryProjection",
    "SalesSummaryProjection",
    "OrderSkuViewProjection",
    "OrderAuditViewProjection",
    "SalesFeedProjection",
    "SkuCatalogProjection",
    "SkuSalesViewProjection",
    "SkuAuditViewProjection",
    "InventoryViewProjection",
    "SalesSkuIndexProjection",
  ],
} as const;

/** Builds the domain with a provider-neutral storage factory supplied at composition. */
export async function createDatastoreOrdersContext(
  storageFactory: StorageFactory,
): Promise<BoundedContext> {
  return BoundedContext.singleTenant("DatastoreOrders")
    .withStorageFactory(storageFactory)
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(OrderAggregate)
    .add(SkuAggregate)
    .add(OrderSummaryProjection)
    .add(SalesSummaryProjection)
    .add(OrderSkuViewProjection)
    .add(OrderAuditViewProjection)
    .add(SalesFeedProjection)
    .add(SkuCatalogProjection)
    .add(SkuSalesViewProjection)
    .add(SkuAuditViewProjection)
    .add(InventoryViewProjection)
    .add(SalesSkuIndexProjection)
    .add(OrderSalesManager)
    .add(SkuSalesManager)
    .buildAsync();
}

export interface DatastoreOrdersServerOptions {
  readonly host?: string;
  readonly port?: number;
}
export async function startDatastoreOrdersServer(
  storageFactory: StorageFactory,
  options: DatastoreOrdersServerOptions = {},
): Promise<RunningServer> {
  return Server.atPort(options.port ?? 0, {
    host: options.host ?? "127.0.0.1",
    services: { subscriptionLimit: 1_000 },
  })
    .add(await createDatastoreOrdersContext(storageFactory))
    .start();
}

/** Creates a Datastore-backed server without leaking provider types into domain handlers. */
export async function startDatastoreOrdersDatastoreServer(
  datastore: DatastoreStorageOptions,
  options: DatastoreOrdersServerOptions = {},
): Promise<RunningServer> {
  return startDatastoreOrdersServer(DatastoreStorageFactory.create(datastore), options);
}
