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

const calls = vi.hoisted(() => {
  const delivery = { open: vi.fn(() => Promise.resolve()) };
  const storageFactory = {};
  const typeRegistry = {};
  const stringifiers = { setTypeRegistry: vi.fn() };
  const subscriptionRegistry = {};
  const context = {};
  const server = {};
  const start = vi.fn(() => Promise.resolve(server));
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
    server,
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
  Server: { atPort: vi.fn(() => ({ add: calls.add })) },
  ServerEnvironment: { when: vi.fn(() => ({ use: calls.environmentUse })) },
  UniformAcrossAllShards: { forNumber: vi.fn(() => calls.shardStrategy) },
}));
vi.mock("../src/todo-app.js", () => ({ createTodoContext: calls.createContext }));

import { createTodoReplica } from "../src/multi-process-replica.js";

describe("To-Do multi-process replica", () => {
  it("assembles storage, Delivery, and a ready server from the assigned child endpoint", async () => {
    const replica = await createTodoReplica(
      {
        host: "127.0.0.1",
        port: 8080,
        projectId: "todo",
        deliveryServerUrl: "http://127.0.0.1:8484",
        processCount: 2,
        deliveryShardCount: 3,
      },
      { host: "127.0.0.2", port: 9000 },
    );

    expect(calls.builder.setClient).toHaveBeenCalledOnce();
    expect(calls.stringifiers.setTypeRegistry).toHaveBeenCalledWith(calls.typeRegistry);
    expect(calls.builder.setStringifierRegistry).toHaveBeenCalledWith(calls.stringifiers);
    expect(calls.createContext).toHaveBeenCalledWith({
      storageFactory: calls.storageFactory,
      deliveryStrategy: calls.shardStrategy,
      subscriptionRegistry: calls.subscriptionRegistry,
    });
    expect(calls.add).toHaveBeenCalledWith(calls.context);
    expect(replica.server).toBe(calls.server);
    await replica.synchronize();
    expect(calls.delivery.open).toHaveBeenCalledOnce();
  });
});
