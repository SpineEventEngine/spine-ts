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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { Identifiers } from "@spine-event-engine/core";
import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import type { ProjectionInbox, ProjectionInboxTarget } from "../../src/repository/repository.js";
import { ShardIndex, type InboxMessage } from "../../src/index.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { LocalProjectionInbox } from "../../src/context/projection-handoff.js";
import { tenant } from "../tenant-fixture.js";

describe("LocalProjectionInbox", () => {
  it("keeps a multitenant descriptor tenant before inbox persistence", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-dynamic") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const kept = Promise.withResolvers<undefined>();
    const keep = vi.fn(() => kept.promise);
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const inbox = new LocalProjectionInbox("Tasks", undefined, keep);
    inbox.register({ targetTypeUrl, replay: () => Promise.resolve() });

    const receiving = inbox.receive(
      delivery,
      projectionInput(targetTypeUrl, "dynamic"),
      tenant("tenant-dynamic"),
    );
    await Promise.resolve();

    expect(keep).toHaveBeenCalledExactlyOnceWith(tenant("tenant-dynamic"));
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);

    kept.resolve(undefined);
    await receiving;
  });

  it("settles persisted rows after ownership transfer", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const readiness = new DeliveryReadiness();
    const inbox = new LocalProjectionInbox("Tasks", readiness);
    const replayStarted = Promise.withResolvers<undefined>();
    const releaseReplay = Promise.withResolvers<undefined>();
    const replayed: string[] = [];
    const routed: unknown[] = [];
    inbox.register({
      targetTypeUrl,
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
      projectionInput(targetTypeUrl, "admitted"),
      tenant("tenant-a"),
    );
    await replayStarted.promise;
    const transition = readiness.transition(
      [
        {
          tenantId: tenant("tenant-b"),
          label: "UPDATE_SUBSCRIBER",
          targetTypeUrl,
          shard: ShardIndex.single(),
        },
      ],
      (scope) => routed.push(scope),
    );

    await expect(
      inbox.receive(delivery, projectionInput(targetTypeUrl, "buffered"), tenant("tenant-a")),
    ).resolves.toBeDefined();
    expect(replayed).toEqual(["admitted"]);
    expect(routed).toEqual([]);

    releaseReplay.resolve(undefined);
    await admitted;
    await expect(transition).rejects.toThrow(
      "Delivery readiness transition received an unconfigured scope.",
    );
    expect(routed).toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
    const delivered = await delivery.inbox.read(ShardIndex.single(), {
      statuses: ["DELIVERED"],
    });
    expect(delivered).toEqual([]);

    await expect(
      inbox.receive(delivery, projectionInput(targetTypeUrl, "routed"), tenant("tenant-a")),
    ).resolves.toBeDefined();
    expect(replayed).toEqual(["admitted", "buffered"]);
    expect(routed).toEqual([]);

    await expect(
      readiness.transition(
        [
          {
            tenantId: tenant("tenant-a"),
            label: "UPDATE_SUBSCRIBER",
            targetTypeUrl,
            shard: ShardIndex.single(),
          },
        ],
        (scope) => routed.push(scope),
      ),
    ).resolves.toBeUndefined();
    expect(routed).toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ inboxId: { targetId: Identifiers.pack("string", "routed") } }]);

    const recovery = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      onMessage: (message) => inbox.replay(message, tenant("tenant-a")),
    }).run();
    expect(recovery.delivered).toBe(1);
    expect(replayed).toEqual(["admitted", "buffered", "routed"]);
  });

  it("matches receive readiness without rebuilding the global endpoint snapshot", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const ready: unknown[] = [];
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      replay: () => Promise.resolve(),
    });
    const endpoints = vi.spyOn(inbox, "endpoints");

    await inbox.receive(
      delivery,
      {
        inboxId: { targetId: Identifiers.pack("string", "projection-ready"), targetTypeUrl },
        signalId: "event-ready",
        signal: eventSignal(),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      },
      tenant("tenant-a"),
    );

    expect(endpoints).not.toHaveBeenCalled();
    expect(ready).toEqual([
      {
        tenantId: tenant("tenant-a"),
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl,
        shard: { index: 0, ofTotal: 1 },
      },
    ]);
  });

  it("preserves exact-drain failure when the readiness observer also throws", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const drainFailure = new Error("projection replay failed");
    let notifications = 0;
    const inbox = new LocalProjectionInbox("Tasks", () => {
      notifications += 1;
      throw new Error("observer failed");
    });
    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(drainFailure);
      },
    });

    const result = await inbox
      .receive(delivery, {
        inboxId: { targetId: Identifiers.pack("string", "projection-ready"), targetTypeUrl },
        signalId: "event-ready",
        signal: eventSignal(),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(result).toBeUndefined();
    expect(notifications).toBe(1);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });
  it("narrows replay targets to pending subscriber updates", () => {
    type ReplayMessage = Parameters<ProjectionInboxTarget["replay"]>[0];

    expectTypeOf<ReplayMessage["label"]>().toEqualTypeOf<"UPDATE_SUBSCRIBER">();
    expectTypeOf<ReplayMessage["status"]>().toEqualTypeOf<"TO_DELIVER">();
  });

  it("replays and cleans eligible durable subscriber rows through a delivery loop endpoint", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    await delivery.inbox.receive({
      inboxId: { targetId: Identifiers.pack("string", "projection-1"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      onMessage: (message) => inbox.replay(message),
    }).run();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });
    expect(run).toMatchObject({
      status: "IDLE",
      processed: 1,
      delivered: 1,
      failed: 0,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("delivers an UPDATE_SUBSCRIBER event row and marks it delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const signal = eventSignal();
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    const delivered = await inbox.receive(delivery, {
      inboxId: { targetId: Identifiers.pack("string", "projection-1"), targetTypeUrl },
      signalId: "event-1",
      signal,
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
    });

    expect(seen).toHaveLength(1);
    expect(delivered).toMatchObject({
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });

  it("rejects non-pending replay snapshots before projection handlers run", async () => {
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    for (const status of ["DELIVERED", "SCHEDULED", "TO_CATCH_UP"] as const) {
      await expect(
        inbox.replay({
          id: {
            value: `message-${status}`,
            shard: ShardIndex.single(),
          },
          inboxId: {
            targetId: Identifiers.pack("string", `projection-${status}`),
            targetTypeUrl,
          },
          signalId: `event-${status}`,
          signal: eventSignal(),
          label: "UPDATE_SUBSCRIBER",
          status,
          shard: ShardIndex.single(),
          whenReceived: new Date("2026-07-08T09:00:00.000Z"),
          version: 1n,
        }),
      ).rejects.toThrow(
        `BoundedContext delivery cannot replay projection inbox message with status "${status}".`,
      );
    }

    expect(seen).toEqual([]);
  });

  it("waits for a concurrent duplicate while the original projection replay is in flight", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
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
      inboxId: { targetId: Identifiers.pack("string", "projection-duplicate"), targetTypeUrl },
      signalId: "event-duplicate",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER" as const,
      status: "TO_DELIVER" as const,
      shard,
    };

    inbox.register({
      targetTypeUrl,
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

  it("contains a fresh-delivery duplicate replay failure", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const firstDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const duplicateDelivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const shard = ShardIndex.single();
    const failure = new Error("projection replay failed");
    let startReplay!: () => void;
    let releaseReplay!: () => void;
    const replayStarted = new Promise<void>((resolve) => {
      startReplay = resolve;
    });
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const input = {
      inboxId: {
        targetId: Identifiers.pack("string", "projection-failing-duplicate"),
        targetTypeUrl,
      },
      signalId: "event-failing-duplicate",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER" as const,
      status: "TO_DELIVER" as const,
      shard,
    };

    inbox.register({
      targetTypeUrl,
      async replay() {
        startReplay();
        await replayReleased;
        throw failure;
      },
    });

    const first = inbox.receive(firstDelivery, input);
    const firstResult = first.then(
      () => undefined,
      (error: unknown) => error,
    );
    await replayStarted;

    const duplicate = inbox.receive(duplicateDelivery, input);
    const duplicateResult = duplicate.then(
      () => undefined,
      (error: unknown) => error,
    );

    await pause(150);
    releaseReplay();

    await expect(firstResult).resolves.toBeUndefined();
    await expect(duplicateResult).resolves.toBeUndefined();
    await expect(firstDelivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual(
      [],
    );
    await expect(firstDelivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("persists a valid non-projection label without readiness", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.Projection";

    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(new Error("unexpected replay"));
      },
    });

    await expect(
      inbox.receive(
        delivery,
        asRuntimeInvalidProjectionInput({
          inboxId: { targetId: Identifiers.pack("string", "projection-2"), targetTypeUrl },
          signalId: "event-2",
          signal: commandSignal(),
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
          shard: ShardIndex.single(),
        }),
      ),
    ).resolves.toMatchObject({ label: "HANDLE_COMMAND" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
    expect(ready).toEqual([]);
  });

  it("emits no readiness for a persisted scheduled subscriber row", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      replay: () => Promise.reject(new Error("scheduled rows should not replay")),
    });

    await expect(
      inbox.receive(
        delivery,
        asRuntimeInvalidProjectionInput({
          inboxId: { targetId: Identifiers.pack("string", "projection-scheduled"), targetTypeUrl },
          signalId: "event-scheduled",
          signal: eventSignal(),
          label: "UPDATE_SUBSCRIBER",
          status: "SCHEDULED",
          shard: ShardIndex.single(),
        }),
      ),
    ).rejects.toThrow(
      "Projection inbox delivery did not reach the target row before the local drain finished.",
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["SCHEDULED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-scheduled",
        label: "UPDATE_SUBSCRIBER",
        status: "SCHEDULED",
      },
    ]);
    expect(ready).toEqual([]);
  });

  it("emits no readiness for a persisted row without a registered projection target", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const targetTypeUrl = "type.example.dev/Tasks.MissingProjection";
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: Identifiers.pack("string", "projection-missing"), targetTypeUrl },
        signalId: "event-missing",
        signal: eventSignal(),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).resolves.toMatchObject({ label: "UPDATE_SUBSCRIBER" });
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
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const shard = new ShardIndex(0, 2);
    const replayFailure = new Error("non-configured shard should preserve drain failure");
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));
    inbox.register({
      targetTypeUrl,
      replay: () => Promise.reject(replayFailure),
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: {
          targetId: Identifiers.pack("string", "projection-shard-mismatch"),
          targetTypeUrl,
        },
        signalId: "event-shard-mismatch",
        signal: eventSignal(),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard,
      }),
    ).resolves.toMatchObject({ label: "UPDATE_SUBSCRIBER" });
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
    expect(ready).toEqual([]);
  });

  it("delivers only the received row when unrelated backlog is pending first", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const unrelatedProjectionTypeUrl = "type.example.dev/Tasks.OtherProjection";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const unrelatedSeen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });
    inbox.register({
      targetTypeUrl: unrelatedProjectionTypeUrl,
      replay(message) {
        unrelatedSeen.push(message);
        return Promise.reject(new Error("unrelated projection should not replay"));
      },
    });

    await delivery.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", "pm-0"),
        targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
      },
      signalId: "signal-0",
      signal: commandSignal(),
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", "projection-0"),
        targetTypeUrl: unrelatedProjectionTypeUrl,
      },
      signalId: "event-0",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:01.000Z"),
      version: 2n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: Identifiers.pack("string", "projection-1"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
    });

    expect(seen).toHaveLength(1);
    expect(unrelatedSeen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });
});

function projectionInput(targetTypeUrl: string, targetId: string) {
  return {
    inboxId: { targetId: Identifiers.pack("string", targetId), targetTypeUrl },
    signalId: `event-${targetId}`,
    signal: eventSignal(),
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
  };
}

function targetValue(message: Pick<InboxMessage, "inboxId">): string {
  const value = Identifiers.unpack("string", message.inboxId.targetId);
  if (value === undefined) throw new Error("Expected a string Inbox target fixture.");
  return value;
}

function eventSignal() {
  return create(AnySchema, {
    typeUrl: "type.spine.io/spine.core.Event",
    value: toBinary(EventSchema, create(EventSchema)),
  });
}

function commandSignal() {
  return create(AnySchema, {
    typeUrl: "type.spine.io/spine.core.Command",
    value: toBinary(CommandSchema, create(CommandSchema)),
  });
}

type ProjectionReceiveInput = Parameters<ProjectionInbox["receive"]>[1];
function asRuntimeInvalidProjectionInput(input: unknown): ProjectionReceiveInput {
  // Intentionally bypasses the narrow projection input type for runtime fail-closed coverage.
  return input as ProjectionReceiveInput;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
