import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { Delivery, ShardIndex, type InboxMessage } from "../../src/index.js";
import { LocalProcessManagerInbox } from "../../src/context/process-manager-handoff.js";

describe("LocalProcessManagerInbox", () => {
  it("delivers a handled command without optional signal and keepUntil fields", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const seen: InboxMessage[] = [];

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    const delivered = await inbox.receive(delivery, {
      inboxId: { targetId: "pm-1", targetTypeUrl },
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    expect(seen[0]?.signal).toBeUndefined();
    expect(seen[0]?.keepUntil).toBeUndefined();
    expect(delivered).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    expect(delivered.signal).toBeUndefined();
    expect(delivered.keepUntil).toBeUndefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-1",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
      },
    ]);
  });

  it("waits for a concurrent duplicate when the original command replay exceeds the old poll window", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
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
      inboxId: { targetId: "pm-duplicate", targetTypeUrl },
      signalId: "signal-duplicate",
      label: "HANDLE_COMMAND" as const,
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
        signalId: "signal-duplicate",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
      },
    ]);
  });

  it("stores optional signal and keepUntil while scheduled rows do not replay", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const shard = ShardIndex.single();
    const seen: InboxMessage[] = [];
    const earlierSignal = create(AnySchema, {
      typeUrl: "type.example.dev/Tasks.PreviousSignal",
      value: new Uint8Array([1]),
    });
    const laterSignal = create(AnySchema, {
      typeUrl: "type.example.dev/Tasks.LaterSignal",
      value: new Uint8Array([2]),
    });
    const keepUntil = new Date("2026-07-08T10:00:00.000Z");

    inbox.register({
      targetTypeUrl,
      replay(message) {
        seen.push(message);
        return Promise.resolve();
      },
    });

    await delivery.inbox.receive({
      inboxId: { targetId: "pm-0", targetTypeUrl },
      signalId: "signal-0",
      signal: earlierSignal,
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "pm-1", targetTypeUrl },
        signalId: "signal-1",
        signal: laterSignal,
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
        shard,
        keepUntil,
      }),
    ).rejects.toThrow(
      "Process-manager inbox delivery did not reach the target row before the local drain finished.",
    );

    expect(seen).toHaveLength(0);
    const pending = await delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] });
    const scheduled = await delivery.inbox.read(shard, { statuses: ["SCHEDULED"] });

    expect(pending).toMatchObject([
      {
        signalId: "signal-0",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
    expect(pending[0]?.signal?.typeUrl).toBe(earlierSignal.typeUrl);
    expect(Array.from(pending[0]?.signal?.value ?? [])).toEqual([1]);
    await expect(delivery.inbox.read(shard, { statuses: ["SCHEDULED"] })).resolves.toMatchObject([
      {
        signalId: "signal-1",
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
        keepUntil,
      },
    ]);
    expect(scheduled[0]?.signal?.typeUrl).toBe(laterSignal.typeUrl);
    expect(Array.from(scheduled[0]?.signal?.value ?? [])).toEqual([2]);
  });

  it("delivers only the received row when unrelated backlog is pending first", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";
    const unrelatedProcessManagerTypeUrl = "type.example.dev/Tasks.OtherProcessManager";
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
      targetTypeUrl: unrelatedProcessManagerTypeUrl,
      replay(message) {
        unrelatedSeen.push(message);
        return Promise.reject(new Error("unrelated process-manager should not replay"));
      },
    });

    await delivery.inbox.receive({
      inboxId: {
        targetId: "projection-0",
        targetTypeUrl: "type.example.dev/Tasks.Projection",
      },
      signalId: "event-0",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });
    await delivery.inbox.receive({
      inboxId: {
        targetId: "pm-0",
        targetTypeUrl: unrelatedProcessManagerTypeUrl,
      },
      signalId: "signal-0",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-08T09:00:01.000Z"),
      version: 2n,
    });

    await inbox.receive(delivery, {
      inboxId: { targetId: "pm-1", targetTypeUrl },
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard,
    });

    expect(seen).toHaveLength(1);
    expect(unrelatedSeen).toHaveLength(0);
    expect(seen[0]).toMatchObject({
      signalId: "signal-1",
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
    });
    await expect(delivery.inbox.read(shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      {
        signalId: "event-0",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      },
      {
        signalId: "signal-0",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
    await expect(delivery.inbox.read(shard, { statuses: ["DELIVERED"] })).resolves.toMatchObject([
      {
        signalId: "signal-1",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
      },
    ]);
  });

  it("rejects when replay throws an Error and leaves the row pending", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(new Error("target failed"));
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "pm-2", targetTypeUrl },
        signalId: "signal-2",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow("target failed");
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-2",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
  });

  it("rejects when replay throws a non-Error value", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      replay() {
        const reason = "not-an-error" as unknown as Error;

        return Promise.reject(reason);
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "pm-3", targetTypeUrl },
        signalId: "signal-3",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow("Process-manager inbox replay failed.");
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-3",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
  });

  it("rejects skipped delivery and leaves the claimed shard available again", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const shard = ShardIndex.single();
    const session = await delivery.shards.pickUp(shard, "other-node");
    if (session === undefined) {
      throw new Error("Expected to claim the shard before inbox delivery.");
    }

    try {
      await expect(
        inbox.receive(delivery, {
          inboxId: { targetId: "pm-4", targetTypeUrl: "type.example.dev/Tasks.ProcessManager" },
          signalId: "signal-4",
          label: "HANDLE_COMMAND",
          status: "TO_DELIVER",
          shard,
        }),
      ).rejects.toThrow(
        "Process-manager inbox delivery was skipped before the target row was delivered.",
      );
    } finally {
      await delivery.shards.release(session);
    }

    await expect(delivery.shards.pickUp(shard, "other-node-2")).resolves.toBeDefined();
  });

  it("rejects when a scheduled inbox row never reaches delivery", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(new Error("scheduled rows should not replay"));
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "pm-5", targetTypeUrl },
        signalId: "signal-5",
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow(
      "Process-manager inbox delivery did not reach the target row before the local drain finished.",
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
  });

  it("rejects when the inbox label is not HANDLE_COMMAND", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");
    const targetTypeUrl = "type.example.dev/Tasks.ProcessManager";

    inbox.register({
      targetTypeUrl,
      replay() {
        return Promise.reject(new Error("unexpected replay"));
      },
    });

    await expect(
      inbox.receive(delivery, {
        inboxId: { targetId: "pm-6", targetTypeUrl },
        signalId: "signal-6",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow(
      'BoundedContext delivery has no handler for inbox label "UPDATE_SUBSCRIBER".',
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-6",
        label: "UPDATE_SUBSCRIBER",
        status: "TO_DELIVER",
      },
    ]);
  });

  it("rejects when no process-manager command target is registered", async () => {
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new LocalProcessManagerInbox("Tasks");

    await expect(
      inbox.receive(delivery, {
        inboxId: {
          targetId: "pm-7",
          targetTypeUrl: "type.example.dev/Tasks.ProcessManager",
        },
        signalId: "signal-7",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
      }),
    ).rejects.toThrow(
      'BoundedContext delivery has no process-manager command target for "type.example.dev/Tasks.ProcessManager".',
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([
      {
        signalId: "signal-7",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
      },
    ]);
  });
});

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
