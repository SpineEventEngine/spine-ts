import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemoteDelivery } from "../src/remote/remote-delivery.js";
import type { RemovalQuarantine } from "../src/client/types.js";

const remote = vi.hoisted(() => ({
  clients: [] as FakeClient[],
  closeEvents: [] as string[],
  readiness: [] as (() => Promise<readonly unknown[]>)[],
}));

vi.mock("../src/client/client.js", () => ({
  DeliveryClient: {
    connectTo: vi.fn(() => {
      const client = new FakeClient(remote.readiness.shift() ?? (() => Promise.resolve([])));
      remote.clients.push(client);
      return client;
    }),
  },
}));

vi.mock("../src/remote/adapters.js", () => ({
  RemoteInbox: class {
    constructor(
      readonly client: FakeClient,
      readonly quarantine: CloseableQuarantine,
    ) {}
  },
  RemoteWorkRegistry: class {
    constructor(readonly client: FakeClient) {}
  },
}));

vi.mock("@spine-event-engine/server", () => ({
  DeliveryBuilder: class {
    withInbox(inbox: unknown): this {
      expect(inbox).toBeInstanceOf(Object);
      return this;
    }

    withWorkRegistry(registry: unknown): this {
      expect(registry).toBeInstanceOf(Object);
      return this;
    }

    build(): { close(): void } {
      return { close: () => remote.closeEvents.push("delivery") };
    }
  },
}));

interface CloseableQuarantine extends RemovalQuarantine {
  close(): unknown;
}

class FakeClient {
  #closed = false;

  constructor(private readonly readiness: () => Promise<readonly unknown[]>) {}

  shardSnapshot(): Promise<readonly unknown[]> {
    return this.readiness();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    remote.closeEvents.push("client");
  }
}

function quarantine(): CloseableQuarantine {
  return {
    close: () => remote.closeEvents.push("quarantine"),
    get: () => Promise.resolve(undefined),
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

describe("RemoteDelivery", () => {
  beforeEach(() => {
    remote.clients = [];
    remote.closeEvents = [];
    remote.readiness = [];
  });

  it("builds one remote environment delivery from an endpoint and durable quarantine", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await delivery.open();

    expect(remote.clients).toHaveLength(1);
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

  it("coalesces concurrent open calls into one client and one readiness attempt", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });

    await Promise.all([delivery.open(), delivery.open()]);

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
    expect(remote.closeEvents).toEqual(["delivery", "client"]);
  });

  it("closes delivery client and quarantine in dependency order exactly once", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });
    await delivery.open();

    await Promise.all([delivery.close(), delivery.close()]);
    await delivery.close();

    expect(remote.closeEvents).toEqual(["delivery", "client", "quarantine"]);
  });

  it("retries only unfinished remote close phases after each phase failure", async () => {
    const delivery = RemoteDelivery.connectTo({
      endpoint: "http://127.0.0.1:8080",
      removalQuarantine: quarantine(),
    });
    await delivery.open();

    await delivery.close();
    await delivery.close();

    expect(remote.closeEvents).toEqual(["delivery", "client", "quarantine"]);
  });

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
