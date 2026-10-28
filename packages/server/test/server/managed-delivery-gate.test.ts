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

import { describe, expect, it, vi } from "vitest";

import { ManagedDeliveryGate } from "../../src/server/managed-delivery-gate.js";

describe("ManagedDeliveryGate", () => {
  it("starts a deferred supervisor once on activation and preserves notifications", async () => {
    const gate = new ManagedDeliveryGate(true);
    const start = vi.fn(() => Promise.resolve(undefined));
    await gate.start(start);
    await gate.start(start);
    expect(start).not.toHaveBeenCalled();
    await gate.activate();
    expect(start).toHaveBeenCalledTimes(1);
    await gate.start(start);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("cancels deferred startup before activation", async () => {
    const gate = new ManagedDeliveryGate(true);
    const start = vi.fn(() => Promise.resolve(undefined));
    await gate.start(start);
    gate.cancel();
    await gate.activate();
    expect(start).not.toHaveBeenCalled();
  });
});
