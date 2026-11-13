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
import type { Any } from "@bufbuild/protobuf/wkt";
import { AnyPacker } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { Application, SignalMetadata } from "@spine-event-engine/server";
import { InMemoryStorageBackend, InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import {
  CreateOrderSchema,
  RegisterSkuSchema,
} from "../generated/spine/examples/orders/commands_pb.js";
import { OrderCardSchema } from "../generated/spine/examples/orders/order_cards_pb.js";

const metadata = new SignalMetadata();

describe("Orders query routing example", () => {
  it("updates every matching saved card, leaves other cards alone, and accepts no matches", async () => {
    const { OrderCard, OrderCardContext } = await import("../dist/src/query-routing.js");
    const reaction = vi.spyOn(OrderCard.prototype, "onSkuRegistered");
    const backend = new InMemoryStorageBackend();
    const { configureOrdersEnvironment, ordersTenants } = await import("../dist/src/index.js");
    const setup = await configureOrdersEnvironment({
      storageFactory: new InMemoryStorageFactory(backend),
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    });
    const application = await Application.newBuilder()
      .setServerEnvironment(setup.environment)
      .setTenantIndex(setup.tenantIndex)
      .add(OrderCardContext.create())
      .build();
    const context = application.contexts()[0];
    if (context === undefined) throw new Error("Expected a Bounded Context in the Application.");
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-query-routing" }),
      tenantId: ordersTenants.northwind,
    });
    const post = async (message: Any): Promise<void> => {
      await context.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message,
        }),
      );
    };
    try {
      await post(
        AnyPacker.pack(
          CreateOrderSchema,
          create(CreateOrderSchema, { id: "order-a", skuId: "sku-1" }),
        ),
      );
      await post(
        AnyPacker.pack(
          CreateOrderSchema,
          create(CreateOrderSchema, { id: "order-b", skuId: "sku-1" }),
        ),
      );
      await post(
        AnyPacker.pack(
          CreateOrderSchema,
          create(CreateOrderSchema, { id: "order-c", skuId: "sku-2" }),
        ),
      );
      await vi.waitFor(async () => {
        expect(
          await context
            .stand()
            .readAllVersioned(OrderCardSchema, { tenantId: ordersTenants.northwind }),
        ).toHaveLength(3);
      });
      await post(
        AnyPacker.pack(
          RegisterSkuSchema,
          create(RegisterSkuSchema, {
            id: "sku-1",
            displayName: "Blue mug",
          }),
        ),
      );
      await vi.waitFor(async () => {
        const cards = await context
          .stand()
          .readAllVersioned(OrderCardSchema, { tenantId: ordersTenants.northwind });
        expect(cards.map(({ state }) => [state.id, state.skuName]).sort()).toEqual([
          ["order-a", "Blue mug"],
          ["order-b", "Blue mug"],
          ["order-c", ""],
        ]);
      });
      expect(reaction).toHaveBeenCalledTimes(2);
      const before = (
        await context
          .stand()
          .readAllVersioned(OrderCardSchema, { tenantId: ordersTenants.northwind })
      ).toSorted((left, right) => left.state.id.localeCompare(right.state.id));
      await post(
        AnyPacker.pack(
          RegisterSkuSchema,
          create(RegisterSkuSchema, {
            id: "sku-1",
            displayName: "Blue mug",
          }),
        ),
      );
      await post(
        AnyPacker.pack(
          RegisterSkuSchema,
          create(RegisterSkuSchema, {
            id: "sku-missing",
            displayName: "No card",
          }),
        ),
      );
      const contosoActor = metadata.actorContext({
        actor: create(UserIdSchema, { value: "orders-query-routing" }),
        tenantId: ordersTenants.contoso,
      });
      await context.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext: contosoActor }),
          message: AnyPacker.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, {
              id: "order-a",
              skuId: "sku-1",
            }),
          ),
        }),
      );
      await vi.waitFor(async () => {
        expect(
          await context.stand().readAllVersioned(OrderCardSchema, {
            tenantId: ordersTenants.contoso,
          }),
        ).toHaveLength(1);
      });
      await context.commandBus().post(
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
            await context.stand().readAllVersioned(OrderCardSchema, {
              tenantId: ordersTenants.contoso,
            })
          )[0]?.state.skuName,
        ).toBe("Red mug");
      });
      expect(
        (
          await context.stand().readAllVersioned(OrderCardSchema, {
            tenantId: ordersTenants.northwind,
          })
        ).map(({ state }) => state.skuName),
      ).toEqual(["Blue mug", "Blue mug", ""]);
      // Closing drains accepted Event delivery before either negative assertion.
      await application.close();
      const inspectionSetup = await configureOrdersEnvironment({
        storageFactory: new InMemoryStorageFactory(backend),
        tenants: [ordersTenants.northwind, ordersTenants.contoso],
      });
      const inspectionApplication = await Application.newBuilder()
        .setServerEnvironment(inspectionSetup.environment)
        .setTenantIndex(inspectionSetup.tenantIndex)
        .add(OrderCardContext.create())
        .build();
      const inspection = inspectionApplication.contexts()[0];
      if (inspection === undefined) throw new Error("Expected an inspection Bounded Context.");
      try {
        const after = (
          await inspection
            .stand()
            .readAllVersioned(OrderCardSchema, { tenantId: ordersTenants.northwind })
        ).toSorted((left, right) => left.state.id.localeCompare(right.state.id));
        expect(reaction).toHaveBeenCalledTimes(3);
        expect(after).toEqual(before);
      } finally {
        await inspectionApplication.close();
        await inspectionSetup.close();
      }
    } finally {
      await application.close();
      await setup.close();
    }
  });
});
