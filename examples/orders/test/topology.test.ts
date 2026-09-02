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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, UserIdSchema } from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-event-engine/proto/client";
import { QueryIdSchema, QuerySchema } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { TopicIdSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { SignalMetadata } from "@spine-event-engine/server";
import type { Datastore } from "@google-cloud/datastore";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  CreateOrderSchema,
  RegisterSkuSchema,
} from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSummarySchema } from "../generated/spine/examples/orders/read_models_pb.js";

const metadata = new SignalMetadata();

describe("datastore orders test app", () => {
  it("provides the generated-domain runtime", () => {
    expect(existsSync(fileURLToPath(new URL("../dist/src/index.js", import.meta.url)))).toBe(true);
  });

  it("registers exactly two aggregates, two process managers, and ten projections", async () => {
    const { createDatastoreOrdersContext, datastoreOrdersTopology } =
      await import("../dist/src/index.js");
    expect(datastoreOrdersTopology.aggregates).toHaveLength(2);
    expect(datastoreOrdersTopology.processManagers).toHaveLength(2);
    expect(datastoreOrdersTopology.projections).toHaveLength(10);
    const context = await createDatastoreOrdersContext(new InMemoryStorageFactory());
    try {
      expect(context.registeredRepositories()).toHaveLength(14);
    } finally {
      await context.close();
    }
  });

  it("uses generic storage composition and real gRPC command, query, and subscription paths", async () => {
    const { startDatastoreOrdersServer } = await import("../dist/src/index.js");
    const server = await startDatastoreOrdersServer(new InMemoryStorageFactory(), {
      host: "127.0.0.1",
      port: 0,
    });
    const session = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: session });
    const commands = createClient(CommandService, transport);
    const queries = createClient(QueryService, transport);
    const subscriptions = createClient(SubscriptionService, transport);
    const id = "order-grpc";
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-user" }),
    });
    const subscription = await subscriptions.subscribe(topic(id, actorContext));
    const controller = new AbortController();
    const updates = subscriptions
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const nextUpdate = updates.next();
    try {
      const acknowledgement = await commands.post(
        create(CommandSchema, {
          id: metadata.commandId("order-grpc-command"),
          context: metadata.commandContext({ actorContext }),
          message: AnyMessages.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id, skuId: "sku-1" }),
          ),
        }),
      );
      expect(acknowledgement.status?.status.case).toBe("ok");
      const skuAcknowledgement = await commands.post(
        create(CommandSchema, {
          id: metadata.commandId("sku-grpc-command"),
          context: metadata.commandContext({ actorContext }),
          message: AnyMessages.pack(
            RegisterSkuSchema,
            create(RegisterSkuSchema, { id: "sku-1", displayName: "SKU one" }),
          ),
        }),
      );
      expect(skuAcknowledgement.status?.status.case).toBe("ok");
      const response = await readEventually(queries, id, actorContext);
      expect(
        response.message.some(
          (row) =>
            row.state !== undefined && AnyMessages.unpack(row.state, OrderSummarySchema)?.id === id,
        ),
      ).toBe(true);
      const update = await nextUpdate;
      expect(update.done).toBe(false);
    } finally {
      controller.abort();
      await updates.return?.();
      session.abort();
      await server.close();
    }
  }, 15_000);

  it("updates both sales managers from their subscribed domain events", async () => {
    const { OrderSalesManager, SkuSalesManager } = await import("../dist/src/index.js");
    const order = manager(OrderSalesManager, "order-sales");
    const sku = manager(SkuSalesManager, "sku-sales");

    order.onOrderCreated(createOrderCreated("order-manager", "sku-manager"));
    sku.onSkuRegistered(createSkuRegistered("sku-manager", "SKU manager"));

    expect(order.state).toMatchObject({ id: "order-sales", updates: 1 });
    expect(sku.state).toMatchObject({ id: "sku-sales", updates: 1 });
  });

  it("starts the in-memory orders server with default network options", async () => {
    const { startDatastoreOrdersServer } = await import("../dist/src/index.js");
    const server = await startDatastoreOrdersServer(new InMemoryStorageFactory());
    await server.close();
  });

  it("builds a Datastore-backed server from the caller-owned client", async () => {
    const { startOrdersDatastoreServer } = await import("../dist/src/index.js");
    const server = await startOrdersDatastoreServer(disconnectedDatastore());
    await server.close();
  });

  it("exposes exactly 10, 100, and 1000 independent-user load scenarios", async () => {
    const { datastoreOrdersLoadLevels, runDatastoreOrdersLoad } =
      await import("../dist/src/load-runner.js");
    expect(datastoreOrdersLoadLevels).toEqual([10, 100, 1000]);

    const { startDatastoreOrdersServer } = await import("../dist/src/index.js");
    const server = await startDatastoreOrdersServer(new InMemoryStorageFactory(), {
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const result = await runDatastoreOrdersLoad({ baseUrl: server.baseUrl, users: 10 });
      expect(result.failedUsers).toBe(0);
      expect(result.commandAcknowledgements).toBe(10);
      expect(result.queryVisibilities).toBe(10);
      expect(result.subscriptionDeliveries).toBe(10);
      expect(result.throughputPerSecond).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30_000);
});

async function readEventually(
  queries: ReturnType<typeof createClient<typeof QueryService>>,
  id: string,
  actorContext: ReturnType<typeof metadata.actorContext>,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await queries.read(
      create(QuerySchema, {
        id: create(QueryIdSchema, { value: `query-${id}-${String(Date.now())}` }),
        target: target(id),
        context: actorContext,
      }),
    );
    if (response.response?.status?.status.case === "ok" && response.message.length > 0)
      return response;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`OrderSummary ${id} was not visible within 5000ms.`);
}

function topic(id: string, actorContext: ReturnType<typeof metadata.actorContext>) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: `order-topic-${id}` }),
    target: target(id),
    context: actorContext,
  });
}

function target(id: string) {
  return create(TargetSchema, {
    type: TypeUrls.derive(OrderSummarySchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: {
          id: [AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }))],
        },
      }),
    },
  });
}

function manager(type: { readonly prototype: object }, id: string) {
  const instance = Object.create(type.prototype) as {
    id: string;
    state: { id: string; updates: number };
    update(change: (state: { id: string; updates: number }) => void): void;
    onOrderCreated(event: unknown): void;
    onSkuRegistered(event: unknown): void;
  };
  Object.defineProperty(instance, "id", { value: id });
  Object.defineProperty(instance, "state", { value: { id, updates: 0 } });
  Object.defineProperty(instance, "update", {
    value: (change: (state: { id: string; updates: number }) => void) => {
      change(instance.state);
    },
  });
  return instance;
}

function disconnectedDatastore(): Datastore {
  const query = {
    filter() {
      return this;
    },
    limit() {
      return this;
    },
    order() {
      return this;
    },
    select() {
      return this;
    },
  };
  return {
    createQuery: () => query,
    runQuery: () => Promise.resolve([[]]),
  } as unknown as Datastore;
}

function createOrderCreated(id: string, skuId: string) {
  return { id, skuId };
}

function createSkuRegistered(id: string, displayName: string) {
  return { id, displayName };
}
