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

import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => {
  const context = {};
  const server = { baseUrl: "http://127.0.0.1:8080" };
  const start = vi.fn(() => Promise.resolve(server));
  const add = vi.fn(() => ({ start }));
  const atPort = vi.fn(() => ({ add }));
  return {
    add,
    atPort,
    context,
    createContext: vi.fn(() => Promise.resolve(context)),
    server,
    signalInstall: vi.fn(),
    start,
  };
});

vi.mock("@spine-event-engine/server", () => ({
  Server: { atPort: calls.atPort },
}));
vi.mock("../dist/src/todo-app.js", () => ({ createTodoContext: calls.createContext }));
vi.mock("../dist/src/process.js", () => ({ TodoProcessSignals: { install: calls.signalInstall } }));

import { startTodoServer } from "../dist/src/single-process-app.js";

describe("To-Do single-process app", () => {
  it("starts the reusable context at its beginner defaults", async () => {
    await expect(startTodoServer()).resolves.toBe(calls.server);

    expect(calls.atPort).toHaveBeenCalledWith(8080, { host: "127.0.0.1" });
    expect(calls.add).toHaveBeenCalledWith(calls.context);
    expect(calls.start).toHaveBeenCalledOnce();
  });

  it("uses an explicit host and free-port override without changing the context", async () => {
    await expect(startTodoServer({ host: "0.0.0.0", port: 0 })).resolves.toBe(calls.server);

    expect(calls.atPort).toHaveBeenLastCalledWith(0, { host: "0.0.0.0" });
    expect(calls.createContext).toHaveBeenCalledTimes(2);
  });

  it("installs lifecycle cleanup only when Node executes the app file", async () => {
    const originalArgv = [...process.argv];
    try {
      vi.clearAllMocks();
      process.argv[1] = fileURLToPath(
        new URL("../dist/src/single-process-app.js", import.meta.url),
      );
      vi.resetModules();

      await import("../dist/src/single-process-app.js");

      await vi.waitFor(() => {
        expect(calls.signalInstall).toHaveBeenCalledWith(calls.server);
      });
    } finally {
      process.argv = originalArgv;
    }
  });

  it("reports a startup failure without installing lifecycle cleanup", async () => {
    const originalArgv = [...process.argv];
    const originalExitCode = process.exitCode;
    try {
      vi.clearAllMocks();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      calls.start.mockRejectedValueOnce(new Error("listener unavailable"));
      process.argv[1] = fileURLToPath(
        new URL("../dist/src/single-process-app.js", import.meta.url),
      );
      vi.resetModules();

      await import("../dist/src/single-process-app.js");

      await vi.waitFor(() => {
        expect(process.exitCode).toBe(1);
      });
      expect(calls.signalInstall).not.toHaveBeenCalled();
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
    }
  });
});
