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
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => {
  const closed: string[] = [];
  const context = {};
  const environment = {
    close: vi.fn(() => {
      closed.push("environment");
      return Promise.resolve();
    }),
  };
  const application = {
    close: vi.fn(() => {
      closed.push("application");
      return Promise.resolve();
    }),
  };
  const endpoint = {
    host: "127.0.0.1",
    port: 8080,
    baseUrl: "http://127.0.0.1:8080",
    close: vi.fn(() => {
      closed.push("endpoint");
      return Promise.resolve();
    }),
  };
  const environmentBuilder = {
    under: vi.fn(),
    build: vi.fn(() => environment),
  };
  environmentBuilder.under.mockReturnValue(environmentBuilder);
  const applicationBuilder = {
    setServerEnvironment: vi.fn(),
    add: vi.fn(),
    build: vi.fn(() => Promise.resolve(application)),
  };
  applicationBuilder.setServerEnvironment.mockReturnValue(applicationBuilder);
  applicationBuilder.add.mockReturnValue(applicationBuilder);
  const serverBuilder = { setApplication: vi.fn(), start: vi.fn(() => Promise.resolve(endpoint)) };
  serverBuilder.setApplication.mockReturnValue(serverBuilder);
  return {
    application,
    applicationBuilder,
    atPort: vi.fn(() => serverBuilder),
    closed,
    context,
    endpoint,
    environment,
    environmentBuilder,
    createContext: vi.fn(() => context),
    selectStorage: vi.fn(() => Promise.resolve(undefined as unknown)),
    serverBuilder,
    signalInstall: vi.fn(),
  };
});

vi.mock("@spine-event-engine/server", () => ({
  Application: { newBuilder: () => calls.applicationBuilder },
  EnvironmentType: { Local: "local" },
  Server: { atPort: calls.atPort },
  ServerEnvironment: { newBuilder: () => calls.environmentBuilder },
}));
vi.mock("../dist/src/todo-app.js", () => ({ createTodoContext: calls.createContext }));
vi.mock("../dist/src/process.js", () => ({ TodoProcessSignals: { install: calls.signalInstall } }));
vi.mock("../dist/src/todo-storage.js", () => ({ TodoStorage: { select: calls.selectStorage } }));

import { startTodoServer } from "../dist/src/single-process-app.js";

describe("To-Do single-process app", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.closed.length = 0;
    calls.selectStorage.mockResolvedValue(undefined);
    calls.applicationBuilder.build.mockResolvedValue(calls.application);
    calls.serverBuilder.start.mockResolvedValue(calls.endpoint);
  });

  it("assembles one Application at its beginner listener defaults", async () => {
    const server = await startTodoServer();
    expect(server.baseUrl).toBe(calls.endpoint.baseUrl);
    expect(calls.atPort).toHaveBeenCalledWith(8080, { host: "127.0.0.1" });
    expect(calls.applicationBuilder.add).toHaveBeenCalledWith(calls.context);
    expect(calls.serverBuilder.setApplication).toHaveBeenCalledWith(calls.application);
    await server.close();
  });

  it("uses an explicit host and free-port override", async () => {
    const server = await startTodoServer({ host: "0.0.0.0", port: 0 });
    expect(calls.atPort).toHaveBeenCalledWith(0, { host: "0.0.0.0" });
    await server.close();
  });

  it("passes caller-supplied storage to the fresh environment", async () => {
    const storageFactory = { close: vi.fn() } as never;
    const server = await startTodoServer({ storageFactory });
    expect(calls.environmentBuilder.under).toHaveBeenCalledWith("local", expect.any(Function));
    const configure = calls.environmentBuilder.under.mock.calls[0]?.[1] as (
      setting: unknown,
    ) => void;
    const use = vi.fn();
    configure({ use });
    expect(use).toHaveBeenCalledWith({ storageFactory });
    await server.close();
  });

  it("selects storage when the caller supplies none", async () => {
    const storageFactory = { close: vi.fn() } as never;
    calls.selectStorage.mockResolvedValue(storageFactory);
    const server = await startTodoServer();
    expect(calls.selectStorage).toHaveBeenCalledOnce();
    const configure = calls.environmentBuilder.under.mock.calls[0]?.[1] as (
      setting: unknown,
    ) => void;
    const use = vi.fn();
    configure({ use });
    expect(use).toHaveBeenCalledWith({ storageFactory });
    await server.close();
  });

  it("closes the endpoint before the Application", async () => {
    const server = await startTodoServer();
    await server.close();
    expect(calls.closed).toEqual(["endpoint", "application"]);
  });

  it("keeps the Application open if endpoint close fails", async () => {
    calls.endpoint.close.mockRejectedValueOnce(new Error("listener active"));
    const server = await startTodoServer();
    await expect(server.close()).rejects.toThrow("listener active");
    expect(calls.application.close).not.toHaveBeenCalled();
  });

  it("closes a built Application when listener startup fails", async () => {
    calls.serverBuilder.start.mockRejectedValueOnce(new Error("listener unavailable"));
    await expect(startTodoServer()).rejects.toThrow("listener unavailable");
    expect(calls.application.close).toHaveBeenCalledOnce();
  });

  it("closes the environment when Application assembly fails", async () => {
    calls.applicationBuilder.build.mockRejectedValueOnce(new Error("assembly unavailable"));
    await expect(startTodoServer()).rejects.toThrow("assembly unavailable");
    expect(calls.environment.close).toHaveBeenCalledOnce();
  });

  it("installs lifecycle cleanup only when Node executes the app file", async () => {
    const originalArgv = [...process.argv];
    try {
      process.argv[1] = fileURLToPath(
        new URL("../dist/src/single-process-app.js", import.meta.url),
      );
      vi.resetModules();
      await import("../dist/src/single-process-app.js");
      await vi.waitFor(() => {
        expect(calls.signalInstall).toHaveBeenCalledOnce();
      });
    } finally {
      process.argv = originalArgv;
    }
  });
});
