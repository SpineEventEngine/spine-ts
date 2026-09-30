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
import { BoundedContext, EventRouting, Projection, Subscribe } from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

import { OrderAggregate, SkuAggregate } from "./index.js";
import {
  type OrderCreated,
  type SkuRegistered,
  OrderCreatedSchema,
  SkuRegisteredSchema,
} from "../generated/spine/examples/orders/events_pb.js";
import { OrderCardSchema } from "../generated/spine/examples/orders/order_cards_pb.js";
import { OrderCardQuery } from "../generated/spine/examples/orders/order_cards_query.js";

/**
 * Displays an order card updated by later SKU registration Events.
 */
export class OrderCard extends Projection<string, typeof OrderCardSchema> {
  // prettier-ignore

  /**
   * Creates a card at the order ID supplied by the creation Event.
   *
   * @param event The newly created order.
   */
  @Subscribe onOrderCreated(event: OrderCreated): void {
    this.update((draft) => Object.assign(draft, create(OrderCardSchema, {
      id: event.id,
      skuId: event.skuId,
    })));
  }

  // prettier-ignore

  /**
   * Updates the displayed name for a card selected by its SKU ID.
   *
   * @param event The registered SKU and its display name.
   */
  @Subscribe onSkuRegistered(event: SkuRegistered): void {
    this.update((draft) => {
      draft.skuName = event.displayName;
    });
  }

  /**
   * Checks whether this card already displays the registered name.
   *
   * @param name The name carried by the current registration Event.
   * @returns Whether delivery would change the displayed name.
   */
  needsSkuName(name: string): boolean {
    return this.state.skuName !== name;
  }
}

/**
 * Builds the independent order-card demonstration context.
 */
export const OrderCardContext: Readonly<{
  create(storageFactory: StorageFactory): Promise<BoundedContext>;
}> = Object.freeze({
  /**
   * Registers the order-card route separately from the fixed load topology.
   *
   * @param storageFactory Storage for the demonstration context.
   * @returns A context ready for server registration or local commands.
   */
  async create(storageFactory) {
    const routes = EventRouting.create(OrderCard)
      .route(OrderCreatedSchema, (event) => [event.id])
      .route(SkuRegisteredSchema, async (event, _context, repository) => {
        // The query module supplies its columns; the receiving repository applies the Event tenant.
        const query = OrderCardQuery.create().skuId().is(event.id).build();
        const cards = await repository.find(query);
        // find() returns application Entities, so this method can skip unchanged cards.
        return cards.filter((card) => card.needsSkuName(event.displayName)).map((card) => card.id);
      });
    return BoundedContext.singleTenant("Order cards")
      .withStorageFactory(storageFactory)
      .withGeneratedRegistryRoot(new URL("..", import.meta.url))
      .add(OrderAggregate)
      .add(SkuAggregate)
      .add(OrderCard, { eventRouting: routes })
      .buildAsync();
  },
});
