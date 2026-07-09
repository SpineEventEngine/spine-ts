import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { Delivery, ShardIndex, type InboxMessage } from "../../src/index.js";
import { LocalProjectionInbox } from "../../src/context/projection-handoff.js";

describe("LocalProjectionInbox", () => {
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
    const inbox = new LocalProjectionInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.Projection";

    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(new Error("unexpected replay"));
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "projection-2", targetTypeUrl },
        signalId: "event-2",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
