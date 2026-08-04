import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteDelivery } from "../src/remote/remote-delivery.js";
import type { RemovalQuarantine } from "../src/client/types.js";

const remote = vi.hoisted(() => ({
  clients: [] as FakeClient[],
  inboxes: [] as unknown[],
  workRegistries: [] as unknown[],
  closeEvents: [] as string[],
  closeFailures: [] as (Error | undefined)[],
  readiness: [] as (() => Promise<readonly unknown[]>)[],
  observations: [] as (() => AsyncIterable<unknown>)[],
  releases: [] as unknown[][],
  reconciled: [] as unknown[],
}));

vi.mock("../src/client/client.js", () => ({
  DeliveryClient: {
    connectTo: vi.fn(() => {
      const client = new FakeClient(
        remote.readiness.shift() ?? (() => Promise.resolve([])),
        remote.observations.shift() ?? (() => emptyUpdates()),
      );
      remote.clients.push(client);
      return client;
    }),
  },
  deliveryClientAccess: {
    observeOnce: (client: FakeClient) => client.observeShardUpdatesOnce(),
  },
}));

vi.mock("../src/remote/adapters.js", () => ({
  RemoteInbox: class {
    constructor(
      readonly client: FakeClient,
      readonly quarantine: CloseableQuarantine,
    ) {
      remote.inboxes.push(this);
    }
  },
  RemoteWorkRegistry: class {
    constructor(readonly client: FakeClient) {
      remote.workRegistries.push(this);
    }
    reconcile(observation: unknown): void {
      remote.reconciled.push(observation);
    }
  },
}));

interface CloseableQuarantine extends RemovalQuarantine {
  close(): unknown;
}

class FakeClient {
  #closed = false;

  constructor(
    private readonly readiness: () => Promise<readonly unknown[]>,
    private readonly observations: () => AsyncIterable<unknown>,
  ) {}

  shardSnapshot(): Promise<readonly unknown[]> {
    return this.readiness();
  }

  observeShardUpdates(): AsyncIterable<unknown> {
    const observations = this.observations;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          yield* observations();
        } catch {
          yield "reconnected";
        }
      },
    };
  }

  observeShardUpdatesOnce(): AsyncIterable<unknown> {
    return this.observations();
  }

  releaseExpired(inactivityMs: number, options?: unknown): Promise<readonly unknown[]> {
    remote.releases.push([inactivityMs, options]);
    return Promise.resolve([]);
  }

  close(): void {
    if (this.#closed) return;
    remote.closeEvents.push("client");
    const failure = remote.closeFailures.shift();
    if (failure !== undefined) throw failure;
    this.#closed = true;
  }
}

async function* emptyUpdates(): AsyncIterable<never> {
  // The default source remains idle for lifecycle tests that do not observe it.
}

function quarantine(): CloseableQuarantine {
  return {
    close: () => {
      remote.closeEvents.push("quarantine");
      const failure = remote.closeFailures.shift();
      if (failure !== undefined) throw failure;
    },
    get: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

describe("RemoteDelivery", () => {
  beforeEach(() => {
    remote.clients = [];
    remote.inboxes = [];
    remote.workRegistries = [];
    remote.closeEvents = [];
    remote.closeFailures = [];
    remote.readiness = [];
    remote.observations = [];
    remote.releases = [];
    remote.reconciled = [];
  });

  it("creates one client and publishes its exact remote adapters", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await delivery.open();

    expect(remote.clients).toHaveLength(1);
    expect(remote.inboxes).toHaveLength(1);
    expect(remote.workRegistries).toHaveLength(1);
    expect(delivery.inbox).toBe(remote.inboxes[0]);
    expect(delivery.workRegistry).toBe(remote.workRegistries[0]);
  });

  it("exposes the first Admin stream break to its supervisor source without client reconnect", async () => {
    const broken = new Error("Admin stream ended");
    let observations = 0;
    remote.observations.push(() => {
      observations += 1;
      return {
        async *[Symbol.asyncIterator]() {
          await Promise.reject(broken);
          yield undefined;
        },
      };
    });
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
      clientOptions: { observationReconnects: 2 },
    });

    await delivery.open();

    await expect(delivery.source.observeShardUpdates()[Symbol.asyncIterator]().next()).rejects.toBe(
      broken,
    );
    expect(observations).toBe(1);
  });

  it("forwards release bounds and reconciles snapshot and live Admin facts before yielding", async () => {
    const snapshot = Object.freeze({ shard: "snapshot", status: "NOT_PICKED", messages: 0 });
    const update = Object.freeze({ shard: "update", status: "PICKED", messages: 1 });
    remote.readiness.push(() => Promise.resolve([snapshot]));
    remote.observations.push(async function* () {
      await Promise.resolve();
      yield update;
    });
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await delivery.open();
    await expect(delivery.source.shardSnapshot()).resolves.toEqual([snapshot]);
    await expect(
      delivery.source.observeShardUpdates()[Symbol.asyncIterator]().next(),
    ).resolves.toMatchObject({
      value: update,
    });
    const controller = new AbortController();
    await delivery.source.releaseExpired(123, { signal: controller.signal, timeoutMs: 456 });

    expect(remote.reconciled).toEqual([snapshot, update]);
    expect(remote.releases).toEqual([[123, { signal: controller.signal, timeoutMs: 456 }]]);
  });

  it("fails closed before readiness then exposes its exact remote adapters", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    }) as unknown as {
      open(): Promise<void>;
      readonly inbox: unknown;
      readonly workRegistry: unknown;
      readonly source: unknown;
    };

    expect(() => delivery.inbox).toThrow("Remote delivery is not open.");
    expect(() => delivery.workRegistry).toThrow("Remote delivery is not open.");
    expect(() => delivery.source).toThrow("Remote delivery is not open.");
    await delivery.open();

    expect(delivery.inbox).toBeInstanceOf(Object);
    expect(delivery.workRegistry).toBeInstanceOf(Object);
  });

  it("completes bounded Admin readiness before publishing the remote delivery", async () => {
    let release: () => void = () => undefined;
    remote.readiness.push(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve([]);
          };
        }),
    );
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    const opening = delivery.open();
    await Promise.resolve();
    expect(remote.clients).toHaveLength(1);
    release();
    await expect(opening).resolves.toBeUndefined();
  });

  it("closes an opening client before readiness can publish adapters", async () => {
    let release: () => void = () => undefined;
    remote.readiness.push(
      () =>
        new Promise((resolve) => {
          release = () => {
            resolve([]);
          };
        }),
    );
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    const opening = delivery.open();
    await Promise.resolve();
    const closing = delivery.close();

    expect(remote.closeEvents).toEqual(["client"]);
    expect(() => delivery.inbox).toThrow("Remote delivery is not open.");
    release();
    await expect(opening).rejects.toThrow("Remote delivery is closed.");
    await expect(closing).resolves.toBeUndefined();
    expect(remote.closeEvents).toEqual(["client", "quarantine"]);
  });

  it("rejects opening before or after terminal closure", async () => {
    const unopened = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });
    await unopened.close();
    await expect(unopened.open()).rejects.toThrow("Remote delivery is closed.");

    const opened = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });
    await opened.open();
    await opened.close();
    await expect(opened.open()).rejects.toThrow("Remote delivery is closed.");
  });

  it("coalesces concurrent open calls into one client and one readiness attempt", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await Promise.all([delivery.open(), delivery.open()]);

    expect(remote.clients).toHaveLength(1);
  });

  it("reuses the published facility after readiness has completed", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await delivery.open();
    await delivery.open();

    expect(remote.clients).toHaveLength(1);
  });

  it("rolls back a failed open and retries with a fresh client without closing the quarantine", async () => {
    remote.readiness.push(
      () => Promise.reject(new Error("readiness failed")),
      () => Promise.resolve([]),
    );
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await expect(delivery.open()).rejects.toThrow("readiness failed");
    await delivery.open();

    expect(remote.clients).toHaveLength(2);
    expect(remote.closeEvents).toEqual(["client"]);
  });

  it("closes delivery client and quarantine in dependency order exactly once", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });
    await delivery.open();

    await Promise.all([delivery.close(), delivery.close()]);
    await delivery.close();

    expect(remote.closeEvents).toEqual(["client", "quarantine"]);
  });

  it.each([
    ["client", [new Error("client close failed")], ["client", "quarantine", "client"]],
    [
      "quarantine",
      [undefined, new Error("quarantine close failed")],
      ["client", "quarantine", "quarantine"],
    ],
  ] as const)(
    "retries only unfinished remote close phases after %s failure",
    async (_phase, failures, events) => {
      const delivery = RemoteDelivery.connectTo({
        endpoint: "http://127.0.0.1:8080",
        removalQuarantine: quarantine(),
      });
      await delivery.open();

      remote.closeFailures.push(...failures);
      await expect(delivery.close()).rejects.toThrow("RemoteDelivery close failed.");
      await delivery.close();

      expect(remote.closeEvents).toEqual(events);
    },
  );

  it("closes the transferred quarantine when the environment owner never opened", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await delivery.close();

    expect(remote.clients).toHaveLength(0);
    expect(remote.closeEvents).toEqual(["quarantine"]);
  });
});
