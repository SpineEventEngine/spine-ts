import { create, type Message } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import {
  type RecordQuery,
  type RecordSpec,
  RecordStorage,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";

import {
  DedupRecords,
  dedupRecordSpec,
  InboxRecords,
  inboxRecordSpec,
} from "../../src/delivery/inbox-records.js";
import type { InboxId, InboxMessage } from "../../src/index.js";

export interface DeliveryFaultPlan {
  blockInboxClaimOnce?: boolean;
  blockInboxRenewalOnce?: boolean;
  throwInboxClaimOnce?: boolean;
  throwInboxClearOnce?: boolean;
  skipInboxClearOnce?: boolean;
  skipDedupFinalizeOnce?: boolean;
  skipInboxRepairOnce?: boolean;
  throwDedupFinalizeOnce?: boolean;
  onInboxReadOnce?: () => void;
  inboxClaimBlocked?: Deferred<undefined>;
  resumeInboxClaim?: Deferred<undefined>;
  inboxRenewalBlocked?: Deferred<undefined>;
  resumeInboxRenewal?: Deferred<undefined>;
  blockedInboxClaims?: number;
  blockedInboxRenewals?: number;
  thrownInboxClaims?: number;
  thrownInboxClears?: number;
  skippedInboxClears?: number;
  skippedDedupFinalizations?: number;
  skippedInboxRepairs?: number;
  opens?: number;
  compareAndSets?: number;
  inboxQueries?: number;
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export class FaultyDeliveryStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();
  readonly #plan: DeliveryFaultPlan;

  constructor(plan: DeliveryFaultPlan) {
    super();
    this.#plan = plan;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.#plan.opens = (this.#plan.opens ?? 0) + 1;
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new FaultyDeliveryRecordStorage(context, recordSpec, storage, this.#plan);
  }
}

export function deliveryDedupRecords(storageFactory: StorageFactory) {
  return storageFactory.createRecordStorage(
    { name: "Tasks.delivery.inbox-dedup", multitenant: false },
    dedupRecordSpec,
  );
}

export function deliveryInboxRecords(storageFactory: StorageFactory) {
  return storageFactory.createRecordStorage(
    { name: "Tasks.delivery.inbox", multitenant: false },
    inboxRecordSpec,
  );
}

export function messageKey(message: InboxMessage): string {
  return `${message.id.shard.key()}:${message.id.value}`;
}

export function targetInbox(): InboxId {
  return {
    targetId: "projection-1",
    targetTypeUrl: "type.example.dev/tasks.Projection",
  };
}

function isInboxClaimClear<I, R extends Message>(id: I, expected: R, next: R): boolean {
  if (typeof id !== "string") {
    return false;
  }

  const current = InboxRecords.read(expected as Any, id);
  const unclaimed = InboxRecords.read(next as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    unclaimed.status === "TO_DELIVER" &&
    current.claim !== undefined &&
    unclaimed.claim === undefined
  );
}

function isInboxClaimCreation<I, R extends Message>(id: I, expected: R, next: R): boolean {
  if (typeof id !== "string") {
    return false;
  }

  const current = InboxRecords.read(expected as Any, id);
  const claimed = InboxRecords.read(next as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    claimed.status === "TO_DELIVER" &&
    current.claim === undefined &&
    claimed.claim !== undefined
  );
}

function isInboxClaimRenewal<I, R extends Message>(id: I, expected: R, next: R): boolean {
  if (typeof id !== "string") {
    return false;
  }

  const current = InboxRecords.read(expected as Any, id);
  const renewed = InboxRecords.read(next as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    renewed.status === "TO_DELIVER" &&
    current.claim !== undefined &&
    renewed.claim !== undefined &&
    current.claim.id === renewed.claim.id &&
    current.claim.node === renewed.claim.node &&
    current.claim.expiresAt.getTime() !== renewed.claim.expiresAt.getTime()
  );
}

class FaultyDeliveryRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #delegate: RecordStorage<I, R>;
  readonly #plan: DeliveryFaultPlan;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    delegate: RecordStorage<I, R>,
    plan: DeliveryFaultPlan,
  ) {
    super(context, recordSpec);
    this.#delegate = delegate;
    this.#plan = plan;
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
    this.#plan.compareAndSets = (this.#plan.compareAndSets ?? 0) + 1;

    return (
      (await this.#maybeThrowInboxClaim(id, expected, next)) ??
      (await this.#maybeBlockInboxClaim(id, expected, next)) ??
      (await this.#maybeBlockInboxRenewal(id, expected, next)) ??
      (await this.#maybeThrowInboxClear(id, expected, next)) ??
      (await this.#maybeSkipInboxClear(id, expected, next)) ??
      (await this.#maybeSkipInboxRepair(expected, next)) ??
      (await this.#maybeSkipDedupFinalize(expected, next)) ??
      (await this.#maybeThrowDedupFinalize(expected, next)) ??
      this.#delegate.compareAndSet(id, expected?.record, next?.record)
    );
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.#delegate.delete(id);
  }

  protected override queryRecordEntries(
    query: RecordQuery<I>,
  ): Promise<readonly { id: I; record: R }[]> {
    if (this.context.name.endsWith(".delivery.inbox")) {
      this.#plan.inboxQueries = (this.#plan.inboxQueries ?? 0) + 1;
    }

    return this.#delegate.queryEntries(query);
  }

  protected async readRecord(id: I): Promise<R | undefined> {
    const record = await this.#delegate.read(id);
    if (this.context.name.endsWith(".delivery.inbox") && this.#plan.onInboxReadOnce !== undefined) {
      const onInboxRead = this.#plan.onInboxReadOnce;
      this.#plan.onInboxReadOnce = undefined;
      onInboxRead();
    }

    return record;
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    return this.#delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    return this.#delegate.write(record.record);
  }

  async #maybeBlockInboxClaim(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.blockInboxClaimOnce !== true ||
      !isInboxClaimCreation(id, expected.record, next.record)
    ) {
      return undefined;
    }

    this.#plan.blockInboxClaimOnce = false;
    this.#plan.blockedInboxClaims = (this.#plan.blockedInboxClaims ?? 0) + 1;
    this.#plan.inboxClaimBlocked?.resolve(undefined);
    await this.#plan.resumeInboxClaim?.promise;

    return undefined;
  }

  async #maybeBlockInboxRenewal(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.blockInboxRenewalOnce !== true ||
      !isInboxClaimRenewal(id, expected.record, next.record)
    ) {
      return undefined;
    }

    this.#plan.blockInboxRenewalOnce = false;
    this.#plan.blockedInboxRenewals = (this.#plan.blockedInboxRenewals ?? 0) + 1;
    this.#plan.inboxRenewalBlocked?.resolve(undefined);
    await this.#plan.resumeInboxRenewal?.promise;

    return undefined;
  }

  async #maybeSkipDedupFinalize(
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox-dedup") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.skipDedupFinalizeOnce !== true
    ) {
      return undefined;
    }

    this.#plan.skipDedupFinalizeOnce = false;
    this.#plan.skippedDedupFinalizations = (this.#plan.skippedDedupFinalizations ?? 0) + 1;

    return false;
  }

  async #maybeSkipInboxClear(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.skipInboxClearOnce !== true ||
      !isInboxClaimClear(id, expected.record, next.record)
    ) {
      return undefined;
    }

    this.#plan.skipInboxClearOnce = false;
    this.#plan.skippedInboxClears = (this.#plan.skippedInboxClears ?? 0) + 1;
    const current = InboxRecords.read(expected.record as Any, id as string);
    const changed = Object.freeze({
      ...current,
      claim: Object.freeze({
        id: "competing-cleanup-owner",
        node: "node-b",
        expiresAt: new Date("2026-07-08T09:01:00.000Z"),
      }),
    });
    await this.#delegate.compareAndSet(id, expected.record, InboxRecords.write(changed) as R);

    return false;
  }

  async #maybeSkipInboxRepair(
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.skipInboxRepairOnce !== true
    ) {
      return undefined;
    }

    this.#plan.skipInboxRepairOnce = false;
    this.#plan.skippedInboxRepairs = (this.#plan.skippedInboxRepairs ?? 0) + 1;

    return false;
  }

  async #maybeThrowDedupFinalize(
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox-dedup") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.throwDedupFinalizeOnce !== true
    ) {
      return undefined;
    }

    this.#plan.throwDedupFinalizeOnce = false;

    return Promise.reject(new Error("Dedup finalize failed."));
  }

  async #maybeThrowInboxClaim(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.throwInboxClaimOnce !== true ||
      !isInboxClaimCreation(id, expected.record, next.record)
    ) {
      return undefined;
    }

    this.#plan.throwInboxClaimOnce = false;
    this.#plan.thrownInboxClaims = (this.#plan.thrownInboxClaims ?? 0) + 1;

    return Promise.reject(new Error("Inbox claim failed."));
  }

  async #maybeThrowInboxClear(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean | undefined> {
    if (
      !this.context.name.endsWith(".delivery.inbox") ||
      expected === undefined ||
      next === undefined ||
      this.#plan.throwInboxClearOnce !== true ||
      !isInboxClaimClear(id, expected.record, next.record)
    ) {
      return undefined;
    }

    this.#plan.throwInboxClearOnce = false;
    this.#plan.thrownInboxClears = (this.#plan.thrownInboxClears ?? 0) + 1;

    return Promise.reject(new Error("Inbox claim clear failed."));
  }
}

export function packStoredRecord(template: Any, value: unknown): Any {
  return create(AnySchema, {
    typeUrl: template.typeUrl,
    value: Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8"),
  });
}

export function unpackStoredRecord(record: Any): Record<string, unknown> {
  return JSON.parse(Buffer.from(record.value).toString("utf8")) as Record<string, unknown>;
}
