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

import { ShardIndex, type InboxMessage } from "../../src/index.js";

export function createMessage(
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

export class FakeStorageFactory extends StorageFactory {
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

export class FaultyStorageFactory extends StorageFactory {
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

export interface FaultPlan {
  failInboxWriteOnce?: boolean;
  skipDedupDeleteOnce?: boolean;
  skipDedupFinalizeOnce?: boolean;
  throwDedupFinalizeOnce?: boolean;
}

export class SlowInboxCreateFactory extends StorageFactory {
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

  protected queryRecords(query: RecordQuery<I>): Promise<readonly R[]> {
    return this.#delegate.query(query);
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
      if (next === undefined && this.#plan.skipDedupDeleteOnce === true) {
        this.#plan.skipDedupDeleteOnce = false;
        return Promise.resolve(false);
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

  protected queryRecords(query: RecordQuery<I>): Promise<readonly R[]> {
    return this.#delegate.query(query);
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

export class CorruptGuardFactory extends StorageFactory {
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

  protected queryRecords(): Promise<readonly Any[]> {
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

interface CorruptGuardRecords {
  readonly guard: Any;
  readonly inbox?: Any;
}

export class ExistingInboxRowFactory extends StorageFactory {
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

export class RecoverPendingConflictFactory extends StorageFactory {
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

  protected queryRecords(): Promise<readonly Any[]> {
    return Promise.resolve(
      this.context.name.endsWith(".delivery.inbox") ? this.#factory.queryInbox() : [],
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

  protected queryRecords(): Promise<readonly Any[]> {
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

interface FinalGuardFields {
  readonly key: string;
  readonly inbox: string;
  readonly signalId: string;
  readonly inboxMessageId: string;
}

interface PendingGuardFields {
  readonly signalId: string;
  readonly valueBase64: string;
}

export function finalDedupRecord(fields: FinalGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
    value: Buffer.from(
      JSON.stringify({
        ...fields,
        shardIndex: 0,
        shardTotal: 1,
        state: "FINAL",
        status: "TO_DELIVER",
      }),
      "utf8",
    ),
  });
}

export function pendingDedupRecord(fields: PendingGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxDedupRecord",
    value: Buffer.from(
      JSON.stringify({
        key: testDedupKey(fields.signalId),
        state: "PENDING",
        message: storedInboxJson(fields),
      }),
      "utf8",
    ),
  });
}

export function storedInboxRecord(fields: PendingGuardFields): Any {
  return create(AnySchema, {
    typeUrl: "type.spine-ts.dev/internal/InboxMessageRecord",
    value: Buffer.from(JSON.stringify(storedInboxJson(fields)), "utf8"),
  });
}

export function storedInboxJson(fields: PendingGuardFields): Record<string, unknown> {
  return {
    key: "0/1:message-1",
    id: "message-1",
    shard: "0/1",
    shardIndex: 0,
    shardTotal: 1,
    inbox: testInboxKey,
    inboxId: {
      targetId: "projection-1",
      targetTypeUrl: "type.example.dev/tasks.Projection",
    },
    signalId: fields.signalId,
    signal: {
      typeUrl: "type.example.dev/tasks.LargeSignal",
      valueBase64: fields.valueBase64,
    },
    label: "UPDATE_SUBSCRIBER",
    status: "TO_DELIVER",
    whenReceivedMs: Date.parse("2026-07-02T08:00:00.000Z"),
    version: "1",
  };
}

export function invalidUtf8JsonBytes(value: Record<string, unknown>, marker: string): Buffer {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  const markerBytes = Buffer.from(marker, "utf8");
  const markerIndex = encoded.indexOf(markerBytes);

  if (markerIndex < 0) {
    throw new Error(`Expected marker "${marker}" in encoded JSON.`);
  }

  return Buffer.concat([
    encoded.subarray(0, markerIndex),
    Buffer.from([0x80]),
    encoded.subarray(markerIndex + 1),
  ]);
}

function sameStoredRecord(left: Any | undefined, right: Any | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return left.typeUrl === right.typeUrl && Buffer.from(left.value).equals(Buffer.from(right.value));
}

export function oversizedPayload(): string {
  return Buffer.alloc(256 * 1024 + 1).toString("base64");
}

export function oversizedStoredRecord(): Buffer {
  return Buffer.concat([Buffer.from("{", "utf8"), Buffer.alloc(512 * 1024)]);
}

export function oversizedText(length: number, char = "x"): string {
  return char.repeat(length);
}

export function oversizedVersion(): bigint {
  return BigInt(`1${"0".repeat(16 * 1024)}`);
}

export function testDedupKey(signalId: string): string {
  return `${testInboxKey}:${signalId}`;
}

export const testInboxKey = JSON.stringify({
  targetId: "projection-1",
  targetTypeUrl: "type.example.dev/tasks.Projection",
});
