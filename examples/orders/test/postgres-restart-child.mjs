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

import process from "node:process";

import { create } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { SignalMetadata } from "@spine-event-engine/server";

import { CreateOrderSchema } from "../dist/generated/spine/examples/orders/commands_pb.js";
import { OrderSchema } from "../dist/generated/spine/examples/orders/entities_pb.js";
import {
  configureOrdersEnvironment,
  createOrdersContext,
  createOrdersPostgresFactory,
  ordersTenants,
} from "../dist/src/index.js";

const [phase, id] = process.argv.slice(2);
if ((phase !== "write" && phase !== "read") || !id)
  throw new Error("Expected an Orders restart phase and order ID.");

const factory = await createOrdersPostgresFactory({
  sharedUrl: process.env.ORDERS_SHARED_DATABASE_URL,
  northwindUrl: process.env.ORDERS_NORTHWIND_DATABASE_URL,
  contosoUrl: process.env.ORDERS_CONTOSO_DATABASE_URL,
});
const tenants = [ordersTenants.northwind, ordersTenants.contoso];
const setup = await configureOrdersEnvironment({
  storageFactory: factory,
  tenants,
  membership: phase === "write" ? "seed-if-empty" : "existing",
});
let context;
let result;
try {
  const registered = await setup.tenantIndex.all();
  if (
    registered.length !== 2 ||
    !(await setup.tenantIndex.contains(tenants[0])) ||
    !(await setup.tenantIndex.contains(tenants[1]))
  )
    throw new Error("Orders membership was not retained across launch processes.");

  context = await createOrdersContext();
  if (phase === "write") {
    await setup.environment.createStorageStructures();
    const metadata = new SignalMetadata();
    for (const [tenantId, skuId] of [
      [tenants[0], "northwind-sku"],
      [tenants[1], "contoso-sku"],
    ]) {
      const actorContext = metadata.actorContext({
        actor: create(UserIdSchema, { value: "orders-restart-test" }),
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
  }
  const northwind = (await context.stand().read(OrderSchema, id, { tenantId: tenants[0] }))?.skuId;
  const contoso = (await context.stand().read(OrderSchema, id, { tenantId: tenants[1] }))?.skuId;
  result = { id, northwind, contoso };
} finally {
  if (context) await context.close();
  await setup.close();
}
process.stdout.write(JSON.stringify(result));
