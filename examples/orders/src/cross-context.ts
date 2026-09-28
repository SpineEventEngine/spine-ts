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
import { BoundedContext, ProcessManager, React } from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

import { OrderAggregate, SkuAggregate, SkuCatalogProjection } from "./index.js";
import { OrderReviewSchema } from "../generated/spine/examples/orders/entities_pb.js";
import {
  type OrderCreated,
  type OrderReviewed,
  OrderReviewedSchema,
} from "../generated/spine/examples/orders/events_pb.js";
import { SkuCatalogSchema } from "../generated/spine/examples/orders/read_models_pb.js";

/**
 * Reviews each order using the catalog available when its creation event arrives.
 *
 * The catalog projection is eventually consistent. A missing catalog record
 * leaves the captured name empty; callers can wait for catalog visibility
 * before placing an order that requires the current name.
 */
export class OrderReview extends ProcessManager<string, typeof OrderReviewSchema> {
  // prettier-ignore

  /**
   * Copies the current catalog name into the review for an ordered SKU.
   *
   * @param event The newly placed order.
   * @returns An Event recording the name captured in the review.
   */
  @React async onOrderCreated(event: OrderCreated): Promise<OrderReviewed> {
    // An ID lookup needs no declared filter columns.
    const catalog = await this.select(SkuCatalogSchema, {})
      .byId(event.skuId)
      .read();
    const skuName = catalog[0]?.value ?? "";
    this.update((draft) => {
      Object.assign(draft, create(OrderReviewSchema, {
        id: event.id,
        skuId: event.skuId,
        skuName,
      }));
    });
    return create(OrderReviewedSchema, {
      id: event.id,
      skuId: event.skuId,
      skuName,
    });
  }
}

/**
 * Assembles the separate catalog and ordering contexts for one server.
 */
export const OrderReviewContexts: Readonly<{
  create(storageFactory: StorageFactory): Promise<{
    readonly catalog: BoundedContext;
    readonly orders: BoundedContext;
  }>;
}> = Object.freeze({
  /**
   * Builds two registrations without changing the load-demo topology.
   *
   * @param storageFactory Storage shared by the two registrations.
   * @returns The catalog and ordering contexts.
   */
  async create(storageFactory) {
    const registryRoot = new URL("..", import.meta.url);
    const catalog = await BoundedContext.singleTenant("Catalog")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(registryRoot)
      .add(SkuAggregate)
      .add(SkuCatalogProjection)
      .buildAsync();
    const orders = await BoundedContext.singleTenant("Ordering")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(registryRoot)
      .add(OrderAggregate)
      .add(OrderReview)
      .buildAsync();
    return { catalog, orders };
  },
});
