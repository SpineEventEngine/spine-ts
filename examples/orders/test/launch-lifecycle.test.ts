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

import { expect, it, vi } from "vitest";

it("closes the setup after a server start failure", async () => {
  const { withOrdersServer } = await import("../dist/src/orders-launch.js");
  const failure = new Error("listener unavailable");
  const closeSetup = vi.fn(() => Promise.resolve());
  await expect(
    withOrdersServer(
      { close: closeSetup },
      () => Promise.reject(failure),
      () => Promise.resolve(1),
    ),
  ).rejects.toBe(failure);
  expect(closeSetup).toHaveBeenCalledOnce();
});

it("drains the server before closing the setup after a run failure", async () => {
  const { withOrdersServer } = await import("../dist/src/orders-launch.js");
  const failure = new Error("load failed");
  const order: string[] = [];
  const setup = {
    close: () => {
      order.push("setup");
      return Promise.resolve();
    },
  };
  const server = {
    close: () => {
      order.push("server");
      return Promise.resolve();
    },
  };
  await expect(
    withOrdersServer(
      setup,
      () => Promise.resolve(server),
      () => Promise.reject(failure),
    ),
  ).rejects.toBe(failure);
  expect(order).toEqual(["server", "setup"]);
});

it("keeps storage open when the server drain rejects", async () => {
  const { withOrdersServer } = await import("../dist/src/orders-launch.js");
  const drainFailure = new Error("drain failed");
  const closeSetup = vi.fn(() => Promise.resolve());
  const server = { close: () => Promise.reject(drainFailure) };
  await expect(
    withOrdersServer(
      { close: closeSetup },
      () => Promise.resolve(server),
      () => Promise.resolve(1),
    ),
  ).rejects.toBe(drainFailure);
  expect(closeSetup).not.toHaveBeenCalled();
});

it("returns the run result after orderly closure", async () => {
  const { withOrdersServer } = await import("../dist/src/orders-launch.js");
  const order: string[] = [];
  const setup = {
    close: () => {
      order.push("setup");
      return Promise.resolve();
    },
  };
  const server = {
    close: () => {
      order.push("server");
      return Promise.resolve();
    },
  };
  await expect(
    withOrdersServer(
      setup,
      () => Promise.resolve(server),
      () => Promise.resolve(42),
    ),
  ).resolves.toBe(42);
  expect(order).toEqual(["server", "setup"]);
});
