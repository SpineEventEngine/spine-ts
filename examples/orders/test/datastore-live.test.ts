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

import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { SignalMetadata } from "@spine-event-engine/server";
import { expect, it } from "vitest";

import { CreateOrderSchema } from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSchema } from "../generated/spine/examples/orders/entities_pb.js";

it("keeps matching order IDs in separate Datastore emulator tenant namespaces", async () => {
  if (!process.env.DATASTORE_EMULATOR_HOST)
    throw new Error("DATASTORE_EMULATOR_HOST is required for Orders Datastore tests.");
  const projectId = process.env.ORDERS_DATASTORE_PROJECT_ID ?? process.env.DATASTORE_PROJECT_ID;
  if (!projectId) throw new Error("A Datastore emulator project ID is required.");
  const {
    configureOrdersEnvironment,
    createOrdersContext,
    createOrdersDatastoreFactory,
    ordersTenants,
  } = await import("../dist/src/index.js");
  const factory = createOrdersDatastoreFactory({ projectId });
  const tenants = [ordersTenants.northwind, ordersTenants.contoso] as const;
  const setup = await configureOrdersEnvironment({
    storageFactory: factory,
    tenants,
    membership: "seed-if-empty",
  });
  const context = await createOrdersContext();
  const id = `datastore-${randomUUID()}`;
  try {
    await setup.environment.createStorageStructures();
    const metadata = new SignalMetadata();
    for (const [tenantId, skuId] of [
      [tenants[0], "northwind-sku"],
      [tenants[1], "contoso-sku"],
    ] as const) {
      const actorContext = metadata.actorContext({
        actor: create(UserIdSchema, { value: "orders-datastore-test" }),
        tenantId,
      });
      await context.commandBus().post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext }),
          message: AnyPacker.pack(CreateOrderSchema, create(CreateOrderSchema, { id, skuId })),
        }),
      );
    }
    expect((await context.stand().read(OrderSchema, id, { tenantId: tenants[0] }))?.skuId).toBe(
      "northwind-sku",
    );
    expect((await context.stand().read(OrderSchema, id, { tenantId: tenants[1] }))?.skuId).toBe(
      "contoso-sku",
    );
  } finally {
    await context.close();
    await setup.close();
  }
});
