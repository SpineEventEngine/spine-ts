import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-ts/storage";

import { Delivery, type DeliveryEndpointMessage } from "../../src/delivery/delivery.js";
import { deliveryAttemptCapacity } from "../../src/delivery/delivery-attempts.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import {
  DeliveryBuilder,
  DeliveryShutdownTimeoutError,
  DeliverySupervisor,
} from "../../src/index.js";
import type {
  DeliveryInbox,
  DeliveryInboxWork,
  DeliveryOperationOptions,
  DeliveryWorkSession,
  DeliveryWorkRegistry,
} from "../../src/delivery/delivery-ports.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardSession } from "../../src/delivery/sharded-work-registry.js";

describe("Delivery operation fencing", () => {
  it("does not durably complete a row when its operation is aborted while its endpoint is pending", async () => {
    const controller = new AbortController();
    const endpoint = Promise.withResolvers<undefined>();
    const inbox = new FencedInbox();
    const delivery = new Delivery({
      context: { name: "fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox,
      workRegistry: new FencedRegistry(),
    });

    const run = delivery.drain(ShardIndex.single(), {
      node: "node",
      operation: { signal: controller.signal },
      onMessage: () => endpoint.promise,
    });
    await Promise.resolve();
    controller.abort(new Error("deadline elapsed"));
    endpoint.resolve(undefined);

    await expect(run).resolves.toMatchObject({ failed: 1, delivered: 0 });
    expect(inbox.completed).toBe(0);
  });

  it("fences a builder-created delivery when supervisor close aborts a pending endpoint", async () => {
    const started = Promise.withResolvers<undefined>();
    const endpoint = Promise.withResolvers<undefined>();
    const inbox = new FencedInbox();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "builder-fencing", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withInbox(inbox)
      .withWorkRegistry(new FencedRegistry())
      .withNode("node")
      .build();
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery,
      onMessage: () => {
        started.resolve(undefined);
        return endpoint.promise;
      },
    });

    await supervisor.start();
    supervisor.notify(ShardIndex.single());
    await started.promise;
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    endpoint.resolve(undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(inbox.completed).toBe(0);
  });

  it("stops a real delivery lease timer on abort before a blocked endpoint settles", async () => {
    vi.useFakeTimers();
    try {
      const started = Promise.withResolvers<undefined>();
      const endpoint = Promise.withResolvers<undefined>();
      const inbox = new FencedInbox("LEASED");
      const registry = new RenewableRegistry();
      const delivery = new DeliveryBuilder()
        .withContext({ name: "lease-fencing", multitenant: false })
        .withStorageFactory(new InMemoryStorageFactory())
        .withInbox(inbox)
        .withWorkRegistry(registry)
        .withNode("node")
        .build();
      const supervisor = new DeliverySupervisor({
        source: {
          shardSnapshot: () => Promise.resolve([]),
          observeShardUpdates: () => emptyUpdates(),
          releaseExpired: () => Promise.resolve([]),
        },
        delivery,
        onMessage: () => {
          started.resolve(undefined);
          return endpoint.promise;
        },
      });

      await supervisor.start();
      supervisor.notify(ShardIndex.single());
      await started.promise;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(registry.renewals).toBe(1);

      await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
        DeliveryShutdownTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(50_000);
      expect(registry.renewals).toBe(1);

      endpoint.resolve(undefined);
      await vi.runAllTimersAsync();
      expect(registry.releases).toBe(1);
      expect(inbox.completed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates the supervisor operation into initial epoch admission", async () => {
    const inbox = new OperationRecordingInbox();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "admission-fencing", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withInbox(inbox)
      .withWorkRegistry(new FencedRegistry())
      .withNode("node")
      .build();
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery,
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    supervisor.notify(ShardIndex.single());
    await supervisor.whenIdle();

    expect(inbox.readSignal).toBeInstanceOf(AbortSignal);
    await supervisor.close();
  });

  it("completes a controlled empty run without a pickup while public runs retain pickup", async () => {
    const events: string[] = [];
    const registry = new FencedRegistry();
    const delivery = new Delivery({
      context: { name: "controlled-empty", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      workRegistry: registry,
      monitor: {
        onStarted() {
          events.push("started");
        },
        onPage(page) {
          events.push(page.status);
        },
        onCompleted(result) {
          events.push(result.status);
        },
      },
    });

    await expect(
      delivery.runControlled({
        shard: ShardIndex.single(),
        signal: new AbortController().signal,
        onMessage: () => Promise.resolve(),
      }),
    ).resolves.toEqual({
      status: "COMPLETED",
      pages: [{ status: "IDLE", processed: 0, accepted: 0, delivered: 0, failed: 0 }],
    });
    expect(events).toEqual(["IDLE", "COMPLETED"]);
    expect(registry.pickups).toBe(0);
    expect(registry.releases).toBe(0);

    await expect(delivery.run({ onMessage: () => Promise.resolve() })).resolves.toMatchObject({
      status: "COMPLETED",
    });
    expect(registry.pickups).toBe(1);
    expect(registry.releases).toBe(1);
  });

  it("rejects an aborted controlled empty admission without completion or ownership", async () => {
    const controller = new AbortController();
    const inbox = new BlockingEmptyInbox();
    const registry = new FencedRegistry();
    let completions = 0;
    const delivery = new Delivery({
      context: { name: "aborted-empty", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox,
      workRegistry: registry,
      monitor: { onCompleted: () => completions++ },
    });

    const running = delivery.runControlled({
      shard: ShardIndex.single(),
      signal: controller.signal,
      onMessage: () => Promise.resolve(),
    });
    await inbox.started.promise;
    controller.abort(new Error("empty admission aborted"));
    inbox.resume.resolve(undefined);

    await expect(running).rejects.toThrow("empty admission aborted");
    expect(completions).toBe(0);
    expect(registry.pickups).toBe(0);
    expect(registry.releases).toBe(0);
  });

  it("rejects an expired empty admission before completion or ownership", async () => {
    vi.useFakeTimers();
    try {
      const inbox = new BlockingEmptyInbox();
      const registry = new FencedRegistry();
      const delivery = new Delivery({
        context: { name: "expired-empty", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        inbox,
        workRegistry: registry,
      });
      const loop = new DeliveryLoop({
        delivery,
        shard: ShardIndex.single(),
        node: "node",
        operation: { timeoutMs: 10 },
        onMessage: () => Promise.resolve(),
        completeAdmittedEmptyEpoch: true,
      });

      const running = loop.run();
      await inbox.started.promise;
      await vi.advanceTimersByTimeAsync(10);
      inbox.resume.resolve(undefined);

      await expect(running).rejects.toThrow("Delivery operation deadline elapsed.");
      expect(registry.pickups).toBe(0);
      expect(registry.releases).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fences exhausted-row completion when synchronization aborts the operation", async () => {
    const controller = new AbortController();
    const inbox = new AbortOnSynchronizeInbox(controller);
    const delivery = new Delivery({
      context: { name: "exhausted-fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox,
      workRegistry: new FencedRegistry(),
    });
    for (let sequence = 1; sequence <= deliveryAttemptCapacity; sequence += 1) {
      await delivery.attempts.recordFailure({
        message: message() as DeliveryEndpointMessage,
        node: `node-${String(sequence)}`,
        attemptedAt: new Date(sequence),
        accepted: true,
        stage: "ENDPOINT",
        reason: "ENDPOINT_REJECTED",
      });
    }

    await expect(
      delivery.runControlled({
        shard: ShardIndex.single(),
        signal: controller.signal,
        onMessage: () => Promise.resolve(),
      }),
    ).resolves.toMatchObject({ status: "FAILED" });

    expect(inbox.completed).toBe(0);
  });
});

class FencedInbox implements DeliveryInbox {
  readonly sessionKind: DeliveryWorkSession["kind"];
  completed = 0;
  readonly #message = message();
  constructor(sessionKind: DeliveryWorkSession["kind"] = "EXCLUSIVE") {
    this.sessionKind = sessionKind;
  }
  receive(): Promise<never> {
    throw new Error("unused");
  }
  read(_shard?: ShardIndex, _options?: DeliveryOperationOptions): Promise<readonly InboxMessage[]> {
    void _shard;
    void _options;
    return Promise.resolve([this.#message]);
  }
  readMessage(): Promise<InboxMessage | undefined> {
    return Promise.resolve(this.#message);
  }
  begin(): Promise<DeliveryInboxWork> {
    return Promise.resolve({
      message: this.#message,
      synchronize: () => Promise.resolve(),
      complete: (_options?: DeliveryOperationOptions) => {
        void _options;
        this.completed += 1;
        return Promise.resolve(true);
      },
      abandon: () => Promise.resolve(),
    });
  }
}

class BlockingEmptyInbox extends FencedInbox {
  readonly started = Promise.withResolvers<undefined>();
  readonly resume = Promise.withResolvers<undefined>();

  override async read(): Promise<readonly InboxMessage[]> {
    this.started.resolve(undefined);
    await this.resume.promise;
    return [];
  }
}

class FencedRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "EXCLUSIVE" as const;
  pickups = 0;
  releases = 0;
  pickUp() {
    this.pickups += 1;
    return Promise.resolve({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });
  }
  release() {
    this.releases += 1;
    return Promise.resolve(true);
  }
}

class RenewableRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "LEASED" as const;
  renewals = 0;
  releases = 0;
  #session = session(30_000);

  pickUp(): Promise<ShardSession> {
    return Promise.resolve(this.#session);
  }

  renew(): Promise<ShardSession> {
    this.renewals += 1;
    this.#session = session(30_000);
    return Promise.resolve(this.#session);
  }

  release(): Promise<boolean> {
    this.releases += 1;
    return Promise.resolve(true);
  }
}

class OperationRecordingInbox extends FencedInbox {
  readSignal: AbortSignal | undefined;

  override read(
    _shard: ShardIndex,
    options?: DeliveryOperationOptions,
  ): Promise<readonly InboxMessage[]> {
    this.readSignal = options?.signal;
    return Promise.resolve([]);
  }
}

class AbortOnSynchronizeInbox extends FencedInbox {
  readonly #controller: AbortController;

  constructor(controller: AbortController) {
    super();
    this.#controller = controller;
  }

  override begin(): Promise<DeliveryInboxWork> {
    return Promise.resolve({
      message: message(),
      synchronize: () => {
        this.#controller.abort(new Error("stop exhausted completion"));
        return Promise.resolve();
      },
      complete: () => {
        this.completed += 1;
        return Promise.resolve(true);
      },
      abandon: () => Promise.resolve(),
    });
  }
}

function session(leaseMs: number): ShardSession {
  const now = Date.now();
  return new ShardSession(
    "lease",
    ShardIndex.single(),
    "node",
    new Date(now),
    new Date(now + leaseMs),
  );
}

function message(): InboxMessage {
  return {
    id: { value: "fenced", shard: ShardIndex.single() },
    inboxId: { targetId: "id", targetTypeUrl: "type.example/Target" },
    signalId: "signal",
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: new Date(0),
    version: 1n,
  };
}

function emptyUpdates(): AsyncIterable<never> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<never> {
      await Promise.resolve();
      yield* [] as never[];
    },
  };
}
