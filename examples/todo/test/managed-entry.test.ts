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
import type { ManagedServerApplicationOptions } from "@spine-event-engine/server";

const calls = vi.hoisted(() => {
  const delivery = { open: vi.fn(() => Promise.resolve()) };
  const storageFactory = {};
  const typeRegistry = {};
  const stringifiers = { setTypeRegistry: vi.fn() };
  const subscriptionRegistry = {};
  const context = {};
  const running = {};
  const start = vi.fn(() => Promise.resolve(running));
  const add = vi.fn(() => ({ start }));
  const builder = {
    setClient: vi.fn(),
    setStringifierRegistry: vi.fn(),
    build: vi.fn(() => storageFactory),
  };
  builder.setClient.mockReturnValue(builder);
  builder.setStringifierRegistry.mockReturnValue(builder);
  return {
    add,
    builder,
    context,
    createContext: vi.fn(() => Promise.resolve(context)),
    delivery,
    environmentUse: vi.fn(),
    managedRun:
      vi.fn<
        (
          options: ManagedServerApplicationOptions,
        ) => Promise<{ ready: boolean; close(): Promise<void> }>
      >(),
    running,
    shardStrategy: {},
    start,
    storageFactory,
    stringifiers,
    subscriptionRegistry,
    typeRegistry,
  };
});

vi.mock("@spine-event-engine/core", () => ({
  StringifierRegistry: vi.fn(function StringifierRegistry() {
    return calls.stringifiers;
  }),
  TypeRegistry: { from: vi.fn(() => calls.typeRegistry) },
}));
vi.mock("@spine-event-engine/delivery-client", () => ({
  RemoteDelivery: { connectTo: vi.fn(() => calls.delivery) },
}));
vi.mock("@spine-event-engine/storage-datastore", () => ({
  DatastoreStorageFactory: { newBuilder: vi.fn(() => calls.builder) },
}));
vi.mock("@google-cloud/datastore", () => ({
  Datastore: vi.fn(function Datastore() {
    return {};
  }),
}));
vi.mock("@spine-event-engine/server", () => ({
  EnvironmentType: { Production: "production" },
  InMemorySubscriptionRegistry: vi.fn(function InMemorySubscriptionRegistry() {
    return calls.subscriptionRegistry;
  }),
  ManagedServerApplication: { run: calls.managedRun },
  Server: { atPort: vi.fn(() => ({ add: calls.add })) },
  ServerEnvironment: { when: vi.fn(() => ({ use: calls.environmentUse })) },
  UniformAcrossAllShards: { forNumber: vi.fn(() => calls.shardStrategy) },
}));
vi.mock("../src/index.js", () => ({ createTodoContext: calls.createContext }));

describe("the To-Do managed entrypoint", () => {
  const originalEnvironment = { ...process.env };
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.env = { ...originalEnvironment };
    process.exitCode = originalExitCode;
    vi.resetModules();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("assembles a complete child with one shared application type registry", async () => {
    Object.assign(process.env, {
      HOST: "127.0.0.1",
      PORT: "8080",
      DATASTORE_PROJECT_ID: "todo-managed",
      DELIVERY_SERVER_URL: "http://127.0.0.1:8484",
      PROCESS_COUNT: "2",
      DELIVERY_SHARD_COUNT: "3",
      SPINE_MANAGED_SERVER_CHILD: "true",
    });
    calls.managedRun.mockResolvedValueOnce({ ready: true, close: () => Promise.resolve() });

    await import("../src/managed-entry.js");
    const options = calls.managedRun.mock.calls[0]?.[0];
    if (options === undefined) throw new Error("Managed options were not supplied.");
    await expect(options.createServer({ host: "127.0.0.1", port: 0 })).resolves.toBe(calls.running);
    await options.synchronize?.();

    expect(calls.stringifiers.setTypeRegistry).toHaveBeenCalledWith(calls.typeRegistry);
    expect(calls.builder.setStringifierRegistry).toHaveBeenCalledWith(calls.stringifiers);
    expect(calls.environmentUse).toHaveBeenCalledWith({
      storageFactory: calls.storageFactory,
      typeRegistry: calls.typeRegistry,
      delivery: calls.delivery,
    });
    expect(calls.createContext).toHaveBeenCalledWith({
      storageFactory: calls.storageFactory,
      deliveryStrategy: calls.shardStrategy,
      subscriptionRegistry: calls.subscriptionRegistry,
    });
    expect(calls.add).toHaveBeenCalledWith(calls.context);
    expect(calls.start).toHaveBeenCalledOnce();
    expect(calls.delivery.open).toHaveBeenCalledOnce();
  });

  it.each([
    ["successful", () => Promise.resolve(), 0],
    ["failed", () => Promise.reject(new Error("close failed")), 1],
  ] as const)("owns %s parent shutdown", async (_description, close, expectedExitCode) => {
    Object.assign(process.env, {
      HOST: "127.0.0.1",
      PORT: "8080",
      DATASTORE_PROJECT_ID: "todo-managed",
      DELIVERY_SERVER_URL: "http://127.0.0.1:8484",
      PROCESS_COUNT: "2",
      DELIVERY_SHARD_COUNT: "3",
    });
    delete process.env.SPINE_MANAGED_SERVER_CHILD;
    const handlers = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      if (typeof event === "string")
        handlers.set(event, () => {
          listener();
        });
      return process;
    });
    const managedClose = vi.fn(close);
    calls.managedRun.mockResolvedValueOnce({ ready: true, close: managedClose });

    await import("../src/managed-entry.js");
    handlers.get("SIGTERM")?.();
    handlers.get("SIGTERM")?.();

    await vi.waitFor(() => {
      expect(managedClose).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(expectedExitCode);
    });
    expect(handlers.has("SIGINT")).toBe(true);
  });
});
