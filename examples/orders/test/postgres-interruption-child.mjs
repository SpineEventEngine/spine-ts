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
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { AnyPacker } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import { Inbox, ShardedWorkRegistry, ShardIndex, SignalMetadata } from "@spine-event-engine/server";

import { CreateOrderSchema } from "../dist/generated/spine/examples/orders/commands_pb.js";
import { OrderSchema } from "../dist/generated/spine/examples/orders/entities_pb.js";
import { OrderSummarySchema } from "../dist/generated/spine/examples/orders/read_models_pb.js";
import {
  configureOrdersEnvironment,
  createOrdersContext,
  createOrdersPostgresFactory,
  OrderAggregate,
  ordersTenants,
  startOrdersServer,
} from "../dist/src/index.js";
import { withOrdersServer } from "../dist/src/orders-launch.js";

const [phase, id, expiry] = process.argv.slice(2);
if ((phase !== "stage" && phase !== "recover") || !id)
  throw new Error("Expected an interrupted Orders phase and order ID.");
const fixed = phase === "stage" ? Date.now() : Number(expiry);
if (!Number.isSafeInteger(fixed)) throw new Error("Expected an exact shard lease expiry.");
const previousTime = Time.setProvider({ currentTime: () => timestampFromDate(new Date(fixed)) });
const factory = await createOrdersPostgresFactory({
  sharedUrl: process.env.ORDERS_SHARED_DATABASE_URL,
  northwindUrl: process.env.ORDERS_NORTHWIND_DATABASE_URL,
  contosoUrl: process.env.ORDERS_CONTOSO_DATABASE_URL,
});
const setup = await configureOrdersEnvironment({
  storageFactory: factory,
  tenants: [ordersTenants.northwind, ordersTenants.contoso],
  membership: phase === "stage" ? "seed-if-empty" : "existing",
});

if (phase === "stage") await stage(id, setup);
else
  try {
    process.send?.({ kind: "result", value: await recover(id, setup) });
  } finally {
    Time.setProvider(previousTime);
  }

function command(orderId, skuId) {
  const metadata = new SignalMetadata();
  const actorContext = metadata.actorContext({
    actor: create(UserIdSchema, { value: "orders-interruption-test" }),
    tenantId: ordersTenants.northwind,
  });
  return create(CommandSchema, {
    id: metadata.commandId(),
    context: metadata.commandContext({ actorContext }),
    message: AnyPacker.pack(CreateOrderSchema, create(CreateOrderSchema, { id: orderId, skuId })),
  });
}

async function stage(id, setup) {
  const original = OrderAggregate.prototype.createOrder;
  let entered;
  const handlerEntered = new Promise((resolve) => {
    entered = resolve;
  });
  OrderAggregate.prototype.createOrder = async function (request) {
    if (request.id === id) {
      entered();
      await new Promise(() => undefined);
    }
    return original.call(this, request);
  };
  const server = await startOrdersServer();
  const session = new Http2SessionManager(server.baseUrl);
  const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: session });
  const envelope = command(id, "recovered-sku");
  const posted = createClient(CommandService, transport).post(envelope);
  await Promise.race([
    handlerEntered,
    posted.then(() => {
      throw new Error("Command completed before handler entry.");
    }),
  ]);
  const rows = await setup.environment.delivery.inbox.read(ShardIndex.single(), {
    statuses: ["TO_DELIVER"],
  });
  const stored = rows.find((row) => row.signalId === envelope.id.uuid);
  if (stored?.status !== "TO_DELIVER")
    throw new Error("Interrupted Orders Command did not remain durably pending.");
  const delivery = setup.environment.delivery;
  const observer = new ShardedWorkRegistry({
    context: delivery.context,
    storageFactory: delivery.storageFactory,
  });
  let held;
  try {
    held = await observer.pickUp(ShardIndex.single(), delivery.worker);
  } finally {
    await observer.close();
  }
  if (!held?.worker || held.expiresAt.getTime() <= fixed)
    throw new Error("Interrupted Orders shard lease was not held at the handler gate.");
  process.send?.({ kind: "pending", id, expiresAt: held.expiresAt.getTime() });
  await new Promise((resolve) => process.once("message", resolve));
  throw new Error("Staging process must be terminated after durable confirmation.");
}

async function recover(id, setup) {
  const newId = `${id}-new`;
  const newEnvelope = command(newId, "new-sku");
  let enter;
  let release;
  let received;
  const handlerEntered = new Promise((resolve) => {
    enter = resolve;
  });
  const handlerReleased = new Promise((resolve) => {
    release = resolve;
  });
  const newReceipt = new Promise((resolve) => {
    received = resolve;
  });
  const originalHandler = OrderAggregate.prototype.createOrder;
  const originalReceive = Inbox.prototype.receive;
  OrderAggregate.prototype.createOrder = async function (request) {
    if (request.id === id) {
      enter();
      await handlerReleased;
    }
    return originalHandler.call(this, request);
  };
  Inbox.prototype.receive = async function (input) {
    const written = await originalReceive.call(this, input);
    if (input.signalId === newEnvelope.id.uuid && written.outcome === "WRITTEN")
      received(written.message);
    return written;
  };
  try {
    return await recoverWithGate(
      id,
      newId,
      newEnvelope,
      setup,
      handlerEntered,
      newReceipt,
      release,
    );
  } finally {
    release();
    OrderAggregate.prototype.createOrder = originalHandler;
    Inbox.prototype.receive = originalReceive;
  }
}

async function recoverWithGate(id, newId, newEnvelope, setup, handlerEntered, newReceipt, release) {
  return await withOrdersServer(
    setup,
    () => startOrdersServer(),
    async (server) => {
      const session = new Http2SessionManager(server.baseUrl);
      try {
        const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: session });
        await handlerEntered;
        process.send?.({ kind: "recovered-entered" });
        const posted = createClient(CommandService, transport).post(newEnvelope);
        const newRow = await Promise.race([
          newReceipt,
          posted.then(() => {
            throw new Error("New Command completed before Inbox receipt.");
          }),
        ]);
        if (newRow.status !== "TO_DELIVER")
          throw new Error("New Orders Command was not pending while recovery was gated.");
        process.send?.({ kind: "new-received" });
        await new Promise((resolve) => process.once("message", resolve));
        release();
        const ack = await posted;
        if (ack.status?.status.case !== "ok")
          throw new Error(`New Orders command did not progress: ${JSON.stringify(ack.status)}`);
      } finally {
        release();
        session.abort();
      }
      await server.close();
      const after = await createOrdersContext();
      try {
        const tenantId = ordersTenants.northwind;
        const pendingOrder = await after.stand().read(OrderSchema, id, { tenantId });
        const pendingView = await after.stand().read(OrderSummarySchema, id, { tenantId });
        const newOrder = await after.stand().read(OrderSchema, newId, { tenantId });
        const newView = await after.stand().read(OrderSummarySchema, newId, { tenantId });
        return {
          pendingOrder: id,
          pendingSku: pendingOrder?.skuId,
          pendingView: pendingView?.value,
          newSku: newOrder?.skuId,
          newView: newView?.value,
        };
      } finally {
        await after.close();
      }
    },
  );
}
