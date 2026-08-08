import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  DeliveryBuilder,
  type DeliveryRunOptions,
  ShardIndex,
  UniformAcrossAllShards,
} from "../../src/index.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../../src/delivery/delivery-ports.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";
import { DeliveryRunControl } from "../../src/delivery/delivery-run-control.js";

describe("DeliveryRunControl", () => {
  it("does not admit a run after its control signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    let calls = 0;
    const control = new DeliveryRunControl(
      controlledDelivery(() => {
        calls += 1;
        return Promise.resolve({ status: "COMPLETED", pages: [] });
      }),
    );

    await expect(
      control.run({
        shard: new ShardIndex(0, 1),
        onMessage: () => Promise.resolve(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("stop");
    expect(calls).toBe(0);
  });

  it("normalizes a non-Error abort reason", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    const control = new DeliveryRunControl(
      controlledDelivery(() => Promise.resolve({ status: "COMPLETED", pages: [] })),
    );

    await expect(
      control.run({
        shard: ShardIndex.single(),
        onMessage: () => Promise.resolve(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Delivery run was aborted.");
  });

  it("does not settle an aborted controlled caller before the underlying run settles", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const inbox = new RunnerInbox(() => settled.promise);
    const control = new DeliveryRunControl(controlledDelivery(() => settled.promise, inbox));

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    await inbox.started.promise;
    controller.abort(new Error("stop"));

    let completed = false;
    void running.catch(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);
    settled.resolve({ status: "COMPLETED", pages: [] });
    await expect(running).rejects.toThrow("stop");
  });

  it("contains an abort until an underlying rejection settles", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const inbox = new RunnerInbox(() => settled.promise);
    const control = new DeliveryRunControl(controlledDelivery(() => settled.promise, inbox));

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    await inbox.started.promise;
    controller.abort(new Error("deadline elapsed"));

    void settled.promise.catch(() => undefined);
    settled.reject(new Error("late endpoint failure"));
    await expect(running).rejects.toThrow("late endpoint failure");
  });
});

function controlledDelivery(
  run: (options: DeliveryRunOptions) => Promise<unknown>,
  inbox = new RunnerInbox(run),
) {
  return new DeliveryBuilder()
    .withContext({ name: "run-control-test", multitenant: false })
    .withStorageFactory(new InMemoryStorageFactory())
    .withStrategy(UniformAcrossAllShards.singleShard())
    .withInbox(inbox)
    .withWorkRegistry(new OpenRegistry())
    .withNode("test-node")
    .build();
}

class RunnerInbox implements DeliveryInbox {
  readonly sessionKind = "EXCLUSIVE" as const;
  readonly #run: (options: DeliveryRunOptions) => Promise<unknown>;
  readonly started = Promise.withResolvers<void>();

  constructor(run: (options: DeliveryRunOptions) => Promise<unknown>) {
    this.#run = run;
  }

  receive(): Promise<never> {
    return Promise.reject(new Error("RunnerInbox.receive is unused."));
  }

  async read(shard: ShardIndex): Promise<readonly InboxMessage[]> {
    this.started.resolve();
    await this.#run({ shard, onMessage: () => Promise.resolve() });
    return [];
  }

  readMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  begin(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

class OpenRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "EXCLUSIVE" as const;

  pickUp(shard: ShardIndex) {
    return Promise.resolve({ kind: "EXCLUSIVE" as const, shard });
  }

  release(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
