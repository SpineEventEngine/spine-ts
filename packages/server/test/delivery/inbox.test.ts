import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxMessageError, ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("Inbox", () => {
  it("receives, orders, reads, and marks a direct generated row delivered", async () => {
    const inbox = open("Tasks");
    const later = createMessage("ignored", "later", 2n, new Date("2026-07-02T08:00:01.000Z"));
    const first = createMessage("ignored", "first", 1n);
    await inbox.receive(input(later));
    const written = await inbox.receive(input(first));
    expect((await inbox.read(ShardIndex.single())).map((row) => row.signalId)).toEqual([
      "first",
      "later",
    ]);
    expect(await inbox.readMessage(written.message.id)).toEqual(written.message);
    expect(await inbox.markDelivered(written.message)).toMatchObject({
      status: "DELIVERED",
      signalId: "first",
    });
  });

  it("shares durable rows through the selected context and isolates another context", async () => {
    const factory = new InMemoryStorageFactory();
    const first = open("Tasks", factory);
    const second = open("Tasks", factory);
    const isolated = open("Other", factory);
    await first.receive(input(createMessage("ignored", "shared", 1n)));
    expect((await second.read(ShardIndex.single())).map((row) => row.signalId)).toEqual(["shared"]);
    expect(await isolated.read(ShardIndex.single())).toEqual([]);
  });

  it("rejects invalid public read limits before storage access", async () => {
    await expect(open("Tasks").read(ShardIndex.single(), { limit: 0 })).rejects.toThrow(
      InboxMessageError,
    );
    await expect(open("Tasks").read(ShardIndex.single(), { limit: 1_001 })).rejects.toThrow(
      InboxMessageError,
    );
  });

  it("does not let caller mutation change the durable input snapshot", async () => {
    const inbox = open("Tasks");
    const value = {
      ...input(createMessage("ignored", "stable", 1n)),
      inboxId: { targetId: "projection-1", targetTypeUrl: "type.example.dev/tasks.Projection" },
    };
    await inbox.receive(value);
    (value.inboxId as { targetId: string }).targetId = "mutated";
    expect((await inbox.read(ShardIndex.single()))[0]?.inboxId.targetId).toBe("projection-1");
  });
});

function open(name: string, factory = new InMemoryStorageFactory()): Inbox {
  return new Inbox(
    new InboxStorage({ context: { name, multitenant: false }, storageFactory: factory }),
  );
}
function input(message: ReturnType<typeof createMessage>) {
  const { id: _id, ...value } = message;
  return value;
}
