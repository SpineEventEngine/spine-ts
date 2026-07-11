import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  type RecordQuery,
  type RecordSpec,
  RecordStorage,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import { Delivery } from "../../src/delivery/delivery.js";
import {
  DedupRecords,
  dedupRecordSpec,
  InboxRecords,
  inboxRecordSpec,
} from "../../src/delivery/inbox-records.js";
import {
  Inbox,
  InboxMessageError,
  InboxStorage,
  ShardIndex,
  type DeliveryStatus,
  type InboxId,
  type InboxReadContinuation,
} from "../../src/index.js";
import { createMessage, oversizedText, oversizedVersion } from "./inbox-message-fixture.js";
import {
  finalDedupRecord,
  invalidUtf8JsonBytes,
  oversizedPayload,
  oversizedStoredRecord,
  pendingDedupRecord,
  storedInboxJson,
  storedInboxRecord,
  testDedupKey,
  testInboxKey,
} from "./inbox-record-fixture.js";

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

  it("reads after a stable inbox continuation in inbox order", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );
    const shard = ShardIndex.single();
    const inboxId: InboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };

    const first = await inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      version: 1n,
    });
    await inbox.receive({
      inboxId,
      signalId: "signal-2",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      version: 2n,
    });
    await inbox.receive({
      inboxId,
      signalId: "signal-3",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
      version: 1n,
    });

    const page = await inbox.read(shard, {
      statuses: ["TO_DELIVER"],
      limit: 1,
      after: {
        messageId: first.message.id.value,
        whenReceived: first.message.whenReceived,
        version: first.message.version,
      },
    });

    expect(page.map((message) => message.signalId)).toEqual(["signal-2"]);
  });

  it("rejects oversized read continuation message IDs before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: {
        messageId: oversizedText(16 * 1024 + 1),
        whenReceived: new Date("2026-07-02T08:00:00.000Z"),
        version: 1n,
      },
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/message id exceeds 16384 bytes/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects invalid read continuation objects before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: [] as unknown as InboxReadContinuation,
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/continuation is invalid/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects blank read continuation message IDs before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: {
        messageId: "   ",
        whenReceived: new Date("2026-07-02T08:00:00.000Z"),
        version: 1n,
      },
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/message id must be a non-empty string/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects invalid read continuation receive times before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: {
        messageId: "message-1",
        whenReceived: new Date(Number.NaN),
        version: 1n,
      },
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/receive time must be a valid date/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects non-bigint read continuation versions before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: {
        messageId: "message-1",
        whenReceived: new Date("2026-07-02T08:00:00.000Z"),
        version: 1 as unknown as bigint,
      },
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/version must be a bigint/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects oversized read continuation versions before querying storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const read = inbox.read(ShardIndex.single(), {
      after: {
        messageId: "message-1",
        whenReceived: new Date("2026-07-02T08:00:00.000Z"),
        version: oversizedVersion(),
      },
    });

    await expect(read).rejects.toBeInstanceOf(InboxMessageError);
    await expect(read).rejects.toThrow(/version exceeds 16384 bytes/i);
    expect(storageFactory.opens).toBe(0);
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

  it("rejects non-object receive inputs before writing storage records", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );

    const receive = inbox.receive(undefined as never);

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow("Inbox message input is invalid.");
  });

  it("rejects IMPORT_EVENT receives before opening durable inbox storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      }),
    );

    const receive = inbox.receive({
      inboxId: {
        targetId: "projection-1",
        targetTypeUrl: "type.example.dev/tasks.Projection",
      },
      signalId: "signal-import",
      label: "IMPORT_EVENT" as never,
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-02T08:10:00.000Z"),
      version: 1n,
    });

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow(/import_event/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("keeps multitenant inbox storage isolated by tenant", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const tenantA = new InboxStorage({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory,
    });
    const tenantB = new InboxStorage({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-b" },
      storageFactory,
    });

    await tenantA.write(createMessage("message-1", "signal-1", 1n));
    await tenantB.write(createMessage("message-2", "signal-2", 2n));

    await expect(tenantA.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
    ]);
    await expect(tenantB.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-2" }, signalId: "signal-2" },
    ]);
  });

  it("rejects IMPORT_EVENT storage writes before opening durable inbox storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    const write = storage.write({
      ...createMessage("message-import", "signal-import", 1n),
      label: "IMPORT_EVENT" as never,
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/import_event/i);
    expect(storageFactory.opens).toBe(0);
  });

  it("rejects public inbox writes with internal claim metadata", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(
      storage.write(withClaim(createMessage("message-claim", "signal-claim", 1n))),
    ).rejects.toBeInstanceOf(InboxMessageError);
    await expect(
      storage.write(withClaim(createMessage("message-claim", "signal-claim", 1n))),
    ).rejects.toThrow("Inbox message claim is internal.");
    await expect(storage.read(ShardIndex.single(), { statuses: liveStatuses })).resolves.toEqual(
      [],
    );
  });

  it("keeps proxy-hidden claim metadata out of public inbox writes", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const message = claimHidingProxy(createMessage("message-proxy-claim", "signal-proxy", 1n));

    await expect(storage.write(message)).resolves.toMatchObject({
      outcome: "WRITTEN",
      message: {
        id: { value: "message-proxy-claim" },
        signalId: "signal-proxy",
        status: "TO_DELIVER",
      },
    });

    const stored = await storage.read(ShardIndex.single(), { statuses: liveStatuses });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: { value: "message-proxy-claim" },
      signalId: "signal-proxy",
      status: "TO_DELIVER",
    });
    expect(Reflect.has(stored[0] ?? {}, "claim")).toBe(false);
    await expect(storage.markDelivered(stored[0] ?? message)).resolves.toMatchObject({
      id: { value: "message-proxy-claim" },
      signalId: "signal-proxy",
      status: "DELIVERED",
    });
  });

  it("does not serialize proxy-provided claim metadata through public record snapshots", () => {
    const proxySnapshot = InboxRecords.read(
      InboxRecords.write(
        claimHidingProxy(createMessage("message-record-proxy", "signal-proxy", 1n)),
      ),
    );
    const inheritedSnapshot = InboxRecords.read(
      InboxRecords.write(
        inheritedClaimMessage(createMessage("message-record-inherited", "signal-inherited", 1n)),
      ),
    );

    expect(proxySnapshot).toMatchObject({
      id: { value: "message-record-proxy" },
      signalId: "signal-proxy",
      status: "TO_DELIVER",
    });
    expect(Reflect.has(proxySnapshot, "claim")).toBe(false);
    expect(inheritedSnapshot).toMatchObject({
      id: { value: "message-record-inherited" },
      signalId: "signal-inherited",
      status: "TO_DELIVER",
    });
    expect(Reflect.has(inheritedSnapshot, "claim")).toBe(false);
  });

  it("orders equal receive time and version ties by inbox message UUID and supports paging limits", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    await storage.write(createMessage("message-b", "signal-b", 7n));
    await storage.write(createMessage("message-a", "signal-a", 7n));
    await storage.write(createMessage("message-c", "signal-c", 8n));

    await expect(storage.read(shard, { limit: 2 })).resolves.toMatchObject([
      { id: { value: "message-a" } },
      { id: { value: "message-b" } },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_001, Number.MAX_SAFE_INTEGER])(
    "rejects invalid read limits before querying storage: %s",
    async (limit) => {
      const storageFactory = new RecordingInboxQueryFactory();
      const storage = new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      });

      await expect(storage.read(ShardIndex.single(), { limit })).rejects.toThrow(
        "Inbox read limit must be a positive safe integer at most 1000.",
      );
      expect(storageFactory.opens).toBe(0);
      expect(storageFactory.queryCount).toBe(0);
    },
  );

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid read offsets before querying storage: %s",
    async (offset) => {
      const storageFactory = new RecordingInboxQueryFactory();
      const storage = new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory,
      });

      await expect(storage.read(ShardIndex.single(), { offset })).rejects.toThrow(
        "Inbox read offset must be a non-negative safe integer.",
      );
      expect(storageFactory.opens).toBe(0);
      expect(storageFactory.queryCount).toBe(0);
    },
  );

  it("normalizes read shards before using them in storage filters", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    await expect(
      storage.read({
        index: 1,
        ofTotal: 2,
        key: () => "0/2",
      }),
    ).resolves.toEqual([]);

    expect(storageFactory.lastShardFilter).toBe("1/2");
  });

  it("rejects invalid read shards before opening inbox storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    const throwingShardRead = storage.read({
      get index(): number {
        throw new Error("read shard index getter failed");
      },
      get ofTotal(): number {
        return 1;
      },
      key() {
        throw new Error("read shard key getter failed");
      },
    });

    await expect(throwingShardRead).rejects.toBeInstanceOf(InboxMessageError);
    await expect(throwingShardRead).rejects.toThrow("Inbox shard is invalid.");
    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
    expect(storageFactory.queryCount).toBe(0);
  });

  it("rejects non-object read shards before opening inbox storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    await expect(storage.read(undefined as unknown as ShardIndex)).rejects.toThrow(
      "Inbox shard is invalid.",
    );

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
    expect(storageFactory.queryCount).toBe(0);
  });

  it("rejects non-integer read shard coordinates before opening inbox storage", async () => {
    const storageFactory = new RecordingInboxQueryFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    await expect(
      storage.read({
        index: "0",
        ofTotal: 1,
      } as unknown as ShardIndex),
    ).rejects.toThrow("Inbox shard index must be a finite integer.");

    expect(storageFactory.opens).toBe(0);
    expect(storageFactory.closes).toBe(0);
    expect(storageFactory.queryCount).toBe(0);
  });

  it("bounds reads with a default page size when no explicit limit is provided", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const shard = ShardIndex.single();

    for (let index = 0; index < 101; index += 1) {
      await storage.write(
        createMessage(
          `message-${String(index).padStart(3, "0")}`,
          `signal-${String(index)}`,
          BigInt(index),
        ),
      );
    }

    const page = await storage.read(shard);

    expect(page).toHaveLength(100);
    expect(page[0]?.id.value).toBe("message-000");
    expect(page.at(-1)?.id.value).toBe("message-099");
  });

  it("evaluates dedup retention against the storage clock instead of caller-supplied receive time", async () => {
    const inboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date("2026-07-02T08:10:00.000Z"),
    });

    const first = await storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      inboxId,
      signalId: "signal-1",
      status: "DELIVERED",
      keepUntil: new Date("2026-07-02T08:05:00.000Z"),
    });
    const second = await storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      inboxId,
      signalId: "signal-1",
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
    });

    expect(first.outcome).toBe("WRITTEN");
    expect(second.outcome).toBe("WRITTEN");
  });

  it("uses the delivery owner clock for inbox dedup expiry decisions", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2099-01-01T00:00:10.000Z"),
    });
    const inboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };

    const first = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "DELIVERED",
      shard: ShardIndex.single(),
      whenReceived: new Date("2099-01-01T00:00:00.000Z"),
      version: 1n,
      keepUntil: new Date("2099-01-01T00:00:05.000Z"),
    });
    const second = await delivery.inbox.receive({
      inboxId,
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2099-01-01T00:00:01.000Z"),
      version: 2n,
    });

    expect(first.outcome).toBe("WRITTEN");
    expect(second.outcome).toBe("WRITTEN");
  });

  it("rejects invalid storage clocks before live dedup retention decisions", async () => {
    const inboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date(Number.NaN),
    });

    const first = await storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      inboxId,
      signalId: "signal-1",
      status: "DELIVERED",
      keepUntil: new Date("2026-07-02T08:15:00.000Z"),
    });
    const second = storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      inboxId,
      signalId: "signal-1",
    });

    expect(first.outcome).toBe("WRITTEN");
    await expect(second).rejects.toThrow(/clock/i);
    await expect(second).rejects.not.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(second).rejects.not.toBeInstanceOf(InboxMessageError);
  });

  it("treats live TO_DELIVER duplicates as clock-independent", async () => {
    const inboxId = {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    };
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      now: () => new Date(Number.NaN),
    });

    const first = await storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      inboxId,
      signalId: "signal-1",
      status: "TO_DELIVER",
    });
    const second = await storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      inboxId,
      signalId: "signal-1",
      status: "TO_DELIVER",
    });

    expect(first.outcome).toBe("WRITTEN");
    expect(second).toMatchObject({
      outcome: "DUPLICATE",
      message: { id: { value: "message-1" }, signalId: "signal-1", status: "TO_DELIVER" },
    });
  });

  it("rejects oversized signal payloads before serializing storage records", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );

    await expect(
      inbox.receive({
        inboxId: {
          targetId: "aggregate-1",
          targetTypeUrl: "type.example.dev/tasks.Aggregate",
        },
        signalId: "signal-large",
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.LargeSignal",
          value: new Uint8Array(256 * 1024 + 1),
        }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
        whenReceived: new Date("2026-07-02T08:10:00.000Z"),
        version: 1n,
      }),
    ).rejects.toBeInstanceOf(InboxMessageError);
    await expect(
      inbox.receive({
        inboxId: {
          targetId: "aggregate-1",
          targetTypeUrl: "type.example.dev/tasks.Aggregate",
        },
        signalId: "signal-large",
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.LargeSignal",
          value: new Uint8Array(256 * 1024 + 1),
        }),
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
        whenReceived: new Date("2026-07-02T08:10:00.000Z"),
        version: 1n,
      }),
    ).rejects.toThrow(/payload/i);
  });

  it("rejects proxy-backed signal payloads as inbox message errors", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const payload = new Proxy(new Uint8Array(1), {});
    const receive = inbox.receive({
      inboxId: {
        targetId: "aggregate-1",
        targetTypeUrl: "type.example.dev/tasks.Aggregate",
      },
      signalId: "signal-proxy",
      signal: {
        typeUrl: "type.example.dev/tasks.ProxySignal",
        value: payload,
      } as Any,
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-02T08:10:00.000Z"),
      version: 1n,
    });

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow(/payload/i);
  });

  it("rejects signal type URL accessor failures as inbox message errors", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const receive = inbox.receive({
      inboxId: {
        targetId: "aggregate-1",
        targetTypeUrl: "type.example.dev/tasks.Aggregate",
      },
      signalId: "signal-bad-type-url",
      signal: {
        get typeUrl() {
          throw new Error("type URL getter failed");
        },
        value: Buffer.from("payload", "utf8"),
      } as unknown as Any,
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-02T08:10:00.000Z"),
      version: 1n,
    });

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow(/signal type url/i);
  });

  it("rejects signal value accessor failures as inbox message errors", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const receive = inbox.receive({
      inboxId: {
        targetId: "aggregate-1",
        targetTypeUrl: "type.example.dev/tasks.Aggregate",
      },
      signalId: "signal-bad-value",
      signal: {
        typeUrl: "type.example.dev/tasks.BadValueSignal",
        get value() {
          throw new Error("signal value getter failed");
        },
      } as unknown as Any,
      label: "HANDLE_COMMAND",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-02T08:10:00.000Z"),
      version: 1n,
    });

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow(/signal payload/i);
  });

  it("rejects invalid caller timestamps as inbox message errors", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    const write = storage.write({
      ...createMessage("message-invalid-time", "signal-invalid-time", 1n),
      whenReceived: new Date(Number.NaN),
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/receive time/i);
  });

  it("rejects proxy-backed caller timestamps as inbox message errors", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const whenReceived = new Proxy(new Date("2026-07-02T08:00:00.000Z"), {});
    const write = storage.write({
      ...createMessage("message-proxy-time", "signal-proxy-time", 1n),
      whenReceived,
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/receive time/i);
  });

  it("rejects structural caller timestamps as inbox message errors", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    const write = storage.write({
      ...createMessage("message-structural-time", "signal-structural-time", 1n),
      whenReceived: {
        getTime: () => Date.parse("2026-07-02T08:00:00.000Z"),
      } as unknown as Date,
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/receive time/i);
  });

  it("rejects top-level caller field accessor failures as inbox message errors", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const write = storage.write({
      ...createMessage("message-getter", "signal-getter", 1n),
      get signalId(): string {
        throw new Error("signal ID getter failed");
      },
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/signal id/i);
  });

  it("rejects top-level receive input accessor failures as inbox message errors", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "Tasks", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const input = {
      ...createMessage("message-getter", "signal-getter", 1n),
      get signalId(): string {
        throw new Error("receive signal ID getter failed");
      },
    };

    const receive = inbox.receive(input);

    await expect(receive).rejects.toBeInstanceOf(InboxMessageError);
    await expect(receive).rejects.toThrow(/signal id/i);
  });

  it("writes one immutable snapshot when caller getters drift after validation", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const initialShard = new ShardIndex(0, 2);
    const driftedShard = new ShardIndex(1, 2);
    let drifted = false;
    const message = {
      get id() {
        return Object.freeze({
          value: drifted ? "message-2" : "message-1",
          shard: drifted ? driftedShard : initialShard,
        });
      },
      get inboxId() {
        return Object.freeze({
          targetId: drifted ? "projection-2" : "projection-1",
          targetTypeUrl: "type.example.dev/tasks.Projection",
        });
      },
      get signalId() {
        return drifted ? "signal-2" : "signal-1";
      },
      label: "UPDATE_SUBSCRIBER" as const,
      status: "TO_DELIVER" as const,
      get shard() {
        return drifted ? driftedShard : initialShard;
      },
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      version: 1n,
      get keepUntil() {
        drifted = true;
        return undefined;
      },
    } as unknown as ReturnType<typeof createMessage>;

    const result = await storage.write(message);

    expect(result).toMatchObject({
      outcome: "WRITTEN",
      message: {
        id: { value: "message-1" },
        inboxId: { targetId: "projection-1" },
        signalId: "signal-1",
      },
    });
    expect(result.message.shard.key()).toBe(initialShard.key());
    await expect(storage.read(initialShard, { limit: 10 })).resolves.toMatchObject([
      {
        id: { value: "message-1" },
        inboxId: { targetId: "projection-1" },
        signalId: "signal-1",
      },
    ]);
    await expect(storage.read(driftedShard, { limit: 10 })).resolves.toEqual([]);
  });

  it("uses caller getter drift as one inbox input snapshot", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inboxIds: readonly InboxId[] = [
      {
        targetId: "projection-1",
        targetTypeUrl: "type.example.dev/tasks.Projection",
      },
      {
        targetId: "projection-2",
        targetTypeUrl: "type.example.dev/tasks.Projection",
      },
    ];
    let inboxReads = 0;
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      get inboxId() {
        const index = Math.min(inboxReads, inboxIds.length - 1);
        inboxReads += 1;
        const inboxId = inboxIds[index];
        if (inboxId === undefined) {
          throw new Error("Missing test inbox ID.");
        }
        return inboxId;
      },
    };

    const result = await storage.write(message);

    expect(result).toMatchObject({
      outcome: "WRITTEN",
      message: { inboxId: { targetId: "projection-1" } },
    });
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { inboxId: { targetId: "projection-1" } },
    ]);
  });

  it("writes and reads back an empty signal payload", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const signal = create(AnySchema, {
      typeUrl: "type.example.dev/tasks.EmptySignal",
      value: new Uint8Array(),
    });

    const result = await storage.write({
      ...createMessage("message-empty", "signal-empty", 1n),
      signal,
    });
    const messages = await storage.read(ShardIndex.single(), { limit: 10 });

    expect(result.outcome).toBe("WRITTEN");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: { value: "message-empty" },
      signalId: "signal-empty",
      signal: { typeUrl: signal.typeUrl },
    });
    expect(Buffer.from(messages[0]?.signal?.value ?? [])).toEqual(Buffer.from(signal.value));
  });

  it("writes and reads back a signal payload larger than the generic text cap", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const signal = create(AnySchema, {
      typeUrl: "type.example.dev/tasks.LargeSignal",
      value: new Uint8Array(20 * 1024),
    });

    const result = await storage.write({
      ...createMessage("message-large-signal", "signal-large-signal", 1n),
      signal,
    });
    const messages = await storage.read(ShardIndex.single(), { limit: 10 });

    expect(result.outcome).toBe("WRITTEN");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: { value: "message-large-signal" },
      signalId: "signal-large-signal",
      signal: { typeUrl: signal.typeUrl },
    });
    expect(Buffer.from(messages[0]?.signal?.value ?? [])).toEqual(Buffer.from(signal.value));
  });

  it("rejects oversized signal payloads before serializing dedup claims", () => {
    expect(() =>
      DedupRecords.writeClaim({
        ...createMessage("message-large", "signal-large", 1n),
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.LargeSignal",
          value: new Uint8Array(256 * 1024 + 1),
        }),
      }),
    ).toThrow(/payload/i);
  });

  it("rejects oversized signal IDs before building inbox and dedup keys", () => {
    expect(() =>
      InboxRecords.write({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
    expect(() =>
      DedupRecords.writeClaim({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
    expect(() =>
      DedupRecords.writeFinal({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
  });

  it("rejects oversized inbox target identity before building inbox and dedup keys", () => {
    const oversizedTargetId = () =>
      DedupRecords.writeClaim({
        ...createMessage("message-large", "signal-large", 1n),
        inboxId: {
          targetId: oversizedText(20 * 1024),
          targetTypeUrl: "type.example.dev/tasks.Projection",
        },
      });
    const oversizedTargetTypeUrl = () =>
      InboxRecords.write({
        ...createMessage("message-large", "signal-large", 1n),
        inboxId: {
          targetId: "projection-1",
          targetTypeUrl: oversizedText(20 * 1024),
        },
      });

    expect(oversizedTargetId).toThrow(/target id/i);
    expect(oversizedTargetTypeUrl).toThrow(/target type url/i);
  });

  it("fails closed when stored inbox records are malformed or invalid", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from("{not-json", "utf8"),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/storage corruption/i);
  });

  it("fails closed when reading legacy stored IMPORT_EVENT inbox rows", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([legacyImportRecord()]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/import_event.*deprecated/i);
  });

  it("does not deliver legacy stored IMPORT_EVENT inbox rows during shard drain", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const records = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox", multitenant: false },
      inboxRecordSpec,
    );
    await records.compareAndSet("0/1:message-1", undefined, legacyImportRecord());
    records.close();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    let delivered = false;

    await expect(
      delivery.drain(ShardIndex.single(), {
        node: "node-1",
        onMessage() {
          delivered = true;
        },
      }),
    ).rejects.toThrow(/import_event.*deprecated/i);
    expect(delivered).toBe(false);
    await expect(delivery.attempts.read()).resolves.toEqual([]);
  });

  it("fails closed when stored inbox records contain invalid UTF-8", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: invalidUtf8JsonBytes(
            storedInboxJson({
              signalId: "signal-invalid-utf8",
              valueBase64: Buffer.from("payload", "utf8").toString("base64"),
            }),
            "type.example.dev/tasks.LargeSignal",
          ),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("fails closed when stored inbox record payload accessors throw", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          get value(): Uint8Array {
            throw new Error("Inbox payload getter failed.");
          },
        } as unknown as Any,
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/value is invalid/i);
  });

  it("translates queried inbox row clone failures into storage corruption", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        inboxQueryEntries: [unclonableStoredRecord()],
      }),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("treats oversized stored inbox composite keys as storage corruption", async () => {
    const escaped = oversizedText(16 * 1024, "\\");
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from(
            JSON.stringify({
              ...storedInboxJson({
                signalId: "signal-stored-composite",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
              inbox: "bogus-inbox-key",
              inboxId: {
                targetId: escaped,
                targetTypeUrl: escaped,
              },
            }),
            "utf8",
          ),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.not.toBeInstanceOf(InboxMessageError);
  });

  it("rejects a queried inbox row copied under another backend key", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const copied = createMessage("message-1", "signal-1", 1n);
    const records = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox", multitenant: false },
      inboxRecordSpec,
    );

    await storage.write(copied);
    await records.compareAndSet("0/1:copied-row", undefined, InboxRecords.write(copied));

    await expect(storage.read(ShardIndex.single(), { limit: 10 })).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).rejects.toThrow(/storage key/i);

    records.close();
  });

  it("rejects stored inbox rows whose record key does not match message identity", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from(
            JSON.stringify({
              ...storedInboxJson({
                signalId: "signal-key-mismatch",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
              key: "0/1:message-2",
            }),
            "utf8",
          ),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/message identity/i);
  });

  it("rejects oversized signal payloads in stored inbox rows", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        storedInboxRecord({
          signalId: "signal-large",
          valueBase64: oversizedPayload(),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects stored signal payloads whose base64 text exceeds the encoded size limit", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        storedInboxRecord({
          signalId: "signal-oversized-base64-text",
          valueBase64: `${Buffer.alloc(256 * 1024).toString("base64")}AAAA`,
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/payload exceeds/i);
  });

  it("rejects malformed signal base64 in stored inbox rows", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        storedInboxRecord({
          signalId: "signal-malformed",
          valueBase64: "not base64!",
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects non-canonical pad bits in stored signal payload base64", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        storedInboxRecord({
          signalId: "signal-non-canonical-pad-bits",
          valueBase64: "Zh==",
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/not canonical/i);
  });

  it("rejects non-canonical signal base64 in stored inbox rows", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        storedInboxRecord({
          signalId: "signal-non-canonical",
          valueBase64: "Zg==\n",
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects oversized stored inbox records before parsing JSON", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: oversizedStoredRecord(),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/record exceeds/i);
  });

  it("rejects oversized signal payloads in pending dedup guards", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: pendingDedupRecord({
          signalId: "signal-1",
          valueBase64: oversizedPayload(),
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("translates dedup guard clone failures into storage corruption", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        dedupRead: unclonableStoredRecord(),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("translates conflicting inbox row clone failures into storage corruption", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        failInboxCreate: true,
        inboxRead: unclonableStoredRecord(),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-2", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("translates guarded inbox row clone failures into storage corruption", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        dedupRead: finalDedupRecord({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
        inboxRead: unclonableStoredRecord(),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("translates pending dedup recovery compare-and-set clone failures into storage corruption", async () => {
    const pending = createMessage("message-1", "signal-1", 1n);
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        dedupRead: cloneFailsOnReuse(DedupRecords.writeClaim(pending)),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("translates dedup re-claim compare-and-set clone failures into storage corruption", async () => {
    const delivered = {
      ...createMessage("message-1", "signal-1", 1n),
      status: "DELIVERED" as const,
    };
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        dedupRead: cloneFailsOnReuse(DedupRecords.writeFinal(delivered)),
        inboxRead: InboxRecords.write(delivered),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects malformed signal base64 in pending dedup guards", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: pendingDedupRecord({
          signalId: "signal-1",
          valueBase64: "not base64!",
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects non-canonical signal base64 in pending dedup guards", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: pendingDedupRecord({
          signalId: "signal-1",
          valueBase64: "Zg==\n",
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects oversized pending dedup records before parsing JSON", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
          value: oversizedStoredRecord(),
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      /record exceeds/i,
    );
  });

  it("fails closed when pending dedup guards contain invalid UTF-8", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
          value: invalidUtf8JsonBytes(
            {
              key: testDedupKey("signal-1"),
              state: "PENDING",
              message: storedInboxJson({
                signalId: "signal-1",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
            },
            "type.example.dev/tasks.LargeSignal",
          ),
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("treats oversized stored dedup composite keys as storage corruption", async () => {
    const escaped = oversizedText(16 * 1024, "\\");
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
          value: Buffer.from(
            JSON.stringify({
              key: "bogus-dedup-key",
              state: "PENDING",
              message: {
                ...storedInboxJson({
                  signalId: "signal-1",
                  valueBase64: Buffer.from("payload", "utf8").toString("base64"),
                }),
                inbox: JSON.stringify({
                  targetId: escaped,
                  targetTypeUrl: escaped,
                }),
                inboxId: {
                  targetId: escaped,
                  targetTypeUrl: escaped,
                },
              },
            }),
            "utf8",
          ),
        }),
      }),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.not.toBeInstanceOf(InboxMessageError);
  });

  it("treats an oversized existing inbox row as storage corruption during direct write recovery", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new ExistingInboxRowFactory({
        inbox: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: oversizedStoredRecord(),
        }),
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects an existing inbox row stored under another message slot during direct write recovery", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new ExistingInboxRowFactory({
        inbox: InboxRecords.write(createMessage("message-2", "signal-1", 1n)),
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("retries safely after an orphaned pending dedup claim", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        failInboxWriteOnce: true,
        skipDedupDeleteOnce: true,
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toThrow(
      /inbox write failed/i,
    );

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).resolves.toMatchObject({
      outcome: "WRITTEN",
      message: { id: { value: "message-1" }, signalId: "signal-1" },
    });
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
    ]);
  });

  it("fails clearly when dedup guard compare-and-set keeps missing", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        failDedupClaimAlways: true,
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toThrow(
      /inbox dedup guard could not be completed due to concurrent changes/i,
    );
  });

  it("recovers a pending dedup claim after finalization fails with a durable inbox row", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        throwDedupFinalizeOnce: true,
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toThrow(
      /dedup finalize failed/i,
    );

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).resolves.toMatchObject({
      outcome: "DUPLICATE",
      message: { id: { value: "message-1" }, signalId: "signal-1" },
    });
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
    ]);
  });

  it("preserves the inbox write failure when dedup rollback also throws", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        failInboxWriteOnce: true,
        throwDedupRollbackOnce: true,
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toThrow(
      /inbox write failed/i,
    );
  });

  it("recovers a pending dedup claim once the inbox row is visible", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        skipDedupFinalizeOnce: true,
      }),
    });

    const first = await storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      status: "DELIVERED",
    });
    const second = await storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      status: "DELIVERED",
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
    });

    expect(first.outcome).toBe("WRITTEN");
    expect(second).toMatchObject({
      outcome: "WRITTEN",
      message: { id: { value: "message-2" }, signalId: "signal-1" },
    });
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
      { id: { value: "message-2" }, signalId: "signal-1" },
    ]);
  });

  it("recovers a pending dedup claim with a visible delivered row without reading the clock", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FaultyStorageFactory({
        skipDedupFinalizeOnce: true,
      }),
      now: () => new Date(Number.NaN),
    });

    const first = await storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      status: "DELIVERED",
    });
    const second = await storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      status: "DELIVERED",
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
    });

    expect(first.outcome).toBe("WRITTEN");
    expect(second).toMatchObject({
      outcome: "WRITTEN",
      message: { id: { value: "message-2" }, signalId: "signal-1", status: "DELIVERED" },
    });
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
      { id: { value: "message-2" }, signalId: "signal-1" },
    ]);
  });

  it("fails closed when pending dedup guard and visible inbox row bytes differ", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const inboxRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox", multitenant: false },
      inboxRecordSpec,
    );
    const dedupRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox-dedup", multitenant: false },
      dedupRecordSpec,
    );
    const pending = createMessage("message-1", "signal-1", 1n);
    const conflicting = {
      ...createMessage("message-1", "signal-1", 9n),
      status: "DELIVERED" as const,
      whenReceived: new Date("2026-07-02T08:00:09.000Z"),
    };
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    await dedupRecords.compareAndSet(
      testDedupKey("signal-1"),
      undefined,
      DedupRecords.writeClaim(pending),
    );
    await inboxRecords.compareAndSet("0/1:message-1", undefined, InboxRecords.write(conflicting));

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/pending dedup/i);

    inboxRecords.close();
    dedupRecords.close();
  });

  it("fails closed when pending dedup recovery finds a conflicting inbox row", async () => {
    const pending = createMessage("message-1", "signal-1", 1n);
    const conflicting = {
      ...createMessage("message-1", "signal-conflict", 1n),
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
    };
    const retryMessage = createMessage("message-2", "signal-1", 2n);
    const storageFactory = new RecoverPendingConflictFactory({
      pendingGuard: DedupRecords.writeClaim(pending),
      conflictingInbox: InboxRecords.write(conflicting),
    });
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    await expect(storage.write(retryMessage)).rejects.toThrow(/already exists/i);
    await expect(storage.write(retryMessage)).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.write(retryMessage)).rejects.toThrow(/points to another dedup key/i);
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-conflict" },
    ]);
  });

  it("fails closed when pending dedup recovery finds same-key conflicting inbox bytes", async () => {
    const pending = createMessage("message-1", "signal-1", 1n);
    const conflicting = {
      ...createMessage("message-1", "signal-1", 9n),
      whenReceived: new Date("2026-07-02T08:00:09.000Z"),
    };
    const retryMessage = createMessage("message-2", "signal-1", 2n);
    const storageFactory = new RecoverPendingConflictFactory({
      pendingGuard: DedupRecords.writeClaim(pending),
      conflictingInbox: InboxRecords.write(conflicting),
    });
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });

    const write = storage.write(retryMessage);

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.not.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/conflicting inbox/i);
  });

  it("retries when a pending guard changes before embedded message recovery", async () => {
    const pending = createMessage("message-1", "signal-1", 1n);
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: pendingThenFinalDedupRecord(pending),
      }),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/points to a missing inbox message/i);
  });

  it("fails clearly when inbox row compare-and-set keeps missing", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        failInboxCreateAlways: true,
      }),
    });

    await expect(storage.write(createMessage("message-1", "signal-1", 1n))).rejects.toThrow(
      /inbox record could not be completed due to concurrent changes/i,
    );
  });

  it("classifies inbox compare-and-set clone failures as storage corruption", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CloneFailFactory({
        throwInboxCreateCloneFailure: true,
      }),
    });

    const write = storage.write(createMessage("message-1", "signal-1", 1n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/inbox record is invalid/i);
  });

  it("keeps the first pending claim canonical when a slow writer races a contender", async () => {
    const storageFactory = new SlowInboxCreateFactory();
    const first = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const second = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
    });
    const firstMessage = {
      ...createMessage("message-1", "signal-1", 1n),
      signal: create(AnySchema, {
        typeUrl: "type.example.dev/tasks.FirstSignal",
        value: Buffer.from("first", "utf8"),
      }),
      whenReceived: new Date("2026-07-02T08:00:00.000Z"),
      status: "TO_DELIVER" as const,
    };
    const secondMessage = {
      ...createMessage("message-2", "signal-1", 9n),
      signal: create(AnySchema, {
        typeUrl: "type.example.dev/tasks.SecondSignal",
        value: Buffer.from("second", "utf8"),
      }),
      whenReceived: new Date("2026-07-02T08:00:09.000Z"),
      status: "DELIVERED" as const,
    };

    const firstWrite = first.write(firstMessage);
    await storageFactory.waitForBlockedCreate();

    const secondWrite = second.write(secondMessage);
    await storageFactory.waitForContender();
    storageFactory.releaseFirstCreate();

    const [firstResult, secondResult] = await Promise.all([firstWrite, secondWrite]);
    const stored = await second.read(ShardIndex.single(), { limit: 10 });

    expect(["WRITTEN", "DUPLICATE"]).toContain(firstResult.outcome);
    expect(firstResult).toMatchObject({
      message: {
        id: { value: "message-1" },
        signalId: "signal-1",
        status: "TO_DELIVER",
        version: 1n,
      },
    });
    expect(secondResult).toMatchObject({
      message: {
        id: { value: "message-1" },
        signalId: "signal-1",
        status: "TO_DELIVER",
        version: 1n,
      },
    });
    expect(stored).toMatchObject([
      {
        id: { value: "message-1" },
        signalId: "signal-1",
        status: "TO_DELIVER",
        version: 1n,
        whenReceived: new Date("2026-07-02T08:00:00.000Z"),
        signal: create(AnySchema, {
          typeUrl: "type.example.dev/tasks.FirstSignal",
          value: Buffer.from("first", "utf8"),
        }),
      },
    ]);
  });

  it("rejects direct inbox writes that reuse an existing message key", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    await storage.write(createMessage("message-1", "signal-1", 1n));

    const write = storage.write(createMessage("message-1", "signal-2", 2n));

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/already exists/i);
  });

  it("rejects direct inbox writes with mismatched shard identities", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    await storage.write(createMessage("message-1", "signal-1", 1n));

    const write = storage.write({
      ...createMessage("message-1", "signal-1", 1n),
      id: {
        value: "message-2",
        shard: new ShardIndex(1, 2),
      },
      shard: new ShardIndex(0, 2),
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/shard/i);
  });

  it("rejects malformed retries even when a live dedup guard already exists", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });

    await storage.write(createMessage("message-1", "signal-1", 1n));

    const write = storage.write({
      ...createMessage("message-2", "signal-1", 2n),
      signal: create(AnySchema, {
        typeUrl: " ",
        value: Buffer.from("retry", "utf8"),
      }),
    });

    await expect(write).rejects.toBeInstanceOf(InboxMessageError);
    await expect(write).rejects.toThrow(/signal type url/i);
  });

  it("rejects oversized versions before building inbox or dedup records", () => {
    const message = createMessage("message-1", "signal-1", oversizedVersion());

    expect(() => InboxRecords.write(message)).toThrow(/version/i);
    expect(() => DedupRecords.writeClaim(message)).toThrow(/version/i);
  });

  it("rejects structural caller versions before building inbox or dedup records", () => {
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      version: {
        toString: () => "1",
      } as unknown as bigint,
    };

    expect(() => InboxRecords.write(message)).toThrow(InboxMessageError);
    expect(() => DedupRecords.writeClaim(message)).toThrow(InboxMessageError);
  });

  it("rejects dedup serializers with mismatched shard identities", () => {
    const message = {
      ...createMessage("message-1", "signal-1", 1n),
      id: {
        value: "message-1",
        shard: new ShardIndex(1, 2),
      },
      shard: new ShardIndex(0, 2),
    };

    expect(() => DedupRecords.writeClaim(message)).toThrow(InboxMessageError);
    expect(() => DedupRecords.writeFinal(message)).toThrow(InboxMessageError);
  });

  it("uses the delivery corruption error only for a final dedup guard that still points to no inbox row", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
  });

  it("fails closed when stored inbox timestamps are out of range", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new FakeStorageFactory([
        create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from(
            JSON.stringify({
              ...storedInboxJson({
                signalId: "signal-invalid-time",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
              whenReceivedMs: Number.MAX_SAFE_INTEGER,
            }),
            "utf8",
          ),
        }),
      ]),
    });

    await expect(storage.read(ShardIndex.single())).rejects.toBeInstanceOf(
      DeliveryStorageCorruptionError,
    );
    await expect(storage.read(ShardIndex.single())).rejects.toThrow(/receive time/i);
  });

  it("fails closed when stored dedup inbox timestamps are out of range", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
        inbox: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from(
            JSON.stringify({
              ...storedInboxJson({
                signalId: "signal-1",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
              status: "DELIVERED",
              keepUntilMs: Number.MAX_SAFE_INTEGER,
            }),
            "utf8",
          ),
        }),
      }),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/keep-until time/i);
  });

  it("fails closed when a pending dedup guard embeds invalid inbox timestamps on fast recovery", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
          value: Buffer.from(
            JSON.stringify({
              key: testDedupKey("signal-1"),
              state: "PENDING",
              message: {
                ...storedInboxJson({
                  signalId: "signal-1",
                  valueBase64: Buffer.from("payload", "utf8").toString("base64"),
                }),
                whenReceivedMs: Number.MAX_SAFE_INTEGER,
              },
            }),
            "utf8",
          ),
        }),
        inbox: InboxRecords.write(createMessage("message-1", "signal-1", 1n)),
      }),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/receive time/i);
  });

  it("fails closed when final dedup guard keep-until timestamps are out of range", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
          value: Buffer.from(
            JSON.stringify({
              key: testDedupKey("signal-1"),
              inbox: testInboxKey,
              signalId: "signal-1",
              inboxMessageId: "message-1",
              shardIndex: 0,
              shardTotal: 1,
              state: "FINAL",
              status: "DELIVERED",
              keepUntilMs: Number.MAX_SAFE_INTEGER,
            }),
            "utf8",
          ),
        }),
        inbox: create(AnySchema, {
          typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
          value: Buffer.from(
            JSON.stringify({
              ...storedInboxJson({
                signalId: "signal-1",
                valueBase64: Buffer.from("payload", "utf8").toString("base64"),
              }),
              status: "DELIVERED",
            }),
            "utf8",
          ),
        }),
      }),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(write).rejects.toThrow(/keep-until time/i);
  });

  it("fails closed when a live final dedup guard points to an expired inbox row", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const inboxRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox", multitenant: false },
      inboxRecordSpec,
    );
    const dedupRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox-dedup", multitenant: false },
      dedupRecordSpec,
    );
    await inboxRecords.compareAndSet(
      "0/1:message-1",
      undefined,
      InboxRecords.write({
        ...createMessage("message-1", "signal-1", 1n),
        status: "DELIVERED",
        keepUntil: new Date("2026-07-02T08:00:00.000Z"),
      }),
    );
    await dedupRecords.compareAndSet(
      testDedupKey("signal-1"),
      undefined,
      finalDedupRecord({
        key: testDedupKey("signal-1"),
        inbox: testInboxKey,
        signalId: "signal-1",
        inboxMessageId: "message-1",
      }),
    );
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:00:00.000Z"),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);

    inboxRecords.close();
    dedupRecords.close();
  });

  it("fails closed when final dedup guard metadata differs from the visible inbox row", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const inboxRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox", multitenant: false },
      inboxRecordSpec,
    );
    const dedupRecords = storageFactory.createRecordStorage(
      { name: "Tasks.delivery.inbox-dedup", multitenant: false },
      dedupRecordSpec,
    );
    await inboxRecords.compareAndSet(
      "0/1:message-1",
      undefined,
      InboxRecords.write(createMessage("message-1", "signal-1", 1n)),
    );
    await dedupRecords.compareAndSet(
      testDedupKey("signal-1"),
      undefined,
      create(AnySchema, {
        typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
        value: Buffer.from(
          JSON.stringify({
            key: testDedupKey("signal-1"),
            inbox: testInboxKey,
            signalId: "signal-1",
            inboxMessageId: "message-1",
            shardIndex: 0,
            shardTotal: 1,
            state: "FINAL",
            status: "DELIVERED",
            keepUntilMs: new Date("2026-07-02T10:00:00.000Z").getTime(),
          }),
          "utf8",
        ),
      }),
    );
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      now: () => new Date("2026-07-02T09:00:00.000Z"),
    });

    const write = storage.write(createMessage("message-2", "signal-1", 2n));

    await expect(write).rejects.toBeInstanceOf(DeliveryStorageCorruptionError);
    await expect(storage.read(ShardIndex.single(), { limit: 10 })).resolves.toMatchObject([
      { id: { value: "message-1" }, signalId: "signal-1" },
    ]);

    inboxRecords.close();
    dedupRecords.close();
  });

  it("rejects a final dedup guard whose key does not match its signal", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-2"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      /does not match/i,
    );
  });

  it("rejects a final dedup guard that points to another dedup key", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
        inbox: InboxRecords.write(createMessage("message-1", "signal-2", 1n)),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects a dedup guard whose inbox row uses another message slot", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-1"),
          inbox: testInboxKey,
          signalId: "signal-1",
          inboxMessageId: "message-1",
        }),
        inbox: InboxRecords.write(createMessage("message-2", "signal-1", 1n)),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      DeliveryStorageCorruptionError,
    );
  });

  it("rejects a final dedup guard stored under another key", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new CorruptGuardFactory({
        guard: finalDedupRecord({
          key: testDedupKey("signal-2"),
          inbox: testInboxKey,
          signalId: "signal-2",
          inboxMessageId: "message-1",
        }),
        inbox: InboxRecords.write(createMessage("message-1", "signal-1", 1n)),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      /storage key/i,
    );
  });

  it("keeps proxy-hidden claim metadata out of public markDelivered", async () => {
    const storage = new InboxStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const write = await storage.write(createMessage("message-mark-proxy", "signal-mark-proxy", 1n));
    const hiddenClaim = claimHidingProxy(write.message);

    await expect(storage.markDelivered(hiddenClaim)).resolves.toMatchObject({
      id: { value: "message-mark-proxy" },
      signalId: "signal-mark-proxy",
      status: "DELIVERED",
    });

    const delivered = await storage.read(ShardIndex.single(), { statuses: ["DELIVERED"] });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      id: { value: "message-mark-proxy" },
      signalId: "signal-mark-proxy",
      status: "DELIVERED",
    });
    expect(Reflect.has(delivered[0] ?? {}, "claim")).toBe(false);
  });
});

const liveStatuses: readonly DeliveryStatus[] = Object.freeze([
  "TO_DELIVER",
  "SCHEDULED",
  "TO_CATCH_UP",
]);

function withClaim(message: ReturnType<typeof createMessage>): ReturnType<typeof createMessage> {
  return Object.freeze({
    ...message,
    claim: {
      id: "external-claim",
      node: "node-a",
      expiresAt: new Date("2026-07-08T09:01:00.000Z"),
    },
  });
}

function inheritedClaimMessage(
  message: ReturnType<typeof createMessage>,
): ReturnType<typeof createMessage> {
  const clone: ReturnType<typeof createMessage> = { ...message };
  Object.setPrototypeOf(clone, {
    claim: {
      id: "inherited-external-claim",
      node: "node-a",
      expiresAt: new Date("2026-07-08T09:01:00.000Z"),
    },
  });

  return Object.freeze(clone);
}

function claimHidingProxy(
  message: ReturnType<typeof createMessage>,
): ReturnType<typeof createMessage> {
  const handler: ProxyHandler<ReturnType<typeof createMessage>> = {
    get(target, property, receiver) {
      if (property === "claim") {
        return {
          id: "hidden-external-claim",
          node: "node-a",
          expiresAt: new Date("2026-07-08T09:01:00.000Z"),
        };
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
    has(target, property) {
      return property === "claim" ? false : Reflect.has(target, property);
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).filter((property) => property !== "claim");
    },
    getOwnPropertyDescriptor(target, property) {
      return property === "claim" ? undefined : Reflect.getOwnPropertyDescriptor(target, property);
    },
  };

  return new Proxy(message, handler);
}

function legacyImportRecord(): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
    value: Buffer.from(
      JSON.stringify({
        ...storedInboxJson({
          signalId: "signal-import",
          valueBase64: Buffer.from("payload", "utf8").toString("base64"),
        }),
        label: "IMPORT_EVENT",
      }),
      "utf8",
    ),
  });
}

class FakeStorageFactory extends StorageFactory {
  readonly #records: readonly Any[];

  constructor(records: readonly Any[]) {
    super();
    this.#records = records;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new FakeRecordStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this.#records,
    ) as unknown as RecordStorage<I, R>;
  }
}

class RecordingInboxQueryFactory extends StorageFactory {
  opens = 0;
  closes = 0;
  queryCount = 0;
  lastShardFilter: unknown;

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.opens += 1;
    return new RecordingInboxQueryStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this,
    ) as unknown as RecordStorage<I, R>;
  }
}

class RecordingInboxQueryStorage extends RecordStorage<string, Any> {
  readonly #factory: RecordingInboxQueryFactory;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    factory: RecordingInboxQueryFactory,
  ) {
    super(context, recordSpec);
    this.#factory = factory;
  }

  override close(): void {
    this.#factory.closes += 1;
    super.close();
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected override queryRecordEntries(
    query: RecordQuery<string>,
  ): Promise<readonly { id: string; record: Any }[]> {
    this.#factory.queryCount += 1;
    this.#factory.lastShardFilter = (query.filters ?? []).find(
      (filter) => filter.column === "shard",
    )?.value;
    return Promise.resolve([]);
  }

  protected readRecord(): Promise<Any | undefined> {
    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeRecordStorage extends RecordStorage<string, Any> {
  readonly #records: readonly Any[];

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    records: readonly Any[],
  ) {
    super(context, recordSpec);
    this.#records = records;
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected override queryRecordEntries(): Promise<readonly { id: string; record: Any }[]> {
    return Promise.resolve(
      this.#records.map((record) => ({
        id: this.recordSpec.idValueIn(record),
        record,
      })),
    );
  }

  protected readRecord(): Promise<Any | undefined> {
    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

interface FaultPlan {
  failInboxWriteOnce?: boolean;
  failDedupClaimAlways?: boolean;
  skipDedupDeleteOnce?: boolean;
  skipDedupFinalizeOnce?: boolean;
  throwDedupFinalizeOnce?: boolean;
  throwDedupRollbackOnce?: boolean;
}

class FaultyStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  readonly #plan: FaultPlan;

  constructor(plan: FaultPlan) {
    super();
    this.#plan = plan;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new FaultyRecordStorage(context, recordSpec, storage, this.#plan);
  }
}

class FaultyRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #plan: FaultPlan;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    plan: FaultPlan,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#plan = plan;
  }

  override close(): void {
    this.#delegate.close();
    super.close();
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    if (
      this.#isInboxStorage() &&
      expected === undefined &&
      next !== undefined &&
      this.#plan.failInboxWriteOnce === true
    ) {
      this.#plan.failInboxWriteOnce = false;
      return Promise.reject(new Error("Inbox write failed."));
    }

    if (this.#isDedupStorage()) {
      if (
        expected === undefined &&
        next !== undefined &&
        this.#plan.failDedupClaimAlways === true
      ) {
        return Promise.resolve(false);
      }

      if (next === undefined && this.#plan.skipDedupDeleteOnce === true) {
        this.#plan.skipDedupDeleteOnce = false;
        return Promise.resolve(false);
      }

      if (
        expected !== undefined &&
        next === undefined &&
        this.#plan.throwDedupRollbackOnce === true
      ) {
        this.#plan.throwDedupRollbackOnce = false;
        return Promise.reject(new Error("Dedup rollback failed."));
      }

      if (
        expected !== undefined &&
        next !== undefined &&
        this.#plan.skipDedupFinalizeOnce === true
      ) {
        this.#plan.skipDedupFinalizeOnce = false;
        return Promise.resolve(false);
      }

      if (
        expected !== undefined &&
        next !== undefined &&
        this.#plan.throwDedupFinalizeOnce === true
      ) {
        this.#plan.throwDedupFinalizeOnce = false;
        return Promise.reject(new Error("Dedup finalize failed."));
      }
    }

    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly { id: I; record: R }[]> {
    return this.#delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return this.#delegate.read(id);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    return this.#delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    return this.#delegate.write(record.record);
  }

  #isDedupStorage(): boolean {
    return this.context.name.endsWith(".delivery.inbox-dedup");
  }

  #isInboxStorage(): boolean {
    return this.context.name.endsWith(".delivery.inbox");
  }
}

class SlowInboxCreateFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  readonly #firstCreate = new Deferred<void>();
  readonly #contender = new Deferred<void>();
  readonly #release = new Deferred<void>();
  #phase: "READY" | "BLOCKED" | "RELEASED" = "READY";

  waitForBlockedCreate(): Promise<void> {
    return this.#firstCreate.promise;
  }

  waitForContender(): Promise<void> {
    return this.#contender.promise;
  }

  releaseFirstCreate(): void {
    this.#release.resolve(undefined);
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new SlowInboxCreateStorage(context, recordSpec, storage, this);
  }

  notifyBlockedCreate(): void {
    this.#phase = "BLOCKED";
    this.#firstCreate.resolve(undefined);
  }

  notifyContender(): void {
    if (this.#phase === "BLOCKED") {
      this.#contender.resolve(undefined);
    }
  }

  async waitForRelease(): Promise<void> {
    await this.#release.promise;
    this.#phase = "RELEASED";
  }

  nextInboxCreateAction(): "BLOCK" | "CONTENDER" | "PASS" {
    if (this.#phase === "READY") {
      return "BLOCK";
    }
    if (this.#phase === "BLOCKED") {
      return "CONTENDER";
    }
    return "PASS";
  }
}

class SlowInboxCreateStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #factory: SlowInboxCreateFactory;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    factory: SlowInboxCreateFactory,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#factory = factory;
  }

  override close(): void {
    this.#delegate.close();
    super.close();
  }

  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    if (this.#isInboxStorage() && expected === undefined && next !== undefined) {
      const action = this.#factory.nextInboxCreateAction();
      if (action === "BLOCK") {
        this.#factory.notifyBlockedCreate();
        await this.#factory.waitForRelease();
      } else if (action === "CONTENDER") {
        this.#factory.notifyContender();
      }
    }

    return this.#delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly { id: I; record: R }[]> {
    return this.#delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return this.#delegate.read(id);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    return this.#delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    return this.#delegate.write(record.record);
  }

  #isInboxStorage(): boolean {
    return this.context.name.endsWith(".delivery.inbox");
  }
}

class Deferred<T> {
  readonly promise: Promise<T>;
  #resolve!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.#resolve = resolve;
    });
  }

  resolve(value: T): void {
    this.#resolve(value);
  }
}

function unclonableStoredRecord(): Any {
  return {} as Any;
}

class CorruptGuardFactory extends StorageFactory {
  readonly #records: CorruptGuardRecords;

  constructor(records: CorruptGuardRecords) {
    super();
    this.#records = records;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new CorruptGuardStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this.#records,
    ) as unknown as RecordStorage<I, R>;
  }
}

interface CorruptGuardRecords {
  readonly guard: Any;
  readonly inbox?: Any;
}

class CorruptGuardStorage extends RecordStorage<string, Any> {
  readonly #records: CorruptGuardRecords;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    records: CorruptGuardRecords,
  ) {
    super(context, recordSpec);
    this.#records = records;
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(): Promise<readonly { id: string; record: Any }[]> {
    return Promise.resolve([]);
  }

  protected readRecord(): Promise<Any | undefined> {
    if (this.context.name.endsWith(".delivery.inbox-dedup")) {
      return Promise.resolve(this.#records.guard);
    }

    if (this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve(this.#records.inbox);
    }

    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class CloneFailFactory extends StorageFactory {
  readonly #records: CloneFailPlan;
  readonly #dedup = new Map<string, Any>();
  readonly #inbox = new Map<string, Any>();

  constructor(records: CloneFailPlan) {
    super();
    this.#records = records;
    if (records.dedupRead !== undefined) {
      this.#dedup.set(testDedupKey("signal-1"), records.dedupRead);
    }
    if (records.inboxRead !== undefined) {
      this.#inbox.set("0/1:message-1", records.inboxRead);
    }
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new CloneFailStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this.#records,
      this.#dedup,
      this.#inbox,
    ) as unknown as RecordStorage<I, R>;
  }
}

interface CloneFailPlan {
  readonly dedupRead?: Any;
  readonly inboxQueryEntries?: readonly Any[];
  readonly inboxRead?: Any;
  readonly failInboxCreate?: boolean;
  readonly failInboxCreateAlways?: boolean;
  readonly throwInboxCreateCloneFailure?: boolean;
}

class CloneFailStorage extends RecordStorage<string, Any> {
  readonly #records: CloneFailPlan;
  readonly #dedup: Map<string, Any>;
  readonly #inbox: Map<string, Any>;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    records: CloneFailPlan,
    dedup: Map<string, Any>,
    inbox: Map<string, Any>,
  ) {
    super(context, recordSpec);
    this.#records = records;
    this.#dedup = dedup;
    this.#inbox = inbox;
  }

  protected compareAndSetRecord(
    id: string,
    expected: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
  ): Promise<boolean> {
    if (
      this.context.name.endsWith(".delivery.inbox") &&
      expected === undefined &&
      next !== undefined
    ) {
      if (this.#records.throwInboxCreateCloneFailure === true) {
        return Promise.reject(new Error("Storage record could not be cloned."));
      }
      if (this.#records.failInboxCreateAlways === true) {
        return Promise.resolve(false);
      }
      if (this.#records.failInboxCreate === true) {
        return Promise.resolve(false);
      }
    }

    if (this.context.name.endsWith(".delivery.inbox-dedup")) {
      const current = this.#dedup.get(id);
      if (current !== expected?.record && !(current === undefined && expected === undefined)) {
        return Promise.resolve(false);
      }

      if (next === undefined) {
        this.#dedup.delete(id);
        return Promise.resolve(true);
      }

      this.#dedup.set(id, next.record);
      return Promise.resolve(true);
    }

    if (this.context.name.endsWith(".delivery.inbox")) {
      const current = this.#inbox.get(id);
      if (current !== expected?.record && !(current === undefined && expected === undefined)) {
        return Promise.resolve(false);
      }

      if (next === undefined) {
        this.#inbox.delete(id);
        return Promise.resolve(true);
      }

      this.#inbox.set(id, next.record);
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(): Promise<readonly { id: string; record: Any }[]> {
    if (!this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      (this.#records.inboxQueryEntries ?? []).map((record, index) => ({
        id: `0/1:query-${String(index)}`,
        record,
      })),
    );
  }

  protected readRecord(id: string): Promise<Any | undefined> {
    if (this.context.name.endsWith(".delivery.inbox-dedup")) {
      return Promise.resolve(this.#dedup.get(id));
    }

    if (this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve(this.#inbox.get(id) ?? this.#records.inboxRead);
    }

    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

function cloneFailsOnReuse(record: Any): Any {
  const rematerialized = {
    ...create(AnySchema, record),
    value: Buffer.from(record.value),
  } as unknown as Any & { clone: () => Any };
  rematerialized.clone = () => {
    throw new Error("Storage record could not be cloned.");
  };

  const firstRead = {
    ...create(AnySchema, record),
    value: Buffer.from(record.value),
  } as unknown as Any & { clone: () => Any };
  firstRead.clone = () => rematerialized;
  return firstRead;
}

function pendingThenFinalDedupRecord(message: ReturnType<typeof createMessage>): Any {
  const pending = DedupRecords.writeClaim(message);
  const final = DedupRecords.writeFinal(message);
  let reads = 0;

  const record = {
    typeUrl: pending.typeUrl,
    get value(): Uint8Array {
      reads += 1;
      return reads <= 2 ? pending.value : final.value;
    },
  } as Any & { clone: () => Any };
  record.clone = () => record;

  return record;
}

class ExistingInboxRowFactory extends StorageFactory {
  readonly #inbox: Any;

  constructor(records: { inbox: Any }) {
    super();
    this.#inbox = records.inbox;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new ExistingInboxRowStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this.#inbox,
    ) as unknown as RecordStorage<I, R>;
  }
}

class ExistingInboxRowStorage extends RecordStorage<string, Any> {
  readonly #inbox: Any;
  readonly #dedup = new Map<string, Any>();

  constructor(context: StorageContext, recordSpec: RecordSpec<string, Any>, inbox: Any) {
    super(context, recordSpec);
    this.#inbox = inbox;
  }

  protected compareAndSetRecord(
    id: string,
    expected: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
  ): Promise<boolean> {
    if (this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve(false);
    }

    const current = this.#dedup.get(id);
    if (current !== expected?.record && !(current === undefined && expected === undefined)) {
      return Promise.resolve(false);
    }

    if (next === undefined) {
      this.#dedup.delete(id);
      return Promise.resolve(true);
    }

    this.#dedup.set(id, next.record);
    return Promise.resolve(true);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecordEntries(): Promise<readonly { id: string; record: Any }[]> {
    return Promise.resolve([]);
  }

  protected readRecord(id: string): Promise<Any | undefined> {
    return this.context.name.endsWith(".delivery.inbox")
      ? Promise.resolve(this.#inbox)
      : Promise.resolve(this.#dedup.get(id));
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

class RecoverPendingConflictFactory extends StorageFactory {
  readonly #dedup = new Map<string, Any>();
  readonly #inbox = new Map<string, Any>();
  readonly #conflictingInbox: Any;
  #hasHiddenConflictingInbox = false;

  constructor(records: { pendingGuard: Any; conflictingInbox: Any }) {
    super();
    this.#conflictingInbox = records.conflictingInbox;
    this.#dedup.set(testDedupKey("signal-1"), records.pendingGuard);
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new RecoverPendingConflictStorage(
      context,
      recordSpec as unknown as RecordSpec<string, Any>,
      this,
    ) as unknown as RecordStorage<I, R>;
  }

  readDedup(id: string): Any | undefined {
    return this.#dedup.get(id);
  }

  compareAndSetDedup(id: string, expected: Any | undefined, next: Any | undefined): boolean {
    const current = this.#dedup.get(id);
    if (!sameStoredRecord(current, expected)) {
      return false;
    }

    if (next === undefined) {
      this.#dedup.delete(id);
      return true;
    }

    this.#dedup.set(id, next);
    return true;
  }

  readInbox(id: string): Any | undefined {
    if (id === "0/1:message-1" && !this.#hasHiddenConflictingInbox) {
      this.#hasHiddenConflictingInbox = true;
      return undefined;
    }

    return this.#inbox.get(id);
  }

  compareAndSetInbox(id: string, expected: Any | undefined, next: Any | undefined): boolean {
    const current = this.#inbox.get(id);
    if (!sameStoredRecord(current, expected)) {
      return false;
    }

    if (id === "0/1:message-1" && expected === undefined && next !== undefined) {
      this.#inbox.set(id, this.#conflictingInbox);
      return false;
    }

    if (next === undefined) {
      this.#inbox.delete(id);
      return true;
    }

    this.#inbox.set(id, next);
    return true;
  }

  queryInbox(): readonly Any[] {
    return [...this.#inbox.values()];
  }
}

class RecoverPendingConflictStorage extends RecordStorage<string, Any> {
  readonly #factory: RecoverPendingConflictFactory;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<string, Any>,
    factory: RecoverPendingConflictFactory,
  ) {
    super(context, recordSpec);
    this.#factory = factory;
  }

  protected compareAndSetRecord(
    id: string,
    expected: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<string, Any>["materialize"]> | undefined,
  ): Promise<boolean> {
    if (this.context.name.endsWith(".delivery.inbox-dedup")) {
      return Promise.resolve(this.#factory.compareAndSetDedup(id, expected?.record, next?.record));
    }

    if (this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve(this.#factory.compareAndSetInbox(id, expected?.record, next?.record));
    }

    return Promise.resolve(false);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected override queryRecordEntries(): Promise<readonly { id: string; record: Any }[]> {
    return Promise.resolve(
      this.context.name.endsWith(".delivery.inbox")
        ? this.#factory.queryInbox().map((record) => ({
            id: this.recordSpec.idValueIn(record),
            record,
          }))
        : [],
    );
  }

  protected readRecord(id: string): Promise<Any | undefined> {
    if (this.context.name.endsWith(".delivery.inbox-dedup")) {
      return Promise.resolve(this.#factory.readDedup(id));
    }

    if (this.context.name.endsWith(".delivery.inbox")) {
      return Promise.resolve(this.#factory.readInbox(id));
    }

    return Promise.resolve(undefined);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}

function sameStoredRecord(left: Any | undefined, right: Any | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.typeUrl === right.typeUrl && Buffer.from(left.value).equals(Buffer.from(right.value));
}
