import { create } from "@bufbuild/protobuf";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import {
  CommandService,
  QueryIdSchema,
  QuerySchema,
  QueryService,
  SubscriptionService,
  TargetFiltersSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { SignalMetadata, ServerEnvironment } from "@spine-event-engine/server";
import { ServerTests } from "@spine-event-engine/server/testing";
import { afterEach, expect, it, vi } from "vitest";

import { CreateOrderSchema } from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSchema } from "../generated/spine/examples/orders/entities_pb.js";
import { OrderSummarySchema } from "../generated/spine/examples/orders/read_models_pb.js";

const metadata = new SignalMetadata();
const northwind = create(TenantIdSchema, { kind: { case: "value", value: "northwind" } });
const contoso = create(TenantIdSchema, { kind: { case: "value", value: "contoso" } });
const unknown = create(TenantIdSchema, { kind: { case: "value", value: "unknown" } });

afterEach(async () => ServerTests.resetEnvironment());

it("isolates the same complete order ID across registered tenants and rejects unregistered tenants", async () => {
  const { configureOrdersEnvironment, createOrdersContext } = await import("../dist/src/index.js");
  const setup = await configureOrdersEnvironment({
    storageFactory: new InMemoryStorageFactory(),
    tenants: [northwind, contoso],
  });
  const context = await createOrdersContext();
  const post = (tenantId: typeof northwind | undefined, skuId: string) => {
    const actorContext = metadata.actorContext({
      actor: create(UserIdSchema, { value: "orders-user" }),
      ...(tenantId === undefined ? {} : { tenantId }),
    });
    return context.commandBus().post(
      create(CommandSchema, {
        id: metadata.commandId(),
        context: metadata.commandContext({ actorContext }),
        message: AnyPacker.pack(
          CreateOrderSchema,
          create(CreateOrderSchema, {
            id: "shared-order",
            skuId,
          }),
        ),
      }),
    );
  };
  try {
    expect(context.isMultitenant).toBe(true);
    await post(northwind, "northwind-sku");
    await post(contoso, "contoso-sku");
    await vi.waitFor(async () => {
      expect(
        (await context.stand().readAllVersioned(OrderSchema, { tenantId: northwind }))[0]?.state
          .skuId,
      ).toBe("northwind-sku");
      expect(
        (await context.stand().readAllVersioned(OrderSchema, { tenantId: contoso }))[0]?.state
          .skuId,
      ).toBe("contoso-sku");
    });
    await expect(post(unknown, "unknown-sku")).rejects.toThrow();
    await expect(post(undefined, "missing-sku")).rejects.toThrow();
    expect(await setup.tenantIndex.contains(unknown)).toBe(false);
    expect(
      await context.stand().readAllVersioned(OrderSchema, { tenantId: northwind }),
    ).toHaveLength(1);
  } finally {
    await context.close();
    await setup.close();
  }
});

it("routes matching order IDs through queries and subscriptions within their original tenants", async () => {
  const { configureOrdersEnvironment, startOrdersServer } = await import("../dist/src/index.js");
  const setup = await configureOrdersEnvironment({
    storageFactory: new InMemoryStorageFactory(),
    tenants: [northwind, contoso],
  });
  const server = await startOrdersServer();
  const session = new Http2SessionManager(server.baseUrl);
  const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: session });
  const commands = createClient(CommandService, transport);
  const queries = createClient(QueryService, transport);
  const subscriptions = createClient(SubscriptionService, transport);
  const controller = new AbortController();
  const actor = (tenantId: typeof northwind) =>
    create(ActorContextSchema, {
      ...metadata.actorContext({
        actor: create(UserIdSchema, { value: "orders-network-user" }),
        tenantId,
      }),
      timestamp: metadata.timestamp(),
    });
  const target = create(TargetSchema, {
    type: TypeUrls.derive(OrderSummarySchema),
    criterion: {
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: {
          id: [AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: "same-id" }))],
        },
      }),
    },
  });
  const subscribe = async (tenantId: typeof northwind) => {
    const subscription = await subscriptions.subscribe(
      create(TopicSchema, {
        id: create(TopicIdSchema, {
          value: `topic-${tenantId.kind.case === "value" ? tenantId.kind.value : "invalid"}`,
        }),
        target,
        context: actor(tenantId),
      }),
    );
    const iterator = subscriptions
      .activate(subscription, { signal: controller.signal })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).value.response?.status?.status.case).toBe("ok");
    return iterator;
  };
  try {
    const northwindUpdates = await subscribe(northwind);
    const contosoUpdates = await subscribe(contoso);
    const northwindNext = northwindUpdates.next();
    const contosoNext = contosoUpdates.next();
    const post = async (tenantId: typeof northwind, skuId: string) => {
      const result = await commands.post(
        create(CommandSchema, {
          id: metadata.commandId(),
          context: metadata.commandContext({ actorContext: actor(tenantId) }),
          message: AnyPacker.pack(
            CreateOrderSchema,
            create(CreateOrderSchema, { id: "same-id", skuId }),
          ),
        }),
      );
      expect(result.status?.status.case).toBe("ok");
    };
    await post(northwind, "sku-northwind");
    await post(contoso, "sku-contoso");
    for (const [tenantId, expected] of [
      [northwind, "sku-northwind"],
      [contoso, "sku-contoso"],
    ] as const) {
      await vi.waitFor(async () => {
        const response = await queries.read(
          create(QuerySchema, {
            id: create(QueryIdSchema, { value: `query-${expected}-${String(Date.now())}` }),
            target,
            context: actor(tenantId),
          }),
        );
        expect(AnyPacker.tryUnpack(response.message[0]?.state, OrderSummarySchema)?.value).toBe(
          expected,
        );
      });
    }
    for (const [next, expected] of [
      [northwindNext, "sku-northwind"],
      [contosoNext, "sku-contoso"],
    ] as const) {
      const update = await next;
      expect(update.value.update.case).toBe("entityUpdates");
      if (update.value.update.case === "entityUpdates") {
        expect(
          update.value.update.value.update.some(
            (row) =>
              row.kind.case === "state" &&
              AnyPacker.tryUnpack(row.kind.value, OrderSummarySchema)?.value === expected,
          ),
        ).toBe(true);
      }
    }
  } finally {
    controller.abort();
    session.abort();
    await server.close();
    await setup.close();
  }
});
