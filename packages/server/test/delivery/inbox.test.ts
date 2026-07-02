import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  Inbox,
  InboxStorage,
  ShardIndex,
  type DeliveryStatus,
  type InboxId,
} from "../../src/index.js";

describe("Inbox", () => {
  it("writes durable inbox messages in received/version order and deduplicates live writes", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const second = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const inboxId: InboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };
    const shard = ShardIndex.single();
    const keepUntil = new Date("2026-07-02T08:15:00.000Z");

    const later = await first.inbox.receive({
      inboxId,
      signalId: "signal-2",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      version: 2n,
    });
    const earlier = await first.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      version: 1n,
      keepUntil,
    });
    const duplicate = await second.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:05:00.000Z"),
      version: 8n,
    });
    const latest = await second.inbox.receive({
      inboxId,
      signalId: "signal-3",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
      version: 1n,
    });

    expect(later.outcome).toBe("WRITTEN");
    expect(earlier.outcome).toBe("WRITTEN");
    expect(duplicate.outcome).toBe("DUPLICATE");
    expect(latest.outcome).toBe("WRITTEN");
    expect(duplicate.message.id).toEqual(earlier.message.id);

    const messages = await first.inbox.read(shard, { statuses: liveStatuses });

    expect(messages.map((message) => message.signalId)).toEqual([
      "signal-1",
      "signal-2",
      "signal-3",
    ]);
    expect(messages[0]).toMatchObject({
      inboxId,
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      keepUntil,
      version: 1n,
    });
    expect(messages).toHaveLength(3);
  });

  it("reads through shared storage without keeping process-local inbox state", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const first = new Inbox(storage);
    const second = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );
    const shard = ShardIndex.single();

    await first.receive({
      inboxId: {
        targetId: "aggregate-1",
        targetTypeUrl: "type.example.dev/tasks.Aggregate",
      },
      signalId: "signal-shared",
      label: "HANDLE_COMMAND",
      status: "SCHEDULED",
      shard,
      whenReceived: new Date("2026-07-02T08:10:00.000Z"),
      version: 4n,
    });

    await expect(second.read(shard, { statuses: ["SCHEDULED"] })).resolves.toMatchObject([
      {
        signalId: "signal-shared",
        label: "HANDLE_COMMAND",
        status: "SCHEDULED",
      },
    ]);
  });
});

const liveStatuses: readonly DeliveryStatus[] = Object.freeze([
  "TO_DELIVER",
  "SCHEDULED",
  "TO_CATCH_UP",
]);
