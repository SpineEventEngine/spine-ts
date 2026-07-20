import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { deriveTypeUrl, packAny, unpackAny } from "@spine-ts/core";
import { CommandSchema, UserIdSchema } from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import {
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { QueryIdSchema, QuerySchema } from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import {
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { SignalMetadata } from "@spine-ts/server";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CreateOrderSchema } from "../generated/spine/example/datastore_orders/v1/commands_pb.js";
import { OrderSummarySchema } from "../generated/spine/example/datastore_orders/v1/read_models_pb.js";

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
          message: packAny(CreateOrderSchema, create(CreateOrderSchema, { id, skuId: "sku-1" })),
        }),
      );
      expect(acknowledgement.status?.status.case).toBe("ok");
      const response = await readEventually(queries, id, actorContext);
      expect(
        response.message.some(
          (row) => row.state !== undefined && unpackAny(row.state, OrderSummarySchema)?.id === id,
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
    type: deriveTypeUrl(OrderSummarySchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: { id: [packAny(StringValueSchema, create(StringValueSchema, { value: id }))] },
      }),
    },
  });
}
