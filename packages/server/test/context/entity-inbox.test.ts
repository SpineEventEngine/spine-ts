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

import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { Identifiers } from "@spine-event-engine/core";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import type { DeliveryStrategy } from "../../src/delivery/delivery-builder.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import { ShardIndex, type InboxMessage } from "../../src/index.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { LocalEntityInbox } from "../../src/context/entity-inbox.js";
import { tenant } from "../tenant-fixture.js";

type ReceiveInput = Parameters<LocalEntityInbox["receive"]>[1];
const processManagerLabels = ["HANDLE_COMMAND", "REACT_UPON_EVENT"] as const;

describe("LocalEntityInbox", () => {
  it("exposes the shared entity inbox for Aggregate command labels", () => {
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    expect(inbox.endpoints()).toContainEqual(
      expect.objectContaining({ label: "HANDLE_COMMAND", targetTypeUrl }),
    );
  });

  it("keeps one multitenant descriptor tenant before batch persistence", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-dynamic") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const kept = Promise.withResolvers<undefined>();
    const keep = vi.fn(() => kept.promise);
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inbox = new LocalEntityInbox("Tasks", undefined, keep);
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    const receiving = inbox.receiveAll(
      delivery,
      ["first", "second"].map((targetId) => processInput(targetTypeUrl, targetId)),
      tenant("tenant-dynamic"),
    );
    await Promise.resolve(undefined);

    expect(keep).toHaveBeenCalledExactlyOnceWith(tenant("tenant-dynamic"));
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);

    kept.resolve(undefined);
    await receiving;
  });

  it("exact-drains persisted batch rows before propagating a later write failure", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inputs = ["persisted", "rejected"].map((targetId) =>
      processInput(targetTypeUrl, targetId),
    );
    const first = inputs[0];
    if (first === undefined) {
      throw new Error("Expected one persisted batch input.");
    }
    const persisted = writtenResult(first, 1n).message;
    const writeFailure = new Error("second write failed");
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
    const readMessage = vi.fn().mockResolvedValue(undefined);
    const delivery = {
      inbox: {
        receive: vi
          .fn()
          .mockResolvedValueOnce({ outcome: "WRITTEN", message: persisted })
          .mockRejectedValueOnce(writeFailure),
        readMessage,
      },
      drainMessage,
    } as unknown as Delivery;
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    await expect(inbox.receiveAll(delivery, inputs)).rejects.toBe(writeFailure);
    expect(drainMessage).toHaveBeenCalledOnce();
    expect(drainMessage.mock.calls[0]?.[0]).toMatchObject({
      inboxId: { targetId: typedTarget("persisted") },
    });
    expect(readMessage).not.toHaveBeenCalled();
  });

  it("does not infer exact acknowledgement from aggregate delivery counts", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const input = processInput(targetTypeUrl, "missing-target");
    const persisted = writtenResult(input, 1n).message;
    const drainMessage = vi.fn().mockResolvedValue({
      acknowledged: false,
      run: {
        status: "DRAINED",
        processed: 9,
        accepted: 9,
        delivered: 9,
        failed: 0,
        failures: [],
      },
    });
    const delivery = {
      inbox: {
        receive: () => Promise.resolve({ outcome: "WRITTEN", message: persisted }),
        readMessage: () => Promise.resolve(undefined),
      },
      drainMessage,
    } as unknown as Delivery;
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    await expect(inbox.receive(delivery, input)).rejects.toThrow(
      "Entity Inbox delivery did not reach the target row before the local drain finished.",
    );
    expect(drainMessage).toHaveBeenCalledTimes(8);
  });

  it("propagates the exact target failure despite unrelated delivery success", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const input = processInput(targetTypeUrl, "failed-target");
    const persisted = writtenResult(input, 1n).message;
    const failure = new Error("exact acknowledgement failed");
    const delivery = {
      inbox: {
        receive: () => Promise.resolve({ outcome: "WRITTEN", message: persisted }),
        readMessage: () => Promise.resolve(undefined),
      },
      drainMessage: () =>
        Promise.resolve({
          acknowledged: false,
          run: {
            status: "DRAINED",
            processed: 2,
            accepted: 2,
            delivered: 1,
            failed: 1,
            failures: [{ message: persisted, error: failure }],
          },
        }),
    } as unknown as Delivery;
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    await expect(inbox.receive(delivery, input)).rejects.toBe(failure);
  });

  it("continues draining persisted batch rows after an earlier reception fails", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const drainFailure = new Error("first drain failed");
    const replayed: string[] = [];
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay(message) {
        replayed.push(targetValue(message));
        return targetValue(message) === "first"
          ? Promise.reject(drainFailure)
          : Promise.resolve(undefined);
      },
    });

    await expect(
      inbox.receiveAll(
        delivery,
        ["first", "second"].map((targetId) => processInput(targetTypeUrl, targetId)),
      ),
    ).resolves.toHaveLength(2);
    expect(replayed).toEqual(["first", "second"]);
  });

  it("buffers persisted rows while direct drain ownership transfers", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("Tasks", readiness);
    const replayStarted = Promise.withResolvers<undefined>();
    const releaseReplay = Promise.withResolvers<undefined>();
    const replayed: string[] = [];
    const routed: unknown[] = [];
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      async replay(message) {
        replayed.push(targetValue(message));
        if (targetValue(message) === "admitted") {
          replayStarted.resolve(undefined);
          await releaseReplay.promise;
        }
      },
    });

    const admitted = inbox.receive(
      delivery,
      processInput(targetTypeUrl, "admitted"),
      tenant("tenant-a"),
    );
    await replayStarted.promise;
    const transition = readiness.transition(
      [
        {
          tenantId: tenant("tenant-a"),
          label: "HANDLE_COMMAND",
          targetTypeUrl,
          shard: ShardIndex.single(),
        },
      ],
      (scope) => routed.push(scope),
    );

    await expect(
      inbox.receiveAll(
        delivery,
        ["buffered-a", "buffered-b"].map((targetId) => processInput(targetTypeUrl, targetId)),
        tenant("tenant-a"),
      ),
    ).resolves.toHaveLength(2);
    expect(replayed).toEqual(["admitted"]);
    expect(routed).toEqual([]);

    releaseReplay.resolve(undefined);
    await Promise.all([admitted, transition]);
    expect(routed).toHaveLength(1);

    await expect(
      inbox.receive(delivery, processInput(targetTypeUrl, "routed"), tenant("tenant-a")),
    ).resolves.toBeDefined();
    expect(replayed).toEqual(["admitted", "buffered-a", "buffered-b"]);
    expect(routed).toHaveLength(2);
  });

  it("emits readiness after persistence before exact drain settles", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      async replay() {
        startReplay();
        await replayReleased;
      },
    });

    const receive = inbox.receive(
      delivery,
      {
        inboxId: { targetId: typedTarget("pm-ready"), targetTypeUrl },
        signalId: "signal-ready",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
      tenant("tenant-a"),
    );
    await replayStarted;

    expect(ready).toEqual([
      {
        tenantId: tenant("tenant-a"),
        label: "HANDLE_COMMAND",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    releaseReplay();
    await receive;
  });

  it("emits for each persisted batch row before a later persistence rejection", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inputs = ["first", "second", "unattempted"].map((targetId) => ({
      inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
      signalId: "event-partial",
      label: "REACT_UPON_EVENT" as const,
      status: "TO_DELIVER" as const,
    }));
    const firstInput = inputs[0];
    if (firstInput === undefined) {
      throw new Error("Expected a first partial-batch input.");
    }
    const receive = vi
      .fn()
      .mockResolvedValueOnce(writtenResult(firstInput, 1n))
      .mockRejectedValueOnce(new Error("second write rejected"));
    const delivery = { inbox: { receive } } as unknown as Delivery;
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      labels: ["REACT_UPON_EVENT"],
      replay: () => Promise.resolve(undefined),
    });

    await expect(inbox.receiveAll(delivery, inputs, tenant("tenant-a"))).rejects.toThrow(
      "second write rejected",
    );

    expect(receive).toHaveBeenCalledTimes(2);
    expect(ready).toEqual([
      {
        tenantId: tenant("tenant-a"),
        label: "REACT_UPON_EVENT",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
    ]);
  });

  it("matches batch readiness without rebuilding the global endpoint snapshot", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.resolve(undefined),
    });
    const endpoints = vi.spyOn(inbox, "endpoints");

    await inbox.receiveAll(
      delivery,
      ["first", "second"].map((targetId) => ({
        inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
        signalId: `command-${targetId}`,
        signal: commandSignal(),
        label: "HANDLE_COMMAND" as const,
        status: "TO_DELIVER" as const,
        shard: ShardIndex.single(),
      })),
      tenant("tenant-a"),
    );

    expect(endpoints).not.toHaveBeenCalled();
    expect(ready).toEqual([
      {
        tenantId: tenant("tenant-a"),
        label: "HANDLE_COMMAND",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
      {
        tenantId: tenant("tenant-a"),
        label: "HANDLE_COMMAND",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
    ]);
  });

  it("isolates readiness observer failure from every batch write and exact drain", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const seen: string[] = [];
    let notifications = 0;
    const inbox = new LocalEntityInbox("Tasks", () => {
      notifications += 1;
      throw new Error("observer failed");
    });
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(targetValue(message));
        return Promise.resolve(undefined);
      },
    });

    await expect(
      inbox.receiveAll(
        delivery,
        ["first", "second"].map((targetId) => ({
          inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
          signalId: "event-observer-failure",
          signal: eventSignal(),
          label: "REACT_UPON_EVENT" as const,
          status: "TO_DELIVER" as const,
          shard: ShardIndex.single(),
        })),
      ),
    ).resolves.toHaveLength(2);
    expect(notifications).toBe(2);
    expect(seen).toEqual(["first", "second"]);
  });

  it("contains a rejected readiness promise created in another realm", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const foreign = runInNewContext(`
      (() => {
        let reject;
        const promise = new Promise((_, onRejected) => {
          reject = onRejected;
        });
        return { promise, reject };
      })()
    `) as ForeignDeferred;
    const then = vi.spyOn(foreign.promise, "then");
    let markObserved!: () => void;
    const observed = new Promise<void>((resolve) => {
      markObserved = resolve;
    });
    const inbox = new LocalEntityInbox("Tasks", () => {
      markObserved();
      return foreign.promise;
    });
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.resolve(undefined),
    });

    const receive = inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-foreign-observer"), targetTypeUrl },
      signalId: "foreign-observer-failure",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    await observed;
    await Promise.resolve(undefined);

    expect(then).toHaveBeenCalledOnce();
    foreign.reject(new Error("foreign observer failed"));
    await expect(receive).resolves.toBeDefined();
  });

  it("emits no readiness for a rejected write or a duplicate without new persistence", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const rejectedDelivery = {
      inbox: { receive: () => Promise.reject(new Error("write rejected")) },
    } as unknown as Delivery;
    const input = {
      inboxId: { targetId: typedTarget("pm-dedup"), targetTypeUrl },
      signalId: "signal-dedup",
      signal: commandSignal(),
      label: "HANDLE_COMMAND" as const,
      status: "TO_DELIVER" as const,
    };

    await expect(inbox.receive(rejectedDelivery, input)).rejects.toThrow("write rejected");
    expect(ready).toEqual([]);

    const duplicate = writtenResult(input, 1n).message;
    const duplicateDelivery = {
      inbox: {
        receive: () => Promise.resolve({ outcome: "DUPLICATE", message: duplicate }),
        readMessage: () => Promise.resolve({ ...duplicate, status: "DELIVERED" }),
      },
      drainMessage: () =>
        Promise.resolve({
          acknowledged: false,
          run: {
            status: "DRAINED",
            processed: 0,
            accepted: 0,
            delivered: 0,
            failed: 0,
            failures: [],
          },
        }),
    } as unknown as Delivery;

    await inbox.receive(duplicateDelivery, input);

    expect(ready).toEqual([]);
  });

  it("emits for all persisted batch rows before a later exact drain rejection", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const drainFailure = new Error("batch replay failed");
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.reject(drainFailure),
    });

    const result = await inbox
      .receiveAll(
        delivery,
        ["first", "second"].map((targetId) => ({
          inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
          signalId: "event-drain-failure",
          signal: eventSignal(),
          label: "REACT_UPON_EVENT" as const,
          status: "TO_DELIVER" as const,
          shard: ShardIndex.single(),
        })),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(result).toBeUndefined();
    expect(ready).toHaveLength(2);
  });
  it("replays and cleans eligible durable command and event rows through a delivery loop endpoint", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    await delivery.inbox.receive({
      inboxId: { targetId: typedTarget("pm-command"), targetTypeUrl },
      signalId: "command-1",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: { targetId: typedTarget("pm-event"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:01.000Z"),
      version: 2n,
    });

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      onMessage: (message) => inbox.replay(message),
    }).run();

    expect(seen.map(({ label }) => label)).toEqual(["HANDLE_COMMAND", "REACT_UPON_EVENT"]);
    expect(run).toMatchObject({
      status: "IDLE",
      processed: 2,
      delivered: 2,
      failed: 0,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("delivers a handled command without the optional keepUntil field", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const delivered = await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-1"), targetTypeUrl },
      signalId: "signal-1",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    expect(seen[0]?.signal).toBeDefined();
    expect(seen[0]?.keepUntil).toBeUndefined();
    expect(delivered).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    expect(delivered.signal).toBeDefined();
    expect(delivered.keepUntil).toBeUndefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("completes local handoff while cleanup removes exact unprotected rows", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.resolve(undefined),
    });

    const first = await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-cleaned"), targetTypeUrl },
      signalId: "signal-cleaned",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });

    const second = await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-cleaned"), targetTypeUrl },
      signalId: "signal-cleaned-2",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.readMessage(first.id)).resolves.toBeUndefined();
    await expect(delivery.inbox.readMessage(second.id)).resolves.toBeUndefined();
  });

  it("retains an acknowledged row until its deduplication boundary", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const keepUntil = new Date(Date.now() + 30_000);

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.resolve(undefined),
    });

    const received = await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-protected"), targetTypeUrl },
      signalId: "signal-protected",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      keepUntil,
    });

    await expect(delivery.inbox.readMessage(received.id)).resolves.toMatchObject({
      status: "DELIVERED",
      keepUntil,
    });
  });

  it("delivers an event reactor row to the registered Entity Inbox target", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-event-1"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "event-1",
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("waits for a concurrent duplicate while the original command replay is in flight", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const input = {
      inboxId: { targetId: typedTarget("pm-duplicate"), targetTypeUrl },
      signalId: "signal-duplicate",
      signal: commandSignal(),
      label: "HANDLE_COMMAND" as const,
      status: "TO_DELIVER" as const,
    };

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      async replay(message) {
        seen.push(message);
        startReplay();
        await replayReleased;
      },
    });

    const first = inbox.receive(delivery, input);
    await replayStarted;
    const duplicate = inbox.receive(delivery, input);

    await pause(150);
    releaseReplay();

    const [firstMessage, duplicateMessage] = await Promise.all([first, duplicate]);

    expect(duplicateMessage.id).toEqual(firstMessage.id);
    expect(seen).toHaveLength(1);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("waits for a concurrent duplicate multi-target event batch", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const inputs = [
      {
        inboxId: { targetId: typedTarget("pm-first"), targetTypeUrl: firstTypeUrl },
        signalId: "event-duplicate-batch",
        signal: eventSignal(),
        label: "REACT_UPON_EVENT" as const,
        status: "TO_DELIVER" as const,
        shard,
      },
      {
        inboxId: { targetId: typedTarget("pm-second"), targetTypeUrl: secondTypeUrl },
        signalId: "event-duplicate-batch",
        signal: eventSignal(),
        label: "REACT_UPON_EVENT" as const,
        status: "TO_DELIVER" as const,
        shard,
      },
    ];
    inbox.register({
      targetTypeUrl: firstTypeUrl,
      labels: processManagerLabels,
      async replay(message) {
        seen.push(message);
        startReplay();
        await replayReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const first = inbox.receiveAll(delivery, inputs);
    await replayStarted;
    const duplicate = inbox.receiveAll(delivery, inputs);

    try {
      await expect(
        Promise.race([duplicate.then(() => "resolved"), pause(150).then(() => "pending")]),
      ).resolves.toBe("pending");
    } finally {
      releaseReplay();
    }

    const [firstMessages, duplicateMessages] = await Promise.all([first, duplicate]);

    expect(duplicateMessages.map(({ id }) => id)).toEqual(firstMessages.map(({ id }) => id));
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("waits for a duplicate single row while a batch row is in flight", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const firstInput = {
      inboxId: { targetId: typedTarget("pm-first"), targetTypeUrl: firstTypeUrl },
      signalId: "event-mixed-batch-to-single",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT" as const,
      status: "TO_DELIVER" as const,
    };
    const secondInput = {
      inboxId: { targetId: typedTarget("pm-second"), targetTypeUrl: secondTypeUrl },
      signalId: "event-mixed-batch-to-single",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT" as const,
      status: "TO_DELIVER" as const,
    };
    const inputs = [firstInput, secondInput];

    inbox.register({
      targetTypeUrl: firstTypeUrl,
      labels: processManagerLabels,
      async replay(message) {
        seen.push(message);
        startReplay();
        await replayReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const batch = inbox.receiveAll(delivery, inputs);
    await replayStarted;
    const duplicate = inbox.receive(delivery, secondInput);

    try {
      await expect(
        Promise.race([
          duplicate.then(
            () => "resolved",
            (error: unknown) => (error instanceof Error ? error.message : "rejected"),
          ),
          pause(150).then(() => "pending"),
        ]),
      ).resolves.toBe("pending");
    } finally {
      releaseReplay();
    }

    const [batchMessages, duplicateMessage] = await Promise.all([batch, duplicate]);

    expect(duplicateMessage.id).toEqual(batchMessages[1]?.id);
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("waits for a duplicate batch row while a single row is in flight", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const firstInput = {
      inboxId: { targetId: typedTarget("pm-first"), targetTypeUrl: firstTypeUrl },
      signalId: "event-mixed-single-to-batch",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT" as const,
      status: "TO_DELIVER" as const,
      shard,
    };
    const secondInput = {
      inboxId: { targetId: typedTarget("pm-second"), targetTypeUrl: secondTypeUrl },
      signalId: "event-mixed-single-to-batch",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT" as const,
      status: "TO_DELIVER" as const,
      shard,
    };
    const inputs = [firstInput, secondInput];

    inbox.register({
      targetTypeUrl: firstTypeUrl,
      labels: processManagerLabels,
      async replay(message) {
        seen.push(message);
        startReplay();
        await replayReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const single = inbox.receive(delivery, firstInput);
    await replayStarted;
    const batch = inbox.receiveAll(delivery, inputs);

    try {
      await expect(
        Promise.race([
          batch.then(
            () => "resolved",
            (error: unknown) => (error instanceof Error ? error.message : "rejected"),
          ),
          pause(150).then(() => "pending"),
        ]),
      ).resolves.toBe("pending");
    } finally {
      releaseReplay();
    }

    const [singleMessage, batchMessages] = await Promise.all([single, batch]);

    expect(batchMessages[0]?.id).toEqual(singleMessage.id);
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("stores optional signal and keepUntil while scheduled rows do not replay", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const earlierSignal = commandSignal();
    const laterSignal = commandSignal();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    await delivery.inbox.receive({
      inboxId: { targetId: typedTarget("pm-0"), targetTypeUrl },
      signalId: "signal-0",
      signal: earlierSignal,
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    await expect(
      inbox.receive(
        delivery,
        corruptedInput({
          inboxId: { targetId: typedTarget("pm-1"), targetTypeUrl },
          signalId: "signal-1",
          signal: laterSignal,
          label: "HANDLE_COMMAND",
          status: "SCHEDULED",
          shard,
          keepUntil,
        }),
      ),
    ).rejects.toThrow(
      "Entity Inbox delivery did not reach the target row before the local drain finished.",
    );

    expect(seen).toHaveLength(1);
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });
    const delivered = await delivery.inbox.read(shard, { statuses: ["DELIVERED"] });
    const scheduled = await delivery.inbox.read(shard, { statuses: ["SCHEDULED"] });

    expect(pending).toEqual([]);
    expect(delivered).toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["SCHEDULED"] })).resolves.toMatchObject([
      {
        signalId: "signal-1",
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
        keepUntil,
      },
    ]);
    expect(scheduled[0]?.signal?.typeUrl).toBe(laterSignal.typeUrl);
    expect(Array.from(scheduled[0]?.signal?.value ?? [])).toEqual([]);
  });

  it("drains the received row and unrelated backlog in the owned shard", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const unrelatedProcessManagerTypeUrl = "type.example.dev/Tasks.OtherProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const unrelatedSeen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });
    inbox.register({
      targetTypeUrl: unrelatedProcessManagerTypeUrl,
      labels: processManagerLabels,
      replay(message) {
        unrelatedSeen.push(message);
        return Promise.reject(new Error("unrelated process-manager should not replay"));
      },
    });

    await delivery.inbox.receive({
      inboxId: {
        targetId: typedTarget("projection-0"),
        targetTypeUrl: "type.example.dev/Tasks.Projection",
      },
      signalId: "event-0",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: {
        targetId: typedTarget("pm-0"),
        targetTypeUrl: unrelatedProcessManagerTypeUrl,
      },
      signalId: "signal-0",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:01.000Z"),
      version: 2n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-1"), targetTypeUrl },
      signalId: "signal-1",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });

    expect(seen).toHaveLength(1);
    expect(unrelatedSeen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([
      expect.objectContaining({
        signalId: "event-0",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      }),
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("contains an Error reception failure and marks the row delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay() {
        return Promise.reject(new Error("target failed"));
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-2"), targetTypeUrl },
        signalId: "signal-2",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      }),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("contains a non-Error reception failure and marks the row delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay() {
        const reason = "not-an-error" as unknown as Error;

        return Promise.reject(reason);
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-3"), targetTypeUrl },
        signalId: "signal-3",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      }),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("rejects skipped delivery and leaves the claimed shard available again", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const shard = ShardIndex.single();
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const input = {
      inboxId: { targetId: typedTarget("pm-4"), targetTypeUrl },
      signalId: "signal-4",
      signal: commandSignal(),
      label: "HANDLE_COMMAND" as const,
      status: "TO_DELIVER" as const,
    };
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });
    const session = await delivery.shards.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "other-node" }, value: "worker-1" }),
    );
    if (session === undefined) {
      throw new Error("Expected to claim the shard before inbox delivery.");
    }

    try {
      await expect(inbox.receive(delivery, input)).rejects.toThrow(
        "Entity Inbox delivery was skipped before the target row was delivered.",
      );
    } finally {
      await delivery.shards.release(session);
    }

    await expect(inbox.receive(delivery, input)).resolves.toBeDefined();

    const reacquired = await delivery.shards.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "other-node-2" }, value: "worker-2" }),
    );
    expect(reacquired).toBeDefined();
    if (reacquired !== undefined) await delivery.shards.release(reacquired);
  });

  it("rejects when a scheduled inbox row never reaches delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay() {
        return Promise.reject(new Error("scheduled rows should not replay"));
      },
    });

    await expect(
      inbox.receive(
        delivery,
        corruptedInput({
          inboxId: { targetId: typedTarget("pm-5"), targetTypeUrl },
          signalId: "signal-5",
          signal: commandSignal(),
          label: "HANDLE_COMMAND",
          status: "SCHEDULED",
          shard: ShardIndex.single(),
        }),
      ),
    ).rejects.toThrow(
      "Entity Inbox delivery did not reach the target row before the local drain finished.",
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["SCHEDULED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-5",
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
      },
    ]);
    expect(ready).toEqual([]);
  });

  it("contains an unsupported inbox label and marks the row delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay() {
        return Promise.reject(new Error("unexpected replay"));
      },
    });

    await expect(
      inbox.receive(
        delivery,
        corruptedInput({
          inboxId: { targetId: typedTarget("pm-6"), targetTypeUrl },
          signalId: "signal-6",
          signal: eventSignal(),
          label: "UPDATE_SUBSCRIBER",
          status: "TO_DELIVER",
          shard: ShardIndex.single(),
        }),
      ),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
    expect(ready).toEqual([]);
  });

  it("emits no readiness when the registered target does not configure the persisted label", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.CommandOnlyProcessManager";
    const replayFailure = new Error("unconfigured event label should not replay");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.reject(replayFailure),
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-label-mismatch"), targetTypeUrl },
        signalId: "event-label-mismatch",
        signal: eventSignal(),
        label: "REACT_UPON_EVENT",
        status: "TO_DELIVER",
      }),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
    expect(ready).toEqual([]);
  });

  it("emits no readiness for a persisted shard outside the configured endpoint", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const replayFailure = new Error("non-configured shard should preserve drain failure");
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      replay: () => Promise.reject(replayFailure),
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-shard-mismatch"), targetTypeUrl },
        signalId: "command-shard-mismatch",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      }),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
    expect(ready).toMatchObject([{ label: "HANDLE_COMMAND", targetTypeUrl }]);
  });

  it("contains a missing process-manager target and marks the row delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));

    await expect(
      inbox.receive(delivery, {
        inboxId: {
          targetId: typedTarget("pm-7"),
          targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
        },
        signalId: "signal-7",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      }),
    ).resolves.toBeDefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
    expect(ready).toEqual([]);
  });

  it("chains same-scope follow-ups before admitting a later receive", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const first = Promise.withResolvers<undefined>();
    const second = Promise.withResolvers<undefined>();
    const followUps: string[] = [];
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay(message) {
        const targetId = targetValue(message);
        return Promise.resolve(async () => {
          followUps.push(targetId);
          if (targetId === "first") await first.promise;
          if (targetId === "second") await second.promise;
        });
      },
    });

    await inbox.receive(delivery, processInput(targetTypeUrl, "first"));
    const secondReceive = inbox.receive(delivery, processInput(targetTypeUrl, "second"));
    await expect(
      Promise.race([secondReceive.then(() => "resolved"), pause(25).then(() => "pending")]),
    ).resolves.toBe("pending");
    first.resolve(undefined);
    await secondReceive;

    const laterReceive = inbox.receive(delivery, processInput(targetTypeUrl, "later"));
    await expect(
      Promise.race([laterReceive.then(() => "resolved"), pause(25).then(() => "pending")]),
    ).resolves.toBe("pending");
    second.resolve(undefined);
    await laterReceive;
    expect(followUps).toEqual(["first", "second", "later"]);

    await expect(
      inbox.receive(delivery, processInput(targetTypeUrl, "after-settle")),
    ).resolves.toBeDefined();
  });

  it("does not block a different tenant or shard behind a gated follow-up", async () => {
    const strategy = twoShardStrategy();
    const blockedDelivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const freeDelivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-b") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks", undefined, undefined, strategy);
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const gate = Promise.withResolvers<undefined>();
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay(message) {
        return Promise.resolve(async () => {
          if (targetValue(message) === "even") await gate.promise;
        });
      },
    });

    await inbox.receive(blockedDelivery, processInput(targetTypeUrl, "even"), tenant("tenant-a"));
    await expect(
      inbox.receive(freeDelivery, processInput(targetTypeUrl, "odd"), tenant("tenant-b")),
    ).resolves.toMatchObject({ shard: { index: 1, ofTotal: 2 } });
    gate.resolve(undefined);
  });

  it("resolves each input shard once and persists that resolved shard", async () => {
    const shardFor = vi.fn((targetId: Any) => {
      const value = Identifiers.unpack("string", targetId);
      if (value === undefined) throw new Error("Expected a string target.");
      return new ShardIndex(value.length % 2, 2);
    });
    const strategy: DeliveryStrategy = { shardCount: 2, shardFor };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks", undefined, undefined, strategy);
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      replay: () => Promise.resolve(undefined),
    });

    const single = await inbox.receive(delivery, processInput(targetTypeUrl, "odd"));
    const batch = await inbox.receiveAll(delivery, [
      processInput(targetTypeUrl, "even"),
      processInput(targetTypeUrl, "three"),
    ]);

    expect(shardFor).toHaveBeenCalledTimes(3);
    expect([single, ...batch].map(({ shard }) => shard)).toEqual([
      new ShardIndex(1, 2),
      new ShardIndex(0, 2),
      new ShardIndex(1, 2),
    ]);
  });
});

function processInput(targetTypeUrl: string, targetId: string): ReceiveInput {
  return {
    inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
    signalId: `signal-${targetId}`,
    signal: commandSignal(),
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
  };
}

function commandSignal() {
  return create(AnySchema, {
    typeUrl: "type.spine.io/spine.core.Command",
    value: toBinary(CommandSchema, create(CommandSchema)),
  });
}

function eventSignal() {
  return create(AnySchema, {
    typeUrl: "type.spine.io/spine.core.Event",
    value: toBinary(EventSchema, create(EventSchema)),
  });
}

function twoShardStrategy(): DeliveryStrategy {
  return {
    shardCount: 2,
    shardFor(targetId): ShardIndex {
      return new ShardIndex(
        targetValue({ inboxId: { targetId } } as InboxMessage) === "even" ? 0 : 1,
        2,
      );
    },
  };
}

function typedTarget(value: string) {
  return Identifiers.pack("string", value);
}

function targetValue(message: Pick<InboxMessage, "inboxId">): string {
  const value = Identifiers.unpack("string", message.inboxId.targetId);
  if (value === undefined) throw new Error("Expected a string Inbox target fixture.");
  return value;
}

interface ForeignDeferred {
  readonly promise: Promise<never>;
  reject(error: Error): void;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function corruptedInput(input: unknown): ReceiveInput {
  return input as ReceiveInput;
}

function writtenResult(
  input: ReceiveInput,
  version: bigint,
): { readonly outcome: "WRITTEN"; readonly message: InboxMessage } {
  return {
    outcome: "WRITTEN" as const,
    message: {
      ...input,
      shard: ShardIndex.single(),
      id: { value: `row-${String(version)}`, shard: ShardIndex.single() },
      whenReceived: new Date("2026-07-12T09:00:00.000Z"),
      version,
    },
  };
}
