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
});
