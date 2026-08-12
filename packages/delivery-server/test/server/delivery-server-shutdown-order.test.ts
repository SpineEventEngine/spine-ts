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

import { DeliveryShutdown } from "../../src/server/shutdown.js";

describe("delivery server shutdown order", () => {
  it("marks health, fences admission, completes Admin, then closes network", async () => {
    const phases: string[] = [];
    await DeliveryShutdown.run({
      markNotServing: () => phases.push("health"),
      closeAdmission: () => phases.push("admission"),
      closeAdmin: () => phases.push("admin"),
      closeNetwork: () => {
        phases.push("network");
        return Promise.resolve();
      },
    });
    expect(phases).toEqual(["health", "admission", "admin", "network"]);
  });
});
