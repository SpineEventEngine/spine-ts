import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-ts/storage";

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

  it("rejects a controlled caller on abort while observing a detached late settlement", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const control = new DeliveryRunControl(controlledDelivery(() => settled.promise));

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    controller.abort(new Error("stop"));

    await expect(running).rejects.toThrow("stop");
    settled.resolve({ status: "COMPLETED", pages: [] });
  });

  it("rejects a controlled caller before a detached late rejection", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const control = new DeliveryRunControl(controlledDelivery(() => settled.promise));

    const running = control.run({
      shard: new ShardIndex(0, 1),
      onMessage: () => Promise.resolve(),
      signal: controller.signal,
    });
    controller.abort(new Error("deadline elapsed"));

    await expect(running).rejects.toThrow("deadline elapsed");
    settled.reject(new Error("late endpoint failure"));
    await Promise.resolve();
  });
});

function controlledDelivery(run: (options: DeliveryRunOptions) => Promise<unknown>) {
  return new DeliveryBuilder()
    .withContext({ name: "run-control-test", multitenant: false })
    .withStorageFactory(new InMemoryStorageFactory())
    .withStrategy(UniformAcrossAllShards.singleShard())
    .withInbox(new RunnerInbox(run))
    .withWorkRegistry(new OpenRegistry())
    .withNode("test-node")
    .build();
}

class RunnerInbox implements DeliveryInbox {
  readonly sessionKind = "EXCLUSIVE" as const;
  readonly #run: (options: DeliveryRunOptions) => Promise<unknown>;

  constructor(run: (options: DeliveryRunOptions) => Promise<unknown>) {
    this.#run = run;
  }

  receive(): Promise<never> {
    return Promise.reject(new Error("RunnerInbox.receive is unused."));
  }

  async read(shard: ShardIndex): Promise<readonly InboxMessage[]> {
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
