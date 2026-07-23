import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-ts/storage";

import { Delivery } from "../../src/delivery/delivery.js";
import {
  DeliveryBuilder,
  DeliveryShutdownTimeoutError,
  DeliverySupervisor,
} from "../../src/index.js";
import type {
  DeliveryInbox,
  DeliveryInboxWork,
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
} from "../../src/delivery/delivery-ports.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";

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
});

class FencedInbox implements DeliveryInbox {
  readonly sessionKind = "EXCLUSIVE" as const;
  completed = 0;
  readonly #message = message();
  receive(): Promise<never> {
    throw new Error("unused");
  }
  read(): Promise<readonly InboxMessage[]> {
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

class FencedRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "EXCLUSIVE" as const;
  pickUp() {
    return Promise.resolve({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });
  }
  release() {
    return Promise.resolve(true);
  }
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
