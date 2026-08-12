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

import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import {
  HealthCheckRequestSchema,
  HealthCheckResponse_ServingStatus,
} from "@spine-event-engine/proto/delivery-server";
import { create } from "@bufbuild/protobuf";

import { HealthHandlers } from "../../src/health/health-service.js";

describe("delivery health", () => {
  it("serves overall and every registered descriptor but not unknown names", () => {
    let serving = true;
    const health = HealthHandlers.create(() => serving);
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
    const health = HealthHandlers.create(() => true);
    expect(() =>
      health.watch(create(HealthCheckRequestSchema, { service: "" }), {} as never),
    ).toThrow(expect.objectContaining({ code: Code.Unimplemented }));
  });
});
