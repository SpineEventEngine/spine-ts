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

import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  type DeliveryReady,
  DeliveryReadiness,
  InboxHandoff,
} from "../../src/context/local-inbox-handoff.js";
import { Delivery } from "../../src/delivery/delivery.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { tenant } from "../tenant-fixture.js";

describe("DeliveryReadiness", () => {
  it("omits optional drain observers when exact acknowledgement needs none", async () => {
    const received = {
      id: { value: "target", shard: ShardIndex.single() },
    } as InboxMessage;
    const drainMessage = vi.fn().mockResolvedValue({
      acknowledged: true,
      run: {
        status: "DRAINED",
        processed: 1,
        accepted: 1,
        delivered: 1,
        failed: 0,
        failures: [],
      },
    });
    const delivery = { drainMessage } as unknown as Delivery;

    await InboxHandoff.runDrain({
      delivery,
      received,
      node: "Tasks",
      onReplay: () => undefined,
      replayFailureMessage: "replay failed",
      skippedMessage: "skipped",
      unfinishedMessage: "unfinished",
    });

    expect(drainMessage).toHaveBeenCalledOnce();
    expect(drainMessage.mock.calls[0]?.[1]).not.toHaveProperty("acceptMessage");
    expect(drainMessage.mock.calls[0]?.[1]).not.toHaveProperty("onDelivered");
  });

  it("publishes the direct gate before a readiness callback can transition", async () => {
    const scope = ready();
    const release = Promise.withResolvers<undefined>();
    const routed: DeliveryReady[] = [];
    let transition: Promise<void> | undefined;
    const readiness = new DeliveryReadiness(() => {
      transition = readiness.transition([scope], (next) => routed.push(next));
    });

    const handoff = readiness.claim(scope);
    const transferring = transition;
    if (transferring === undefined) {
      throw new Error("Expected the readiness callback to begin transition.");
    }
    let transferred = false;
    void transferring.then(() => {
      transferred = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(transferred).toBe(false);
    const draining = handoff.complete(() => release.promise);
    release.resolve(undefined);
    await Promise.all([draining, transferring]);
    expect(routed).toEqual([]);
  });

  it("closes direct admission, awaits every admitted drain, and transfers bounded readiness once", async () => {
    const scope = ready("tenant-a");
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    const routed: DeliveryReady[] = [];
    const readiness = new DeliveryReadiness();
    let directDrains = 0;

    const firstDrain = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return first.promise;
    });
    const secondDrain = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return second.promise;
    });
    const transition = readiness.transition([scope], (next) => routed.push(next));
    const buffered = readiness.claim(scope).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    let transitioned = false;
    void transition.then(() => {
      transitioned = true;
    });

    await buffered;
    expect(directDrains).toBe(2);
    expect(routed).toEqual([]);
    first.resolve(undefined);
    await firstDrain;
    await Promise.resolve();
    expect(transitioned).toBe(false);

    second.resolve(undefined);
    await Promise.all([secondDrain, transition]);
    expect(routed).toEqual([scope]);

    await readiness.claim(scope).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    expect(directDrains).toBe(2);
    expect(routed).toEqual([scope, scope]);
  });

  it("preserves a pre-transition exact-drain rejection", async () => {
    const failure = new Error("exact drain failed");
    const readiness = new DeliveryReadiness();

    await expect(readiness.claim(ready()).complete(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });

  it("rejects a second ownership transfer", async () => {
    const scope = ready();
    const readiness = new DeliveryReadiness();

    await readiness.transition([scope], () => undefined);

    await expect(readiness.transition([scope], () => undefined)).rejects.toThrow(
      "Delivery readiness ownership is already transferred.",
    );
  });

  it("runs direct completion once across concurrent and repeated calls", async () => {
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(ready());
    const release = Promise.withResolvers<undefined>();
    let drains = 0;

    const first = handoff.complete(() => {
      drains += 1;
      return release.promise;
    });
    const concurrent = handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });
    expect(drains).toBe(1);

    release.resolve(undefined);
    await Promise.all([first, concurrent]);
    await handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });
    expect(drains).toBe(1);
  });

  it("publishes shared completion before synchronous complete reentry", async () => {
    const scope = ready();
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(scope);
    const release = Promise.withResolvers<undefined>();
    let drains = 0;
    let reentrant: Promise<void> | undefined;

    const original = handoff.complete(() => {
      drains += 1;
      reentrant = handoff.complete(() => {
        drains += 1;
        return Promise.resolve();
      });
      return release.promise;
    });
    const transferring = readiness.transition([scope], () => undefined);
    let transferred = false;
    void transferring.then(() => {
      transferred = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(drains).toBe(1);
    expect(reentrant).toBe(original);
    expect(transferred).toBe(false);
    release.resolve(undefined);
    await Promise.all([original, transferring]);
  });

  it("does not release the shared completion gate on synchronous abandon", async () => {
    const scope = ready();
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(scope);
    const release = Promise.withResolvers<undefined>();

    const draining = handoff.complete(() => {
      handoff.abandon();
      return release.promise;
    });
    const transferring = readiness.transition([scope], () => undefined);
    let transferred = false;
    void transferring.then(() => {
      transferred = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(transferred).toBe(false);
    release.resolve(undefined);
    await Promise.all([draining, transferring]);
  });

  it("does not start direct completion after abandon", async () => {
    const readiness = new DeliveryReadiness();
    const handoff = readiness.claim(ready());
    let drains = 0;

    handoff.abandon();
    await handoff.complete(() => {
      drains += 1;
      return Promise.resolve();
    });

    expect(drains).toBe(0);
  });

  it("keeps the installed route when onReady is called after transfer", async () => {
    const scope = ready();
    const routed: DeliveryReady[] = [];
    const replaced: DeliveryReady[] = [];
    const readiness = new DeliveryReadiness();
    await readiness.transition([scope], (next) => routed.push(next));

    readiness.onReady((next) => replaced.push(next));
    await readiness.claim(scope).complete(() => Promise.resolve());

    expect(routed).toEqual([scope]);
    expect(replaced).toEqual([]);
  });

  it("routes inbox writes and shard work through transferred environment ports", async () => {
    const localStorage = new InMemoryStorageFactory();
    const remoteStorage = new InMemoryStorageFactory();
    const local = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: localStorage,
    });
    const remote = new Delivery({
      context: { name: "Remote", multitenant: false },
      storageFactory: remoteStorage,
    });
    const readiness = new DeliveryReadiness();

    expect(readiness.route(local)).toBe(local);
    await readiness.transition([ready()], () => undefined, {
      ports: { inbox: remote.inbox, workRegistry: remote.shards },
    });

    const routed = readiness.route(local);
    expect(routed).not.toBe(local);
    expect(routed.context).toEqual(local.context);
    expect(routed.storageFactory).toBe(local.storageFactory);
    expect(routed.inbox).toBe(remote.inbox);
    expect(routed.shards).toBe(remote.shards);

    localStorage.close();
    remoteStorage.close();
  });

  it("fails a stalled transition finitely for arbitrary unconfigured scopes", async () => {
    const scope = ready();
    const readiness = new DeliveryReadiness();
    const release = Promise.withResolvers<undefined>();
    const draining = readiness.claim(scope).complete(() => release.promise);
    const routed: DeliveryReady[] = [];
    const transition = readiness.transition([scope], (next) => routed.push(next));
    let directDrains = 1;

    for (let index = 0; index < 2_048; index += 1) {
      await readiness
        .claim({ ...scope, targetTypeUrl: `type.example.dev/Unknown.${String(index)}` })
        .complete(() => {
          directDrains += 1;
          return Promise.resolve();
        });
    }
    expect(routed).toEqual([]);
    expect(directDrains).toBe(1);

    release.resolve(undefined);
    await draining;
    await expect(transition).rejects.toThrow(
      "Delivery readiness transition received an unconfigured scope.",
    );
    expect(routed).toEqual([]);

    await readiness
      .claim({ ...scope, targetTypeUrl: "type.example.dev/Unknown.Late" })
      .complete(() => {
        directDrains += 1;
        return Promise.resolve();
      });
    expect(directDrains).toBe(1);
  });

  it("retries a failed transition with a refreshed complete scope set", async () => {
    const configured = ready();
    const omitted = { ...configured, targetTypeUrl: "type.example.dev/Recovered" };
    const readiness = new DeliveryReadiness();
    const release = Promise.withResolvers<undefined>();
    const draining = readiness.claim(configured).complete(() => release.promise);
    const routed: DeliveryReady[] = [];
    const stale = readiness.transition([configured], (next) => routed.push(next));
    let directDrains = 1;

    await readiness.claim(omitted).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    release.resolve(undefined);
    await draining;
    await expect(stale).rejects.toThrow(
      "Delivery readiness transition received an unconfigured scope.",
    );
    expect(routed).toEqual([]);

    await readiness.claim(omitted).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    expect(routed).toEqual([]);

    const retry = readiness.transition([configured, omitted], (next) => routed.push(next));
    await readiness.claim(configured).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    await readiness.claim(omitted).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    await retry;

    expect(directDrains).toBe(1);
    expect(routed).toEqual([configured, omitted]);
  });

  it("accepts one simultaneous failed-checkpoint retry without loser mutation", async () => {
    const configured = ready();
    const omitted = { ...configured, targetTypeUrl: "type.example.dev/Recovered" };
    const readiness = new DeliveryReadiness();
    const staleRoute: DeliveryReady[] = [];
    const stale = readiness.transition([configured], (next) => staleRoute.push(next));
    await readiness.claim(omitted).complete(() => Promise.resolve());
    await expect(stale).rejects.toThrow(
      "Delivery readiness transition received an unconfigured scope.",
    );

    const winnerRoute: DeliveryReady[] = [];
    const loserRoute: DeliveryReady[] = [];
    let directDrains = 0;
    const winner = readiness.transition([configured, omitted], (next) => winnerRoute.push(next));
    const configuredReadiness = readiness.claim(configured).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    const loser = readiness.transition([omitted], (next) => loserRoute.push(next));
    const omittedReadiness = readiness.claim(omitted).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });

    expect(winnerRoute).toEqual([]);
    expect(loserRoute).toEqual([]);
    await expect(loser).rejects.toThrow("Delivery readiness ownership is already transferred.");
    await Promise.all([configuredReadiness, omittedReadiness, winner]);
    expect(staleRoute).toEqual([]);
    expect(winnerRoute).toEqual([configured, omitted]);
    expect(loserRoute).toEqual([]);
    expect(directDrains).toBe(0);

    await readiness.claim(omitted).complete(() => {
      directDrains += 1;
      return Promise.resolve();
    });
    expect(winnerRoute).toEqual([configured, omitted, omitted]);
    expect(loserRoute).toEqual([]);
    expect(directDrains).toBe(0);
  });
});

function ready(tenantId?: string): DeliveryReady {
  return Object.freeze({
    ...(tenantId === undefined ? {} : { tenantId: tenant(tenantId) }),
    label: "HANDLE_COMMAND",
    targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
    shard: ShardIndex.single(),
  });
}
