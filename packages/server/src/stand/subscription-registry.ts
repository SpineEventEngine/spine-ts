import { clone, create, toBinary } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import { SubscriptionSchema, type Subscription } from "@spine-event-engine/proto/client";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import type { StandSubscriptionRecord } from "@spine-event-engine/proto/generated/spine/system/server/stand_subscription_pb.js";

import { StandSubscriptionRecords } from "./subscription-records.js";

const defaultLimit = 100;
const pendingMilliseconds = 30_000;

/**
 * A durable Stand subscription definition.
 */
export interface StandSubscriptionEntry {
  readonly id: string;
  readonly subscription: Subscription;
  readonly phase: "PENDING" | "ACTIVE";
  readonly createdAtMs: number;
  readonly pendingUntilMs?: number;
  readonly revision: number;
}

/**
 * Result returned after a create attempt.
 */
export interface StandSubscriptionCreateResult {
  readonly entry: StandSubscriptionEntry;
  readonly created: boolean;
}

/**
 * Result returned after an activate attempt.
 */
export interface StandSubscriptionActivateResult {
  readonly entry?: StandSubscriptionEntry;
  readonly activated: boolean;
}

/**
 * Result returned after a delete attempt.
 */
export interface StandSubscriptionDeleteResult {
  readonly deleted: boolean;
}

/**
 * Reports capacity exhaustion while admitting a definition.
 */
export class StandCapacityError extends Error {
  /**
   * Creates the capacity failure.
   * @param limit The configured admission limit.
   */
  constructor(readonly limit: number) {
    super(`Stand subscription capacity of ${String(limit)} is exhausted.`);
    this.name = "StandCapacityError";
  }
}

/**
 * Reports an ID reused with distinct subscription content.
 */
export class StandConflictError extends Error {
  /**
   * Creates the conflict failure.
   * @param id The conflicting subscription ID.
   */
  constructor(readonly id: string) {
    super(`Stand subscription "${id}" already exists with different content.`);
    this.name = "StandConflictError";
  }
}

/**
 * Stores Stand subscription definitions independently from listener delivery.
 */
export interface StandSubscriptionRegistry {
  readonly persistent: boolean;
  create(subscription: Subscription): Promise<StandSubscriptionCreateResult>;
  activate(id: string): Promise<StandSubscriptionActivateResult>;
  delete(id: string): Promise<StandSubscriptionDeleteResult>;
  get(id: string): Promise<StandSubscriptionEntry | undefined>;
  snapshot(): Promise<readonly StandSubscriptionEntry[]>;
  cleanupExpiredPending(nowMs?: number): Promise<number>;
  close(): Promise<void>;
}

/**
 * Keeps bounded subscription definitions in process memory.
 */
export class InMemorySubscriptionRegistry implements StandSubscriptionRegistry {
  readonly persistent = false;
  readonly #entries = new Map<string, StandSubscriptionEntry>();
  readonly #limit: number;
  #closed = false;

  /**
   * Creates an in-memory registry.
   * @param limit Maximum number of definitions, from one through 100.
   */
  constructor(limit: number = defaultLimit) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) {
      throw new RangeError(
        "Stand subscription limit must be a positive safe integer no greater than 100.",
      );
    }
    this.#limit = limit;
  }

  async create(subscription: Subscription): Promise<StandSubscriptionCreateResult> {
    await Promise.resolve();
    this.#requireOpen();
    const id = InMemorySubscriptionRegistry.#id(subscription);
    const existing = this.#entries.get(id);
    if (existing !== undefined) {
      if (JSON.stringify(existing.subscription) !== JSON.stringify(subscription))
        throw new StandConflictError(id);
      return Object.freeze({
        entry: InMemorySubscriptionRegistry.#clone(existing),
        created: false,
      });
    }
    if (this.#entries.size >= this.#limit) throw new StandCapacityError(this.#limit);
    const nowMs = Date.now();
    const entry: StandSubscriptionEntry = Object.freeze({
      id,
      subscription: clone(SubscriptionSchema, subscription),
      phase: "PENDING",
      createdAtMs: nowMs,
      pendingUntilMs: nowMs + pendingMilliseconds,
      revision: 1,
    });
    this.#entries.set(id, entry);
    return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(entry), created: true });
  }

  async activate(id: string): Promise<StandSubscriptionActivateResult> {
    await Promise.resolve();
    this.#requireOpen();
    const entry = this.#entries.get(id);
    if (entry === undefined) return Object.freeze({ activated: false });
    if (entry.phase === "ACTIVE")
      return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(entry), activated: false });
    const active: StandSubscriptionEntry = Object.freeze({
      id: entry.id,
      subscription: entry.subscription,
      phase: "ACTIVE",
      createdAtMs: entry.createdAtMs,
      revision: entry.revision + 1,
    });
    this.#entries.set(id, active);
    return Object.freeze({ entry: InMemorySubscriptionRegistry.#clone(active), activated: true });
  }

  async delete(id: string): Promise<StandSubscriptionDeleteResult> {
    await Promise.resolve();
    this.#requireOpen();
    return Object.freeze({ deleted: this.#entries.delete(id) });
  }

  async get(id: string): Promise<StandSubscriptionEntry | undefined> {
    await Promise.resolve();
    this.#requireOpen();
    const entry = this.#entries.get(id);
    return entry === undefined ? undefined : InMemorySubscriptionRegistry.#clone(entry);
  }

  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    await Promise.resolve();
    this.#requireOpen();
    return Object.freeze(
      [...this.#entries.values()]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((entry: StandSubscriptionEntry) => InMemorySubscriptionRegistry.#clone(entry)),
    );
  }

  async cleanupExpiredPending(nowMs: number = Date.now()): Promise<number> {
    await Promise.resolve();
    this.#requireOpen();
    let deleted = 0;
    for (const [id, entry] of this.#entries) {
      if (
        entry.phase === "PENDING" &&
        entry.pendingUntilMs !== undefined &&
        entry.pendingUntilMs <= nowMs
      ) {
        this.#entries.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  async close(): Promise<void> {
    await Promise.resolve();
    this.#closed = true;
    this.#entries.clear();
  }

  static #id(subscription: Subscription): string {
    const id = subscription.id?.value;
    if (typeof id !== "string" || id.trim() === "")
      throw new TypeError("Stand subscription ID must be non-blank.");
    return id;
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({ ...entry, subscription: clone(SubscriptionSchema, entry.subscription) });
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }
}

/**
 * Stores one durable subscription definition per storage key.
 */
export class StorageSubscriptionRegistry implements StandSubscriptionRegistry {
  readonly persistent = true;
  readonly #storage: RecordStorage<string, StandSubscriptionRecord>;
  readonly #control: RecordStorage<string, Any>;
  readonly #limit: number;
  #closed = false;
  #activeOperations = 0;
  #closeWaiter: (() => void) | undefined;

  /**
   * Creates a storage-backed registry for one bounded-context storage scope.
   * @param context Scopes definition rows to the context and tenant mode.
   * @param storageFactory Opens the durable record handle.
   * @param limit Maximum admitted definitions.
   */
  constructor(
    context: StorageContext,
    storageFactory: StorageFactory,
    limit: number = defaultLimit,
  ) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > defaultLimit) {
      throw new RangeError(
        "Stand subscription limit must be a positive safe integer no greater than 100.",
      );
    }
    this.#limit = limit;
    this.#storage = storageFactory.createRecordStorage(
      context,
      new RecordSpec<string, StandSubscriptionRecord>({
        schema: StandSubscriptionRecords.schema,
        storageKey: "spine.server.StandSubscriptionRecord:definition",
        idKind: "string",
        extractId: (record: StandSubscriptionRecord) => StandSubscriptionRecords.read(record).id,
      }),
    );
    this.#control = storageFactory.createRecordStorage(
      context,
      new RecordSpec<string, Any>({
        schema: AnySchema,
        storageKey: "spine.server.StandSubscriptionRecord:control",
        idKind: "string",
        extractId: () => controlSlot,
      }),
    );
    if (!this.#storage.atomicCompareAndSet || !this.#control.atomicCompareAndSet) {
      this.#storage.close();
      this.#control.close();
      throw new Error("Stand subscription storage must support atomic compare-and-set.");
    }
  }

  async create(subscription: Subscription): Promise<StandSubscriptionCreateResult> {
    return await this.#operation(async () => {
      const id = StorageSubscriptionRegistry.#id(subscription);
      const nowMs = Date.now();
      const proposed: StandSubscriptionEntry = Object.freeze({
        id,
        subscription: clone(SubscriptionSchema, subscription),
        phase: "PENDING",
        createdAtMs: nowMs,
        pendingUntilMs: nowMs + pendingMilliseconds,
        revision: 1,
      });
      const next = StandSubscriptionRecords.write(proposed);
      const digest = recordDigest(next);
      for (;;) {
        await this.#recover();
        const existing = await this.#storage.read(id);
        if (existing !== undefined) {
          const entry = StandSubscriptionRecords.read(existing, id);
          if (!sameSubscription(entry.subscription, subscription)) throw new StandConflictError(id);
          return Object.freeze({
            entry: StorageSubscriptionRegistry.#clone(entry),
            created: false,
          });
        }
        const control = await this.#controlState();
        if (control.count >= this.#limit) throw new StandCapacityError(this.#limit);
        const staged = controlWithOperation(control, control.count + 1, {
          kind: "create",
          id,
          digest,
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        if (!(await this.#storage.compareAndSet(id, undefined, next))) {
          await this.#recover();
          continue;
        }
        await this.#recover();
        return Object.freeze({
          entry: StorageSubscriptionRegistry.#clone(proposed),
          created: true,
        });
      }
    });
  }

  async activate(id: string): Promise<StandSubscriptionActivateResult> {
    return await this.#operation(async () => {
      for (;;) {
        await this.#recover();
        const record = await this.#storage.read(id);
        if (record === undefined) return Object.freeze({ activated: false });
        const entry = StandSubscriptionRecords.read(record, id);
        if (entry.phase === "ACTIVE")
          return Object.freeze({
            entry: StorageSubscriptionRegistry.#clone(entry),
            activated: false,
          });
        const active: StandSubscriptionEntry = Object.freeze({
          id,
          subscription: entry.subscription,
          phase: "ACTIVE",
          createdAtMs: entry.createdAtMs,
          revision: entry.revision + 1,
        });
        if (await this.#storage.compareAndSet(id, record, StandSubscriptionRecords.write(active))) {
          return Object.freeze({
            entry: StorageSubscriptionRegistry.#clone(active),
            activated: true,
          });
        }
      }
    });
  }

  async delete(id: string): Promise<StandSubscriptionDeleteResult> {
    return await this.#operation(async () => {
      for (;;) {
        await this.#recover();
        const record = await this.#storage.read(id);
        if (record === undefined) return Object.freeze({ deleted: false });
        StandSubscriptionRecords.read(record, id);
        const control = await this.#controlState();
        if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
        const staged = controlWithOperation(control, control.count, {
          kind: "delete",
          id,
          digest: recordDigest(record),
        });
        if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
          continue;
        const deleted = await this.#storage.compareAndSet(id, record, undefined);
        await this.#recover();
        return Object.freeze({ deleted });
      }
    });
  }

  async get(id: string): Promise<StandSubscriptionEntry | undefined> {
    return await this.#operation(async () => {
      await this.#recover();
      const record = await this.#storage.read(id);
      return record === undefined
        ? undefined
        : StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(record, id));
    });
  }

  async snapshot(): Promise<readonly StandSubscriptionEntry[]> {
    return await this.#operation(async () => {
      await this.#recover();
      return Object.freeze(
        (await this.#definitions()).map((row) =>
          StorageSubscriptionRegistry.#clone(StandSubscriptionRecords.read(row.record, row.id)),
        ),
      );
    });
  }

  async cleanupExpiredPending(nowMs: number = Date.now()): Promise<number> {
    return await this.#operation(async () => {
      await this.#recover();
      let deleted = 0;
      for (const row of await this.#storage.queryEntries({ sort: [{ field: "id" }], limit: 25 })) {
        const entry = StandSubscriptionRecords.read(row.record, row.id);
        if (
          entry.phase === "PENDING" &&
          entry.pendingUntilMs !== undefined &&
          entry.pendingUntilMs <= nowMs
        ) {
          if (await this.#deleteCurrent(row.id, row.record)) deleted += 1;
        }
      }
      return deleted;
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#activeOperations > 0)
      await new Promise<void>((resolve) => {
        this.#closeWaiter = resolve;
      });
    this.#storage.close();
    this.#control.close();
  }

  static #id(subscription: Subscription): string {
    const id = subscription.id?.value;
    if (typeof id !== "string" || id.trim() === "")
      throw new TypeError("Stand subscription ID must be non-blank.");
    return id;
  }

  static #clone(entry: StandSubscriptionEntry): StandSubscriptionEntry {
    return Object.freeze({ ...entry, subscription: clone(SubscriptionSchema, entry.subscription) });
  }

  #requireOpen(): void {
    if (this.#closed) throw new Error("Stand subscription registry is closed.");
  }

  async #operation<T>(action: () => Promise<T>): Promise<T> {
    this.#requireOpen();
    this.#activeOperations += 1;
    try {
      return await action();
    } finally {
      this.#activeOperations -= 1;
      if (this.#closed && this.#activeOperations === 0) this.#closeWaiter?.();
    }
  }

  async #definitions() {
    const rows = await this.#storage.queryEntries({
      sort: [{ field: "id" }],
      limit: this.#limit + 1,
    });
    if (rows.length > this.#limit) throw new Error("Malformed Stand subscription control record.");
    for (const row of rows) StandSubscriptionRecords.read(row.record, row.id);
    return rows;
  }

  async #controlState(): Promise<ControlState> {
    const record = await this.#control.read(controlSlot);
    if (record === undefined) throw new Error("Stand subscription control record is missing.");
    return { record, ...readControl(record, this.#limit) };
  }

  async #recover(): Promise<void> {
    for (;;) {
      const record = await this.#control.read(controlSlot);
      if (record === undefined) {
        const rows = await this.#definitions();
        const initial: Control = { revision: 1, count: rows.length };
        if (await this.#control.compareAndSet(controlSlot, undefined, writeControl(initial)))
          return;
        continue;
      }
      const control = readControl(record, this.#limit);
      if (control.operation === undefined) {
        if ((await this.#definitions()).length !== control.count) {
          throw new Error("Malformed Stand subscription control record.");
        }
        return;
      }
      const current = await this.#storage.read(control.operation.id);
      const matches = current !== undefined && recordDigest(current) === control.operation.digest;
      if (current !== undefined && !matches)
        throw new Error("Malformed Stand subscription control record.");
      let next: Control;
      if (control.operation.kind === "create") {
        next = controlWithOperation(control, matches ? control.count : control.count - 1);
      } else {
        if (
          matches &&
          !(await this.#storage.compareAndSet(control.operation.id, current, undefined))
        )
          continue;
        next = controlWithOperation(control, control.count - 1);
      }
      if (next.count < 0) throw new Error("Malformed Stand subscription control record.");
      if (await this.#control.compareAndSet(controlSlot, record, writeControl(next))) return;
    }
  }

  async #deleteCurrent(id: string, record: StandSubscriptionRecord): Promise<boolean> {
    for (;;) {
      const control = await this.#controlState();
      if (control.count < 1) throw new Error("Malformed Stand subscription control record.");
      const staged = controlWithOperation(control, control.count, {
        kind: "delete",
        id,
        digest: recordDigest(record),
      });
      if (!(await this.#control.compareAndSet(controlSlot, control.record, writeControl(staged))))
        continue;
      const deleted = await this.#storage.compareAndSet(id, record, undefined);
      await this.#recover();
      return deleted;
    }
  }
}

const controlSlot = "control";
const controlTypeUrl = "type.spine.io/stand.subscription.control.v1";
interface ControlOperation {
  readonly kind: "create" | "delete";
  readonly id: string;
  readonly digest: string;
}
interface Control {
  readonly revision: number;
  readonly count: number;
  readonly operation?: ControlOperation;
}
interface ControlState extends Control {
  readonly record: Any;
}

function controlWithOperation(
  control: Control,
  count: number,
  operation?: ControlOperation,
): Control {
  return Object.freeze({
    revision: control.revision + 1,
    count,
    ...(operation === undefined ? {} : { operation }),
  });
}

function writeControl(control: Control): Any {
  return create(AnySchema, {
    typeUrl: controlTypeUrl,
    value: new TextEncoder().encode(JSON.stringify(control)),
  });
}

function readControl(record: Any, limit: number): Control {
  try {
    if (record.typeUrl !== controlTypeUrl) throw Error();
    const value: unknown = JSON.parse(new TextDecoder().decode(record.value));
    if (typeof value !== "object" || value === null) throw Error();
    const control = value as { revision?: unknown; count?: unknown; operation?: unknown };
    if (
      !Number.isSafeInteger(control.revision) ||
      (control.revision as number) < 1 ||
      !Number.isSafeInteger(control.count) ||
      (control.count as number) < 0 ||
      (control.count as number) > limit
    )
      throw Error();
    if (control.operation === undefined)
      return Object.freeze({
        revision: control.revision as number,
        count: control.count as number,
      });
    const operation = control.operation as { kind?: unknown; id?: unknown; digest?: unknown };
    if (
      (operation.kind !== "create" && operation.kind !== "delete") ||
      typeof operation.id !== "string" ||
      operation.id.trim() === "" ||
      typeof operation.digest !== "string" ||
      !/^[0-9a-f]{16}$/.test(operation.digest)
    )
      throw Error();
    return Object.freeze({
      revision: control.revision as number,
      count: control.count as number,
      operation: Object.freeze({
        kind: operation.kind,
        id: operation.id,
        digest: operation.digest,
      }),
    });
  } catch {
    throw new Error("Malformed Stand subscription control record.");
  }
}

function recordDigest(record: StandSubscriptionRecord): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of toBinary(StandSubscriptionRecords.schema, record)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

function sameSubscription(left: Subscription, right: Subscription): boolean {
  const leftBytes = toBinary(SubscriptionSchema, left);
  const rightBytes = toBinary(SubscriptionSchema, right);
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.every((byte, index) => byte === rightBytes[index])
  );
}
