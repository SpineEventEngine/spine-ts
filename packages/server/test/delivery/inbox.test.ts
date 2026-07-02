import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  InMemoryStorageFactory,
  RecordSpec,
  RecordStorage,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import {
  Delivery,
  Inbox,
  InboxStorage,
  ShardIndex,
  type DeliveryStatus,
  type InboxId,
  type InboxMessage,
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

  it("evaluates dedup retention against the storage clock instead of caller-supplied receive time", async () => {
    const inboxId: InboxId = {
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
});

const liveStatuses: readonly DeliveryStatus[] = Object.freeze([
  "TO_DELIVER",
  "SCHEDULED",
  "TO_CATCH_UP",
]);

function createMessage(
  id: string,
  signalId: string,
  version: bigint,
  whenReceived = new Date("2026-07-02T08:00:00.000Z"),
): InboxMessage {
  return Object.freeze({
    id: Object.freeze({
      value: id,
      shard: ShardIndex.single(),
    }),
    inboxId: Object.freeze({
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    }),
    signalId,
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard: ShardIndex.single(),
    whenReceived,
    version,
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

  protected queryRecords(): Promise<readonly Any[]> {
    return Promise.resolve(this.#records);
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
