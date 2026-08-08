import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import { CommandSchema, EventSchema } from "@spine-event-engine/proto";
import {
  InboxLabel,
  InboxMessageIdSchema,
  InboxMessageSchema,
  InboxMessageStatus,
} from "@spine-event-engine/proto/delivery";

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

  it("rejects every CAS mutation before touching a non-atomic inbox handle", async () => {
    const factory = new InMemoryStorageFactory();
    const original = factory.createRecordStorage.bind(factory);
    vi.spyOn(factory, "createRecordStorage").mockImplementation((context, spec) => {
      const storage = original(context, spec);
      Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
      return storage;
    });
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const message = createMessage("atomic", "atomic", 1n);
    await expect(storage.write(message)).rejects.toThrow("atomic");
    await expect(storage.markDelivered(message)).rejects.toThrow("atomic");
    await expect(storage.admit(message)).rejects.toThrow("atomic");
  });

  it("rejects corrupt generated inbox rows as storage corruption", () => {
    expect(() => InboxRecords.read(create(InboxMessageSchema))).toThrow(
      DeliveryStorageCorruptionError,
    );
  });

  it("round-trips command and event payloads while rejecting corrupt direct fields", () => {
    const command = {
      ...createMessage("command", "signal-command", 1n),
      signal: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.Command",
        value: toBinary(CommandSchema, create(CommandSchema)),
      }),
      label: "HANDLE_COMMAND" as const,
    };
    const event = {
      ...createMessage("event", "signal-event", 2n),
      signal: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.Event",
        value: toBinary(EventSchema, create(EventSchema)),
      }),
      label: "REACT_UPON_EVENT" as const,
    };

    expect(InboxRecords.read(InboxRecords.write(command)).signal?.typeUrl).toContain("Command");
    expect(InboxRecords.read(InboxRecords.write(event)).signal?.typeUrl).toContain("Event");
    expect(() => InboxRecords.write({ ...command, label: "UNKNOWN" as never })).toThrow();
    for (const invalid of [
      { ...command, signal: undefined },
      { ...command, label: "REACT_UPON_EVENT" as const },
      { ...event, label: "HANDLE_COMMAND" as const },
    ])
      expect(() => InboxRecords.write(invalid)).toThrow("label");
    expect(() => InboxRecords.write({ ...command, version: -1n })).toThrow();

    const stored = InboxRecords.write(command);
    expect(() =>
      InboxRecords.read(
        stored,
        create(InboxMessageIdSchema, { uuid: "other", index: stored.id?.index }),
      ),
    ).toThrow(DeliveryStorageCorruptionError);
    expect(() =>
      InboxRecords.read({ ...stored, label: InboxLabel.UNRECOGNIZED as InboxLabel }),
    ).toThrow(DeliveryStorageCorruptionError);
    expect(() =>
      InboxRecords.read({
        ...stored,
        status: InboxMessageStatus.UNRECOGNIZED as InboxMessageStatus,
      }),
    ).toThrow(DeliveryStorageCorruptionError);
    for (const invalid of [
      { ...stored, payload: { case: undefined } },
      { ...stored, label: InboxLabel.REACT_UPON_EVENT },
    ])
      expect(() => InboxRecords.read(invalid)).toThrow(DeliveryStorageCorruptionError);
    expect(() =>
      InboxRecords.read({ ...stored, whenReceived: { seconds: 0n, nanos: -1 } }),
    ).toThrow(DeliveryStorageCorruptionError);
    expect(() => InboxRecords.write({ ...command, keepUntil: new Date(Number.NaN) })).toThrow();
    expect(() => InboxRecords.write({ ...command, id: { ...command.id, value: " " } })).toThrow();
    expect(() => InboxRecords.write({ ...command, signalId: " " })).toThrow();
    expect(() => InboxRecords.write({ ...command, shard: {} as never })).toThrow();
    expect(() =>
      InboxRecords.write({ ...command, signal: { typeUrl: "unknown", value: new Uint8Array() } }),
    ).toThrow();
    expect(() => InboxRecords.read({ ...stored, id: undefined })).toThrow(
      DeliveryStorageCorruptionError,
    );
    expect(() => InboxRecords.read({ ...stored, signalId: undefined })).toThrow(
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

  it("rereads only the exact delivered successor after a contested completion CAS", async () => {
    for (const outcome of ["delivered", "different"] as const) {
      const factory = new InMemoryStorageFactory();
      const original = factory.createRecordStorage.bind(factory);
      let race = false;
      vi.spyOn(factory, "createRecordStorage").mockImplementation((context, spec) => {
        const records = original(context, spec);
        const compareAndSet = records.compareAndSet.bind(records);
        vi.spyOn(records, "compareAndSet").mockImplementation(async (id, expected, next) => {
          if (!race) return compareAndSet(id, expected, next);
          if (outcome === "delivered") {
            if (next === undefined) throw new Error("Expected delivered successor.");
            await records.write(next);
          } else
            await records.write(
              InboxRecords.write({ ...createMessage("message", "signal", 1n), version: 2n }),
            );
          return false;
        });
        return records;
      });
      const storage = new InboxStorage({
        context: { name: `Contested-${outcome}`, multitenant: false },
        storageFactory: factory,
      });
      const pending = createMessage("message", "signal", 1n);

      await storage.write(pending);
      race = true;
      await expect(storage.markDelivered(pending)).resolves.toMatchObject(
        outcome === "delivered" ? { status: "DELIVERED" } : undefined,
      );
    }
  });

  it("orders filtered rows and handles duplicate, collision, missing, and non-pending paths", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const first = createMessage("message-1", "signal-1", 1n, new Date(2_000));
    const second = createMessage("message-2", "signal-2", 2n, new Date(1_000));

    await expect(storage.write(first)).resolves.toMatchObject({ outcome: "WRITTEN" });
    await expect(storage.write(first)).resolves.toMatchObject({ outcome: "DUPLICATE" });
    await expect(storage.write({ ...first, signalId: "conflict" })).rejects.toThrow(
      "already exists",
    );
    await storage.write(second);
    await expect(storage.read(first.shard, { statuses: ["TO_DELIVER"] })).resolves.toMatchObject([
      { id: second.id },
      { id: first.id },
    ]);
    await expect(storage.read(first.shard, { limit: 0 })).rejects.toThrow("limit");
    await expect(storage.readMessage({ ...first.id, value: "missing" })).resolves.toBeUndefined();
    await expect(
      storage.markDelivered({ ...first, id: { ...first.id, value: "missing" } }),
    ).resolves.toBeUndefined();
    await storage.markDelivered(first);
    await expect(storage.admit(first)).resolves.toBeUndefined();
    await expect(storage.admit({ ...second, version: 3n })).resolves.toBeUndefined();
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

  it("finds an exact delivered predecessor despite more than 1000 unrelated delivered rows", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const predecessor = createMessage("predecessor", "signal", 1n);
    const duplicate = createMessage("duplicate", "signal", 2n);

    await storage.write(predecessor);
    await storage.markDelivered(predecessor);
    for (let i = 0; i <= 1_000; i++) {
      await storage.write({
        ...createMessage(`unrelated-${String(i)}`, `unrelated-signal-${String(i)}`, BigInt(i)),
        status: "DELIVERED",
      });
    }
    await storage.write(duplicate);

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

  it("validates direct read bounds, clock output, and multitenant storage context", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date(Number.NaN),
    });
    const message = { ...createMessage("message", "signal", 1n), keepUntil: new Date(1_000) };
    const candidate = createMessage("new", "signal", 2n);

    await storage.write(message);
    await expect(storage.read(message.shard)).resolves.toEqual([message]);
    for (const limit of [-1, 1.5, 1_001, Number.MAX_SAFE_INTEGER + 1])
      await expect(storage.read(message.shard, { limit })).rejects.toThrow("limit");
    for (const offset of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(storage.read(message.shard, { offset })).rejects.toThrow("offset");
    for (const after of [
      { messageId: " ", whenReceived: new Date(0), version: 0n },
      { messageId: "message", whenReceived: new Date(Number.NaN), version: 0n },
      { messageId: "message", whenReceived: new Date(0), version: -1n },
      { messageId: "message", whenReceived: new Date(0), version: 0 as never },
    ])
      await expect(storage.read(message.shard, { after })).rejects.toThrow("continuation");
    await expect(
      storage.read(message.shard, {
        offset: 0,
        after: { messageId: message.id.value, whenReceived: message.whenReceived, version: 1n },
      }),
    ).resolves.toEqual([message]);
    await expect(storage.read({} as never)).rejects.toThrow("shard");
    await storage.markDelivered(message);
    await expect(storage.admit(message)).resolves.toBeUndefined();
    await storage.write(candidate);
    await expect(storage.admit(candidate)).rejects.toThrow("clock");
  });
});
