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

import { afterEach, describe, expect, it, vi } from "vitest";

interface ManagedRunOptions {
  createServer(endpoint: { readonly host: string; readonly port: number }): Promise<unknown>;
  synchronize?(): Promise<void>;
}

const calls = vi.hoisted(() => ({
  coordinator: vi.fn(),
  createReplica: vi.fn(() =>
    Promise.resolve({ server: {}, synchronize: vi.fn(() => Promise.resolve()) }),
  ),
  run: vi.fn(),
  settings: {
    deliveryServerUrl: "http://127.0.0.1:8484",
    deliveryShardCount: 3,
    host: "127.0.0.1",
    port: 8080,
    processCount: 2,
    projectId: "todo",
  },
}));

vi.mock("@spine-event-engine/server", () => ({
  ManagedServerApplication: { run: calls.run },
}));

describe("To-Do multi-process app entry selection", () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("creates and synchronizes a replica before the parent owns terminal shutdown", async () => {
    calls.run.mockImplementationOnce(async (options: ManagedRunOptions) => {
      await options.createServer({ host: "127.0.0.2", port: 9000 });
      await options.synchronize?.();
      return { ready: true, close: vi.fn(() => Promise.resolve()) };
    });
    vi.doMock("../dist/src/multi-process-coordinator.js", () => ({
      runTodoCoordinator: calls.coordinator,
    }));
    vi.doMock("../dist/src/multi-process-replica.js", () => ({
      createTodoReplica: calls.createReplica,
    }));
    vi.doMock("../dist/src/multi-process-settings.js", () => ({
      readMultiProcessSettings: vi.fn(() => calls.settings),
    }));

    await import("../dist/src/multi-process-app.js");

    expect(calls.run).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "127.0.0.1",
        port: 8080,
        processCount: 2,
      }),
    );
    expect(calls.createReplica).toHaveBeenCalledWith(calls.settings, {
      host: "127.0.0.2",
      port: 9000,
    });
    expect(calls.coordinator).toHaveBeenCalledOnce();
  });

  it("leaves terminal shutdown with the managed child", async () => {
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    calls.run.mockResolvedValueOnce({ ready: true, close: vi.fn(() => Promise.resolve()) });
    vi.doMock("../dist/src/multi-process-coordinator.js", () => ({
      runTodoCoordinator: calls.coordinator,
    }));
    vi.doMock("../dist/src/multi-process-replica.js", () => ({
      createTodoReplica: calls.createReplica,
    }));
    vi.doMock("../dist/src/multi-process-settings.js", () => ({
      readMultiProcessSettings: vi.fn(() => calls.settings),
    }));

    await import("../dist/src/multi-process-app.js");

    expect(calls.coordinator).not.toHaveBeenCalled();
  });
});
