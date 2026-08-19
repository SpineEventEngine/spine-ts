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

import { GceDeploymentSettings } from "../../examples/deployment-settings.js";

describe("GCE managed deployment settings", () => {
  it("requires explicit positive process and Delivery shard counts", () => {
    const environment = { APPLICATION_PROCESS_COUNT: "2", DELIVERY_SHARD_COUNT: "3" };

    expect(GceDeploymentSettings.processCount(environment)).toBe(2);
    expect(GceDeploymentSettings.deliveryShardCount(environment)).toBe(3);
    expect(GceDeploymentSettings.port({ PORT: "8080" }, "PORT")).toBe(8080);
    expect(GceDeploymentSettings.registryNamespace({ REGISTRY_NAMESPACE: " nodes " })).toBe(
      "nodes",
    );
    expect(
      GceDeploymentSettings.registryStorageReference({ REGISTRY_STORAGE_REFERENCE: " shared " }),
    ).toBe("shared");
    for (const value of [undefined, "0", "1.5", "unsafe"])
      expect(() =>
        GceDeploymentSettings.deliveryShardCount({ DELIVERY_SHARD_COUNT: value }),
      ).toThrow("DELIVERY_SHARD_COUNT must be a positive safe integer.");
    for (const read of [
      () => GceDeploymentSettings.port({ PORT: "0" }, "PORT"),
      () => GceDeploymentSettings.registryNamespace({ REGISTRY_NAMESPACE: " " }),
      () => GceDeploymentSettings.registryStorageReference({ REGISTRY_STORAGE_REFERENCE: " " }),
    ])
      expect(read).toThrow();
  });
});
