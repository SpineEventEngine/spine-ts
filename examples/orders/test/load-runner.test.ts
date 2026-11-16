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

import { existsSync } from "node:fs";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { create } from "@bufbuild/protobuf";
import { EmptySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AnyPacker } from "@spine-event-engine/core";
import { AckSchema } from "@spine-event-engine/proto";
import { ResponseSchema, StatusSchema } from "@spine-event-engine/proto";
import { type Query, QueryResponseSchema } from "@spine-event-engine/proto/client";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionUpdateSchema,
  type Subscription,
  type Topic,
} from "@spine-event-engine/proto/client";
import { CommandService } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { ordersTenants } from "../src/orders-environment.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { ordersLoadLevels, runOrdersLoad } from "../src/load-runner.js";
import { LatencyDistribution } from "../src/internal/latency-distribution.js";
import { OrderSummarySchema } from "../generated/spine/examples/orders/read_models_pb.js";

describe("datastore-orders load runner", () => {
  it("calculates nearest-rank percentiles from unsorted latencies and zeros empty distributions", () => {
    expect(LatencyDistribution.from([40, 10, 30, 20, 50]).percentiles()).toEqual({
      p50Ms: 30,
      p95Ms: 50,
      p99Ms: 50,
    });
    expect(LatencyDistribution.from([]).percentiles()).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0 });
  });

  it("runs ten users over real gRPC and reports command, query, subscription, and metrics", async () => {
    const modulePath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
    expect(existsSync(modulePath)).toBe(true);
    const { configureOrdersEnvironment, startOrdersServer } = await import("../dist/src/index.js");
    const setup = await configureOrdersEnvironment({
      storageFactory: new InMemoryStorageFactory(),
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    });
    const server = await startOrdersServer(setup, {
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const result = await runOrdersLoad({
        baseUrl: server.baseUrl,
        users: 10,
        tenants: [ordersTenants.northwind, ordersTenants.contoso],
      });
      expect(ordersLoadLevels).toEqual([10, 100, 1000]);
      expect(result).toMatchObject({
        users: 10,
        failedUsers: 0,
        commandAcknowledgements: 10,
        queryVisibilities: 10,
        subscriptionDeliveries: 10,
      });
      expect(result.throughputPerSecond).toBeGreaterThan(0);
      expect(result.perTenant).toEqual({
        northwind: {
          users: 5,
          failedUsers: 0,
          commandAcknowledgements: 5,
          queryVisibilities: 5,
          subscriptionDeliveries: 5,
        },
        contoso: {
          users: 5,
          failedUsers: 0,
          commandAcknowledgements: 5,
          queryVisibilities: 5,
          subscriptionDeliveries: 5,
        },
      });
    } finally {
      await server.close();
      await setup.close();
    }
  }, 30_000);

  it("reports failed users and zeroed metrics when the gRPC endpoint is unavailable", async () => {
    const result = await runOrdersLoad({
      baseUrl: "http://127.0.0.1:1",
      users: 10,
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
      visibilityTimeoutMs: 100,
    });
    expect(result).toMatchObject({
      users: 10,
      failedUsers: 10,
      commandAcknowledgements: 0,
      queryVisibilities: 0,
      subscriptionDeliveries: 0,
      throughputPerSecond: 0,
    });
    expect(result.commandAcknowledgementLatency).toEqual({ p50Ms: 0, p95Ms: 0, p99Ms: 0 });
  }, 10_000);

  it("retains acknowledged command counts when every subsequent query fails", async () => {
    const server = await startProtocolOutcomeServer("query-rejected");
    try {
      const result = await runOrdersLoad({
        baseUrl: server.baseUrl,
        users: 10,
        tenants: [ordersTenants.northwind, ordersTenants.contoso],
      });
      expect(result).toMatchObject({
        failedUsers: 10,
        commandAcknowledgements: 10,
        queryVisibilities: 0,
        subscriptionDeliveries: 0,
        perTenant: {
          northwind: {
            users: 5,
            failedUsers: 5,
            commandAcknowledgements: 5,
            queryVisibilities: 0,
            subscriptionDeliveries: 0,
          },
          contoso: {
            users: 5,
            failedUsers: 5,
            commandAcknowledgements: 5,
            queryVisibilities: 0,
            subscriptionDeliveries: 0,
          },
        },
      });
      expect(result.commandAcknowledgementLatency.p50Ms).toBeGreaterThan(0);
      expect(result.queryVisibilityLatency.p50Ms).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("retains command and query counts when the subscription ends before an update", async () => {
    const server = await startProtocolOutcomeServer("ended-after-activation");
    try {
      const result = await runOrdersLoad({
        baseUrl: server.baseUrl,
        users: 10,
        tenants: [ordersTenants.northwind, ordersTenants.contoso],
      });
      expect(result).toMatchObject({
        failedUsers: 10,
        commandAcknowledgements: 10,
        queryVisibilities: 10,
        subscriptionDeliveries: 0,
        perTenant: {
          northwind: {
            users: 5,
            failedUsers: 5,
            commandAcknowledgements: 5,
            queryVisibilities: 5,
            subscriptionDeliveries: 0,
          },
          contoso: {
            users: 5,
            failedUsers: 5,
            commandAcknowledgements: 5,
            queryVisibilities: 5,
            subscriptionDeliveries: 0,
          },
        },
      });
      expect(result.queryVisibilityLatency.p50Ms).toBeGreaterThan(0);
      expect(result.subscriptionDeliveryLatency.p50Ms).toBe(0);
    } finally {
      await server.close();
    }
  });

  it("reports zero throughput when the real gRPC load completes within one clock tick", async () => {
    const { configureOrdersEnvironment, startOrdersServer } = await import("../dist/src/index.js");
    const setup = await configureOrdersEnvironment({
      storageFactory: new InMemoryStorageFactory(),
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
    });
    const server = await startOrdersServer(setup, {
      host: "127.0.0.1",
      port: 0,
    });
    const now = vi.spyOn(performance, "now").mockReturnValue(1);
    try {
      const result = await runOrdersLoad({
        baseUrl: server.baseUrl,
        users: 10,
        tenants: [ordersTenants.northwind, ordersTenants.contoso],
      });
      expect(result).toMatchObject({ users: 10, failedUsers: 0, throughputPerSecond: 0 });
    } finally {
      now.mockRestore();
      await server.close();
      await setup.close();
    }
  }, 30_000);

  it("classifies unsuccessful protocol outcomes as failed users", async () => {
    for (const [outcome, commandAcknowledgements, queryVisibilities] of [
      ["missing-acknowledgement", 0, 0],
      ["ended-subscription", 0, 0],
      ["uncorrelated-update", 10, 10],
    ] as const) {
      const server = await startProtocolOutcomeServer(outcome);
      try {
        const result = await runOrdersLoad({
          baseUrl: server.baseUrl,
          users: 10,
          tenants: [ordersTenants.northwind, ordersTenants.contoso],
          visibilityTimeoutMs: 100,
        });
        expect(result).toMatchObject({
          users: 10,
          failedUsers: 10,
          commandAcknowledgements,
          queryVisibilities,
          subscriptionDeliveries: 0,
        });
      } finally {
        await server.close();
      }
    }
  }, 30_000);

  it("aborts every stalled RPC phase and leaves no active server work in the shared session pool", async () => {
    for (const outcome of [
      "stalled-subscription",
      "stalled-command",
      "stalled-query",
      "stalled-activation",
    ] as const)
      await expectStalledPhaseCanceled(outcome);
  }, 30_000);
});

type ProtocolOutcome =
  | "missing-acknowledgement"
  | "ended-subscription"
  | "ended-after-activation"
  | "uncorrelated-update"
  | "stalled-subscription"
  | "stalled-command"
  | "stalled-query"
  | "stalled-activation"
  | "query-rejected";

const stalledRpcTimeoutMs = 500;

async function expectStalledPhaseCanceled(outcome: ProtocolOutcome): Promise<void> {
  const tracker = { started: 0, active: 0, aborted: 0 };
  const server = await startProtocolOutcomeServer(
    outcome,
    () => {
      tracker.started += 1;
      tracker.active += 1;
    },
    () => {
      tracker.aborted += 1;
      tracker.active -= 1;
    },
  );
  try {
    const result = await runOrdersLoad({
      baseUrl: server.baseUrl,
      users: 10,
      tenants: [ordersTenants.northwind, ordersTenants.contoso],
      visibilityTimeoutMs: stalledRpcTimeoutMs,
    });
    expect(result.failedUsers).toBe(10);
    expect(tracker.started).toBe(10);
    await vi.waitFor(() => {
      expect(tracker.aborted).toBe(10);
      expect(tracker.active).toBe(0);
    });
  } finally {
    await server.close();
  }
}

async function startProtocolOutcomeServer(
  outcome: ProtocolOutcome,
  onStart = () => undefined,
  onAbort = () => undefined,
) {
  const server = http2.createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(CommandService, commandHandlers(outcome, onStart, onAbort));
        router.service(QueryService, queryHandlers(outcome, onStart, onAbort));
        router.service(SubscriptionService, subscriptionHandlers(outcome, onStart, onAbort));
      },
    }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      ),
  };
}

function commandHandlers(outcome: ProtocolOutcome, onStart: () => void, onAbort: () => void) {
  return {
    post: (_command: unknown, context: HandlerContext) => {
      if (outcome === "stalled-command") return stalled(context, onStart, onAbort);
      return Promise.resolve(
        outcome === "missing-acknowledgement"
          ? create(AckSchema)
          : create(AckSchema, { status: okStatus() }),
      );
    },
  };
}

function queryHandlers(outcome: ProtocolOutcome, onStart: () => void, onAbort: () => void) {
  return {
    read: (query: Query, context: HandlerContext) =>
      outcome === "stalled-query"
        ? stalled(context, onStart, onAbort)
        : outcome === "query-rejected"
          ? Promise.reject(new Error("query unavailable"))
          : Promise.resolve(queryResponse(query)),
  };
}

function subscriptionHandlers(outcome: ProtocolOutcome, onStart: () => void, onAbort: () => void) {
  return {
    subscribe: (topic: Topic, context: HandlerContext) =>
      outcome === "stalled-subscription"
        ? stalled(context, onStart, onAbort)
        : Promise.resolve(
            create(SubscriptionSchema, {
              id: create(SubscriptionIdSchema, { value: "test-subscription" }),
              topic,
            }),
          ),
    async *activate(subscription: Subscription, context: HandlerContext) {
      if (outcome === "stalled-activation") await stalled(context, onStart, onAbort);
      await Promise.resolve();
      if (outcome === "ended-subscription") return;
      yield create(SubscriptionUpdateSchema, {
        subscription,
        response: create(ResponseSchema, { status: okStatus() }),
      });
      if (outcome === "ended-after-activation") return;
      yield create(SubscriptionUpdateSchema, outcome === "uncorrelated-update" ? {} : undefined);
    },
    cancel: () => Promise.resolve(create(ResponseSchema, { status: okStatus() })),
  };
}

function stalled(
  context: HandlerContext,
  onStart: () => void,
  onAbort: () => void,
): Promise<never> {
  onStart();
  return new Promise<never>((_resolve, reject) => {
    const abort = () => {
      onAbort();
      reject(new Error("stalled RPC canceled"));
    };
    if (context.signal.aborted) abort();
    else context.signal.addEventListener("abort", abort, { once: true });
  });
}

function queryResponse(query: Query) {
  const packedId =
    query.target?.criterion.case === "filters"
      ? query.target.criterion.value.idFilter?.id[0]
      : undefined;
  const id =
    packedId === undefined ? undefined : AnyPacker.tryUnpack(packedId, StringValueSchema)?.value;
  return create(QueryResponseSchema, {
    response: create(ResponseSchema, { status: okStatus() }),
    message:
      id === undefined
        ? []
        : [{ state: AnyPacker.pack(OrderSummarySchema, create(OrderSummarySchema, { id })) }],
  });
}
function okStatus() {
  return create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } });
}
