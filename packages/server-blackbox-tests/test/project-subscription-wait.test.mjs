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

import { performance } from "node:perf_hooks";
import { setTimeout } from "node:timers";

import { describe, expect, it } from "vitest";

import { waitUntil } from "../test-fixtures/project-subscription-wait.mjs";

describe("subscription fixture polling", () => {
  it("stops checking when the observation deadline expires", async () => {
    let checks = 0;
    const started = performance.now();
    await expect(
      waitUntil(
        () => {
          checks++;
          return false;
        },
        25,
        "missing child ACK",
      ),
    ).rejects.toThrow("Timed out waiting for missing child ACK.");
    expect(performance.now() - started).toBeLessThan(250);
    const settledChecks = checks;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(checks).toBe(settledChecks);
  });

  it("stops checking when the fixture terminates", async () => {
    const terminated = Promise.withResolvers();
    let checks = 0;
    const waiting = waitUntil(
      () => {
        checks++;
        return false;
      },
      2_000,
      "terminated child ACK",
      terminated.promise,
    );
    terminated.reject(new Error("fixture terminated"));
    await expect(waiting).rejects.toThrow("fixture terminated");
    const settledChecks = checks;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(checks).toBe(settledChecks);
  });
});
