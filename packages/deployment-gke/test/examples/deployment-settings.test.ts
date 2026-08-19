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

import { DeploymentSettings } from "../../examples/deployment-settings.js";

describe("GKE managed deployment settings", () => {
  it("requires explicit positive process and Delivery shard counts", () => {
    const environment = { APPLICATION_PROCESS_COUNT: "2", DELIVERY_SHARD_COUNT: "3" };

    expect(DeploymentSettings.processCount(environment)).toBe(2);
    expect(DeploymentSettings.deliveryShardCount(environment)).toBe(3);
    expect(DeploymentSettings.port({ PORT: "8080" }, "PORT")).toBe(8080);
    expect(
      DeploymentSettings.serviceName({ BACKEND_DISCOVERY_SERVICE: " application.default " }),
    ).toBe("application.default");
    for (const value of [undefined, "0", "1.5", "unsafe"])
      expect(() => DeploymentSettings.processCount({ APPLICATION_PROCESS_COUNT: value })).toThrow(
        "APPLICATION_PROCESS_COUNT must be a positive safe integer.",
      );
    for (const read of [
      () => DeploymentSettings.port({ PORT: "0" }, "PORT"),
      () => DeploymentSettings.serviceName({ BACKEND_DISCOVERY_SERVICE: " " }),
    ])
      expect(read).toThrow();
  });
});
