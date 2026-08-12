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
import { describe, expect, it } from "vitest";

import { DeliveryServer, InMemoryDelivery } from "../../src/index.js";
import { DeliveryConfig } from "../../src/server/config.js";

describe("DeliveryServer configuration", () => {
  it("uses documented defaults and keeps configured zero", () => {
    const server = new DeliveryServer({ port: 0, processingTimeoutSeconds: 0 });

    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(0);
  });

  it("rejects invalid configuration synchronously before startup", () => {
    expect(() => new DeliveryServer({ host: " " })).toThrow("Delivery server host is invalid.");
    expect(() => new DeliveryServer({ port: -1 })).toThrow("Delivery server port is invalid.");
    expect(() => new DeliveryServer({ maxInboundMessageBytes: 0 })).toThrow(
      "Delivery server inbound message size is invalid.",
    );
    expect(() => new DeliveryServer({ maxRetainedMessages: 0 })).toThrow(
      "Delivery server retained message limit is invalid.",
    );
    expect(() => new DeliveryServer({ maxTrackedShards: 1_001 })).toThrow(
      "Delivery server tracked shard limit is invalid.",
    );
    expect(() => InMemoryDelivery.create({ maxTrackedShards: 1_001 })).toThrow(
      "Delivery server maxTrackedShards is invalid.",
    );
    expect(() => InMemoryDelivery.create({ maxRetainedMessages: 0 })).toThrow(
      "Delivery server maxRetainedMessages is invalid.",
    );
  });

  it("parses bounded numeric environment values without coercion", () => {
    expect(DeliveryConfig.environmentNumber(undefined, 7, "test value")).toBe(7);
    expect(DeliveryConfig.environmentNumber("", 7, "test value")).toBe(7);
    expect(DeliveryConfig.environmentNumber("12", 7, "test value")).toBe(12);
    expect(() => DeliveryConfig.environmentNumber("01", 7, "test value")).toThrow(
      "Delivery server test value is invalid.",
    );
    expect(() => DeliveryConfig.environmentNumber("9007199254740992", 7, "test value")).toThrow(
      "Delivery server test value is invalid.",
    );
  });
});
