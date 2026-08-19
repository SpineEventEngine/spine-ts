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

import { runTodoCoordinator } from "../src/multi-process-coordinator.js";

describe("To-Do multi-process Coordinator", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it.each([
    ["SIGINT", () => Promise.resolve(), 0],
    ["SIGTERM", () => Promise.reject(new Error("close failed")), 1],
  ] as const)("closes all replicas once after %s", async (signal, close, expectedExitCode) => {
    const handlers = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (typeof event === "string") {
        handlers.set(event, () => {
          listener();
        });
      }
      return process;
    });
    const handle = { ready: true, close: vi.fn(close) };

    runTodoCoordinator(handle, {
      host: "127.0.0.1",
      port: 8080,
      projectId: "todo",
      deliveryServerUrl: "http://127.0.0.1:8484",
      processCount: 2,
      deliveryShardCount: 3,
    });
    handlers.get(signal)?.();
    handlers.get(signal)?.();

    await vi.waitFor(() => {
      expect(handle.close).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(expectedExitCode);
    });
    expect(handlers.has("SIGINT")).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);
  });
});
