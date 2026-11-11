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
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers, SignalEnvelopes, TypeUrls } from "@spine-event-engine/core";
import { CommandSchema, EventContextSchema, EventSchema } from "@spine-event-engine/proto";
import { ProjectCreatedSchema } from "../../test-fixtures/generated/entity-metadata/project_events_pb.js";
import {
  ProjectOverviewStateSchema,
  PublishedProjectStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import type { ProjectionInbox, ProjectionInboxTarget } from "../../src/repository/repository.js";
import { ShardIndex, type InboxMessage } from "../../src/index.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { LocalProjectionInbox } from "../../src/context/projection-handoff.js";
import type { DeliveryStrategy } from "../../src/delivery/delivery-builder.js";
import { tenant } from "../tenant-fixture.js";

describe("LocalProjectionInbox", () => {
  it("stores and advertises a routed Projection on its configured shard", async () => {
    const delivery = new Delivery({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = TypeUrls.derive(ProjectOverviewStateSchema);
    const targetId = Identifiers.pack("string", "project-routed");
    const strategy: DeliveryStrategy = {
      shardCount: 3,
      shardFor(id, type) {
        expect(id).toEqual(targetId);
        expect(type).toBe(targetTypeUrl);
        return new ShardIndex(2, 3);
      },
    };
    const ready: unknown[] = [];
    const inbox = new LocalProjectionInbox(
      "Projects",
      (scope) => ready.push(scope),
      undefined,
      strategy,
    );
    inbox.register({ targetTypeUrl, deliver: () => Promise.resolve() });

    const message = await inbox.receive(delivery, {
      inboxId: { targetId, targetTypeUrl },
      signalId: "project-routed-event",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });

    expect(message.shard).toEqual(new ShardIndex(2, 3));
    expect(inbox.endpoints()).toEqual(
      [0, 1, 2].map((index) => ({
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl,
        shard: { index, ofTotal: 3 },
      })),
    );
    expect(ready).toEqual([
      { label: "UPDATE_SUBSCRIBER", targetTypeUrl, shard: { index: 2, ofTotal: 3 } },
    ]);
  });

  it("rejects a saved Projection row whose shard differs from its routed target", async () => {
    const targetTypeUrl = TypeUrls.derive(ProjectOverviewStateSchema);
    const targetId = Identifiers.pack("string", "project-mismatch");
    const strategy: DeliveryStrategy = {
      shardCount: 3,
      shardFor: () => new ShardIndex(2, 3),
    };
    const deliverTarget = vi.fn(() => Promise.resolve());
    const inbox = new LocalProjectionInbox("Projects", undefined, undefined, strategy);
    inbox.register({ targetTypeUrl, deliver: deliverTarget });
    const saved: InboxMessage = {
      id: { value: "row-mismatch", shard: new ShardIndex(1, 3) },
      inboxId: { targetId, targetTypeUrl },
      signalId: "project-mismatch-event",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: new ShardIndex(1, 3),
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
    };

    for (const shard of [new ShardIndex(1, 3), new ShardIndex(2, 4)]) {
      await expect(inbox.deliver({ ...saved, id: { ...saved.id, shard }, shard })).rejects.toThrow(
        "Projection Inbox delivery stored shard does not match the routed target.",
      );
    }
    expect(deliverTarget).not.toHaveBeenCalled();

    const matchingShard = new ShardIndex(2, 3);
    await inbox.deliver({
      ...saved,
      id: { ...saved.id, shard: matchingShard },
      shard: matchingShard,
    });
    expect(deliverTarget).toHaveBeenCalledOnce();
  });

  it("selects different configured shards for two Projection state types", async () => {
    const delivery = new Delivery({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const overviewType = TypeUrls.derive(ProjectOverviewStateSchema);
    const publishedType = TypeUrls.derive(PublishedProjectStateSchema);
    const strategy: DeliveryStrategy = {
      shardCount: 8,
      shardFor(_id, type) {
        return new ShardIndex(type === overviewType ? 6 : 7, 8);
      },
    };
    const inbox = new LocalProjectionInbox("Projects", undefined, undefined, strategy);
    inbox.register({ targetTypeUrl: overviewType, deliver: () => Promise.resolve() });
    inbox.register({ targetTypeUrl: publishedType, deliver: () => Promise.resolve() });
    const event = SignalEnvelopes.event({
      context: create(EventContextSchema),
      schema: ProjectCreatedSchema,
      message: create(ProjectCreatedSchema, { id: "project-types", name: "Types" }),
    });

    const rows = await Promise.all(
      [overviewType, publishedType].map((targetTypeUrl) =>
        inbox.receive(delivery, {
          inboxId: { targetId: Identifiers.pack("string", "project-types"), targetTypeUrl },
          signalId: event.id?.value ?? "",
          signal: AnyPacker.pack(EventSchema, event),
          label: "UPDATE_SUBSCRIBER",
          status: "TO_DELIVER",
        }),
      ),
    );

    expect(rows.map((row) => row.shard)).toEqual([new ShardIndex(6, 8), new ShardIndex(7, 8)]);
  });

  it("checks a multitenant descriptor tenant before inbox persistence", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const admitted = Promise.withResolvers<undefined>();
    const onAdmit = vi.fn(() => admitted.promise);
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const inbox = new LocalProjectionInbox("Tasks", undefined, onAdmit);
    inbox.register({ targetTypeUrl, deliver: () => Promise.resolve() });

    const receiving = inbox.receive(
      delivery,
      projectionInput(targetTypeUrl, "dynamic"),
      tenant("tenant-dynamic"),
    );
    await Promise.resolve();

    expect(onAdmit).toHaveBeenCalledExactlyOnceWith(tenant("tenant-dynamic"));
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);

    admitted.resolve(undefined);
    await receiving;
  });

  it("rejects a saved Projection inbox row after its tenant is removed", async () => {
    const failure = new Error("tenant removed");
    let admitted = true;
    const deliverTarget = vi.fn(() => Promise.resolve());
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const inbox = new LocalProjectionInbox("Tasks", undefined, () =>
      admitted ? Promise.resolve() : Promise.reject(failure),
    );
    inbox.register({ targetTypeUrl, deliver: deliverTarget });
    const saved: InboxMessage = {
      ...projectionInput(targetTypeUrl, "saved"),
      id: { value: "row-saved", shard: ShardIndex.single() },
      shard: ShardIndex.single(),
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
    };

    await inbox.deliver(saved, tenant("tenant-a"));
    admitted = false;
    await expect(inbox.deliver(saved, tenant("tenant-a"))).rejects.toBe(failure);
    expect(deliverTarget).toHaveBeenCalledOnce();
  });

  it("remote supervised Projection reception notifies without local dispatch", async () => {
    const delivery = new Delivery({
      context: { name: "ExternalProjects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const wake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, delivery, wake, true);
    const strategy: DeliveryStrategy = {
      shardCount: 3,
      shardFor: () => new ShardIndex(2, 3),
    };
    const inbox = new LocalProjectionInbox("ExternalProjects", readiness, undefined, strategy);
    const deliverTarget = vi.fn(() => Promise.resolve());
    const targetTypeUrl = TypeUrls.derive(ProjectOverviewStateSchema);
    inbox.register({ targetTypeUrl, deliver: deliverTarget });
    const project = create(ProjectCreatedSchema, { id: "project-remote", name: "Remote" });
    const event = SignalEnvelopes.event({
      context: create(EventContextSchema),
      schema: ProjectCreatedSchema,
      message: project,
    });
    const message = await inbox.receive(delivery, {
      inboxId: { targetId: Identifiers.pack("string", project.id), targetTypeUrl },
      signalId: event.id?.value ?? "",
      signal: AnyPacker.pack(EventSchema, event),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });

    expect(message.status).toBe("TO_DELIVER");
    expect(wake).toHaveBeenCalledExactlyOnceWith(new ShardIndex(2, 3));
    expect(deliverTarget).not.toHaveBeenCalled();
    await expect(
      delivery.inbox.read(new ShardIndex(2, 3), { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(1);
  });

  it("accepts a local shared Event after its Projection Inbox write and wakes delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Projects", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const onWake = vi.fn();
    const readiness = new DeliveryReadiness(undefined, delivery, onWake, false);
    const inbox = new LocalProjectionInbox("Projects", readiness);
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const deliverTarget = vi.fn(async () => {
      entered.resolve(undefined);
      await release.promise;
    });
    const targetTypeUrl = TypeUrls.derive(ProjectOverviewStateSchema);
    inbox.register({ targetTypeUrl, deliver: deliverTarget });
    readiness.configureDirect((message) => inbox.deliver(message));
    const event = SignalEnvelopes.event({
      context: create(EventContextSchema),
      schema: ProjectCreatedSchema,
      message: create(ProjectCreatedSchema, { id: "accepted", name: "Accepted" }),
    });

    try {
      const accepted = await inbox.receive(delivery, {
        inboxId: { targetId: Identifiers.pack("string", "accepted"), targetTypeUrl },
        signalId: event.id?.value ?? "",
        signal: AnyPacker.pack(EventSchema, event),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      });
      await entered.promise;

      expect(accepted.status).toBe("TO_DELIVER");
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
      deliver: () => Promise.resolve(),
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

  it("accepts a row when its readiness observer throws before recipient processing fails", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const drainFailure = new Error("projection delivery failed");
    let notifications = 0;
    const inbox = new LocalProjectionInbox("Tasks", () => {
      notifications += 1;
      throw new Error("observer failed");
    });
    inbox.register({
      targetTypeUrl,
      deliver() {
        return Promise.reject(drainFailure);
      },
    });

    const accepted = await inbox.receive(delivery, {
      inboxId: { targetId: Identifiers.pack("string", "projection-ready"), targetTypeUrl },
      signalId: "event-ready",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });

    expect(accepted.signalId).toBe("event-ready");
    expect(notifications).toBe(1);
    await expect(delivery.whenIdle()).rejects.toBe(drainFailure);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toEqual([]);
  });
  it("narrows delivery targets to pending subscriber updates", () => {
    type DeliveryMessage = Parameters<ProjectionInboxTarget["deliver"]>[0];

    expectTypeOf<DeliveryMessage["label"]>().toEqualTypeOf<"UPDATE_SUBSCRIBER">();
    expectTypeOf<DeliveryMessage["status"]>().toEqualTypeOf<"TO_DELIVER">();
  });

  it("delivers and cleans eligible durable subscriber rows through a delivery loop endpoint", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      deliver(message) {
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
      version: 1n,
    });

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      onMessage: (message) => inbox.deliver(message),
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

  it("delivers an UPDATE_SUBSCRIBER event row and clears pending work", async () => {
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
      deliver(message) {
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
    });

    await delivery.whenIdle();

    expect(seen).toHaveLength(1);
    expect(delivered).toMatchObject({
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("rejects non-pending delivery snapshots before projection handlers run", async () => {
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      deliver(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    for (const status of ["DELIVERED", "SCHEDULED", "TO_CATCH_UP"] as const) {
      await expect(
        inbox.deliver({
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
          whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
          version: 1n,
        }),
      ).rejects.toThrow(
        `BoundedContext delivery cannot deliver projection inbox message with status "${status}".`,
      );
    }

    expect(seen).toEqual([]);
  });

  it("accepts a concurrent duplicate while the original Projection handler is active", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
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
    const input = {
      inboxId: { targetId: Identifiers.pack("string", "projection-duplicate"), targetTypeUrl },
      signalId: "event-duplicate",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER" as const,
      status: "TO_DELIVER" as const,
    };

    inbox.register({
      targetTypeUrl,
      async deliver(message) {
        seen.push(message);
        startDelivery();
        await deliveryReleased;
      },
    });

    const firstMessage = await inbox.receive(delivery, input);
    await deliveryStarted;
    const duplicateMessage = await inbox.receive(delivery, input);
    expect(duplicateMessage.id).not.toEqual(firstMessage.id);
    expect(seen).toHaveLength(1);
    releaseDelivery();
    await delivery.whenIdle();
    expect(seen).toHaveLength(1);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([]);
  });

  it("accepts a duplicate during another worker's failed Projection delivery", async () => {
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
    const failure = new Error("projection delivery failed");
    let startDelivery!: () => void;
    let releaseDelivery!: () => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      startDelivery = resolve;
    });
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
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
    };

    inbox.register({
      targetTypeUrl,
      async deliver() {
        startDelivery();
        await deliveryReleased;
        throw failure;
      },
    });

    const firstMessage = await inbox.receive(firstDelivery, input);
    await deliveryStarted;

    const duplicateMessage = await inbox.receive(duplicateDelivery, input);
    expect(duplicateMessage.id).not.toEqual(firstMessage.id);
    releaseDelivery();

    await expect(firstDelivery.whenIdle()).rejects.toBe(failure);
    await duplicateDelivery.whenIdle();
    await expect(
      firstDelivery.inbox.read(shard, { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      { signalId: "event-failing-duplicate", status: "TO_DELIVER" },
      { signalId: "event-failing-duplicate", status: "TO_DELIVER" },
    ]);
    await expect(firstDelivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("retains a valid non-projection label as pending without readiness", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const inbox = new LocalProjectionInbox("Tasks", (scope) => ready.push(scope));
    const targetTypeUrl = "type.example.dev/Tasks.Projection";

    inbox.register({
      targetTypeUrl,
      deliver() {
        return Promise.reject(new Error("unexpected delivery"));
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
        }),
      ),
    ).resolves.toMatchObject({ signalId: "event-2" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "event-2", status: "TO_DELIVER" }]);
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
      deliver: () => Promise.reject(new Error("scheduled rows should not delivery")),
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
        }),
      ),
    ).resolves.toMatchObject({ signalId: "event-scheduled", status: "SCHEDULED" });
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
      }),
    ).resolves.toMatchObject({ signalId: "event-missing" });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "event-missing", status: "TO_DELIVER" }]);
    expect(ready).toEqual([]);
  });

  it("selects the configured shard despite a caller-supplied shard", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const ready: unknown[] = [];
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const strategy: DeliveryStrategy = {
      shardCount: 2,
      shardFor: () => new ShardIndex(1, 2),
    };
    const inbox = new LocalProjectionInbox(
      "Tasks",
      (scope) => ready.push(scope),
      undefined,
      strategy,
    );
    inbox.register({
      targetTypeUrl,
      deliver: () => Promise.resolve(),
    });

    const accepted = await inbox.receive(
      delivery,
      asRuntimeInvalidProjectionInput({
        inboxId: {
          targetId: Identifiers.pack("string", "projection-shard-mismatch"),
          targetTypeUrl,
        },
        signalId: "event-shard-mismatch",
        signal: eventSignal(),
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: new ShardIndex(0, 2),
      }),
    );

    expect(accepted.shard).toEqual(new ShardIndex(1, 2));
    expect(ready).toEqual([
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl,
        shard: { index: 1, ofTotal: 2 },
      },
    ]);
    await expect(delivery.inbox.read(new ShardIndex(0, 2))).resolves.toEqual([]);
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

    inbox.register({
      targetTypeUrl,
      deliver(message) {
        seen.push(message);
        return Promise.resolve();
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:00.000Z")),
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
      whenReceived: timestampFromDate(new Date("2026-07-08T09:00:01.000Z")),
      version: 2n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: Identifiers.pack("string", "projection-1"), targetTypeUrl },
      signalId: "event-1",
      signal: eventSignal(),
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });

    await delivery.whenIdle();

    expect(seen).toHaveLength(1);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { signalId: "signal-0" },
      { signalId: "event-0" },
    ]);
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
  };
}

function eventSignal() {
  return AnyPacker.pack(EventSchema, create(EventSchema));
}

function commandSignal() {
  return AnyPacker.pack(CommandSchema, create(CommandSchema));
}

type ProjectionReceiveInput = Parameters<ProjectionInbox["receive"]>[1];
function asRuntimeInvalidProjectionInput(input: unknown): ProjectionReceiveInput {
  // Intentionally bypasses the narrow projection input type for runtime fail-closed coverage.
  return input as ProjectionReceiveInput;
}
