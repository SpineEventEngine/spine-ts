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
import { AnyPacker } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { Server, SignalMetadata } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  await ServerTests.resetEnvironment();
});

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
    const { configureOrdersEnvironment, ordersTenants } = await import("../dist/src/index.js");
    const setup = await configureOrdersEnvironment({
      storageFactory: new InMemoryStorageFactory(),
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    });
    const { catalog, orders } = await OrderReviewContexts.create();
    const running = await Server.atPort(0).add(catalog).add(orders).start();
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-reviewer" }),
      tenantId: ordersTenants.northwind,
    });

    try {
      await catalog.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyPacker.pack(
            RegisterSkuSchema,
            create(RegisterSkuSchema, { id: "sku-1", displayName: "Blue mug" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await catalog
          .stand()
          .readAllVersioned(SkuCatalogSchema, { tenantId: ordersTenants.northwind });
        expect(states[0]?.state.value).toBe("Blue mug");
      });
      await orders.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyPacker.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id: "order-1", skuId: "sku-1" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await orders
          .stand()
          .readAllVersioned(OrderSchema, { tenantId: ordersTenants.northwind });
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
        const states = await orders
          .stand()
          .readAllVersioned(OrderReviewSchema, { tenantId: ordersTenants.northwind });
        expect(states[0]?.state).toMatchObject({
          id: "order-1",
          skuId: "sku-1",
          skuName: "Blue mug",
        });
      });
      const contosoActor = metadata.actorContext({
        actor: create(UserIdSchema, { value: "orders-reviewer" }),
        tenantId: ordersTenants.contoso,
      });
      await catalog.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext: contosoActor }),
          message: AnyPacker.pack(
            RegisterSkuSchema,
            create(RegisterSkuSchema, {
              id: "sku-1",
              displayName: "Red mug",
            }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        expect(
          (
            await catalog.stand().readAllVersioned(SkuCatalogSchema, {
              tenantId: ordersTenants.contoso,
            })
          )[0]?.state.value,
        ).toBe("Red mug");
      });
      await orders.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext: contosoActor }),
          message: AnyPacker.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, {
              id: "order-1",
              skuId: "sku-1",
            }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        expect(
          (
            await orders.stand().readAllVersioned(OrderReviewSchema, {
              tenantId: ordersTenants.contoso,
            })
          )[0]?.state.skuName,
        ).toBe("Red mug");
      });
      expect(
        (
          await orders.stand().readAllVersioned(OrderReviewSchema, {
            tenantId: ordersTenants.northwind,
          })
        )[0]?.state.skuName,
      ).toBe("Blue mug");
    } finally {
      await running.close();
      await setup.close();
    }
  });

  it("captures an empty name when the SKU is absent from the eventual catalog", async () => {
    const { OrderReviewContexts } = await import("../dist/src/cross-context.js");
    const { configureOrdersEnvironment, ordersTenants } = await import("../dist/src/index.js");
    const setup = await configureOrdersEnvironment({
      storageFactory: new InMemoryStorageFactory(),
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    });
    const { catalog, orders } = await OrderReviewContexts.create();
    const running = await Server.atPort(0).add(catalog).add(orders).start();
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-reviewer" }),
      tenantId: ordersTenants.northwind,
    });

    try {
      await orders.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyPacker.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id: "order-missing", skuId: "sku-missing" }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        const states = await orders
          .stand()
          .readAllVersioned(OrderReviewSchema, { tenantId: ordersTenants.northwind });
        expect(states[0]?.state).toMatchObject({
          id: "order-missing",
          skuId: "sku-missing",
          skuName: "",
        });
      });
    } finally {
      await running.close();
      await setup.close();
    }
  });
});
