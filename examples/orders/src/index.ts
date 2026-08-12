/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

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
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import type { Datastore } from "@google-cloud/datastore";

import {
  type CreateOrder,
  type RegisterSku,
} from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSchema, SkuSchema } from "../generated/spine/examples/orders/entities_pb.js";
import {
  OrderCreatedSchema,
  SkuRegisteredSchema,
  type OrderCreated,
  type SkuRegistered,
} from "../generated/spine/examples/orders/events_pb.js";
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
} from "../generated/spine/examples/orders/read_models_pb.js";

/**
 * Represents the order aggregate in the fixed topology.
 */
export class OrderAggregate extends Aggregate<string, typeof OrderSchema> {
  // prettier-ignore

  /**
   * Creates an order and emits its creation event.
   *
   * @param command The requested order creation.
   * @returns The event recording the created order.
   */
  @Assign createOrder(command: CreateOrder): OrderCreated {
    this.update((draft) =>
      Object.assign(draft, create(OrderSchema, { id: this.id, skuId: command.skuId })),
    );
    return create(OrderCreatedSchema, { id: this.id, skuId: command.skuId });
  }
}

/**
 * Represents the SKU aggregate in the fixed topology.
 */
export class SkuAggregate extends Aggregate<string, typeof SkuSchema> {
  // prettier-ignore

  /**
   * Registers a SKU and emits its registration event.
   *
   * @param command The requested SKU registration.
   * @returns The event recording the registered SKU.
   */
  @Assign registerSku(command: RegisterSku): SkuRegistered {
    this.update((draft) =>
      Object.assign(draft, create(SkuSchema, { id: this.id, displayName: command.displayName })),
    );
    return create(SkuRegisteredSchema, { id: this.id, displayName: command.displayName });
  }
}

/**
 * Represents a fixed-topology row that records an order ID and SKU ID.
 */
export class OrderSummaryProjection extends Projection<string, typeof OrderSummarySchema> {
  // prettier-ignore

  /**
   * Records an order ID and SKU ID in the fixed-topology row.
   *
   * @param event The order-created event that supplies the values.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderSummarySchema, { id: event.id, value: event.skuId })),
    );
  }
}

/**
 * Represents a fixed-topology row that records an order ID and SKU ID.
 */
export class SalesSummaryProjection extends Projection<string, typeof SalesSummarySchema> {
  // prettier-ignore

  /**
   * Records an order ID and SKU ID in the fixed-topology row.
   *
   * @param event The order-created event that supplies the values.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesSummarySchema, { id: event.id, value: event.skuId })),
    );
  }
}

/**
 * Represents a fixed-topology row that records an order ID and SKU ID.
 */
export class OrderSkuViewProjection extends Projection<string, typeof OrderSkuViewSchema> {
  // prettier-ignore

  /**
   * Records an order ID and SKU ID in the fixed-topology row.
   *
   * @param event The order-created event that supplies the values.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderSkuViewSchema, { id: event.id, value: event.skuId })),
    );
  }
}

/**
 * Represents a fixed-topology row that records an order ID and SKU ID.
 */
export class OrderAuditViewProjection extends Projection<string, typeof OrderAuditViewSchema> {
  // prettier-ignore

  /**
   * Records an order ID and SKU ID in the fixed-topology row.
   *
   * @param event The order-created event that supplies the values.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(OrderAuditViewSchema, { id: event.id, value: event.skuId })),
    );
  }
}

/**
 * Represents a fixed-topology row that records an order ID and SKU ID.
 */
export class SalesFeedProjection extends Projection<string, typeof SalesFeedSchema> {
  // prettier-ignore

  /**
   * Records an order ID and SKU ID in the fixed-topology row.
   *
   * @param event The order-created event that supplies the values.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesFeedSchema, { id: event.id, value: event.skuId })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a SKU ID and display name.
 */
export class SkuCatalogProjection extends Projection<string, typeof SkuCatalogSchema> {
  // prettier-ignore

  /**
   * Records a SKU ID and display name in the fixed-topology row.
   *
   * @param event The SKU-registered event that supplies the values.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuCatalogSchema, { id: event.id, value: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a SKU ID and display name.
 */
export class SkuSalesViewProjection extends Projection<string, typeof SkuSalesViewSchema> {
  // prettier-ignore

  /**
   * Records a SKU ID and display name in the fixed-topology row.
   *
   * @param event The SKU-registered event that supplies the values.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuSalesViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a SKU ID and display name.
 */
export class SkuAuditViewProjection extends Projection<string, typeof SkuAuditViewSchema> {
  // prettier-ignore

  /**
   * Records a SKU ID and display name in the fixed-topology row.
   *
   * @param event The SKU-registered event that supplies the values.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SkuAuditViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a SKU ID and display name.
 */
export class InventoryViewProjection extends Projection<string, typeof InventoryViewSchema> {
  // prettier-ignore

  /**
   * Records a SKU ID and display name in the fixed-topology row.
   *
   * @param event The SKU-registered event that supplies the values.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(InventoryViewSchema, { id: event.id, value: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology row that records a SKU ID and display name.
 */
export class SalesSkuIndexProjection extends Projection<string, typeof SalesSkuIndexSchema> {
  // prettier-ignore

  /**
   * Records a SKU ID and display name in the fixed-topology row.
   *
   * @param event The SKU-registered event that supplies the values.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) =>
      Object.assign(draft, create(SalesSkuIndexSchema, { id: event.id, value: event.displayName })),
    );
  }
}

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class OrderSalesManager extends ProcessManager<string, typeof OrderSalesManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for an order-created event.
   *
   * @param event The order-created event that triggers the update.
   */
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

/**
 * Represents a fixed-topology process manager with a generic update counter.
 */
export class SkuSalesManager extends ProcessManager<string, typeof SkuSalesManagerSchema> {
  // prettier-ignore

  /**
   * Updates the generic counter by incrementing it for a SKU-registered event.
   *
   * @param event The SKU-registered event that triggers the update.
   */
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

/**
 * Lists the fixed datastore-orders registration topology.
 */
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

/**
 * Builds the domain with a provider-neutral storage factory supplied at composition.
 *
 * @param storageFactory The storage factory used by the bounded context.
 * @returns The assembled datastore-orders bounded context.
 */
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

/**
 * Configures the datastore-orders server binding.
 */
export interface DatastoreOrdersServerOptions {
  // prettier-ignore

  /**
   * Specifies the network host to bind.
   */
  readonly host?: string;

  /**
   * Specifies the network port to bind.
   */
  readonly port?: number;
}

/**
 * Starts a datastore-orders server with the supplied storage factory.
 *
 * @param storageFactory The storage factory used by the bounded context.
 * @param options The network binding options for the server.
 * @returns The running datastore-orders server.
 */
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

/**
 * Creates a Datastore-backed server without leaking provider types into domain handlers.
 *
 * @param client The caller-owned Datastore client used to create the factory.
 * @param options The network binding options for the server.
 * @returns The running Datastore-backed server.
 */
export async function startOrdersDatastoreServer(
  client: Datastore,
  options: DatastoreOrdersServerOptions = {},
): Promise<RunningServer> {
  return startDatastoreOrdersServer(
    DatastoreStorageFactory.newBuilder().setClient(client).build(),
    options,
  );
}
