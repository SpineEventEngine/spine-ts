import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  HealthCheckRequestSchema,
  HealthCheckResponse_ServingStatus,
} from "@spine-event-engine/proto/delivery-server";
import { create } from "@bufbuild/protobuf";

import { createHealthService } from "../../src/health/health-service.js";

describe("delivery health", () => {
  it("serves overall and every registered descriptor but not unknown names", () => {
    let serving = true;
    const health = createHealthService(() => serving);
    for (const service of [
      "",
      "grpc.health.v1.Health",
      "spine.delivery.InboxService",
      "spine.delivery.ShardService",
      "spine.delivery.AdminService",
    ])
      expect(
        health.check(create(HealthCheckRequestSchema, { service }), {} as never),
      ).toMatchObject({
        status: HealthCheckResponse_ServingStatus.SERVING,
      });
    expect(
      health.check(create(HealthCheckRequestSchema, { service: "unknown" }), {} as never),
    ).toMatchObject({
      status: HealthCheckResponse_ServingStatus.NOT_SERVING,
    });
    serving = false;
    expect(
      health.check(create(HealthCheckRequestSchema, { service: "" }), {} as never),
    ).toMatchObject({
      status: HealthCheckResponse_ServingStatus.NOT_SERVING,
    });
  });

  it("does not implement health watch", () => {
    const health = createHealthService(() => true);
    expect(() =>
      health.watch(create(HealthCheckRequestSchema, { service: "" }), {} as never),
    ).toThrow(expect.objectContaining({ code: Code.Unimplemented }));
  });
});
