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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ManagedServerApplicationHandle,
  ManagedServerApplicationOptions,
  RunningServer,
} from "@spine-event-engine/server";

const managed = vi.hoisted(() => ({
  run: vi.fn<(options: ManagedServerApplicationOptions) => Promise<ManagedServerApplicationHandle>>(),
}));
const registry = vi.hoisted(() => ({ close: vi.fn(() => Promise.resolve()) }));
const registrar = vi.hoisted(() => ({
  start: vi.fn(() => Promise.resolve()),
  close: vi.fn(() => Promise.resolve()),
}));

vi.mock("@spine-event-engine/server", () => ({
  ManagedServerApplication: { start: managed.run },
}));
vi.mock("@spine-event-engine/deployment", () => ({
  LeasedNodeRegistry: vi.fn(function LeasedNodeRegistry() {
    return registry;
  }),
}));
vi.mock("@spine-event-engine/deployment-gce", () => ({
  GceRegistrar: vi.fn(function GceRegistrar() {
    return registrar;
  }),
}));

const { GceApplicationEntrypoint } = await import("../../examples/application.js");

describe("the GCE managed application entrypoint", () => {
  beforeEach(() => {
    managed.run.mockReset();
    registry.close.mockReset();
    registrar.start.mockReset();
    registrar.close.mockReset();
    registry.close.mockResolvedValue();
    registrar.start.mockResolvedValue();
    registrar.close.mockResolvedValue();
  });

  it("leases a ready Coordinator and withdraws it before managed children stop", async () => {
    const events: string[] = [];
    const handle = {
      ready: true,
      close: vi.fn(() => {
        events.push("managed");
        return Promise.resolve();
      }),
    };
    registrar.start.mockImplementationOnce(() => {
      events.push("registered");
      return Promise.resolve();
    });
    registrar.close.mockImplementationOnce(() => {
      events.push("withdrawn");
      return Promise.resolve();
    });
    registry.close.mockImplementationOnce(() => {
      events.push("registry");
      return Promise.resolve();
    });
    managed.run.mockResolvedValueOnce(handle);
    const createServer = vi.fn(() => Promise.resolve(runningServer()));

    const running = await GceApplicationEntrypoint.run(
      {
        moduleUrl: import.meta.url,
        createServer,
        registryStorage: { storageFactoryFor: vi.fn(() => ({}) as never) },
      },
      {
        PORT: "8080",
        APPLICATION_PROCESS_COUNT: "2",
        DELIVERY_SHARD_COUNT: "3",
        REGISTRY_NAMESPACE: "nodes",
        REGISTRY_STORAGE_REFERENCE: "shared",
      },
    );

    expect(events).toEqual(["registered"]);
    expect(managed.run.mock.calls[0]?.[0]).toMatchObject({ processCount: 2, port: 8080 });
    await expect(
      managed.run.mock.calls[0]?.[0]?.createServer({ host: "127.0.0.1", port: 0 }),
    ).resolves.toBeDefined();
    expect(createServer).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 0,
      deliveryShardCount: 3,
    });
    await running.close();
    expect(events).toEqual(["registered", "withdrawn", "managed", "registry"]);
  });

  it("cleans up the registry when managed startup fails before a Coordinator exists", async () => {
    const failure = new Error("children failed");
    managed.run.mockRejectedValueOnce(failure);

    await expect(GceApplicationEntrypoint.run(options(), environment())).rejects.toBe(failure);
    expect(registry.close).toHaveBeenCalledOnce();
  });

  it("rejects an invalid managed startup result before a Coordinator can be leased", async () => {
    managed.run.mockResolvedValueOnce(undefined as never);

    await expect(GceApplicationEntrypoint.run(options(), environment())).rejects.toThrow(
      "GCE managed application did not start.",
    );
    expect(registrar.start).not.toHaveBeenCalled();
    expect(registry.close).toHaveBeenCalledOnce();
  });

  it("retains registry cleanup failure when managed startup fails", async () => {
    const startup = new Error("children failed");
    const cleanup = new Error("registry cleanup failed");
    managed.run.mockRejectedValueOnce(startup);
    registry.close.mockRejectedValueOnce(cleanup);

    const failure = await GceApplicationEntrypoint.run(options(), environment()).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([startup, cleanup]);
  });

  it("keeps the VM Coordinator lease out of each managed child", async () => {
    const previous = process.env.SPINE_MANAGED_SERVER_CHILD;
    process.env.SPINE_MANAGED_SERVER_CHILD = "true";
    const handle = { ready: true, close: vi.fn(() => Promise.resolve()) };
    managed.run.mockResolvedValueOnce(handle);
    try {
      const running = await GceApplicationEntrypoint.run(options(), environment());
      expect(running).toBe(handle);
      await running.close();
      expect(registrar.start).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SPINE_MANAGED_SERVER_CHILD;
      else process.env.SPINE_MANAGED_SERVER_CHILD = previous;
    }
  });

  it("retains startup and cleanup failures", async () => {
    const startup = new Error("registration failed");
    const managedClose = new Error("managed close failed");
    const registryClose = new Error("registry close failed");
    managed.run.mockResolvedValueOnce({
      ready: true,
      close: () => Promise.reject(managedClose),
    });
    registrar.start.mockRejectedValueOnce(startup);
    registry.close.mockRejectedValueOnce(registryClose);

    const failure = await GceApplicationEntrypoint.run(options(), environment()).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([startup, managedClose, registryClose]);
  });

  it("withdraws a partially started lease before managed startup rollback", async () => {
    const events: string[] = [];
    const failure = new Error("registration failed");
    managed.run.mockResolvedValueOnce({
      ready: true,
      close: () => {
        events.push("managed");
        return Promise.resolve();
      },
    });
    registrar.start.mockImplementationOnce(() => {
      events.push("start");
      return Promise.reject(failure);
    });
    registrar.close.mockImplementationOnce(() => {
      events.push("withdraw");
      return Promise.resolve();
    });
    registry.close.mockImplementationOnce(() => {
      events.push("registry");
      return Promise.resolve();
    });

    await expect(GceApplicationEntrypoint.run(options(), environment())).rejects.toBe(failure);
    expect(events).toEqual(["start", "withdraw", "managed", "registry"]);
  });

  it("retains a direct registrar cleanup failure after registration startup fails", async () => {
    const startup = new Error("registration failed");
    const withdrawal = new Error("withdraw failed");
    managed.run.mockResolvedValueOnce({ ready: true, close: () => Promise.resolve() });
    registrar.start.mockRejectedValueOnce(startup);
    registrar.close.mockRejectedValueOnce(withdrawal);

    const failure = await GceApplicationEntrypoint.run(options(), environment()).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([startup, withdrawal]);
  });

  it("preserves an unrelated SIGTERM listener while closing through its outer withdrawal path", async () => {
    const events: string[] = [];
    const unrelated = () => {
      events.push("unrelated");
    };
    process.on("SIGTERM", unrelated);
    managed.run.mockResolvedValueOnce({
      ready: true,
      close: () => {
        events.push("managed");
        return Promise.resolve();
      },
    });
    registrar.close.mockImplementationOnce(() => {
      events.push("withdraw");
      return Promise.resolve();
    });
    registry.close.mockImplementationOnce(() => {
      events.push("registry");
      return Promise.resolve();
    });

    try {
      const running = await GceApplicationEntrypoint.run(options(), environment());
      expect(process.listeners("SIGTERM")).toContain(unrelated);
      process.emit("SIGTERM");
      await running.close();

      expect(events).toEqual(["unrelated", "withdraw", "managed", "registry"]);
      expect(process.listeners("SIGTERM")).toContain(unrelated);
    } finally {
      process.off("SIGTERM", unrelated);
    }
  });

  it("retains every graceful shutdown failure", async () => {
    const first = new Error("withdraw failed");
    const second = new Error("managed close failed");
    const third = new Error("registry close failed");
    const handle = { ready: true, close: vi.fn(() => Promise.reject(second)) };
    managed.run.mockResolvedValueOnce(handle);
    registrar.close.mockRejectedValueOnce(first);
    registry.close.mockRejectedValueOnce(third);
    const running = await GceApplicationEntrypoint.run(options(), environment());

    const failure = await running.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([first, second, third]);
  });

  it("returns one shutdown failure directly", async () => {
    const failure = new Error("withdraw failed");
    managed.run.mockResolvedValueOnce({ ready: true, close: () => Promise.resolve() });
    registrar.close.mockRejectedValueOnce(failure);
    const running = await GceApplicationEntrypoint.run(options(), environment());

    await expect(running.close()).rejects.toBe(failure);
  });

  it("forwards optional managed-child synchronization and replacement settings", async () => {
    const synchronize = vi.fn(() => Promise.resolve());
    const restart = { initialDelayMs: 10, concurrentStarts: 2 };
    const handle = { ready: true, close: vi.fn(() => Promise.resolve()) };
    managed.run.mockResolvedValueOnce(handle);

    const running = await GceApplicationEntrypoint.run(
      { ...options(), synchronize, restart },
      environment(),
    );

    expect(running.ready).toBe(true);
    expect(managed.run.mock.calls[0]?.[0]).toMatchObject({ synchronize, restart });
    await running.close();
  });
});

function options() {
  return {
    moduleUrl: import.meta.url,
    createServer: () => Promise.resolve(runningServer()),
    registryStorage: { storageFactoryFor: vi.fn(() => ({}) as never) },
  };
}

function runningServer(): RunningServer {
  return {} as RunningServer;
}

function environment() {
  return {
    PORT: "8080",
    APPLICATION_PROCESS_COUNT: "1",
    DELIVERY_SHARD_COUNT: "1",
    REGISTRY_NAMESPACE: "nodes",
    REGISTRY_STORAGE_REFERENCE: "shared",
  };
}
