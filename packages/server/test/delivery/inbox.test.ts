import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { DeliveryStorageCorruptionError } from "../../src/delivery/delivery-storage-error.js";
import {
  writeDedupClaim,
  writeDedupRecord,
  writeInboxMessage,
} from "../../src/delivery/inbox-records.js";
import {
  Delivery,
  Inbox,
  InboxMessageError,
  InboxStorage,
  ShardIndex,
  type DeliveryStatus,
  type InboxId,
} from "../../src/index.js";
import {
  CorruptGuardFactory,
  ExistingInboxRowFactory,
  FakeStorageFactory,
  FaultyStorageFactory,
  RecoverPendingConflictFactory,
  SlowInboxCreateFactory,
  createMessage,
  finalDedupRecord,
  invalidUtf8JsonBytes,
  oversizedPayload,
  oversizedStoredRecord,
  oversizedText,
  oversizedVersion,
  pendingDedupRecord,
  storedInboxJson,
  storedInboxRecord,
  testDedupKey,
  testInboxKey,
} from "./inbox-test-support.js";

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
    ).rejects.toThrow(/payload/i);
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
      writeDedupClaim({
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
      writeInboxMessage({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
    expect(() =>
      writeDedupClaim({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
    expect(() =>
      writeDedupRecord({
        ...createMessage("message-large", "signal-large", 1n),
        signalId: oversizedText(20 * 1024),
      }),
    ).toThrow(/signal id/i);
  });

  it("rejects oversized inbox target identity before building inbox and dedup keys", () => {
    const oversizedTargetId = () =>
      writeDedupClaim({
        ...createMessage("message-large", "signal-large", 1n),
        inboxId: {
          targetId: oversizedText(20 * 1024),
          targetTypeUrl: "type.example.dev/tasks.Projection",
        },
      });
    const oversizedTargetTypeUrl = () =>
      writeInboxMessage({
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
        inbox: writeInboxMessage(createMessage("message-2", "signal-1", 1n)),
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

  it("fails closed when pending dedup recovery finds a conflicting inbox row", async () => {
    const pending = createMessage("message-1", "signal-1", 1n);
    const conflicting = {
      ...createMessage("message-1", "signal-conflict", 1n),
      whenReceived: new Date("2026-07-02T08:00:01.000Z"),
    };
    const retryMessage = createMessage("message-2", "signal-1", 2n);
    const storageFactory = new RecoverPendingConflictFactory({
      pendingGuard: writeDedupClaim(pending),
      conflictingInbox: writeInboxMessage(conflicting),
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

    await expect(storage.write(createMessage("message-1", "signal-2", 2n))).rejects.toThrow(
      /already exists/i,
    );
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

  it("rejects oversized versions before building inbox or dedup records", () => {
    const message = createMessage("message-1", "signal-1", oversizedVersion());

    expect(() => writeInboxMessage(message)).toThrow(/version/i);
    expect(() => writeDedupClaim(message)).toThrow(/version/i);
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

    expect(() => writeDedupClaim(message)).toThrow(InboxMessageError);
    expect(() => writeDedupRecord(message)).toThrow(InboxMessageError);
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
        inbox: writeInboxMessage(createMessage("message-1", "signal-2", 1n)),
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
        inbox: writeInboxMessage(createMessage("message-2", "signal-1", 1n)),
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
        inbox: writeInboxMessage(createMessage("message-1", "signal-1", 1n)),
      }),
    });

    await expect(storage.write(createMessage("message-2", "signal-1", 2n))).rejects.toThrow(
      /storage key/i,
    );
  });
});

const liveStatuses: readonly DeliveryStatus[] = Object.freeze([
  "TO_DELIVER",
  "SCHEDULED",
  "TO_CATCH_UP",
]);
