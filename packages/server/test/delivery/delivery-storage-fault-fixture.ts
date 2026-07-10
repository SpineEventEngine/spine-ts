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

type MaterializedRecord<I, R extends Message> = ReturnType<RecordSpec<I, R>["materialize"]>;

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
}

export interface CountedDeliveryFaultProbe {
  readonly count: number;
}

export interface ArmableDeliveryFaultProbe extends CountedDeliveryFaultProbe {
  arm(): void;
}

export interface BlockedDeliveryFaultProbe extends CountedDeliveryFaultProbe {
  readonly blocked: Promise<undefined>;
  resume(): void;
}

export interface DeliveryStorageFaultFixture {
  readonly storageFactory: StorageFactory;
  readonly opens: number;
  readonly compareAndSets: number;
  readonly inboxQueries: number;
}

interface DeliveryFaultPlan {
  readonly probes: readonly DeliveryStorageFaultProbe[];
  opens: number;
  compareAndSets: number;
  inboxQueries: number;
}

interface DeliveryStorageFaultProbe {
  compareAndSet?<I, R extends Message>(
    context: StorageContext,
    id: I,
    expected: MaterializedRecord<I, R> | undefined,
    next: MaterializedRecord<I, R> | undefined,
    delegate: RecordStorage<I, R>,
  ): Promise<boolean | undefined>;
  read?<I>(context: StorageContext, id: I): void;
}

type CompareAndSetMatcher = <I, R extends Message>(
  context: StorageContext,
  id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
) => boolean;

type CompareAndSetEffect = <I, R extends Message>(
  id: I,
  expected: MaterializedRecord<I, R>,
  next: MaterializedRecord<I, R>,
  delegate: RecordStorage<I, R>,
) => Promise<boolean | undefined>;

export function deliveryStorageFaults(
  ...probes: readonly DeliveryStorageFaultProbe[]
): DeliveryStorageFaultFixture {
  const plan: DeliveryFaultPlan = {
    probes,
    opens: 0,
    compareAndSets: 0,
    inboxQueries: 0,
  };

  return Object.freeze({
    storageFactory: new FaultyDeliveryStorageFactory(plan),
    get opens() {
      return plan.opens;
    },
    get compareAndSets() {
      return plan.compareAndSets;
    },
    get inboxQueries() {
      return plan.inboxQueries;
    },
  });
}

export function blockInboxClaimOnce(): BlockedDeliveryFaultProbe {
  return blockingCompareAndSetProbe(isInboxClaimCreation);
}

export function blockInboxRenewalOnce(): BlockedDeliveryFaultProbe {
  return blockingCompareAndSetProbe(isInboxClaimRenewal);
}

export function throwInboxClaimOnce(): CountedDeliveryFaultProbe {
  return throwingCompareAndSetProbe(isInboxClaimCreation, new Error("Inbox claim failed."));
}

export function throwInboxClearOnce(): CountedDeliveryFaultProbe {
  return throwingCompareAndSetProbe(isInboxClaimClear, new Error("Inbox claim clear failed."));
}

export function throwDedupFinalizeOnce(
  options: { readonly armed?: boolean } = {},
): ArmableDeliveryFaultProbe {
  return throwingCompareAndSetProbe(
    isDedupFinalize,
    new Error("Dedup finalize failed."),
    options.armed ?? true,
  );
}

export function skipInboxClearOnce(): CountedDeliveryFaultProbe {
  return compareAndSetProbe(isInboxClaimClear, async (id, expected, _next, delegate) => {
    const current = InboxRecords.read(expected.record as Any, id as string);
    const changed = Object.freeze({
      ...current,
      claim: Object.freeze({
        id: "competing-cleanup-owner",
        node: "node-b",
        expiresAt: new Date("2026-07-08T09:01:00.000Z"),
      }),
    });
    await delegate.compareAndSet(id, expected.record, InboxRecords.write(changed) as never);

    return false;
  });
}

export function skipDedupFinalizeOnce(
  options: { readonly armed?: boolean } = {},
): ArmableDeliveryFaultProbe {
  return compareAndSetProbe(isDedupFinalize, () => Promise.resolve(false), options.armed ?? true);
}

export function skipInboxRepairOnce(
  options: { readonly armed?: boolean } = {},
): ArmableDeliveryFaultProbe {
  return compareAndSetProbe(isInboxRepair, () => Promise.resolve(false), options.armed ?? true);
}

export function onInboxReadOnce(onRead: () => void): DeliveryStorageFaultProbe {
  let used = false;

  return Object.freeze({
    read<I>(context: StorageContext, _id: I) {
      if (used || !context.name.endsWith(".delivery.inbox")) {
        return;
      }
      used = true;
      onRead();
    },
  });
}

class FaultyDeliveryStorageFactory extends StorageFactory {
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
    this.#plan.opens += 1;
    const storage = this.#delegate.createRecordStorage(context, recordSpec);

    return new FaultyDeliveryRecordStorage(context, recordSpec, storage, this.#plan);
  }
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
    expected: MaterializedRecord<I, R> | undefined,
    next: MaterializedRecord<I, R> | undefined,
  ): Promise<boolean> {
    this.#plan.compareAndSets += 1;

    for (const probe of this.#plan.probes) {
      const handled = await probe.compareAndSet?.(this.context, id, expected, next, this.#delegate);
      if (handled !== undefined) {
        return handled;
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
    if (this.context.name.endsWith(".delivery.inbox")) {
      this.#plan.inboxQueries += 1;
    }

    return this.#delegate.queryEntries(query);
  }

  protected async readRecord(id: I): Promise<R | undefined> {
    const record = await this.#delegate.read(id);

    for (const probe of this.#plan.probes) {
      probe.read?.(this.context, id);
    }

    return record;
  }

  protected writeAllRecords(records: readonly MaterializedRecord<I, R>[]): Promise<void> {
    return this.#delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: MaterializedRecord<I, R>): Promise<void> {
    return this.#delegate.write(record.record);
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

function compareAndSetProbe(
  matches: CompareAndSetMatcher,
  effect: CompareAndSetEffect,
  initiallyArmed = true,
): ArmableDeliveryFaultProbe & DeliveryStorageFaultProbe {
  let count = 0;
  let armed = initiallyArmed;

  return Object.freeze({
    get count() {
      return count;
    },
    arm() {
      armed = true;
    },
    async compareAndSet<I, R extends Message>(
      context: StorageContext,
      id: I,
      expected: MaterializedRecord<I, R> | undefined,
      next: MaterializedRecord<I, R> | undefined,
      delegate: RecordStorage<I, R>,
    ): Promise<boolean | undefined> {
      if (!armed || !matches(context, id, expected, next)) {
        return undefined;
      }

      armed = false;
      count += 1;
      if (expected === undefined || next === undefined) {
        throw new Error("Fault probe expected a compare-and-set update.");
      }

      return effect(id, expected, next, delegate);
    },
  });
}

function blockingCompareAndSetProbe(
  matches: CompareAndSetMatcher,
): BlockedDeliveryFaultProbe & DeliveryStorageFaultProbe {
  let count = 0;
  let armed = true;
  let gate = deferred<undefined>();
  let resume = deferred<undefined>();

  return Object.freeze({
    get count() {
      return count;
    },
    get blocked() {
      return gate.promise;
    },
    resume() {
      resume.resolve(undefined);
    },
    async compareAndSet<I, R extends Message>(
      context: StorageContext,
      id: I,
      expected: MaterializedRecord<I, R> | undefined,
      next: MaterializedRecord<I, R> | undefined,
      _delegate: RecordStorage<I, R>,
    ): Promise<boolean | undefined> {
      if (!armed || !matches(context, id, expected, next)) {
        return undefined;
      }

      armed = false;
      count += 1;
      gate.resolve(undefined);
      await resume.promise;
      gate = deferred<undefined>();
      resume = deferred<undefined>();

      return undefined;
    },
  });
}

function throwingCompareAndSetProbe(
  matches: CompareAndSetMatcher,
  error: Error,
  initiallyArmed = true,
): ArmableDeliveryFaultProbe & DeliveryStorageFaultProbe {
  return compareAndSetProbe(matches, () => Promise.reject(error), initiallyArmed);
}

function isInboxClaimClear<I, R extends Message>(
  context: StorageContext,
  id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
): boolean {
  if (
    !context.name.endsWith(".delivery.inbox") ||
    typeof id !== "string" ||
    expected === undefined ||
    next === undefined
  ) {
    return false;
  }

  const current = InboxRecords.read(expected.record as Any, id);
  const unclaimed = InboxRecords.read(next.record as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    unclaimed.status === "TO_DELIVER" &&
    current.claim !== undefined &&
    unclaimed.claim === undefined
  );
}

function isInboxClaimCreation<I, R extends Message>(
  context: StorageContext,
  id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
): boolean {
  if (
    !context.name.endsWith(".delivery.inbox") ||
    typeof id !== "string" ||
    expected === undefined ||
    next === undefined
  ) {
    return false;
  }

  const current = InboxRecords.read(expected.record as Any, id);
  const claimed = InboxRecords.read(next.record as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    claimed.status === "TO_DELIVER" &&
    current.claim === undefined &&
    claimed.claim !== undefined
  );
}

function isInboxClaimRenewal<I, R extends Message>(
  context: StorageContext,
  id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
): boolean {
  if (
    !context.name.endsWith(".delivery.inbox") ||
    typeof id !== "string" ||
    expected === undefined ||
    next === undefined
  ) {
    return false;
  }

  const current = InboxRecords.read(expected.record as Any, id);
  const renewed = InboxRecords.read(next.record as Any, id);

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

function isDedupFinalize<I, R extends Message>(
  context: StorageContext,
  _id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
): boolean {
  return (
    context.name.endsWith(".delivery.inbox-dedup") && expected !== undefined && next !== undefined
  );
}

function isInboxRepair<I, R extends Message>(
  context: StorageContext,
  id: I,
  expected: MaterializedRecord<I, R> | undefined,
  next: MaterializedRecord<I, R> | undefined,
): boolean {
  if (
    !context.name.endsWith(".delivery.inbox") ||
    typeof id !== "string" ||
    expected === undefined ||
    next === undefined
  ) {
    return false;
  }

  const current = InboxRecords.read(expected.record as Any, id);
  const repaired = InboxRecords.read(next.record as Any, id);

  return (
    current.status === "TO_DELIVER" &&
    current.claim === undefined &&
    repaired.status === "DELIVERED"
  );
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

function deferred<T>(): Deferred<T> {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}
