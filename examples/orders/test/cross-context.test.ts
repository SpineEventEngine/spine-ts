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
import { AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { Server, SignalMetadata } from "@spine-event-engine/server";
import { describe, expect, it, vi } from "vitest";

import {
  CreateOrderSchema,
  RegisterSkuSchema,
} from "../generated/spine/examples/orders/commands_pb.js";
import { OrderReviewSchema, OrderSchema } from "../generated/spine/examples/orders/entities_pb.js";
import { SkuCatalogSchema } from "../generated/spine/examples/orders/read_models_pb.js";

const metadata = new SignalMetadata();

describe("cross-context Orders example", () => {
  it("copies the catalog name into an order review through a Process Manager query", async () => {
    const { OrderReviewContexts, OrderReview } = await import("../dist/src/cross-context.js");
    const reviewHandler = vi.spyOn(OrderReview.prototype, "onOrderCreated");
    const { catalog, orders } = await OrderReviewContexts.create(new InMemoryStorageFactory());
    const running = await Server.atPort(0).add(catalog).add(orders).start();
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-reviewer" }),
    });

    try {
      await catalog.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyMessages.pack(
            RegisterSkuSchema,
            create(RegisterSkuSchema, { id: "sku-1", displayName: "Blue mug" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await catalog.stand().readAllVersioned(SkuCatalogSchema);
        expect(states[0]?.state.value).toBe("Blue mug");
      });
      await orders.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyMessages.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id: "order-1", skuId: "sku-1" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await orders.stand().readAllVersioned(OrderSchema);
        expect(states[0]?.state.skuId).toBe("sku-1");
      });
      await vi.waitFor(() => {
        expect(reviewHandler).toHaveBeenCalled();
      });
      expect(await reviewHandler.mock.results[0]?.value).toMatchObject({
        id: "order-1",
        skuId: "sku-1",
        skuName: "Blue mug",
      });
      await vi.waitFor(async () => {
        const states = await orders.stand().readAllVersioned(OrderReviewSchema);
        expect(states[0]?.state).toMatchObject({
          id: "order-1",
          skuId: "sku-1",
          skuName: "Blue mug",
        });
      });
    } finally {
      await running.close();
    }
  });

  it("captures an empty name when the SKU is absent from the eventual catalog", async () => {
    const { OrderReviewContexts } = await import("../dist/src/cross-context.js");
    const { catalog, orders } = await OrderReviewContexts.create(new InMemoryStorageFactory());
    const running = await Server.atPort(0).add(catalog).add(orders).start();
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-reviewer" }),
    });

    try {
      await orders.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyMessages.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id: "order-missing", skuId: "sku-missing" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await orders.stand().readAllVersioned(OrderReviewSchema);
        expect(states[0]?.state).toMatchObject({
          id: "order-missing",
          skuId: "sku-missing",
          skuName: "",
        });
      });
    } finally {
      await running.close();
    }
  });
});
