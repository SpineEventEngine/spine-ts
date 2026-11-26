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

import { DeliveryServer } from "../../src/index.js";
import { DeliveryConfig } from "../../src/server/config.js";

describe("DeliveryServer configuration", () => {
  it("uses the 60-second default", () => {
    const server = new DeliveryServer({ port: 0 });

    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(0);
  });

  it("rejects invalid configuration synchronously before startup", () => {
    expect(() => new DeliveryServer({ host: " " })).toThrow("Delivery server host is invalid.");
    expect(() => new DeliveryServer({ port: -1 })).toThrow("Delivery server port is invalid.");
    expect(() => new DeliveryServer({ maxInboundMessageBytes: 0 })).toThrow(
      "Delivery server inbound message size is invalid.",
    );
    expect(() => new DeliveryServer({ maxOutboundMessageBytes: 0 })).toThrow(
      "Delivery server outbound message size is invalid.",
    );
    expect(() => new DeliveryServer({ maxOutboundMessageBytes: 0x1_0000_0000 })).toThrow(
      "Delivery server outbound message size is invalid.",
    );
  });

  it("uses protobuf framing capacity by default and keeps direction-specific overrides", () => {
    expect(DeliveryConfig.resolve()).toMatchObject({
      maxInboundMessageBytes: 0xffff_ffff,
      maxOutboundMessageBytes: 0xffff_ffff,
    });
    expect(
      DeliveryConfig.resolve({ maxInboundMessageBytes: 1_024, maxOutboundMessageBytes: 2_048 }),
    ).toMatchObject({ maxInboundMessageBytes: 1_024, maxOutboundMessageBytes: 2_048 });
  });

  it("accepts sessions longer than one Node timer interval", () => {
    expect(
      DeliveryConfig.resolve({ processingTimeoutSeconds: 3_000_000 }).processingTimeoutMs,
    ).toBe(3_000_000_000);
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
