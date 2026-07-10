import type { Any } from "@bufbuild/protobuf/wkt";
import type { RecordStorage, StorageContext, StorageFactory } from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import {
  InboxMessageError,
  type DeliveryStatus,
  type InboxMessage,
  type InboxMessageId,
  type InboxReadOptions,
  type InboxWriteResult,
} from "./inbox.js";
import {
  DedupRecords,
  dedupRecordSpec,
  InboxClaimRecords,
  InboxRecords,
  inboxRecordSpec,
  type DedupGuardState,
} from "./inbox-records.js";
import type { ClaimedInboxMessage, InboxClaim, InboxRecordMessage } from "./inbox-claim.js";
import type { ShardSession } from "./sharded-work-registry.js";
import { ShardIndex } from "./shard-index.js";

const defaultReadLimit = 100;
const maxReadLimit = 1_000;
const casRetryLimit = 8;

/** Durable inbox storage over record storage. */
export class InboxStorage {
  readonly #context: StorageContext;
  readonly #storageFactory: StorageFactory;
  readonly #now: () => Date;

  /** Open an inbox storage from one storage context and storage factory. */
  constructor(options: InboxStorageOptions) {
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#now = options.now ?? (() => new Date());
    inboxStorageInternals.set(this, {
      claim: (message, session) => this.#claimForDelivery(message, session),
      renew: (message, session) => this.#renewForDelivery(message, session),
      markDelivered: (message) => this.#markDelivered(message),
      unclaim: (message) => this.#unclaim(message),
    });
    Object.freeze(this);
  }

  /** Read ordered inbox messages for one shard. */
  async read(shard: ShardIndex, options: InboxReadOptions = {}): Promise<readonly InboxMessage[]> {
    const nextShard = requireReadShard(shard);
    const limit = requireInboxReadLimit(options.limit ?? defaultReadLimit);
    const offset = requireInboxReadOffset(options.offset ?? 0);
    const storage = this.#inboxStorage();

    try {
      const records = await this.#durableRead("Inbox record", () =>
        storage.queryEntries({
          filters: [
            { column: "shard", value: nextShard.key() },
            ...statusFilters(options.statuses),
          ],
          sort: [{ field: "receivedAt" }, { field: "version" }, { field: "messageId" }],
          limit,
          offset,
        }),
      );

      return Object.freeze(
        records.map((entry) => publicMessage(InboxRecords.read(entry.record, entry.id))),
      );
    } finally {
      storage.close();
    }
  }

  /** Read one exact durable inbox message by ID. */
  async readMessage(id: InboxMessageId): Promise<InboxMessage | undefined> {
    const key = this.#messageKey(id);
    const storage = this.#inboxStorage();

    try {
      const record = await this.#durableRead("Inbox record", () => storage.read(key));
      return record === undefined ? undefined : publicMessage(InboxRecords.read(record, key));
    } finally {
      storage.close();
    }
  }

  /** Write one inbox message unless a live dedup key already exists. */
  async write(message: InboxMessage): Promise<InboxWriteResult> {
    // Serialize the inbox row once so validation and all later CAS keys use
    // one immutable caller-input snapshot.
    const snapshot = InboxRecords.read(InboxRecords.write(requirePublicMessage(message)));
    DedupRecords.writeClaim(snapshot);

    const inboxStorage = this.#inboxStorage();
    const dedupStorage = this.#dedupStorage();

    try {
      return await this.#writeWithDedup(inboxStorage, dedupStorage, snapshot);
    } finally {
      inboxStorage.close();
      dedupStorage.close();
    }
  }

  /**
   * Mark one exact `TO_DELIVER` inbox message as `DELIVERED`.
   *
   * Returns `undefined` when the row is missing, is not pending, or does not
   * match the caller-provided message snapshot. Already-delivered rows are
   * returned idempotently only when they match the same message apart from the
   * status transition.
   */
  async markDelivered(message: InboxMessage): Promise<InboxMessage | undefined> {
    return this.#markDelivered(requirePublicMessage(message));
  }

  async #markDelivered(message: InboxRecordMessage): Promise<InboxMessage | undefined> {
    const snapshot = InboxRecords.read(InboxRecords.write(message));
    const inboxStorage = this.#inboxStorage();
    const dedupStorage = this.#dedupStorage();

    try {
      const delivered = await this.#markDeliveredWithDedup(inboxStorage, dedupStorage, snapshot);
      return delivered === undefined ? undefined : publicMessage(delivered);
    } finally {
      inboxStorage.close();
      dedupStorage.close();
    }
  }

  async #claimForDelivery(
    message: InboxMessage,
    session: ShardSession,
  ): Promise<ClaimedInboxMessage | undefined> {
    const snapshot = InboxRecords.read(InboxRecords.write(message));
    const inboxStorage = this.#inboxStorage();

    try {
      return await this.#claimMessage(inboxStorage, snapshot, claimFromSession(session));
    } finally {
      inboxStorage.close();
    }
  }

  async #renewForDelivery(
    message: ClaimedInboxMessage,
    session: ShardSession,
  ): Promise<ClaimedInboxMessage | undefined> {
    const snapshot = requireClaimed(InboxRecords.read(InboxRecords.write(message)));
    const inboxStorage = this.#inboxStorage();

    try {
      return await this.#renewClaim(inboxStorage, snapshot, claimFromSession(session));
    } finally {
      inboxStorage.close();
    }
  }

  async #unclaim(message: ClaimedInboxMessage): Promise<InboxMessage | undefined> {
    const snapshot = InboxRecords.read(InboxRecords.write(message));
    const inboxStorage = this.#inboxStorage();

    try {
      const unclaimed = await this.#unclaimMessage(inboxStorage, snapshot);
      return unclaimed === undefined ? undefined : publicMessage(unclaimed);
    } finally {
      inboxStorage.close();
    }
  }

  async #claimMessage(
    inboxStorage: RecordStorage<string, Any>,
    message: InboxRecordMessage,
    claim: InboxClaim,
  ): Promise<ClaimedInboxMessage | undefined> {
    const key = this.#messageKey(message.id);
    const nextClaim = InboxClaimRecords.snapshot(claim);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const currentRecord = await this.#durableRead("Inbox record", () => inboxStorage.read(key));
      if (currentRecord === undefined) {
        return undefined;
      }

      const current = InboxRecords.read(currentRecord, key);
      if (current.status !== "TO_DELIVER") {
        return undefined;
      }
      if (!this.#sameMessageExceptClaim(current, message)) {
        return undefined;
      }
      if (current.claim !== undefined) {
        return undefined;
      }

      const claimed = Object.freeze({
        ...current,
        claim: nextClaim,
      });
      const nextRecord = InboxRecords.write(claimed);
      const updated = await this.#durableCompareAndSet(
        "Inbox record",
        inboxStorage,
        key,
        currentRecord,
        nextRecord,
      );
      if (updated) {
        return requireClaimed(InboxRecords.read(nextRecord, key));
      }
    }

    throw casRetriesExhausted("Inbox claim");
  }

  async #renewClaim(
    inboxStorage: RecordStorage<string, Any>,
    message: ClaimedInboxMessage,
    claim: InboxClaim,
  ): Promise<ClaimedInboxMessage | undefined> {
    const key = this.#messageKey(message.id);
    const expectedRecord = InboxRecords.write(message);
    const nextClaim = InboxClaimRecords.snapshot(claim);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const currentRecord = await this.#durableRead("Inbox record", () => inboxStorage.read(key));
      if (currentRecord === undefined) {
        return undefined;
      }

      const current = InboxRecords.read(currentRecord, key);
      if (current.status !== "TO_DELIVER" || !this.#sameRecord(currentRecord, expectedRecord)) {
        return undefined;
      }

      const renewed = Object.freeze({
        ...current,
        claim: nextClaim,
      });
      const nextRecord = InboxRecords.write(renewed);
      const updated = await this.#durableCompareAndSet(
        "Inbox record",
        inboxStorage,
        key,
        currentRecord,
        nextRecord,
      );
      if (updated) {
        return requireClaimed(InboxRecords.read(nextRecord, key));
      }
    }

    throw casRetriesExhausted("Inbox claim renewal");
  }

  async #unclaimMessage(
    inboxStorage: RecordStorage<string, Any>,
    message: InboxRecordMessage,
  ): Promise<InboxRecordMessage | undefined> {
    const key = this.#messageKey(message.id);
    const expectedRecord = InboxRecords.write(message);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const currentRecord = await this.#durableRead("Inbox record", () => inboxStorage.read(key));
      if (currentRecord === undefined) {
        return undefined;
      }

      const current = InboxRecords.read(currentRecord, key);
      if (current.status !== "TO_DELIVER" || !this.#sameRecord(currentRecord, expectedRecord)) {
        return undefined;
      }

      const unclaimed = this.#withoutClaim(current);
      const nextRecord = InboxRecords.write(unclaimed);
      const updated = await this.#durableCompareAndSet(
        "Inbox record",
        inboxStorage,
        key,
        currentRecord,
        nextRecord,
      );
      if (updated) {
        return InboxRecords.read(nextRecord, key);
      }
    }

    throw casRetriesExhausted("Inbox claim release");
  }

  async #markDeliveredWithDedup(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    message: InboxMessage,
  ): Promise<InboxMessage | undefined> {
    const key = this.#messageKey(message.id);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const currentRecord = await this.#durableRead("Inbox record", () => inboxStorage.read(key));
      if (currentRecord === undefined) {
        return undefined;
      }

      const current = InboxRecords.read(currentRecord, key);
      if (current.status === "DELIVERED") {
        if (!this.#sameMessageExceptStatus(current, message)) {
          return undefined;
        }
        await this.#syncDeliveredDedupGuard(dedupStorage, current, current);
        return current;
      }
      if (current.status !== "TO_DELIVER") {
        return undefined;
      }
      if (!this.#sameRecord(currentRecord, InboxRecords.write(message))) {
        return undefined;
      }

      const delivered = Object.freeze({
        ...this.#withoutClaim(current),
        status: "DELIVERED" as const,
      });
      await this.#syncDeliveredDedupGuard(dedupStorage, current, delivered);

      const nextRecord = InboxRecords.write(delivered);
      const marked = await this.#durableCompareAndSet(
        "Inbox record",
        inboxStorage,
        key,
        currentRecord,
        nextRecord,
      );
      if (!marked) {
        continue;
      }

      return delivered;
    }

    throw casRetriesExhausted("Inbox delivery status");
  }

  async #syncDeliveredDedupGuard(
    dedupStorage: RecordStorage<string, Any>,
    expected: InboxMessage,
    delivered: InboxMessage,
  ): Promise<void> {
    const dedupKey = DedupRecords.guardKey(delivered);
    const nextRecord = DedupRecords.writeFinal(delivered);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const currentRecord = await this.#durableRead("Inbox dedup guard", () =>
        dedupStorage.read(dedupKey),
      );
      if (currentRecord === undefined) {
        throw new DeliveryStorageCorruptionError(
          `Inbox dedup guard "${dedupKey}" is missing for a delivered message.`,
        );
      }

      if (this.#sameRecord(currentRecord, nextRecord)) {
        return;
      }
      if (this.#dedupGuardMatches(currentRecord, dedupKey, delivered)) {
        return;
      }
      if (!this.#dedupGuardCanAdvance(currentRecord, dedupKey, expected)) {
        throw new DeliveryStorageCorruptionError(
          `Inbox dedup guard "${dedupKey}" does not match the delivered message.`,
        );
      }

      const updated = await this.#durableCompareAndSet(
        "Inbox dedup guard",
        dedupStorage,
        dedupKey,
        currentRecord,
        nextRecord,
      );
      if (updated) {
        return;
      }
    }

    throw casRetriesExhausted("Inbox dedup guard");
  }

  #dedupGuardMatches(record: Any, dedupKey: string, message: InboxMessage): boolean {
    const pending = DedupRecords.readPendingMessage(record);
    if (pending !== undefined) {
      return this.#sameRecord(InboxRecords.write(pending), InboxRecords.write(message));
    }

    const guard = DedupRecords.readGuard(record, dedupKey);
    return (
      this.#sameMessageId(guard.messageId, message.id) && this.#sameGuardMetadata(guard, message)
    );
  }

  #dedupGuardCanAdvance(record: Any, dedupKey: string, expected: InboxMessage): boolean {
    if (this.#dedupGuardMatches(record, dedupKey, expected)) {
      return true;
    }

    if (expected.status !== "DELIVERED") {
      return false;
    }

    return this.#dedupGuardMatches(
      record,
      dedupKey,
      Object.freeze({
        ...expected,
        status: "TO_DELIVER" as const,
      }),
    );
  }

  async #writeWithDedup(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    message: InboxMessage,
  ): Promise<InboxWriteResult> {
    const dedupKey = DedupRecords.guardKey(message);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      const step = await this.#readWriteStep(inboxStorage, dedupStorage, dedupKey, message);
      if (step.kind === "RETURN") {
        return step.result;
      }
      if (step.kind === "RETRY") {
        continue;
      }
      const result = await this.#claimAndWrite(inboxStorage, dedupStorage, dedupKey, step);
      if (result !== undefined) {
        return result;
      }
    }

    throw casRetriesExhausted("Inbox dedup guard");
  }

  async #readWriteStep(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const current = await this.#durableRead("Inbox dedup guard", () => dedupStorage.read(dedupKey));
    if (current === undefined) {
      return { kind: "CLAIM", expected: undefined, message };
    }

    const storedGuard = await this.#readGuardMessage(inboxStorage, dedupKey, current);

    if (storedGuard !== undefined) {
      return this.#handleStoredGuardMessage(
        inboxStorage,
        dedupStorage,
        dedupKey,
        current,
        storedGuard,
        message,
      );
    }

    if (!DedupRecords.isPending(current)) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${dedupKey}" points to a missing inbox message.`,
      );
    }

    return this.#recoverPendingClaim(inboxStorage, dedupStorage, dedupKey, current, message);
  }

  async #handleStoredGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    current: Any,
    storedGuard: GuardMessage,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const { guard, message: storedMessage } = storedGuard;

    const expected = await this.#finalizeStoredGuard(dedupStorage, dedupKey, current, storedGuard);
    if (expected === undefined) {
      return { kind: "RETRY" };
    }

    const repaired = await this.#repairStoredGuardMessage(
      inboxStorage,
      guard,
      storedGuard,
      expected,
      message,
    );
    if (repaired !== undefined) {
      return repaired;
    }

    return this.#messageBlocks(storedMessage)
      ? this.#duplicate(storedMessage)
      : { kind: "CLAIM", expected, message };
  }

  async #finalizeStoredGuard(
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    current: Any,
    storedGuard: GuardMessage,
  ): Promise<Any | undefined> {
    const { guard, message } = storedGuard;
    const shouldFinalize =
      DedupRecords.isPending(current) ||
      (guard.status === "TO_DELIVER" && message.status === "DELIVERED");
    if (!shouldFinalize) {
      return current;
    }

    const next = DedupRecords.writeFinal(message);
    const finalized = await this.#durableCompareAndSet(
      "Inbox dedup guard",
      dedupStorage,
      dedupKey,
      current,
      next,
    );

    return finalized ? next : undefined;
  }

  async #repairStoredGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    guard: DedupGuardState,
    storedGuard: GuardMessage,
    expected: Any,
    message: InboxMessage,
  ): Promise<WriteStep | undefined> {
    const storedMessage = storedGuard.message;
    if (guard.status !== "DELIVERED" || storedMessage.status !== "TO_DELIVER") {
      return undefined;
    }

    const delivered = Object.freeze({
      ...storedMessage,
      status: "DELIVERED" as const,
    });
    const repaired = await this.#durableCompareAndSet(
      "Inbox record",
      inboxStorage,
      this.#messageKey(storedMessage.id),
      storedGuard.record,
      InboxRecords.write(delivered),
    );
    if (!repaired) {
      return { kind: "RETRY" };
    }

    return this.#messageBlocks(delivered)
      ? this.#duplicate(delivered)
      : { kind: "CLAIM", expected, message };
  }

  async #recoverPendingClaim(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    current: Any,
    message: InboxMessage,
  ): Promise<WriteStep> {
    const pendingMessage = DedupRecords.readPendingMessage(current);
    if (pendingMessage === undefined) {
      return { kind: "RETRY" };
    }

    const storedMessage = await this.#ensureInboxRow(
      inboxStorage,
      pendingMessage,
      "STORAGE_CORRUPTION",
    );

    const finalRecord = DedupRecords.writeFinal(storedMessage);
    const finalized = await this.#durableCompareAndSet(
      "Inbox dedup guard",
      dedupStorage,
      dedupKey,
      current,
      finalRecord,
    );
    if (!finalized) {
      return { kind: "RETRY" };
    }

    return this.#messageBlocks(storedMessage)
      ? this.#written(storedMessage)
      : { kind: "CLAIM", expected: finalRecord, message };
  }

  async #claimAndWrite(
    inboxStorage: RecordStorage<string, Any>,
    dedupStorage: RecordStorage<string, Any>,
    dedupKey: string,
    step: WriteClaim,
  ): Promise<InboxWriteResult | undefined> {
    const pending = DedupRecords.writeClaim(step.message);
    const claimed = await this.#durableCompareAndSet(
      "Inbox dedup guard",
      dedupStorage,
      dedupKey,
      step.expected,
      pending,
    );
    if (!claimed) {
      return undefined;
    }

    let storedMessage: InboxMessage;
    try {
      storedMessage = await this.#ensureInboxRow(inboxStorage, step.message);
    } catch (error) {
      try {
        await this.#durableCompareAndSet(
          "Inbox dedup guard",
          dedupStorage,
          dedupKey,
          pending,
          step.expected,
        );
      } catch {
        // Preserve the original inbox-write failure even if rollback also fails.
      }
      throw error;
    }

    const finalized = await this.#durableCompareAndSet(
      "Inbox dedup guard",
      dedupStorage,
      dedupKey,
      pending,
      DedupRecords.writeFinal(storedMessage),
    );
    return finalized ? this.#written(storedMessage).result : undefined;
  }

  async #ensureInboxRow(
    inboxStorage: RecordStorage<string, Any>,
    message: InboxMessage,
    conflict: InboxConflict = "CALLER_INPUT",
  ): Promise<InboxMessage> {
    const key = this.#messageKey(message.id);
    const record = InboxRecords.write(message);

    for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
      if (await this.#durableCompareAndSet("Inbox record", inboxStorage, key, undefined, record)) {
        return InboxRecords.read(record);
      }

      const current = await this.#durableRead("Inbox record", () => inboxStorage.read(key));
      if (current === undefined) {
        continue;
      }

      const storedMessage = InboxRecords.read(current, key);
      if (this.#sameRecord(InboxRecords.write(storedMessage), record)) {
        return storedMessage;
      }

      if (conflict === "STORAGE_CORRUPTION") {
        throw new DeliveryStorageCorruptionError(
          `Inbox message "${key}" already exists with conflicting inbox bytes.`,
        );
      }

      throw new InboxMessageError(`Inbox message "${key}" already exists.`);
    }

    throw casRetriesExhausted("Inbox record");
  }

  async #readGuardMessage(
    inboxStorage: RecordStorage<string, Any>,
    dedupKey: string,
    guard: Any,
  ): Promise<GuardMessage | undefined> {
    const guardState = DedupRecords.readGuard(guard, dedupKey);
    const expectedKey = this.#messageKey(guardState.messageId);
    const storedRecord = await this.#durableRead("Inbox record", () =>
      inboxStorage.read(expectedKey),
    );
    if (storedRecord === undefined) {
      return undefined;
    }

    const message = InboxRecords.read(storedRecord, expectedKey);
    if (DedupRecords.guardKey(message) !== dedupKey) {
      throw new DeliveryStorageCorruptionError(
        `Inbox dedup guard "${dedupKey}" points to another dedup key.`,
      );
    }

    const pendingMessage = DedupRecords.isPending(guard)
      ? DedupRecords.readPendingMessage(guard)
      : undefined;
    if (
      pendingMessage !== undefined &&
      !this.#sameRecord(InboxRecords.write(pendingMessage), storedRecord)
    ) {
      throw new DeliveryStorageCorruptionError(
        `Inbox pending dedup guard "${dedupKey}" does not match the visible inbox row.`,
      );
    }

    if (
      pendingMessage === undefined &&
      !this.#sameGuardMetadata(guardState, message) &&
      !this.#sameDeliveryTransitionGuard(guardState, message)
    ) {
      throw new DeliveryStorageCorruptionError(
        `Inbox final dedup guard "${dedupKey}" does not match the visible inbox row.`,
      );
    }

    return Object.freeze({ guard: guardState, message, record: storedRecord });
  }

  #messageBlocks(message: Pick<InboxMessage, "status" | "keepUntil">): boolean {
    if (message.status !== "DELIVERED") {
      return true;
    }

    const keepUntil = message.keepUntil;
    if (keepUntil === undefined) {
      return false;
    }

    return keepUntil.getTime() >= this.#dedupNow();
  }

  #dedupNow(): number {
    const now = this.#now();
    if (!(now instanceof Date)) {
      throw new Error("Inbox storage clock must return a Date.");
    }

    const time = now.getTime();
    if (!Number.isFinite(time)) {
      throw new Error("Inbox storage clock returned an invalid time.");
    }

    return time;
  }

  #sameRecord(left: Any, right: Any): boolean {
    return (
      left.typeUrl === right.typeUrl && Buffer.from(left.value).equals(Buffer.from(right.value))
    );
  }

  #sameGuardMetadata(
    guard: Pick<DedupGuardState, "status" | "keepUntil">,
    message: Pick<InboxMessage, "status" | "keepUntil">,
  ): boolean {
    return guard.status === message.status && this.#sameTime(guard.keepUntil, message.keepUntil);
  }

  #sameDeliveryTransitionGuard(
    guard: Pick<DedupGuardState, "status" | "keepUntil">,
    message: Pick<InboxMessage, "status" | "keepUntil">,
  ): boolean {
    return (
      this.#sameTime(guard.keepUntil, message.keepUntil) &&
      ((guard.status === "TO_DELIVER" && message.status === "DELIVERED") ||
        (guard.status === "DELIVERED" && message.status === "TO_DELIVER"))
    );
  }

  #sameTime(left: Date | undefined, right: Date | undefined): boolean {
    return left?.getTime() === right?.getTime();
  }

  #sameMessageId(left: InboxMessage["id"], right: InboxMessage["id"]): boolean {
    return left.value === right.value && left.shard.key() === right.shard.key();
  }

  #sameMessageExceptStatus(left: InboxRecordMessage, right: InboxRecordMessage): boolean {
    return this.#sameRecord(
      InboxRecords.write({
        ...left,
        status: right.status,
      }),
      InboxRecords.write(right),
    );
  }

  #sameMessageExceptClaim(left: InboxRecordMessage, right: InboxRecordMessage): boolean {
    return this.#sameRecord(
      InboxRecords.write(this.#withClaim(left, right.claim)),
      InboxRecords.write(right),
    );
  }

  #withClaim(message: InboxRecordMessage, claim: InboxClaim | undefined): InboxRecordMessage {
    const unclaimed = this.#withoutClaim(message);
    return claim === undefined ? unclaimed : Object.freeze({ ...unclaimed, claim });
  }

  #withoutClaim(message: InboxRecordMessage): InboxMessage {
    const { claim: _claim, ...unclaimed } = message;
    return Object.freeze(unclaimed);
  }

  async #durableRead<T>(label: string, read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      throw this.#storageCorruptionError(label, error);
    }
  }

  async #durableCompareAndSet(
    label: string,
    storage: RecordStorage<string, Any>,
    id: string,
    expected: Any | undefined,
    next: Any | undefined,
  ): Promise<boolean> {
    try {
      return await storage.compareAndSet(id, expected, next);
    } catch (error) {
      throw this.#storageCorruptionError(label, error);
    }
  }

  #storageCorruptionError(label: string, error: unknown): Error {
    if (
      error instanceof Error &&
      (error.message === "Storage record could not be cloned." ||
        error.message === "Storage value could not be cloned.")
    ) {
      return new DeliveryStorageCorruptionError(`${label} is invalid.`, {
        cause: error,
      });
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  #written(message: InboxMessage): WriteReturn {
    return {
      kind: "RETURN",
      result: Object.freeze({
        outcome: "WRITTEN" as const,
        message: publicMessage(message),
      }),
    };
  }

  #duplicate(message: InboxMessage): WriteReturn {
    return {
      kind: "RETURN",
      result: Object.freeze({
        outcome: "DUPLICATE" as const,
        message: publicMessage(message),
      }),
    };
  }

  #messageKey(id: Pick<InboxMessage["id"], "value" | "shard">): string {
    return `${id.shard.key()}:${id.value}`;
  }

  #inboxStorage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      inboxStorageContext(this.#context),
      inboxRecordSpec,
    );
  }

  #dedupStorage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      dedupStorageContext(this.#context),
      dedupRecordSpec,
    );
  }
}

/** @internal Internal claim-bearing access for delivery workers. */
export interface InboxStorageAccess {
  readonly maxReadLimit: number;
  readonly readLimit: (value: unknown) => number;
  readonly claim: (
    storage: InboxStorage,
    message: InboxMessage,
    session: ShardSession,
  ) => Promise<ClaimedInboxMessage | undefined>;
  readonly renew: (
    storage: InboxStorage,
    message: ClaimedInboxMessage,
    session: ShardSession,
  ) => Promise<ClaimedInboxMessage | undefined>;
  readonly markDelivered: (
    storage: InboxStorage,
    message: ClaimedInboxMessage,
  ) => Promise<InboxMessage | undefined>;
  readonly clear: (
    storage: InboxStorage,
    message: ClaimedInboxMessage,
  ) => Promise<InboxMessage | undefined>;
}

/** @internal Internal claim-bearing access for delivery workers. */
export const inboxStorageAccess: InboxStorageAccess = Object.freeze({
  maxReadLimit,
  readLimit(value: unknown = defaultReadLimit) {
    return requireInboxReadLimit(value);
  },
  claim(storage: InboxStorage, message: InboxMessage, session: ShardSession) {
    return requireInternals(storage).claim(message, session);
  },
  renew(storage: InboxStorage, message: ClaimedInboxMessage, session: ShardSession) {
    return requireInternals(storage).renew(message, session);
  },
  markDelivered(storage: InboxStorage, message: ClaimedInboxMessage) {
    return requireInternals(storage).markDelivered(message);
  },
  clear(storage: InboxStorage, message: ClaimedInboxMessage) {
    return requireInternals(storage).unclaim(message);
  },
});

/** Inbox storage construction options. */
export interface InboxStorageOptions {
  /** Storage context owning this inbox set. */
  readonly context: StorageContext;
  /** Storage factory used for durable records. */
  readonly storageFactory: StorageFactory;
  /** Optional clock used for deduplication retention decisions. */
  readonly now?: () => Date;
}

function statusFilters(statuses: readonly DeliveryStatus[] | undefined) {
  return statuses === undefined || statuses.length === 0
    ? []
    : [{ column: "status", value: [...statuses] as readonly DeliveryStatus[] }];
}

interface WriteClaim {
  readonly kind: "CLAIM";
  readonly expected: Any | undefined;
  readonly message: InboxMessage;
}

interface WriteReturn {
  readonly kind: "RETURN";
  readonly result: InboxWriteResult;
}

interface GuardMessage {
  readonly guard: DedupGuardState;
  readonly message: InboxMessage;
  readonly record: Any;
}

type InboxConflict = "CALLER_INPUT" | "STORAGE_CORRUPTION";
type WriteStep = WriteClaim | WriteReturn | { readonly kind: "RETRY" };

interface InboxStorageInternal {
  readonly claim: (
    message: InboxMessage,
    session: ShardSession,
  ) => Promise<ClaimedInboxMessage | undefined>;
  readonly renew: (
    message: ClaimedInboxMessage,
    session: ShardSession,
  ) => Promise<ClaimedInboxMessage | undefined>;
  readonly markDelivered: (message: ClaimedInboxMessage) => Promise<InboxMessage | undefined>;
  readonly unclaim: (message: ClaimedInboxMessage) => Promise<InboxMessage | undefined>;
}

const inboxStorageInternals = new WeakMap<InboxStorage, InboxStorageInternal>();

function requireInternals(storage: InboxStorage): InboxStorageInternal {
  const internals = inboxStorageInternals.get(storage);
  if (internals === undefined) {
    throw new Error("Inbox storage internals are unavailable.");
  }

  return internals;
}

function claimFromSession(session: ShardSession): InboxClaim {
  return InboxClaimRecords.snapshot({
    id: session.id,
    node: session.node,
    expiresAt: session.expiresAt,
  });
}

function requireClaimed(message: InboxRecordMessage): ClaimedInboxMessage {
  if (message.claim === undefined) {
    throw new DeliveryStorageCorruptionError("Inbox claim is missing from claimed row.");
  }

  return message as ClaimedInboxMessage;
}

function requirePublicMessage(message: InboxMessage): InboxMessage {
  if (typeof message !== "object" || message === null) {
    return message;
  }
  if (Reflect.has(message, "claim")) {
    throw new InboxMessageError("Inbox message claim is internal.");
  }

  const id = readPublicMessageProperty(message, "id", "Inbox message ID") as InboxMessage["id"];
  const inboxId = readPublicMessageProperty(
    message,
    "inboxId",
    "Inbox target identity",
  ) as InboxMessage["inboxId"];
  const signalId = readPublicMessageProperty(
    message,
    "signalId",
    "Inbox signal ID",
  ) as InboxMessage["signalId"];
  const label = readPublicMessageProperty(
    message,
    "label",
    "Inbox delivery label",
  ) as InboxMessage["label"];
  const status = readPublicMessageProperty(
    message,
    "status",
    "Inbox delivery status",
  ) as InboxMessage["status"];
  const shard = readPublicMessageProperty(
    message,
    "shard",
    "Inbox message shard",
  ) as InboxMessage["shard"];
  const whenReceived = readPublicMessageProperty(
    message,
    "whenReceived",
    "Inbox receive time",
  ) as InboxMessage["whenReceived"];
  const version = readPublicMessageProperty(
    message,
    "version",
    "Inbox version",
  ) as InboxMessage["version"];
  const signal = readPublicMessageProperty(
    message,
    "signal",
    "Inbox signal",
  ) as InboxMessage["signal"];
  const keepUntil = readPublicMessageProperty(
    message,
    "keepUntil",
    "Inbox keep-until time",
  ) as InboxMessage["keepUntil"];

  return Object.freeze({
    id,
    inboxId,
    signalId,
    ...(signal === undefined ? {} : { signal }),
    label,
    status,
    shard,
    whenReceived,
    version,
    ...(keepUntil === undefined ? {} : { keepUntil }),
  });
}

function readPublicMessageProperty(
  message: InboxMessage,
  property: keyof InboxMessage,
  label: string,
): unknown {
  try {
    return Reflect.get(message, property);
  } catch (error) {
    throw new InboxMessageError(`${label} is invalid.`, { cause: error });
  }
}

function publicMessage(message: InboxRecordMessage): InboxMessage {
  if (message.claim === undefined) {
    return message;
  }

  const { claim: _claim, ...unclaimed } = message;
  return Object.freeze(unclaimed);
}

function dedupStorageContext(context: StorageContext): StorageContext {
  return deliveryStorageContext(context, "inbox-dedup");
}

function inboxStorageContext(context: StorageContext): StorageContext {
  return deliveryStorageContext(context, "inbox");
}

function deliveryStorageContext(context: StorageContext, name: string): StorageContext {
  return context.multitenant
    ? {
        name: `${context.name}.delivery.${name}`,
        multitenant: true,
        ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      }
    : {
        name: `${context.name}.delivery.${name}`,
        multitenant: false,
      };
}

function casRetriesExhausted(label: string): Error {
  return new Error(`${label} could not be completed due to concurrent changes.`);
}

function requireReadShard(value: unknown): ShardIndex {
  if (typeof value !== "object" || value === null) {
    throw new InboxMessageError("Inbox shard is invalid.");
  }

  try {
    return new ShardIndex(
      requireReadInteger(Reflect.get(value, "index"), "Inbox shard index"),
      requireReadInteger(Reflect.get(value, "ofTotal"), "Inbox shard total"),
    );
  } catch (error) {
    if (error instanceof InboxMessageError) {
      throw error;
    }

    throw new InboxMessageError("Inbox shard is invalid.", { cause: error });
  }
}

function requireReadInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new InboxMessageError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireInboxReadLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maxReadLimit) {
    throw new InboxMessageError(
      `Inbox read limit must be a positive safe integer at most ${String(maxReadLimit)}.`,
    );
  }

  return value as number;
}

function requireInboxReadOffset(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InboxMessageError("Inbox read offset must be a non-negative safe integer.");
  }

  return value as number;
}
