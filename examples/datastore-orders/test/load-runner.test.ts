import { existsSync } from "node:fs";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { create } from "@bufbuild/protobuf";
import { EmptySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import type { HandlerContext } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { AnyMessages } from "@spine-event-engine/core";
import { AckSchema } from "@spine-event-engine/proto";
import { ResponseSchema, StatusSchema } from "@spine-event-engine/proto";
import { type Query, QueryResponseSchema } from "@spine-event-engine/proto/client";
import { SubscriptionSchema, SubscriptionUpdateSchema } from "@spine-event-engine/proto/client";
import { CommandService } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { describe, expect, it, vi } from "vitest";

import { datastoreOrdersLoadLevels, runDatastoreOrdersLoad } from "../src/load-runner.js";
import { OrderSummarySchema } from "../generated/spine/example/datastore_orders/v1/read_models_pb.js";

describe("datastore-orders load runner", () => {
  it("runs ten users over real gRPC and reports command, query, subscription, and metrics", async () => {
    const modulePath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
    expect(existsSync(modulePath)).toBe(true);
    const { startDatastoreOrdersServer } = await import("../dist/src/index.js");
    const { InMemoryStorageFactory } = await import("@spine-event-engine/storage");
    const server = await startDatastoreOrdersServer(new InMemoryStorageFactory(), {
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const result = await runDatastoreOrdersLoad({ baseUrl: server.baseUrl, users: 10 });
      expect(datastoreOrdersLoadLevels).toEqual([10, 100, 1000]);
      expect(result).toMatchObject({
        users: 10,
        failedUsers: 0,
        commandAcknowledgements: 10,
        queryVisibilities: 10,
        subscriptionDeliveries: 10,
      });
      expect(result.throughputPerSecond).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("reports failed users and zeroed metrics when the gRPC endpoint is unavailable", async () => {
    const result = await runDatastoreOrdersLoad({
      baseUrl: "http://127.0.0.1:1",
      users: 10,
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

  it("reports zero throughput when the real gRPC load completes within one clock tick", async () => {
    const { startDatastoreOrdersServer } = await import("../dist/src/index.js");
    const { InMemoryStorageFactory } = await import("@spine-event-engine/storage");
    const server = await startDatastoreOrdersServer(new InMemoryStorageFactory(), {
      host: "127.0.0.1",
      port: 0,
    });
    const now = vi.spyOn(performance, "now").mockReturnValue(1);
    try {
      const result = await runDatastoreOrdersLoad({ baseUrl: server.baseUrl, users: 10 });
      expect(result).toMatchObject({ users: 10, failedUsers: 0, throughputPerSecond: 0 });
    } finally {
      now.mockRestore();
      await server.close();
    }
  }, 30_000);

  it("classifies unsuccessful protocol outcomes as failed users", async () => {
    for (const outcome of [
      "missing-acknowledgement",
      "ended-subscription",
      "uncorrelated-update",
    ] as const) {
      const server = await startProtocolOutcomeServer(outcome);
      try {
        const result = await runDatastoreOrdersLoad({
          baseUrl: server.baseUrl,
          users: 10,
          visibilityTimeoutMs: 100,
        });
        expect(result).toMatchObject({
          users: 10,
          failedUsers: 10,
          commandAcknowledgements: 0,
          queryVisibilities: 0,
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
  | "uncorrelated-update"
  | "stalled-subscription"
  | "stalled-command"
  | "stalled-query"
  | "stalled-activation";

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
    const result = await runDatastoreOrdersLoad({
      baseUrl: server.baseUrl,
      users: 10,
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
        : Promise.resolve(queryResponse(query)),
  };
}

function subscriptionHandlers(outcome: ProtocolOutcome, onStart: () => void, onAbort: () => void) {
  return {
    subscribe: (_topic: unknown, context: HandlerContext) =>
      outcome === "stalled-subscription"
        ? stalled(context, onStart, onAbort)
        : Promise.resolve(create(SubscriptionSchema)),
    async *activate(_subscription: unknown, context: HandlerContext) {
      if (outcome === "stalled-activation") await stalled(context, onStart, onAbort);
      await Promise.resolve();
      if (outcome === "ended-subscription") return;
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
    packedId === undefined ? undefined : AnyMessages.unpack(packedId, StringValueSchema)?.value;
  return create(QueryResponseSchema, {
    response: create(ResponseSchema, { status: okStatus() }),
    message:
      id === undefined
        ? []
        : [{ state: AnyMessages.pack(OrderSummarySchema, create(OrderSummarySchema, { id })) }],
  });
}
function okStatus() {
  return create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } });
}
