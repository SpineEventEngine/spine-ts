import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import { InboxMessageSchema, InboxMessageIdSchema } from "@spine-event-engine/proto/delivery";

import { InboxRecords, inboxRecordSpec } from "../../src/delivery/inbox-records.js";
import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("direct InboxMessage storage", () => {
  it("has no per-message exclusion or separate duplicate persistence", async () => {
    const [storage, mapper] = await Promise.all([
      readFile(new URL("../../src/delivery/inbox-storage.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/delivery/inbox-records.ts", import.meta.url), "utf8"),
    ]);

    expect(`${storage}${mapper}`).not.toMatch(/claim|dedup|guard/i);
  });

  it("uses the generated InboxMessage and InboxMessageId records directly", () => {
    expect(inboxRecordSpec.sourceType).toBe(InboxMessageSchema);
    expect(inboxRecordSpec.recordType).toBe(InboxMessageSchema);
    expect(inboxRecordSpec.idType).toBe(InboxMessageIdSchema);
    expect(inboxRecordSpec.columns.map((column) => [column.name, column.valueType])).toEqual([
      ["inbox_id", "message"],
      ["signal_id", "message"],
      ["shard_index", "number"],
      ["shard_total", "number"],
      ["status", "number"],
      ["when_received", "timestamp"],
      ["version", "number"],
      ["message_id", "string"],
    ]);
  });

  it("maps an ergonomic message to the generated record without an Any envelope", () => {
    const record = InboxRecords.write(createMessage("message-1", "signal-1", 7n));

    expect(record.$typeName).toBe("spine.server.delivery.InboxMessage");
    expect(record.id?.uuid).toBe("message-1");
    expect(record.signalId?.value).toBe("signal-1");
    expect(record.version).toBe(7);
  });

  it("rejects corrupt generated inbox rows as storage corruption", () => {
    expect(() => InboxRecords.read(create(InboxMessageSchema))).toThrow(
      DeliveryStorageCorruptionError,
    );
  });

  it("changes only the exact pending snapshot to delivered and converges a matching delivery", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const pending = createMessage("message-1", "signal-1", 1n);

    await storage.write(pending);
    await expect(storage.markDelivered({ ...pending, version: 2n })).resolves.toBeUndefined();
    await expect(storage.readMessage(pending.id)).resolves.toMatchObject({ status: "TO_DELIVER" });
    await expect(storage.markDelivered(pending)).resolves.toMatchObject({ status: "DELIVERED" });
    await expect(storage.markDelivered(pending)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("suppresses a duplicate pending row before callback admission when its shard has a live delivered predecessor", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const first = createMessage("message-1", "signal-1", 1n);
    const duplicate = createMessage("message-2", "signal-1", 2n);

    await storage.write(first);
    await storage.write(duplicate);
    await storage.markDelivered(first);

    await expect(storage.admit(duplicate)).resolves.toBeUndefined();
    await expect(storage.readMessage(duplicate.id)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("admits a duplicate when its delivered predecessor has expired", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T08:00:01.000Z"),
    });
    const expired = {
      ...createMessage("message-1", "signal-1", 1n),
      keepUntil: new Date("2026-07-02T08:00:00.000Z"),
    };
    const duplicate = createMessage("message-2", "signal-1", 2n);

    await storage.write(expired);
    await storage.write(duplicate);
    await storage.markDelivered(expired);

    await expect(storage.admit(duplicate)).resolves.toMatchObject({ id: duplicate.id });
  });
});
