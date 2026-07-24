import { existsSync } from "node:fs";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { create } from "@bufbuild/protobuf";
import { EmptySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { packAny, unpackAny } from "@spine-event-engine/core";
import { AckSchema } from "@spine-event-engine/proto";
import { ResponseSchema, StatusSchema } from "@spine-event-engine/proto";
import {
  type Query,
  type QueryResponse,
  QueryResponseSchema,
} from "@spine-event-engine/proto/client";
import { SubscriptionSchema, SubscriptionUpdateSchema } from "@spine-event-engine/proto/client";
import { CommandService } from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import { describe, expect, it, vi } from "vitest";

import { projectManagementLoadLevels, runProjectManagementLoad } from "../src/load-runner.js";
import { ProjectSummarySchema } from "../generated/spine/example/project_management/v1/read_models_pb.js";

describe("project-management load runner", () => {
  it("runs ten users over real gRPC and reports command, query, subscription, cleanup, and metrics", async () => {
    const modulePath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
    expect(existsSync(modulePath)).toBe(true);

    const { startProjectManagementServer } = await import("../dist/src/index.js");
    const server = await startProjectManagementServer({ host: "127.0.0.1", port: 0 });
    try {
      const result = await runProjectManagementLoad({ baseUrl: server.baseUrl, users: 10 });

      expect(projectManagementLoadLevels).toEqual([10, 25, 50, 100]);
      expect(result).toMatchObject({
        users: 10,
        failedUsers: 0,
        commandAcknowledgements: 10,
        queryVisibilities: 10,
        subscriptionDeliveries: 10,
      });
      expect(result.commandAcknowledgementLatency.p99Ms).toBeGreaterThanOrEqual(0);
      expect(result.queryVisibilityLatency.p99Ms).toBeGreaterThanOrEqual(0);
      expect(result.subscriptionDeliveryLatency.p99Ms).toBeGreaterThanOrEqual(0);
      expect(result.throughputPerSecond).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  }, 30_000);

  it("reports failed users and zeroed metrics when the gRPC endpoint is unavailable", async () => {
    const result = await runProjectManagementLoad({
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
      commandAcknowledgementLatency: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
      queryVisibilityLatency: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
      subscriptionDeliveryLatency: { p50Ms: 0, p95Ms: 0, p99Ms: 0 },
    });
    expect(result.throughputPerSecond).toBe(0);
  }, 10_000);

  it("reports zero throughput when the real gRPC load completes within one clock tick", async () => {
    const modulePath = fileURLToPath(new URL("../dist/src/index.js", import.meta.url));
    expect(existsSync(modulePath)).toBe(true);

    const { startProjectManagementServer } = await import("../dist/src/index.js");
    const server = await startProjectManagementServer({ host: "127.0.0.1", port: 0 });
    const now = vi.spyOn(performance, "now").mockReturnValue(1);
    try {
      const result = await runProjectManagementLoad({ baseUrl: server.baseUrl, users: 10 });

      expect(result).toMatchObject({
        users: 10,
        failedUsers: 0,
        commandAcknowledgements: 10,
        queryVisibilities: 10,
        subscriptionDeliveries: 10,
        throughputPerSecond: 0,
      });
    } finally {
      now.mockRestore();
      await server.close();
    }
  }, 30_000);

  it("reports failed users when real gRPC services return unsuccessful protocol outcomes", async () => {
    for (const outcome of [
      "missing-acknowledgement",
      "ended-subscription",
      "uncorrelated-update",
      "missing-query-response",
      "missing-query-state",
      "timed-out-acknowledgement",
    ] as const) {
      const server = await startProtocolOutcomeServer(outcome);
      try {
        const result = await runProjectManagementLoad({
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
        if (outcome === "timed-out-acknowledgement") expect(server.queryReads()).toBe(0);
      } finally {
        await server.close();
      }
    }
  }, 30_000);
});

type ProtocolOutcome =
  | "missing-acknowledgement"
  | "ended-subscription"
  | "uncorrelated-update"
  | "missing-query-response"
  | "missing-query-state"
  | "timed-out-acknowledgement";

async function startProtocolOutcomeServer(outcome: ProtocolOutcome) {
  let queryReads = 0;
  const server = http2.createServer(
    connectNodeAdapter({
      routes(router) {
        router.service(CommandService, {
          post: () =>
            outcome === "timed-out-acknowledgement"
              ? new Promise<never>(() => undefined)
              : Promise.resolve(
                  outcome === "missing-acknowledgement"
                    ? create(AckSchema)
                    : create(AckSchema, { status: okStatus() }),
                ),
        });
        router.service(QueryService, {
          read: (query) => {
            queryReads += 1;
            return Promise.resolve(queryResponse(outcome, query));
          },
        });
        router.service(SubscriptionService, {
          subscribe: () => Promise.resolve(create(SubscriptionSchema)),
          async *activate() {
            await Promise.resolve();
            if (outcome === "ended-subscription") return;
            yield create(SubscriptionUpdateSchema);
          },
          cancel: () => Promise.resolve(create(ResponseSchema, { status: okStatus() })),
        });
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
    queryReads: () => queryReads,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      ),
  };
}

function queryResponse(outcome: ProtocolOutcome, query: Query): QueryResponse {
  const filters = query.target?.criterion;
  const packedId = filters?.case === "filters" ? filters.value.idFilter?.id[0] : undefined;
  const id = packedId === undefined ? undefined : unpackAny(packedId, StringValueSchema)?.value;
  const response =
    outcome === "missing-query-response"
      ? undefined
      : create(ResponseSchema, { status: okStatus() });
  const message =
    outcome === "missing-query-state"
      ? [{}]
      : id === undefined
        ? []
        : [{ state: packAny(ProjectSummarySchema, create(ProjectSummarySchema, { id })) }];

  return create(QueryResponseSchema, {
    response,
    message,
  });
}

function okStatus() {
  return create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } });
}
