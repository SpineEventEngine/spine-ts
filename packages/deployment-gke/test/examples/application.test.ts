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
import type {
  ManagedServerApplicationHandle,
  ManagedServerApplicationOptions,
  RunningServer,
} from "@spine-event-engine/server";

const managed = vi.hoisted(() => ({
  run: vi.fn<(options: ManagedServerApplicationOptions) => Promise<ManagedServerApplicationHandle>>(),
}));

vi.mock("@spine-event-engine/server", () => ({
  ManagedServerApplication: { run: managed.run },
}));

const { ApplicationEntrypoint } = await import("../../examples/application.js");

describe("the GKE managed application entrypoint", () => {
  it("starts the Coordinator with explicit deployer counts and loopback-only children", async () => {
    const handle = { ready: true, close: vi.fn(() => Promise.resolve()) };
    const createServer = vi.fn(() => Promise.resolve(runningServer()));
    managed.run.mockResolvedValueOnce(handle);

    await expect(
      ApplicationEntrypoint.run(
        { moduleUrl: import.meta.url, createServer },
        { PORT: "8080", APPLICATION_PROCESS_COUNT: "2", DELIVERY_SHARD_COUNT: "3" },
      ),
    ).resolves.toBe(handle);

    const options = managed.run.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      processCount: 2,
      host: "0.0.0.0",
      port: 8080,
      moduleUrl: import.meta.url,
    });
    await expect(options.createServer({ host: "127.0.0.1", port: 0 })).resolves.toBeDefined();
    expect(createServer).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 0,
      deliveryShardCount: 3,
    });
  });

  it("passes optional synchronization and restart configuration through unchanged", async () => {
    const handle = { ready: true, close: vi.fn(() => Promise.resolve()) };
    const synchronize = vi.fn(() => Promise.resolve());
    const restart = { initialDelayMs: 10 };
    managed.run.mockResolvedValueOnce(handle);

    await ApplicationEntrypoint.run(
      {
        moduleUrl: import.meta.url,
        createServer: () => Promise.resolve(runningServer()),
        synchronize,
        restart,
      },
      { PORT: "8080", APPLICATION_PROCESS_COUNT: "1", DELIVERY_SHARD_COUNT: "1" },
    );

    expect(managed.run.mock.calls[1]?.[0]).toMatchObject({ synchronize, restart });
  });
});

function runningServer(): RunningServer {
  return {} as RunningServer;
}
