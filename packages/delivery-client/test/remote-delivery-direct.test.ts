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
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

const state = vi.hoisted(() => ({ clients: [] as FakeClient[], closeFailures: 0 }));

vi.mock("../src/client/client.js", () => ({
  DeliveryClient: {
    connectTo: vi.fn(() => {
      const client = new FakeClient();
      state.clients.push(client);
      return client;
    }),
  },
}));
vi.mock("../src/remote/adapters.js", () => ({
  RemoteInbox: class {
    constructor(readonly client: FakeClient) {}
  },
  RemoteWorkRegistry: class {
    constructor(readonly client: FakeClient) {}
  },
}));

import { RemoteDelivery } from "../src/remote/remote-delivery.js";
import { DeliveryBuilder } from "../src/index.js";

class FakeClient {
  closed = 0;
  observed = 0;
  async *observeAvailableShards(): AsyncIterable<string> {
    this.observed += 1;
    await Promise.resolve();
    yield "available";
  }
  close(): void {
    this.closed += 1;
    if (state.closeFailures > 0) {
      state.closeFailures -= 1;
      throw new Error("close failed");
    }
  }
}

describe("RemoteDelivery work source", () => {
  beforeEach(() => {
    state.clients = [];
    state.closeFailures = 0;
  });

  it("publishes adapters without waiting for the first work notice", async () => {
    const delivery = DeliveryBuilder.remote({ endpoint: "http://delivery.test" });
    expect(() => delivery.inbox).toThrow("not open");
    expect(() => delivery.source).toThrow("not open");

    await Promise.all([delivery.open(), delivery.open()]);
    expect(state.clients).toHaveLength(1);
    expect(delivery.inbox).toBeTruthy();
    expect(delivery.workRegistry).toBeTruthy();
    await expect(
      delivery.source.observeAvailableShards()[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ value: "available" });
    expect(state.clients[0]?.observed).toBe(1);
    await delivery.close();
    expect(state.clients[0]?.closed).toBe(1);
  });

  it("validates notification modes before opening a connection", () => {
    expect(() =>
      RemoteDelivery.connectTo({
        endpoint: "http://delivery.test",
        notifications: {
          kind: "delivery-server",
          maxConcurrentDeliveries: 0,
        },
      }),
    ).toThrow("positive safe integer");
    expect(() =>
      RemoteDelivery.connectTo({
        endpoint: "http://delivery.test",
        notifications: {
          kind: "custom",
          shardObserver: undefined,
        } as never,
      }),
    ).toThrow("shard observer");
    expect(() =>
      RemoteDelivery.connectTo({
        endpoint: "http://delivery.test",
        notifications: {
          kind: "custom",
          shardObserver: { onMessage: () => undefined },
          maxConcurrentDeliveries: 2,
        } as never,
      }),
    ).toThrow("built-in");
    expect(() =>
      RemoteDelivery.connectTo({
        endpoint: "http://delivery.test",
        notifications: {
          kind: "delivery-server",
          shardObserver: { onMessage: () => undefined },
        } as never,
      }),
    ).toThrow("custom");
    expect(state.clients).toHaveLength(0);
    for (const notifications of [
      null,
      {},
      {
        kind: "unknown",
        shardObserver: {
          onMessage: () => undefined,
        },
      },
    ]) {
      expect(() =>
        RemoteDelivery.connectTo({ endpoint: "http://delivery.test", notifications } as never),
      ).toThrow("notification kind");
    }
  });

  it("exposes local custom observation through the public delivery-client builder", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const shardObserver = { onMessage: vi.fn() };
    const local = DeliveryBuilder.local({ storageFactory, shardObserver });
    expect(local.local).toBe(true);
    expect(local.notifications).toEqual({ kind: "custom", shardObserver });
    await local.open();
    await local.close();
  });

  it("retries failed close without reopening the terminal facility", async () => {
    state.closeFailures = 1;
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });
    await delivery.open();
    await expect(delivery.close()).rejects.toThrow("RemoteDelivery close failed");
    await expect(delivery.close()).resolves.toBeUndefined();
    expect(state.clients[0]?.closed).toBe(2);
    await expect(delivery.open()).rejects.toThrow("closed");
  });

  it("closes a concurrent opening attempt before the caller can reuse it", async () => {
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });
    const opening = delivery.open();
    const closing = delivery.close();
    await expect(opening).resolves.toBeUndefined();
    await expect(delivery.open()).rejects.toThrow("closed");
    await expect(closing).resolves.toBeUndefined();
    expect(state.clients[0]?.closed).toBe(1);
  });
});
