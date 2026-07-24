import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryLoop } from "../../src/delivery/delivery-loop.js";
import type { ProjectionInbox, ProjectionInboxTarget } from "../../src/repository/repository.js";
import { ShardIndex, type InboxMessage } from "../../src/index.js";
import { DeliveryReadiness } from "../../src/context/local-inbox-handoff.js";
import { LocalProjectionInbox } from "../../src/context/projection-handoff.js";

describe("LocalProjectionInbox", () => {
  it("keeps a multitenant descriptor tenant before inbox persistence", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-dynamic" },
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
      "tenant-dynamic",
    );
    await Promise.resolve();

    expect(keep).toHaveBeenCalledExactlyOnceWith("tenant-dynamic");
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);

    kept.resolve(undefined);
    await receiving;
  });

  it("routes persisted rows without exact drain after ownership transfer", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
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
        replayed.push(message.inboxId.targetId);
        if (message.inboxId.targetId === "admitted") {
          replayStarted.resolve(undefined);
          await releaseReplay.promise;
        }
      },
    });

    const admitted = inbox.receive(
      delivery,
      projectionInput(targetTypeUrl, "admitted"),
      "tenant-a",
    );
    await replayStarted.promise;
    const transition = readiness.transition(
      [
        {
          tenantId: "tenant-b",
          label: "UPDATE_SUBSCRIBER",
          targetTypeUrl,
          shard: ShardIndex.single(),
        },
      ],
      (scope) => routed.push(scope),
    );

    await expect(
      inbox.receive(delivery, projectionInput(targetTypeUrl, "buffered"), "tenant-a"),
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
    ).resolves.toMatchObject([{ inboxId: { targetId: "buffered" } }]);

    await expect(
      inbox.receive(delivery, projectionInput(targetTypeUrl, "routed"), "tenant-a"),
    ).resolves.toBeDefined();
    expect(replayed).toEqual(["admitted"]);
    expect(routed).toEqual([]);

    await expect(
      readiness.transition(
        [
          {
            tenantId: "tenant-a",
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
    ).resolves.toMatchObject([
      { inboxId: { targetId: "buffered" } },
      { inboxId: { targetId: "routed" } },
    ]);

    const recovery = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "startup-recovery",
      onMessage: (message) => inbox.replay(message, "tenant-a"),
    }).run();
    expect(recovery.delivered).toBe(2);
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
        inboxId: { targetId: "projection-ready", targetTypeUrl },
        signalId: "event-ready",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      },
      "tenant-a",
    );

    expect(endpoints).not.toHaveBeenCalled();
    expect(ready).toEqual([
      {
        tenantId: "tenant-a",
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
        inboxId: { targetId: "projection-ready", targetTypeUrl },
        signalId: "event-ready",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(result).toBe(drainFailure);
    expect(notifications).toBe(1);
  });
  it("narrows replay targets to pending subscriber updates", () => {
    type ReplayMessage = Parameters<ProjectionInboxTarget["replay"]>[0];

    expectTypeOf<ReplayMessage["label"]>().toEqualTypeOf<"UPDATE_SUBSCRIBER">();
    expectTypeOf<ReplayMessage["status"]>().toEqualTypeOf<"TO_DELIVER">();
  });

  it("replays existing durable subscriber rows through a delivery loop endpoint", async () => {
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
      inboxId: { targetId: "projection-1", targetTypeUrl },
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    const run = await new DeliveryLoop({
      delivery,
      shard: ShardIndex.single(),
      node: "worker-a",
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
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("delivers an UPDATE_SUBSCRIBER event row and marks it delivered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";
    const signal = create(AnySchema, {
      typeUrl: "type.example.dev/Tasks.Event",
      value: new Uint8Array([1]),
    });
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    const delivered = await inbox.receive(delivery, {
      inboxId: { targetId: "projection-1", targetTypeUrl },
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
    ).resolves.toMatchObject([
      {
        signalId: "event-1",
        label: "UPDATE_SUBSCRIBER",
        status: "DELIVERED",
      },
    ]);
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
            targetId: `projection-${status}`,
            targetTypeUrl,
          },
          signalId: `event-${status}`,
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
      inboxId: { targetId: "projection-duplicate", targetTypeUrl },
      signalId: "event-duplicate",
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
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      {
        signalId: "event-duplicate",
        label: "UPDATE_SUBSCRIBER",
        status: "DELIVERED",
      },
    ]);
  });

  it("rejects a fresh-delivery duplicate with the original replay failure", async () => {
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
      inboxId: { targetId: "projection-failing-duplicate", targetTypeUrl },
      signalId: "event-failing-duplicate",
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

    await expect(firstResult).resolves.toBe(failure);
    await expect(duplicateResult).resolves.toBe(failure);
    await expect(firstDelivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toEqual([
      expect.objectContaining({
        signalId: "event-failing-duplicate",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      }),
    ]);
    await expect(firstDelivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toEqual([]);
  });

  it("rejects when the inbox label is not UPDATE_SUBSCRIBER", async () => {
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
          inboxId: { targetId: "projection-2", targetTypeUrl },
          signalId: "event-2",
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
          shard: ShardIndex.single(),
        }),
      ),
    ).rejects.toThrow('BoundedContext delivery has no handler for inbox label "HANDLE_COMMAND".');
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-2",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
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
          inboxId: { targetId: "projection-scheduled", targetTypeUrl },
          signalId: "event-scheduled",
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
        inboxId: { targetId: "projection-missing", targetTypeUrl },
        signalId: "event-missing",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow(
      `BoundedContext delivery has no projection subscriber target for "${targetTypeUrl}".`,
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-missing",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      },
    ]);
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
        inboxId: { targetId: "projection-shard-mismatch", targetTypeUrl },
        signalId: "event-shard-mismatch",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard,
      }),
    ).rejects.toBe(replayFailure);
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      {
        signalId: "event-shard-mismatch",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      },
    ]);
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
        targetId: "pm-0",
        targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
      },
      signalId: "signal-0",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: {
        targetId: "projection-0",
        targetTypeUrl: unrelatedProjectionTypeUrl,
      },
      signalId: "event-0",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:01.000Z"),
      version: 2n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: "projection-1", targetTypeUrl },
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
    });

    expect(seen).toHaveLength(1);
    expect(unrelatedSeen).toHaveLength(0);
    expect(seen[0]).toMatchObject({
      signalId: "event-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      {
        signalId: "signal-0",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
      {
        signalId: "event-0",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      },
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      {
        signalId: "event-1",
        label: "UPDATE_SUBSCRIBER",
        status: "DELIVERED",
      },
    ]);
  });
});

function projectionInput(targetTypeUrl: string, targetId: string) {
  return {
    inboxId: { targetId, targetTypeUrl },
    signalId: `event-${targetId}`,
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
  };
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
