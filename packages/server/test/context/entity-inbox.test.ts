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

import { create } from "@bufbuild/protobuf";
import { timestampFromDate, type Any } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers } from "@spine-event-engine/core";
import { Time } from "@spine-event-engine/core/time";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import type { DeliveryStrategy } from "../../src/delivery/delivery-builder.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import { ShardIndex, type InboxMessage } from "../../src/index.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { LocalEntityInbox } from "../../src/context/entity-inbox.js";
import type { DeliveryInbox } from "../../src/delivery/delivery-ports.js";
import { commitFenced, withoutDeliveryCommitFence } from "../../src/repository/commit-fence.js";
import { tenant } from "../tenant-fixture.js";
import { CreateTaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import { TaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";

type ReceiveInput = Parameters<LocalEntityInbox["receive"]>[1];
const processManagerLabels = ["HANDLE_COMMAND", "REACT_UPON_EVENT"] as const;

describe("LocalEntityInbox", () => {
  it("drains a batch with a distinct precise receipt instant for every recipient", async () => {
    const previous = Time.setProvider({
      currentTime: (() => {
        let nanos = 0;
        return () => ({
          $typeName: "google.protobuf.Timestamp" as const,
          seconds: 1_700_000_000n,
          nanos: (nanos += 1_000),
        });
      })(),
    });
    try {
      const shard = ShardIndex.single();
      const delivery = new Delivery({
        context: { name: "BatchReceipt", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        pageSize: 2,
      });
      const entityInbox = new LocalEntityInbox("BatchReceipt");
      const targetTypeUrl = TaskSchema.typeName;
      const delivered: string[] = [];
      entityInbox.register({
        targetTypeUrl,
        labels: ["HANDLE_COMMAND"],
        deliver(message) {
          delivered.push(message.signalId);
          return Promise.resolve(undefined);
        },
      });
      const inputs = ["first", "second", "third"].map((target) => ({
        inboxId: {
          targetId: AnyPacker.pack(TaskIdSchema, create(TaskIdSchema, { value: target })),
          targetTypeUrl,
        },
        signalId: `command-${target}`,
        signal: AnyPacker.pack(
          CommandSchema,
          create(CommandSchema, {
            id: create(CommandIdSchema, { uuid: `command-${target}` }),
            context: create(CommandContextSchema, {
              actorContext: create(ActorContextSchema, {
                actor: create(UserIdSchema, { value: "batch-test-user" }),
              }),
            }),
            message: AnyPacker.pack(
              CreateTaskSchema,
              create(CreateTaskSchema, {
                id: create(TaskIdSchema, { value: target }),
                taskListId: create(TaskListIdSchema, { value: "batch-list" }),
                title: `Task ${target}`,
              }),
            ),
          }),
        ),
        label: "HANDLE_COMMAND" as const,
        status: "TO_DELIVER" as const,
      }));

      const messages = await entityInbox.receiveAll(delivery, inputs);

      expect(messages).toHaveLength(3);
      expect(
        new Set(
          messages.map(
            ({ whenReceived }) => String(whenReceived.seconds) + ":" + String(whenReceived.nanos),
          ),
        ).size,
      ).toBe(3);
      await delivery.whenIdle();
      expect(delivered).toEqual(inputs.map(({ signalId }) => signalId));
      await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    } finally {
      Time.setProvider(previous);
    }
  });

  it("exposes the shared entity inbox for Aggregate command labels", () => {
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });

    expect(inbox.endpoints()).toContainEqual(
      expect.objectContaining({ label: "HANDLE_COMMAND", targetTypeUrl }),
    );
  });

  it("checks one multitenant descriptor tenant before batch persistence", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const admitted = Promise.withResolvers<undefined>();
    const onAdmit = vi.fn(() => admitted.promise);
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inbox = new LocalEntityInbox("Tasks", undefined, onAdmit);
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });

    const receiving = inbox.receiveAll(
      delivery,
      ["first", "second"].map((targetId) => processInput(targetTypeUrl, targetId)),
      tenant("tenant-dynamic"),
    );
    await Promise.resolve(undefined);

    expect(onAdmit).toHaveBeenCalledExactlyOnceWith(tenant("tenant-dynamic"));
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);

    admitted.resolve(undefined);
    await receiving;
  });

  it("prepares a single-tenant inbox before persisting its first batch", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const admitted = Promise.withResolvers<undefined>();
    const onAdmit = vi.fn(() => admitted.promise);
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inbox = new LocalEntityInbox("Tasks", undefined, onAdmit);
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });
    const receiving = inbox.receiveAll(delivery, [processInput(targetTypeUrl, "first")]);
    await Promise.resolve();
    expect(onAdmit).toHaveBeenCalledExactlyOnceWith(undefined);
    await expect(delivery.inbox.read(ShardIndex.single())).resolves.toEqual([]);
    admitted.resolve(undefined);
    await receiving;
  });

  it("schedules a distinct written batch row before an existing receipt settles", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const backing = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const firstWriteStarted = Promise.withResolvers<undefined>();
    const releaseFirstWrite = Promise.withResolvers<undefined>();
    const secondWritten = Promise.withResolvers<undefined>();
    let writes = 0;
    const port: DeliveryInbox = {
      sessionKind: backing.inbox.sessionKind,
      async receive(input, options) {
        const write = ++writes;
        if (write === 1) {
          firstWriteStarted.resolve(undefined);
          await releaseFirstWrite.promise;
        }
        const result = await backing.inbox.receive(input, options);
        if (write === 2) secondWritten.resolve(undefined);
        return result;
      },
      read: (shard, options) => backing.inbox.read(shard, options),
      readMessage: (id, options) => backing.inbox.readMessage(id, options),
      markDelivered: (message, options) => backing.inbox.markDelivered(message, options),
      removeDuplicate: (message, options) => backing.inbox.removeDuplicate(message, options),
    };
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      inbox: port,
    });
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, delivery, onWake, false);
    const inbox = new LocalEntityInbox("Tasks", readiness);
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });
    const firstInput = processInput(targetTypeUrl, "first");
    const secondInput = processInput(targetTypeUrl, "second");
    const first = inbox.receive(delivery, firstInput);
    await firstWriteStarted.promise;
    const batch = inbox.receiveAll(delivery, [firstInput, secondInput]);
    let batchSettled = false;
    void batch.then(
      () => {
        batchSettled = true;
      },
      () => {
        batchSettled = true;
      },
    );
    await secondWritten.promise;
    await new Promise<undefined>((resolve) => {
      setImmediate(() => {
        resolve(undefined);
      });
    });

    try {
      expect(onWake).toHaveBeenCalledWith(ShardIndex.single());
      expect(batchSettled).toBe(false);
      expect(await delivery.inbox.read(ShardIndex.single())).toMatchObject([
        { signalId: "signal-second" },
      ]);
    } finally {
      releaseFirstWrite.resolve(undefined);
      const [, messages] = await Promise.all([first, batch]);
      expect(messages.map((message) => message.signalId)).toEqual([
        "signal-first",
        "signal-second",
      ]);
    }
  });

  it("rejects a saved Entity inbox row after its tenant is removed", async () => {
    const failure = new Error("tenant removed");
    let admitted = true;
    const deliverTarget = vi.fn(() => Promise.resolve(undefined));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const inbox = new LocalEntityInbox("Tasks", undefined, () =>
      admitted ? Promise.resolve() : Promise.reject(failure),
    );
    inbox.register({ targetTypeUrl, labels: ["HANDLE_COMMAND"], deliver: deliverTarget });
    const saved = writtenResult(processInput(targetTypeUrl, "saved"), 1n).message;

    await inbox.deliver(saved, tenant("tenant-a"));
    admitted = false;
    await expect(inbox.deliver(saved, tenant("tenant-a"))).rejects.toBe(failure);
    expect(deliverTarget).toHaveBeenCalledOnce();
  });

  it("schedules persisted batch rows before propagating a later write failure", async () => {
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
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        receive: vi
          .fn()
          .mockResolvedValueOnce({ outcome: "WRITTEN", message: persisted })
          .mockRejectedValueOnce(writeFailure),
        readMessage,
      },
      drainMessage,
      close: () => Promise.resolve(),
    } as unknown as Delivery;
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });

    await expect(inbox.receiveAll(delivery, inputs)).rejects.toBe(writeFailure);
    expect(drainMessage).toHaveBeenCalledOnce();
    expect(drainMessage.mock.calls[0]?.[0]).toMatchObject({
      inboxId: { targetId: typedTarget("persisted") },
    });
    expect(readMessage).not.toHaveBeenCalled();
  });

  it("accepts a persisted row before aggregate delivery counts settle", async () => {
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
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        receive: () => Promise.resolve({ outcome: "WRITTEN", message: persisted }),
        readMessage: () => Promise.resolve(undefined),
      },
      drainMessage,
      close: () => Promise.resolve(),
    } as unknown as Delivery;
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("Tasks", readiness);
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });

    await expect(inbox.receive(delivery, input)).resolves.toMatchObject({
      signalId: input.signalId,
    });
    await expect(readiness.close()).resolves.toBeUndefined();
    expect(drainMessage).toHaveBeenCalledTimes(8);
  });

  it("accepts a persisted row despite an unrelated delivery result", async () => {
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const input = processInput(targetTypeUrl, "failed-target");
    const persisted = writtenResult(input, 1n).message;
    const failure = new Error("exact acknowledgement failed");
    const delivery = {
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        receive: () => Promise.resolve({ outcome: "WRITTEN", message: persisted }),
        readMessage: () => Promise.resolve(undefined),
      },
      close: () => Promise.resolve(),
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
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("Tasks", readiness);
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });

    await expect(inbox.receive(delivery, input)).resolves.toMatchObject({
      signalId: input.signalId,
    });
    await expect(readiness.close()).resolves.toBeUndefined();
  });

  it("accepts a batch while a direct target failure leaves unprocessed rows pending", async () => {
    const monitor = vi.fn();
    class ObservingMonitor extends DeliveryMonitor {
      override onReceptionFailure(reception: Parameters<DeliveryMonitor["onReceptionFailure"]>[0]) {
        monitor(reception.error);
        return reception.markDelivered();
      }
    }
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      monitor: new ObservingMonitor(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const drainFailure = new Error("first drain failed");
    const delivered: string[] = [];
    const inbox = new LocalEntityInbox("Tasks");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver(message) {
        delivered.push(targetValue(message));
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
    await expect(delivery.whenIdle()).rejects.toBe(drainFailure);
    expect(delivered).toEqual(["first"]);
    expect(monitor).not.toHaveBeenCalled();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      { signalId: "signal-first", status: "TO_DELIVER" },
      { signalId: "signal-second", status: "TO_DELIVER" },
    ]);
  });

  it("remote supervised Entity single and batch writes notify without local delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, delivery, onWake, true);
    const inbox = new LocalEntityInbox("Tasks", readiness);
    const deliverTarget = vi.fn(() => Promise.resolve(undefined));
    inbox.register({
      targetTypeUrl: TaskSchema.typeName,
      labels: ["HANDLE_COMMAND"],
      deliver: deliverTarget,
    });

    const batch = await inbox.receiveAll(delivery, [
      taskCommandInput("first"),
      taskCommandInput("second"),
    ]);
    const single = await inbox.receive(delivery, taskCommandInput("third"));

    expect(batch).toHaveLength(2);
    expect(single.signalId).toBe("command-third");
    expect(onWake).toHaveBeenCalledTimes(3);
    expect(deliverTarget).not.toHaveBeenCalled();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(3);
  });

  it("accepts a local shared Command after its Inbox write and wakes delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, delivery, onWake, false);
    const inbox = new LocalEntityInbox("Tasks", readiness);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const deliverTarget = vi.fn(async () => {
      entered.resolve(undefined);
      await release.promise;
      return undefined;
    });
    inbox.register({
      targetTypeUrl: TaskSchema.typeName,
      labels: ["HANDLE_COMMAND"],
      deliver: deliverTarget,
    });
    readiness.configureDirect((message) => inbox.deliver(message));

    try {
      const accepted = await inbox.receive(delivery, taskCommandInput("locally-accepted"));
      await entered.promise;

      expect(accepted.signalId).toBe("command-locally-accepted");
      expect(onWake).toHaveBeenCalledExactlyOnceWith(ShardIndex.single());
      expect(deliverTarget).toHaveBeenCalledOnce();
      const closing = readiness.close();
      let closed = false;
      void closing.then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      release.resolve(undefined);
      await closing;
    } finally {
      release.resolve(undefined);
    }
  });

  it("emits readiness after persistence before exact drain settles", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      async deliver() {
        startDelivery();
        await deliveryReleased;
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
    await deliveryStarted;

    expect(ready).toEqual([
      {
        tenantId: tenant("tenant-a"),
        label: "HANDLE_COMMAND",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    releaseDelivery();
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
    const delivery = {
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: { receive },
    } as unknown as Delivery;
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      labels: ["REACT_UPON_EVENT"],
      deliver: () => Promise.resolve(undefined),
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
      deliver: () => Promise.resolve(undefined),
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

  it("isolates readiness observer failure from every batch write and recipient", async () => {
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
      deliver(message) {
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
    await delivery.whenIdle();
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
      deliver: () => Promise.resolve(undefined),
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
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
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
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
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

  it("notifies all persisted batch rows before a later processing failure", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const drainFailure = new Error("batch delivery failed");
    const ready: unknown[] = [];
    const inbox = new LocalEntityInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver: () => Promise.reject(drainFailure),
    });

    const accepted = await inbox.receiveAll(
      delivery,
      ["first", "second"].map((targetId) => ({
        inboxId: { targetId: typedTarget(targetId), targetTypeUrl },
        signalId: "event-drain-failure",
        signal: eventSignal(),
        label: "REACT_UPON_EVENT" as const,
        status: "TO_DELIVER" as const,
        shard: ShardIndex.single(),
      })),
    );

    expect(accepted).toHaveLength(2);
    expect(ready).toHaveLength(2);
    await expect(delivery.whenIdle()).rejects.toBe(drainFailure);
  });
  it("delivers and cleans eligible durable command and event rows through a delivery loop endpoint", async () => {
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
      deliver(message) {
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: { targetId: typedTarget("pm-event"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:01.000Z")),
      version: 2n,
    });

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      onMessage: (message) => inbox.deliver(message),
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

  it("acknowledges a recovered command before its same-shard event recipient completes", async () => {
    const delivery = new Delivery({
      context: { name: "RecoveredFollowUp", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("RecoveredFollowUp");
    const shard = ShardIndex.single();
    const commandTypeUrl = "type.example.dev/Tasks.Aggregate";
    const eventTypeUrl = "type.example.dev/Tasks.Projection";
    const recipientEntered = Promise.withResolvers<undefined>();
    const recipientReleased = Promise.withResolvers<undefined>();
    const publicationAttempted = Promise.withResolvers<undefined>();
    const seen: string[] = [];
    let publicationCommits = 0;
    let recipientCommits = 0;
    const validate = vi.spyOn(ShardedWorkRegistry.prototype, "validateOwnership");
    const pickUp = vi.spyOn(ShardedWorkRegistry.prototype, "pickUp");
    inbox.register({
      targetTypeUrl: commandTypeUrl,
      labels: ["HANDLE_COMMAND"],
      async deliver(message) {
        seen.push(message.signalId);
        await commitFenced({}, () => ({ status: "committed" }));
        await withoutDeliveryCommitFence(async () => {
          const priorValidations = validate.mock.calls.length;
          try {
            await commitFenced({}, () => {
              publicationCommits += 1;
              return { status: "committed" };
            });
          } finally {
            publicationAttempted.resolve(undefined);
          }
          expect(validate.mock.calls.length).toBe(priorValidations);
          await inbox.receive(delivery, {
            inboxId: { targetId: typedTarget("recipient"), targetTypeUrl: eventTypeUrl },
            signalId: "event-from-recovered-command",
            signal: eventSignal(),
            label: "REACT_UPON_EVENT",
            status: "TO_DELIVER",
          });
        });
      },
    });
    inbox.register({
      targetTypeUrl: eventTypeUrl,
      labels: ["REACT_UPON_EVENT"],
      async deliver(message) {
        seen.push(message.signalId);
        const priorValidations = validate.mock.calls.length;
        await commitFenced({}, () => {
          recipientCommits += 1;
          return { status: "committed" };
        });
        expect(validate.mock.calls.length).toBeGreaterThan(priorValidations);
        recipientEntered.resolve(undefined);
        await recipientReleased.promise;
      },
    });
    const source = await delivery.inbox.receive({
      ...processInput(commandTypeUrl, "recovered"),
      shard,
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
      keepUntil: new Date("2100-01-01T00:00:00.000Z"),
    });

    const loop = new DeliveryLoop({
      delivery,
      shard,
      onMessage: (message) => inbox.deliver(message),
    }).run();
    let idle: Promise<void> | undefined;
    let followUpSettled = false;
    let assertionFailure: unknown;
    let assertionFailed = false;
    let cleanup: PromiseSettledResult<unknown>[] = [];
    try {
      await Promise.race([
        publicationAttempted.promise,
        loop.then(() => {
          throw new Error("Recovered source settled without publication attempt.");
        }),
      ]);
      expect(publicationCommits).toBe(1);
      await Promise.race([
        recipientEntered.promise,
        loop.then(() => {
          throw new Error("Recovered source settled without recipient delivery.");
        }),
      ]);
      idle = delivery.whenIdle().then(() => {
        followUpSettled = true;
      });
      expect(seen).toEqual(["signal-recovered", "event-from-recovered-command"]);
      expect(pickUp).toHaveBeenCalledOnce();
      expect(recipientCommits).toBe(1);
      await expect(delivery.inbox.readMessage(source.message.id)).resolves.toMatchObject({
        signalId: "signal-recovered",
        status: "DELIVERED",
      });
      await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject(
        [{ signalId: "event-from-recovered-command" }],
      );
      expect(followUpSettled).toBe(false);
    } catch (error) {
      assertionFailure = error;
      assertionFailed = true;
    } finally {
      recipientReleased.resolve(undefined);
      cleanup = await Promise.allSettled([loop, idle ?? delivery.whenIdle()]);
      validate.mockRestore();
      pickUp.mockRestore();
    }
    const failures: unknown[] = [];
    for (const result of cleanup)
      if (result.status === "rejected") failures.push(result.reason as unknown);
    if (assertionFailed) failures.unshift(assertionFailure);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Delivery regression failed.");
    expect(followUpSettled).toBe(true);
    await delivery.whenIdle();
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
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
      deliver(message) {
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

    await delivery.whenIdle();

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
    await delivery.whenIdle();
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
      deliver: () => Promise.resolve(undefined),
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
    await delivery.whenIdle();
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
      deliver: () => Promise.resolve(undefined),
    });

    const received = await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-protected"), targetTypeUrl },
      signalId: "signal-protected",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      keepUntil,
    });

    await delivery.whenIdle();

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
      deliver(message) {
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

    await delivery.whenIdle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "event-1",
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
    });
    await delivery.whenIdle();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("accepts a concurrent duplicate while its Command handler remains active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let followUps = 0;
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
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
      async deliver(message) {
        seen.push(message);
        startDelivery();
        await deliveryReleased;
        followUps++;
      },
    });

    const firstMessage = await inbox.receive(delivery, input);
    await deliveryStarted;
    const duplicateMessage = await inbox.receive(delivery, input);
    expect(duplicateMessage.id).not.toEqual(firstMessage.id);
    expect(seen).toHaveLength(1);
    expect(followUps).toBe(0);
    releaseDelivery();
    await delivery.whenIdle();
    expect(seen).toHaveLength(1);
    expect(followUps).toBe(1);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("accepts a duplicate multi-target Event batch while a handler remains active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
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
      async deliver(message) {
        seen.push(message);
        startDelivery();
        await deliveryReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const firstMessages = await inbox.receiveAll(delivery, inputs);
    await deliveryStarted;
    const duplicateMessages = await inbox.receiveAll(delivery, inputs);

    try {
      expect(duplicateMessages.map(({ id }) => id)).not.toEqual(firstMessages.map(({ id }) => id));
      expect(seen.map(targetValue)).toEqual(["pm-first"]);
    } finally {
      releaseDelivery();
    }
    await delivery.whenIdle();
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("accepts a duplicate single row while its batch handler remains active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
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
      async deliver(message) {
        seen.push(message);
        startDelivery();
        await deliveryReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const batchMessages = await inbox.receiveAll(delivery, inputs);
    await deliveryStarted;
    const duplicateMessage = await inbox.receive(delivery, secondInput);

    try {
      expect(duplicateMessage.id).not.toEqual(batchMessages[1]?.id);
      expect(seen.map(targetValue)).toEqual(["pm-first"]);
    } finally {
      releaseDelivery();
    }
    await delivery.whenIdle();
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("accepts a duplicate batch row while its single-row handler remains active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const firstTypeUrl = "type.example.dev/Tasks.FirstProcessManager";
    const secondTypeUrl = "type.example.dev/Tasks.SecondProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
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
      async deliver(message) {
        seen.push(message);
        startDelivery();
        await deliveryReleased;
      },
    });
    inbox.register({
      targetTypeUrl: secondTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });

    const singleMessage = await inbox.receive(delivery, firstInput);
    await deliveryStarted;
    const batchMessages = await inbox.receiveAll(delivery, inputs);

    try {
      expect(batchMessages[0]?.id).not.toEqual(singleMessage.id);
      expect(seen.map(targetValue)).toEqual(["pm-first"]);
    } finally {
      releaseDelivery();
    }
    await delivery.whenIdle();
    expect(seen.map(targetValue)).toEqual(["pm-first", "pm-second"]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("stores optional signal and keepUntil while scheduled rows do not delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("Tasks", readiness);
    readiness.configureDirect((message) => inbox.deliver(message));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const earlierSignal = commandSignal();
    const laterSignal = commandSignal();
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
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
    ).resolves.toMatchObject({ signalId: "signal-1", status: "SCHEDULED" });

    await delivery.whenIdle();
    expect(seen).toHaveLength(0);
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });
    const delivered = await delivery.inbox.read(shard, { statuses: ["DELIVERED"] });
    const scheduled = await delivery.inbox.read(shard, { statuses: ["SCHEDULED"] });

    expect(pending).toMatchObject([{ signalId: "signal-0" }]);
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
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("Tasks", readiness);
    readiness.configureDirect((message) => inbox.deliver(message));
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const unrelatedProcessManagerTypeUrl = "type.example.dev/Tasks.OtherProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const unrelatedSeen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
        seen.push(message);
        return Promise.resolve(undefined);
      },
    });
    inbox.register({
      targetTypeUrl: unrelatedProcessManagerTypeUrl,
      labels: processManagerLabels,
      deliver(message) {
        unrelatedSeen.push(message);
        return Promise.resolve(undefined);
      },
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:01.000Z")),
      version: 1n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: typedTarget("pm-1"), targetTypeUrl },
      signalId: "signal-1",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });

    await delivery.whenIdle();
    expect(seen).toHaveLength(1);
    expect(unrelatedSeen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("publishes a recovered direct-backlog command to a same-shard recipient", async () => {
    const delivery = new Delivery({
      context: { name: "DirectBacklogFollowUp", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const readiness = new DeliveryReadiness();
    const inbox = new LocalEntityInbox("DirectBacklogFollowUp", readiness);
    readiness.configureDirect((message) => inbox.deliver(message));
    const sourceTypeUrl = "type.example.dev/Tasks.BacklogAggregate";
    const triggerTypeUrl = "type.example.dev/Tasks.TriggerAggregate";
    const recipientTypeUrl = "type.example.dev/Tasks.BacklogProjection";
    const seen: string[] = [];
    inbox.register({
      targetTypeUrl: sourceTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver() {
        return inbox
          .receive(delivery, {
            inboxId: { targetId: typedTarget("recipient"), targetTypeUrl: recipientTypeUrl },
            signalId: "backlog-event",
            signal: eventSignal(),
            label: "REACT_UPON_EVENT",
            status: "TO_DELIVER",
          })
          .then(() => undefined);
      },
    });
    inbox.register({
      targetTypeUrl: triggerTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.resolve(undefined),
    });
    inbox.register({
      targetTypeUrl: recipientTypeUrl,
      labels: ["REACT_UPON_EVENT"],
      deliver(message) {
        seen.push(message.signalId);
        return Promise.resolve(undefined);
      },
    });
    await delivery.inbox.receive({
      ...processInput(sourceTypeUrl, "backlog"),
      shard: ShardIndex.single(),
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
    });

    await inbox.receive(delivery, processInput(triggerTypeUrl, "trigger"));
    await delivery.whenIdle();
    await delivery.whenIdle();
    expect(seen).toEqual(["backlog-event"]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("propagates an Error reception failure and retains the pending row", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver() {
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
    ).resolves.toMatchObject({ signalId: "signal-2" });
    await expect(delivery.whenIdle()).rejects.toThrow("target failed");
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-2", status: "TO_DELIVER" }]);
  });

  it("reports a primitive delivery failure and retains the pending row", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const reason = "not-an-error";

    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver() {
        // The primitive rejection is intentional: the delivery result retains the original value.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
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
    ).resolves.toMatchObject({ signalId: "signal-3" });
    await expect(delivery.whenIdle()).rejects.toBe(reason);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-3", status: "TO_DELIVER" }]);
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
      deliver: () => Promise.resolve(undefined),
    });
    const session = await delivery.shards.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "other-node" }, value: "worker-1" }),
    );
    if (session === undefined) {
      throw new Error("Expected to claim the shard before inbox delivery.");
    }

    try {
      await expect(inbox.receive(delivery, input)).resolves.toMatchObject({ signalId: "signal-4" });
    } finally {
      await delivery.shards.release(session);
    }

    await expect(inbox.receive(delivery, input)).resolves.toBeDefined();
    await delivery.whenIdle();

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
      deliver() {
        return Promise.reject(new Error("scheduled rows should not delivery"));
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
    ).resolves.toMatchObject({ signalId: "signal-5", status: "SCHEDULED" });
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

  it("rejects an unsupported inbox label and retains the pending row", async () => {
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
      deliver() {
        return Promise.reject(new Error("unexpected delivery"));
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
    ).resolves.toMatchObject({ signalId: "signal-6" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-6", status: "TO_DELIVER" }]);
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
    const deliveryFailure = new Error("unconfigured event label should not delivery");
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver: () => Promise.reject(deliveryFailure),
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-label-mismatch"), targetTypeUrl },
        signalId: "event-label-mismatch",
        signal: eventSignal(),
        label: "REACT_UPON_EVENT",
        status: "TO_DELIVER",
      }),
    ).resolves.toMatchObject({ signalId: "event-label-mismatch" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "event-label-mismatch", status: "TO_DELIVER" }]);
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
    const deliveryFailure = new Error("non-configured shard should preserve drain failure");
    inbox.register({
      targetTypeUrl,
      labels: processManagerLabels,
      deliver: () => Promise.reject(deliveryFailure),
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: typedTarget("pm-shard-mismatch"), targetTypeUrl },
        signalId: "command-shard-mismatch",
        signal: commandSignal(),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      }),
    ).resolves.toMatchObject({ signalId: "command-shard-mismatch" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "command-shard-mismatch", status: "TO_DELIVER" }]);
    expect(ready).toMatchObject([{ label: "HANDLE_COMMAND", targetTypeUrl }]);
  });

  it("rejects a missing process-manager target and retains the pending row", async () => {
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
    ).resolves.toMatchObject({ signalId: "signal-7" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal-7", status: "TO_DELIVER" }]);
    expect(ready).toEqual([]);
  });

  it("accepts later same-scope rows while the first handler remains active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const firstStarted = Promise.withResolvers<undefined>();
    const releaseFirst = Promise.withResolvers<undefined>();
    const delivered: string[] = [];
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      async deliver(message) {
        const targetId = targetValue(message);
        delivered.push(targetId);
        if (targetId === "first") {
          firstStarted.resolve(undefined);
          await releaseFirst.promise;
        }
      },
    });

    await inbox.receive(delivery, processInput(targetTypeUrl, "first"));
    await firstStarted.promise;
    await expect(
      inbox.receive(delivery, processInput(targetTypeUrl, "second")),
    ).resolves.toBeDefined();
    await expect(
      inbox.receive(delivery, processInput(targetTypeUrl, "later")),
    ).resolves.toBeDefined();
    expect(delivered).toEqual(["first"]);
    releaseFirst.resolve(undefined);
    await delivery.whenIdle();
    expect(delivered).toEqual(["first", "second", "later"]);
  });

  it("delivers both initial publications from one shard batch", async () => {
    const delivery = new Delivery({
      context: { name: "FollowUpBatch", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      pageSize: 2,
    });
    const inbox = new LocalEntityInbox("FollowUpBatch");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const published: string[] = [];
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver(message) {
        published.push(message.signalId);
        return Promise.resolve();
      },
    });
    await inbox.receiveAll(delivery, [
      processInput(targetTypeUrl, "first"),
      processInput(targetTypeUrl, "second"),
    ]);
    await delivery.whenIdle();
    expect(published).toEqual(["signal-first", "signal-second"]);
  });

  it("attempts a new row after an earlier handler fails and retains the failed batch", async () => {
    const delivery = new Delivery({
      context: { name: "FollowUpFailure", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      pageSize: 2,
    });
    const inbox = new LocalEntityInbox("FollowUpFailure");
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const attempted: string[] = [];
    let unavailable = true;
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      deliver(message) {
        attempted.push(message.signalId);
        return message.signalId === "signal-first" && unavailable
          ? Promise.reject(new Error("first publication unavailable"))
          : Promise.resolve();
      },
    });
    await inbox.receiveAll(delivery, [
      processInput(targetTypeUrl, "first"),
      processInput(targetTypeUrl, "second"),
    ]);
    await expect(delivery.whenIdle()).rejects.toThrow("first publication unavailable");
    expect(attempted).toEqual(["signal-first"]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(2);
    unavailable = false;
    await inbox.receive(delivery, processInput(targetTypeUrl, "later"));
    await delivery.whenIdle();
    expect(attempted).toEqual(["signal-first", "signal-later"]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(2);
  });

  it("accepts a different tenant and shard while one handler remains active", async () => {
    const strategy = twoShardStrategy();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalEntityInbox("Tasks", undefined, undefined, strategy);
    const targetTypeUrl = "type.example.dev/Tasks.Aggregate";
    const entered = Promise.withResolvers<undefined>();
    const gate = Promise.withResolvers<undefined>();
    const delivered: string[] = [];
    inbox.register({
      targetTypeUrl,
      labels: ["HANDLE_COMMAND"],
      async deliver(message) {
        const targetId = targetValue(message);
        delivered.push(targetId);
        if (targetId === "even") {
          entered.resolve(undefined);
          await gate.promise;
        }
      },
    });

    await inbox.receive(delivery, processInput(targetTypeUrl, "even"), tenant("tenant-a"));
    await entered.promise;
    await expect(
      inbox.receive(delivery, processInput(targetTypeUrl, "odd"), tenant("tenant-b")),
    ).resolves.toMatchObject({ shard: { index: 1, ofTotal: 2 } });
    gate.resolve(undefined);
    await delivery.whenIdle();
    expect(delivered).toEqual(["even", "odd"]);
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
      deliver: () => Promise.resolve(undefined),
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

function taskCommandInput(id: string): ReceiveInput {
  const taskId = create(TaskIdSchema, { value: id });
  return {
    inboxId: { targetId: AnyPacker.pack(TaskIdSchema, taskId), targetTypeUrl: TaskSchema.typeName },
    signalId: `command-${id}`,
    signal: AnyPacker.pack(
      CommandSchema,
      create(CommandSchema, {
        id: create(CommandIdSchema, { uuid: `command-${id}` }),
        context: create(CommandContextSchema, {
          actorContext: create(ActorContextSchema, {
            actor: create(UserIdSchema, { value: "remote-test-user" }),
          }),
        }),
        message: AnyPacker.pack(
          CreateTaskSchema,
          create(CreateTaskSchema, {
            id: taskId,
            taskListId: create(TaskListIdSchema, { value: "remote-test-list" }),
            title: `Task ${id}`,
          }),
        ),
      }),
    ),
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
  };
}

function commandSignal() {
  return AnyPacker.pack(CommandSchema, create(CommandSchema));
}

function eventSignal() {
  return AnyPacker.pack(EventSchema, create(EventSchema));
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
      whenReceived: timestampFromDate(new Date("2026-07-12T09:00:00.000Z")),
      version,
    },
  };
}
