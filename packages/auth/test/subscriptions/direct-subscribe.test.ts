import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { ActorContextSchema, TenantIdSchema, UserIdSchema } from "@spine-event-engine/proto";
import { SubscriptionSchema, TargetSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import {
  InMemorySubscriptionBindings,
  SubscriptionGateway,
  TransportFacts,
} from "../../src/index.js";

const service = "spine.client.SubscriptionService";
const context = create(ActorContextSchema, {
  actor: create(UserIdSchema, { value: "actor" }),
  tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
});
const topic = toBinary(TopicSchema, create(TopicSchema, { target: create(TargetSchema), context }));

describe("direct subscription creation", () => {
  it("creates a canonical public subscription from the trusted topic", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "direct-id",
      dispose: async () => undefined,
    });

    const wire = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic },
      whenExpires: 1_000,
    });

    expect(fromBinary(SubscriptionSchema, wire.bytes)).toMatchObject({
      id: { value: "direct-id" },
      topic: { context },
    });
  });

  it("compensates a retained direct subscription when backend creation fails", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "direct-id",
      dispose: async () => undefined,
    });
    const gateway = new SubscriptionGateway({
      bindings,
      sessions: {
        resolve: async () => ({
          principal: { id: "actor" },
          expiresAt: create(TimestampSchema, { seconds: 100n }),
        }),
      },
      authorize: async () => true,
      contexts: {
        resolve: async () => ({
          actor: create(UserIdSchema, { value: "actor" }),
          tenant: context.tenantId,
          timestamp: create(TimestampSchema),
        }),
        resolveContext: async () => ({
          actor: create(UserIdSchema, { value: "actor" }),
          timestamp: create(TimestampSchema),
        }),
      },
      clock: { now: () => create(TimestampSchema, { seconds: 1n }) },
      creator: {
        subscribe: async () => {
          throw new Error("backend failed");
        },
        activate: async () => undefined,
        cancel: async () => undefined,
      },
    });

    await expect(
      gateway.handle({
        service,
        method: "Subscribe",
        wire: { kind: "subscription-topic", bytes: topic },
        credential: { kind: "bearer", value: "credential" },
        transport: TransportFacts.from({ service, method: "Subscribe" }),
      }),
    ).rejects.toThrow("backend failed");
    expect(bindings.size).toBe(0);
  });

  it("retains a direct subscription when failed creation cannot be compensated", async () => {
    const bindings = new InMemorySubscriptionBindings({ nextId: () => "direct-id", dispose: async () => undefined });
    const gateway = new SubscriptionGateway({
      bindings, sessions: { resolve: async () => ({ principal: { id: "actor" }, expiresAt: create(TimestampSchema, { seconds: 100n }) }) },
      authorize: async () => true, contexts: { resolve: async () => ({ actor: create(UserIdSchema, { value: "actor" }), tenant: context.tenantId, timestamp: create(TimestampSchema) }), resolveContext: async () => ({ actor: create(UserIdSchema, { value: "actor" }), timestamp: create(TimestampSchema) }) },
      clock: { now: () => create(TimestampSchema, { seconds: 1n }) },
      creator: { subscribe: async () => { throw new Error("backend failed"); }, activate: async () => undefined, cancel: async () => { throw new Error("cleanup failed"); } },
    });
    await expect(gateway.handle({ service, method: "Subscribe", wire: { kind: "subscription-topic", bytes: topic }, credential: { kind: "bearer", value: "credential" }, transport: TransportFacts.from({ service, method: "Subscribe" }) })).rejects.toThrow("backend failed");
    expect(bindings.size).toBe(1);
  });

  it("discards retained in-memory subscriptions on close", async () => {
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => "direct-id",
      dispose: async () => undefined,
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic },
      whenExpires: 1_000,
    });

    await bindings.close();

    expect(bindings.size).toBe(0);
  });
});
