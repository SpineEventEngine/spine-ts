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

import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  DeliveryBuilder,
  type Delivery,
  type DeliveryRunOptions,
  ShardIndex,
  UniformAcrossAllShards,
} from "../../src/index.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "../../src/delivery/delivery-ports.js";
import { deliveryControls } from "../../src/delivery/delivery-builder.js";
import type { DeliveryControlledRun } from "../../src/delivery/delivery-run-control.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";

describe("controlled delivery runs", () => {
  it("does not admit a run after its control signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    let calls = 0;
    const control = controlledDelivery(() => {
      calls += 1;
      return Promise.resolve({ status: "COMPLETED", pages: [] });
    });

    await expect(
      controlledRun(control, {
        shard: new ShardIndex(0, 1),
        onMessage: () => Promise.resolve(),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(calls).toBe(0);
  });

  it("stops before admission for a non-Error abort reason", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    const control = controlledDelivery(() => Promise.resolve({ status: "COMPLETED", pages: [] }));

    await expect(
      controlledRun(control, {
        shard: ShardIndex.single(),
        onMessage: () => Promise.resolve(),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
  });

  it("waits for an admitted run to settle after its caller aborts", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const inbox = new RunnerInbox(() => settled.promise);
    const control = controlledDelivery(() => settled.promise, inbox);

    const running = controlledRun(control, {
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
    await expect(running).resolves.toMatchObject({ status: "COMPLETED" });
  });

  it("contains an abort until an underlying rejection settles", async () => {
    const controller = new AbortController();
    const settled = Promise.withResolvers<{ status: "COMPLETED"; pages: never[] }>();
    const inbox = new RunnerInbox(() => settled.promise);
    const control = controlledDelivery(() => settled.promise, inbox);

    const running = controlledRun(control, {
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

function controlledRun(delivery: Delivery, options: DeliveryControlledRun) {
  const run = deliveryControls.runner(delivery);
  if (run === undefined) throw new Error("Expected a configured delivery runner.");
  return run(options);
}

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
  readonly started = Promise.withResolvers<undefined>();

  constructor(run: (options: DeliveryRunOptions) => Promise<unknown>) {
    this.#run = run;
  }

  receive(): Promise<never> {
    return Promise.reject(new Error("RunnerInbox.receive is unused."));
  }

  async read(shard: ShardIndex): Promise<readonly InboxMessage[]> {
    this.started.resolve(undefined);
    await this.#run({ shard, onMessage: () => Promise.resolve() });
    return [];
  }

  readMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  newestPending(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  removeDuplicate(): Promise<boolean> {
    return Promise.resolve(true);
  }

  markDelivered(): Promise<undefined> {
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

  validateOwnership(session: Parameters<DeliveryWorkRegistry["validateOwnership"]>[0]) {
    return Promise.resolve(session);
  }
}
