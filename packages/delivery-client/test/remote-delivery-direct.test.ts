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

const state = vi.hoisted(() => ({
  clients: [] as FakeClient[],
  readiness: [] as (() => Promise<readonly unknown[]>)[],
  updates: [] as (() => AsyncIterable<unknown>)[],
  reconciled: [] as unknown[],
  releases: [] as unknown[][],
  closeFailures: 0,
}));

vi.mock("../src/client/client.js", () => ({
  DeliveryClient: {
    connectTo: vi.fn(() => {
      const client = new FakeClient(state.readiness.shift() ?? (() => Promise.resolve([])));
      state.clients.push(client);
      return client;
    }),
  },
  deliveryClientAccess: { observeOnce: (client: FakeClient) => client.updates() },
}));
vi.mock("../src/remote/adapters.js", () => ({
  RemoteInbox: class {
    constructor(readonly client: FakeClient) {}
  },
  RemoteWorkRegistry: class {
    constructor(readonly client: FakeClient) {}
    reconcile(value: unknown): void {
      state.reconciled.push(value);
    }
  },
}));

import { RemoteDelivery } from "../src/remote/remote-delivery.js";

class FakeClient {
  closed = 0;
  constructor(private readonly ready: () => Promise<readonly unknown[]>) {}
  shardSnapshot(): Promise<readonly unknown[]> {
    return this.ready();
  }
  updates(): AsyncIterable<unknown> {
    return state.updates.shift()?.() ?? empty();
  }
  releaseExpired(...input: unknown[]): Promise<readonly unknown[]> {
    state.releases.push(input);
    return Promise.resolve([]);
  }
  close(): void {
    this.closed += 1;
    if (state.closeFailures > 0) {
      state.closeFailures -= 1;
      throw new Error("close failed");
    }
  }
}
async function* empty(): AsyncIterable<never> {
  await Promise.resolve();
  yield* [];
}

describe("RemoteDelivery without removal state", () => {
  beforeEach(() => {
    state.clients = [];
    state.readiness = [];
    state.updates = [];
    state.reconciled = [];
    state.releases = [];
    state.closeFailures = 0;
  });

  it("fails closed until readiness then publishes adapters and reconciles source facts", async () => {
    const snapshot = { status: "NOT_PICKED" };
    const update = { status: "PICKED" };
    state.readiness.push(() => Promise.resolve([snapshot]));
    state.updates.push(async function* () {
      await Promise.resolve();
      yield update;
    });
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });

    expect(() => delivery.inbox).toThrow("not open");
    expect(() => delivery.workRegistry).toThrow("not open");
    expect(() => delivery.source).toThrow("not open");
    await delivery.open();
    await expect(delivery.open()).resolves.toBeUndefined();
    expect(delivery.inbox).toBeTruthy();
    expect(delivery.workRegistry).toBeTruthy();
    expect(delivery.source).toBeTruthy();
    await expect(delivery.source.shardSnapshot()).resolves.toEqual([snapshot]);
    await expect(
      delivery.source.observeShardUpdates()[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({ value: update });
    await delivery.source.releaseExpired(10, { timeoutMs: 20 });
    expect(state.reconciled).toEqual([snapshot, update]);
    expect(state.releases).toEqual([[10, { timeoutMs: 20 }]]);
  });

  it("shares opening, closes a failed readiness client, and is terminal after close", async () => {
    const failure = new Error("not ready");
    state.readiness.push(
      () => Promise.reject(failure),
      () => Promise.resolve([]),
    );
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });

    await expect(Promise.all([delivery.open(), delivery.open()])).rejects.toThrow(failure);
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.closed).toBe(1);
    await delivery.open();
    await delivery.close();
    await expect(delivery.open()).rejects.toThrow("closed");
    expect(state.clients[1]?.closed).toBe(1);
  });

  it("retries a failed client close without reopening the terminal delivery", async () => {
    state.readiness.push(() => Promise.resolve([]));
    state.closeFailures = 1;
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });

    await delivery.open();
    await expect(delivery.close()).rejects.toThrow("RemoteDelivery close failed");
    await expect(delivery.close()).resolves.toBeUndefined();
    expect(state.clients[0]?.closed).toBe(2);
    await expect(delivery.open()).rejects.toThrow("closed");
  });

  it("makes an in-flight readiness attempt terminal when closing", async () => {
    let ready!: () => void;
    state.readiness.push(
      () =>
        new Promise((resolve) => {
          ready = () => {
            resolve([]);
          };
        }),
    );
    const delivery = RemoteDelivery.connectTo({ endpoint: "http://delivery.test" });

    const opening = delivery.open();
    await vi.waitFor(() => {
      expect(state.clients).toHaveLength(1);
    });
    const closing = delivery.close();
    ready();
    await expect(opening).rejects.toThrow("closed");
    await expect(closing).resolves.toBeUndefined();
    expect(state.clients[0]?.closed).toBe(1);
  });
});
