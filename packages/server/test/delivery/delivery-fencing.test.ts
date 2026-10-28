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

import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { create } from "@bufbuild/protobuf";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { AgentDeliveryScope } from "../../src/delivery/agent-delivery-scope.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import { ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("Delivery fencing", () => {
  it("restarts a finite scan when a durable wake lands at its terminal decision", async () => {
    const message = createMessage("terminal-wake", "signal", 1n);
    const rows: ReturnType<typeof createMessage>[] = [];
    const delivered = Promise.withResolvers<undefined>();
    const delivery = agentDelivery(rows, () => {
      delivered.resolve(undefined);
    });
    let reads = 0;
    delivery.inbox.read = () => {
      if (++reads === 1) {
        queueMicrotask(() => {
          queueMicrotask(() => {
            queueMicrotask(() => {
              rows.push(message);
              delivery.wake(message.shard);
            });
          });
        });
        return Promise.resolve([]);
      }
      return Promise.resolve(rows);
    };
    delivery.setReplay(() => undefined);
    delivery.wake(message.shard);
    await delivered.promise;
    await delivery.whenIdle();
    expect(reads).toBeGreaterThanOrEqual(2);
    await delivery.close();
  });

  it("rechecks a direct deferred route without an onReady observer", async () => {
    const message = createMessage("direct-retry", "signal", 1n);
    const acknowledged = new Set<string>();
    const delivery = agentDelivery([message], (next) => {
      acknowledged.add(next.id.value);
    });
    const readiness = new DeliveryReadiness();
    let replayed = 0;
    readiness.configureDirect(() => {
      replayed++;
      return Promise.resolve();
    });
    readiness.route(delivery);
    readiness.notify({
      label: message.label,
      targetTypeUrl: message.inboxId.targetTypeUrl,
      shard: message.shard,
    });
    await delivery.whenIdle();
    expect(replayed).toBe(1);
    expect(acknowledged.has(message.id.value)).toBe(true);
    await readiness.close();
  });

  it("keeps direct close pending after acknowledgement until entered Agent work settles", async () => {
    const message = createMessage("close-agent", "signal", 1n);
    const acknowledged = new Set<string>();
    const release = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    let released = 0;
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      () => {
        released++;
      },
      acknowledged,
    );
    const readiness = new DeliveryReadiness();
    readiness.route(delivery);
    await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            entered.resolve(undefined);
            await release.promise;
          },
        });
      },
    });
    await entered.promise;
    let closed = false;
    const closing = readiness.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(released).toBe(0);
    release.resolve(undefined);
    await closing;
    expect(released).toBe(1);
  });

  it("holds readiness transfer until an acknowledged Agent releases its shard", async () => {
    const message = createMessage("transfer-agent", "signal", 1n);
    const acknowledged = new Set<string>();
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let releases = 0;
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      () => {
        releases++;
      },
      acknowledged,
    );
    const readiness = new DeliveryReadiness();
    readiness.route(delivery);
    await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            entered.resolve(undefined);
            await release.promise;
          },
        });
      },
    });
    await entered.promise;
    const route = {
      label: message.label,
      targetTypeUrl: message.inboxId.targetTypeUrl,
      shard: message.shard,
    };
    let transferred = false;
    const transition = readiness
      .transition([route], () => undefined)
      .then(() => {
        transferred = true;
      });
    await Promise.resolve();
    expect(transferred).toBe(false);
    expect(releases).toBe(0);
    release.resolve(undefined);
    await transition;
    expect(releases).toBe(1);
  });

  it("keeps the original active release failure visible to a readiness transition", async () => {
    const message = createMessage("transition-failure", "signal", 1n);
    const acknowledged = new Set<string>();
    const entered = Promise.withResolvers<undefined>();
    const finish = Promise.withResolvers<undefined>();
    const failure = new Error("transition release failed");
    const delivery = agentDelivery(
      [message],
      (next) => acknowledged.add(next.id.value),
      () => {
        throw failure;
      },
      acknowledged,
    );
    const readiness = new DeliveryReadiness();
    readiness.route(delivery);
    await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            entered.resolve(undefined);
            await finish.promise;
          },
        });
      },
    });
    await entered.promise;
    const transition = readiness.transition(
      [
        {
          label: message.label,
          targetTypeUrl: message.inboxId.targetTypeUrl,
          shard: message.shard,
        },
      ],
      () => undefined,
    );
    finish.resolve(undefined);
    await expect(transition).rejects.toBe(failure);
  });

  it("reports an admitted direct shard release failure during close", async () => {
    const message = createMessage("release-agent", "signal", 1n);
    const acknowledged = new Set<string>();
    const releaseWork = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const releaseFailure = new Error("shard release failed");
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      () => {
        throw releaseFailure;
      },
      acknowledged,
    );
    const readiness = new DeliveryReadiness();
    readiness.route(delivery);
    await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            entered.resolve(undefined);
            await releaseWork.promise;
          },
        });
      },
    });
    await entered.promise;
    const closing = readiness.close();
    releaseWork.resolve(undefined);
    await expect(closing).rejects.toMatchObject({ errors: [releaseFailure] });
  });

  it("renews the leased shard session while an acknowledged Agent call remains held", async () => {
    vi.useFakeTimers();
    const message = createMessage("renew-agent", "signal", 1n);
    const acknowledged = new Set<string>();
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      undefined,
      acknowledged,
    );
    let renewals = 0;
    delivery.shards.renew = (current) => {
      renewals++;
      return Promise.resolve({
        kind: "LEASED" as const,
        shard: current.shard,
        worker: current.worker,
        pickedUpAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
    };
    try {
      await delivery.drainMessage(message, {
        onMessage: () => {
          AgentDeliveryScope.record({
            kind: "accepted",
            discard: () => undefined,
            run: async () => {
              entered.resolve(undefined);
              await gate.promise;
            },
          });
        },
      });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(renewals).toBeGreaterThanOrEqual(1);
    } finally {
      gate.resolve(undefined);
      await delivery.whenIdle();
      vi.useRealTimers();
    }
  });

  it("fences a held live Agent effect after shard authority is lost", async () => {
    const message = createMessage("lost-agent", "signal", 1n);
    const acknowledged = new Set<string>();
    const gate = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      undefined,
      acknowledged,
    );
    let valid = true;
    let effects = 0;
    delivery.shards.validateOwnership = (current) => Promise.resolve(valid ? current : undefined);
    await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async (_signal, checkSession) => {
            entered.resolve(undefined);
            await gate.promise;
            await checkSession();
            effects++;
          },
        });
      },
    });
    await entered.promise;
    valid = false;
    gate.resolve(undefined);
    await delivery.whenIdle();
    expect(effects).toBe(0);
  });
  it("leaves deferred Agent input pending without invoking reception failure policy", async () => {
    const message = createMessage("agent-pending", "signal", 1n);
    let marks = 0;
    let receptions = 0;
    const delivery = new Delivery({
      context: { name: "AgentDefer", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      monitor: new (class extends DeliveryMonitor {
        override onReceptionFailure(): never {
          receptions++;
          throw new Error("Agent deferral entered reception policy.");
        }
      })(),
      inbox: {
        sessionKind: "LEASED",
        receive: () => Promise.reject(new Error("unused")),
        read: () => Promise.resolve([message]),
        readMessage: () => Promise.resolve(message),
        markDelivered: () => {
          marks++;
          return Promise.resolve(message);
        },
        removeDuplicate: () => Promise.resolve(true),
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: () => Promise.resolve(session()),
        release: () => Promise.resolve(true),
        validateOwnership: (current) => Promise.resolve(current),
      },
    });
    const result = await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({ kind: "deferred" });
      },
    });
    expect(result.acknowledged).toBe(false);
    expect(result.outcome).toMatchObject({ kind: "deferred" });
    expect(marks).toBe(0);
    expect(receptions).toBe(0);
  });

  it("surfaces receipt failure without acknowledging or applying reception policy", async () => {
    const message = createMessage("agent-error", "signal", 1n);
    const failure = new Error("receipt CAS failed");
    let marks = 0;
    const delivery = agentDelivery([message], () => {
      marks++;
    });
    const direct = await delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({ kind: "error", error: failure });
      },
    });
    expect(direct.acknowledged).toBe(false);
    expect(direct.outcome).toEqual({ kind: "failed", error: failure });
    expect(marks).toBe(0);
  });

  it("acknowledges Agent input before live work and retains the shard for two targets", async () => {
    const first = createMessage("agent-a", "signal-a", 1n);
    const second = createMessage("agent-b", "signal-b", 2n);
    const acknowledged = new Set<string>();
    let released = 0;
    const delivery = agentDelivery(
      [first, second],
      (message) => {
        acknowledged.add(message.id.value);
      },
      () => {
        released++;
      },
      acknowledged,
    );
    const entered = Promise.withResolvers<undefined>();
    const secondStarted = Promise.withResolvers<undefined>();
    const continueFirst = Promise.withResolvers<undefined>();
    const started: string[] = [];
    const run = delivery.drain(ShardIndex.single(), {
      onMessage: (message) => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            expect(acknowledged.has(message.id.value)).toBe(true);
            started.push(message.id.value);
            if (message.id.value === first.id.value) {
              entered.resolve(undefined);
              await continueFirst.promise;
            } else secondStarted.resolve(undefined);
          },
        });
      },
    });
    await entered.promise;
    await secondStarted.promise;
    expect(started).toEqual([first.id.value, second.id.value]);
    expect(released).toBe(0);
    continueFirst.resolve(undefined);
    await expect(run).resolves.toMatchObject({ delivered: 2, failed: 0 });
    expect(released).toBe(1);
  });

  it("settles the selected Agent message while its complete shard drain remains live", async () => {
    const message = createMessage("agent-direct", "signal", 1n);
    const releaseWork = Promise.withResolvers<undefined>();
    const entered = Promise.withResolvers<undefined>();
    const acknowledged = new Set<string>();
    let released = 0;
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      () => {
        released++;
      },
      acknowledged,
    );
    const settled = delivery.drainMessage(message, {
      onMessage: () => {
        AgentDeliveryScope.record({
          kind: "accepted",
          discard: () => undefined,
          run: async () => {
            entered.resolve(undefined);
            await releaseWork.promise;
          },
        });
      },
    });
    await entered.promise;
    await expect(settled).resolves.toMatchObject({ acknowledged: true });
    expect(released).toBe(0);
    releaseWork.resolve(undefined);
  });

  it("wakes one active shard drain for a second Agent without a second acquisition", async () => {
    const first = createMessage("agent-a", "signal-a", 1n);
    const second = createMessage("agent-b", "signal-b", 2n);
    const rows = [first];
    const acknowledged = new Set<string>();
    const releaseFirst = Promise.withResolvers<undefined>();
    let pickups = 0;
    const delivery = agentDelivery(
      rows,
      (next) => {
        acknowledged.add(next.id.value);
      },
      undefined,
      acknowledged,
    );
    const pickup = delivery.shards.pickUp.bind(delivery.shards);
    delivery.shards.pickUp = (...args) => {
      pickups++;
      return pickup(...args);
    };
    const onMessage = (message: typeof first) => {
      AgentDeliveryScope.record({
        kind: "accepted",
        discard: () => undefined,
        run: async () => {
          if (message.id.value === first.id.value) await releaseFirst.promise;
        },
      });
    };
    await expect(delivery.drainMessage(first, { onMessage })).resolves.toMatchObject({
      acknowledged: true,
    });
    rows.push(second);
    await expect(delivery.drainMessage(second, { onMessage })).resolves.toMatchObject({
      acknowledged: true,
    });
    expect(pickups).toBe(1);
    releaseFirst.resolve(undefined);
  });

  it("revisits a deferred partial page after the active Agent turn finishes", async () => {
    const first = createMessage("agent-a", "signal-a", 1n);
    const waiting = createMessage("agent-b", "signal-b", 2n);
    const acknowledged = new Set<string>();
    const releaseFirst = Promise.withResolvers<undefined>();
    const firstStarted = Promise.withResolvers<undefined>();
    const secondStarted = Promise.withResolvers<undefined>();
    const deferredOnce = Promise.withResolvers<undefined>();
    let released = 0;
    let firstActive = false;
    let deferred = 0;
    const delivery = agentDelivery(
      [first, waiting],
      (message) => {
        acknowledged.add(message.id.value);
      },
      () => {
        released++;
      },
      acknowledged,
    );
    const run = delivery.drain(ShardIndex.single(), {
      onMessage: (message) => {
        if (message.id.value === waiting.id.value && firstActive) {
          deferred++;
          deferredOnce.resolve(undefined);
          AgentDeliveryScope.record({ kind: "deferred" });
        } else
          AgentDeliveryScope.record({
            kind: "accepted",
            discard: () => undefined,
            run: async () => {
              if (message.id.value === first.id.value) {
                firstActive = true;
                firstStarted.resolve(undefined);
                await releaseFirst.promise;
                firstActive = false;
              } else secondStarted.resolve(undefined);
            },
          });
      },
    });
    await firstStarted.promise;
    await deferredOnce.promise;
    releaseFirst.resolve(undefined);
    await secondStarted.promise;
    await expect(run).resolves.toMatchObject({ delivered: 2, failed: 0 });
    expect(deferred).toBeGreaterThan(0);
    expect(released).toBe(1);
  });

  it("starts a successor when input arrives during shard release", async () => {
    const first = createMessage("release-first", "signal-a", 1n);
    const second = createMessage("release-second", "signal-b", 2n);
    const rows = [first];
    const acknowledged = new Set<string>();
    const secondDelivered = Promise.withResolvers<undefined>();
    let releases = 0;
    let selected: ReturnType<Delivery["drainMessage"]> | undefined;
    const delivery = agentDelivery(
      rows,
      (message) => {
        acknowledged.add(message.id.value);
        if (message.id.value === second.id.value) secondDelivered.resolve(undefined);
      },
      () => {
        if (++releases === 1) {
          rows.push(second);
          selected = delivery.drainMessage(second, { onMessage: () => undefined });
        }
      },
      acknowledged,
    );
    delivery.setReplay(() => undefined);
    await expect(
      delivery.drainMessage(first, { onMessage: () => undefined }),
    ).resolves.toMatchObject({
      acknowledged: true,
    });
    await secondDelivered.promise;
    await expect(selected).resolves.toMatchObject({ acknowledged: true });
    await delivery.whenIdle();
    expect(releases).toBeGreaterThanOrEqual(2);
  });

  it("fences a direct post when close starts during shard acquisition", async () => {
    const message = createMessage("pickup-close", "signal", 1n);
    const acknowledged = new Set<string>();
    const pickup = Promise.withResolvers<ReturnType<typeof session>>();
    let entered = 0;
    let releases = 0;
    const delivery = agentDelivery(
      [message],
      (next) => {
        acknowledged.add(next.id.value);
      },
      () => {
        releases++;
      },
      acknowledged,
    );
    delivery.shards.pickUp = () => pickup.promise;
    const posted = delivery.drainMessage(message, {
      onMessage: () => {
        entered++;
      },
    });
    const closing = delivery.close();
    pickup.resolve(session());
    await closing;
    await expect(posted).resolves.toMatchObject({ acknowledged: false });
    expect(entered).toBe(0);
    expect(releases).toBe(1);
  });

  it("reports a failed acquired-session release when close started during pickup", async () => {
    const message = createMessage("pickup-release-failure", "signal", 1n);
    const pickup = Promise.withResolvers<ReturnType<typeof session>>();
    const failure = new Error("pickup release failed");
    let dispatched = 0;
    let releases = 0;
    const delivery = agentDelivery(
      [],
      () => undefined,
      () => {
        releases++;
        throw failure;
      },
    );
    delivery.shards.pickUp = () => pickup.promise;
    const posted = delivery.drainMessage(message, {
      onMessage: () => {
        dispatched++;
      },
    });
    const closing = delivery.close();
    pickup.resolve(session());
    await expect(closing).rejects.toBe(failure);
    await expect(posted).resolves.toMatchObject({ acknowledged: false });
    expect(dispatched).toBe(0);
    expect(releases).toBe(1);
  });

  it("reports an unconfirmed acquired-session release during pending-pickup close", async () => {
    const message = createMessage("pickup-unconfirmed", "signal", 1n);
    const pickup = Promise.withResolvers<ReturnType<typeof session>>();
    const delivery = agentDelivery([], () => undefined);
    delivery.shards.pickUp = () => pickup.promise;
    delivery.shards.release = () => Promise.resolve(false);
    const posted = delivery.drainMessage(message, { onMessage: () => undefined });
    const closing = delivery.close();
    pickup.resolve(session());
    await expect(closing).rejects.toThrow("Shard release was not confirmed.");
    await expect(posted).resolves.toMatchObject({ acknowledged: false });
  });
  it("does not acquire a shard after an operation is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let pickups = 0;
    const delivery = new Delivery({
      context: { name: "Fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        sessionKind: "LEASED",
        receive: () => Promise.reject(new Error("not used")),
        read: () => Promise.resolve([]),
        readMessage: () => Promise.resolve(undefined),
        markDelivered: () => Promise.resolve(undefined),
        removeDuplicate: () => Promise.resolve(true),
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: () => {
          pickups += 1;
          return Promise.resolve(undefined);
        },
        release: () => Promise.resolve(true),
        validateOwnership: () => Promise.resolve(undefined),
      },
    });
    await expect(
      delivery.drain(ShardIndex.single(), {
        operation: { signal: controller.signal },
        onMessage: () => undefined,
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(pickups).toBe(0);
  });

  it("releases a picked shard when monitor start fails", async () => {
    const shard = ShardIndex.single();
    let releases = 0;
    const delivery = new Delivery({
      context: { name: "Fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      monitor: new (class extends DeliveryMonitor {
        override onDeliveryStarted(): void {
          throw new Error("start");
        }
      })(),
      inbox: {
        sessionKind: "LEASED",
        receive: () => Promise.reject(new Error("not used")),
        read: () => Promise.resolve([]),
        readMessage: () => Promise.resolve(undefined),
        markDelivered: () => Promise.resolve(undefined),
        removeDuplicate: () => Promise.resolve(true),
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: () =>
          Promise.resolve({
            kind: "LEASED" as const,
            shard,
            worker: create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
            pickedUpAt: new Date(),
            expiresAt: new Date(),
          }),
        release: () => {
          releases += 1;
          return Promise.resolve(true);
        },
        validateOwnership: (session) => Promise.resolve(session),
      },
    });
    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
    });
    expect(releases).toBe(1);
  });
});

function session() {
  return {
    kind: "LEASED" as const,
    shard: ShardIndex.single(),
    worker: create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    pickedUpAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
}

function agentDelivery(
  messages: ReturnType<typeof createMessage>[],
  onMark: (message: ReturnType<typeof createMessage>) => void,
  onRelease: () => void = () => undefined,
  acknowledged = new Set<string>(),
): Delivery {
  return new Delivery({
    context: { name: "AgentDelivery", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
    inbox: {
      sessionKind: "LEASED",
      receive: () => Promise.reject(new Error("unused")),
      read: () =>
        Promise.resolve(messages.filter((message) => !acknowledged.has(message.id.value))),
      readMessage: (id) =>
        Promise.resolve(messages.find((message) => message.id.value === id.value)),
      markDelivered: (message) => {
        onMark(message);
        return Promise.resolve(message);
      },
      removeDuplicate: () => Promise.resolve(true),
    },
    workRegistry: {
      sessionKind: "LEASED",
      pickUp: () => Promise.resolve(session()),
      release: () => {
        onRelease();
        return Promise.resolve(true);
      },
      validateOwnership: (current) => Promise.resolve(current),
    },
  });
}
