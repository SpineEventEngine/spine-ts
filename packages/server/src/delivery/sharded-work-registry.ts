import { create } from "@bufbuild/protobuf";
import {
  ShardIndexSchema,
  ShardSessionRecordSchema,
  WorkerIdSchema,
  type ShardIndex as WireShardIndex,
  type ShardSessionRecord,
  type WorkerId,
} from "@spine-event-engine/proto/delivery";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";
import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import { DeliveryLeases } from "./delivery-lease.js";
import { ShardIndex } from "./shard-index.js";

const retries = 8;
const leaseDefault = 30_000;

export const shardSessionRecordSpec = new RecordSpec<WireShardIndex, ShardSessionRecord>({
  sourceType: ShardSessionRecordSchema,
  recordType: ShardSessionRecordSchema,
  idSchema: ShardIndexSchema,
  extractId: (record) => {
    if (record.index === undefined)
      throw new DeliveryStorageCorruptionError("Shard session index is missing.");
    return record.index;
  },
});

export class ShardedWorkRegistry {
  readonly sessionKind = "LEASED" as const;
  readonly #context: StorageContext;
  readonly #factory: StorageFactory;
  readonly #lease: number;
  readonly #now: () => Date;
  constructor(options: ShardedWorkRegistryOptions) {
    this.#context = copy(options.context);
    this.#factory = options.storageFactory;
    this.#lease = DeliveryLeases.requireMs("ShardedWorkRegistry", options.leaseMs ?? leaseDefault);
    this.#now = options.now ?? (() => new Date());
    configs.set(this, { context: this.#context, storageFactory: this.#factory });
    Object.freeze(this);
  }
  async pickUp(shard: ShardIndex, worker: WorkerId): Promise<ShardSession | undefined> {
    const nextShard = checkedShard(shard);
    const nextWorker = checkedWorker(worker);
    const storage = this.#storage();
    try {
      for (let i = 0; i < retries; i++) {
        const id = wireId(nextShard);
        const record = await storage.read(id);
        const current = record === undefined ? undefined : session(record, nextShard, this.#lease);
        const now = time(this.#now());
        if (current?.worker !== undefined && current.expiresAt.getTime() > now) return undefined;
        const next = owned(nextShard, nextWorker, now, this.#lease);
        if (await storage.compareAndSet(id, record, toRecord(next))) return next;
      }
      throw concurrent("Shard pickup");
    } finally {
      storage.close();
    }
  }
  async renew(expected: ShardSession): Promise<ShardSession | undefined> {
    return this.#update(expected, false);
  }
  async release(expected: ShardSession): Promise<boolean> {
    const storage = this.#storage();
    try {
      for (let i = 0; i < retries; i++) {
        const record = await storage.read(wireId(expected.shard));
        if (record === undefined) return false;
        const current = session(record, expected.shard, this.#lease);
        if (!same(current, expected) || current.expiresAt.getTime() <= time(this.#now()))
          return false;
        if (await storage.compareAndSet(wireId(expected.shard), record, unowned(current)))
          return true;
      }
      throw concurrent("Shard release");
    } finally {
      storage.close();
    }
  }
  async drainUntilEmpty<T>(
    shard: ShardIndex,
    worker: WorkerId,
    read: () => Promise<readonly T[]>,
    deliver: (value: T, session: ShardSession) => Promise<void>,
  ): Promise<void> {
    let current = await this.pickUp(shard, worker);
    if (current === undefined) return;
    try {
      for (;;) {
        current = await this.renew(current);
        if (current === undefined) return;
        const values = await read();
        if (values.length === 0) return;
        for (const value of values) {
          current = await this.renew(current);
          if (current === undefined) return;
          await deliver(value, current);
        }
      }
    } finally {
      await this.release(current);
    }
  }
  async #update(expected: ShardSession, _release: boolean): Promise<ShardSession | undefined> {
    const storage = this.#storage();
    try {
      for (let i = 0; i < retries; i++) {
        const record = await storage.read(wireId(expected.shard));
        if (record === undefined) return undefined;
        const current = session(record, expected.shard, this.#lease);
        const now = time(this.#now());
        if (
          !same(current, expected) ||
          current.worker === undefined ||
          current.expiresAt.getTime() <= now
        )
          return undefined;
        const next = owned(current.shard, current.worker, now, this.#lease);
        if (await storage.compareAndSet(wireId(expected.shard), record, toRecord(next)))
          return next;
      }
      throw concurrent("Shard renewal");
    } finally {
      storage.close();
    }
  }
  #storage(): RecordStorage<WireShardIndex, ShardSessionRecord> {
    return this.#factory.createRecordStorage(context(this.#context), shardSessionRecordSpec);
  }
}
export class ShardSession {
  readonly kind = "LEASED" as const;
  constructor(
    readonly shard: ShardIndex,
    readonly worker: WorkerId | undefined,
    readonly pickedUpAt: Date,
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
  }
}
export interface ShardedWorkRegistryOptions {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly leaseMs?: number;
  readonly now?: () => Date;
}
const configs = new WeakMap<
  ShardedWorkRegistry,
  { context: StorageContext; storageFactory: StorageFactory }
>();
export const shardedWorkRegistryAccess = Object.freeze({
  matches(
    registry: ShardedWorkRegistry,
    contextValue: StorageContext,
    storageFactory: StorageFactory,
  ) {
    const value = configs.get(registry);
    return (
      value?.storageFactory === storageFactory &&
      value.context.name === contextValue.name &&
      value.context.multitenant === contextValue.multitenant &&
      value.context.tenantId === contextValue.tenantId
    );
  },
});
function wireId(value: ShardIndex): WireShardIndex {
  return create(ShardIndexSchema, { index: value.index, ofTotal: value.ofTotal });
}
function checkedShard(value: ShardIndex): ShardIndex {
  if (!(value instanceof ShardIndex)) throw new Error("Shard index is invalid.");
  return value;
}
function checkedWorker(value: WorkerId): WorkerId {
  const node = value?.nodeId?.value;
  if (
    typeof node !== "string" ||
    node.trim() === "" ||
    typeof value.value !== "string" ||
    value.value.trim() === ""
  )
    throw new Error("Shard worker is invalid.");
  return create(WorkerIdSchema, { nodeId: { value: node }, value: value.value });
}
function time(value: unknown): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Shard time is invalid.");
  return value.getTime();
}
function session(record: ShardSessionRecord, expected: ShardIndex, lease: number): ShardSession {
  if (record.index?.index !== expected.index || record.index?.ofTotal !== expected.ofTotal)
    throw new DeliveryStorageCorruptionError("Shard session does not match its storage ID.");
  const picked = timestamp(record.whenLastPicked);
  const worker = record.worker === undefined ? undefined : checkedWorker(record.worker);
  return new ShardSession(expected, worker, picked, new Date(picked.getTime() + lease));
}
function timestamp(value: ShardSessionRecord["whenLastPicked"]): Date {
  if (
    value === undefined ||
    !Number.isInteger(value.nanos) ||
    value.nanos < 0 ||
    value.nanos >= 1e9
  )
    throw new DeliveryStorageCorruptionError("Shard pickup time is invalid.");
  const ms = Number(value.seconds) * 1000 + Math.floor(value.nanos / 1e6);
  if (!Number.isSafeInteger(ms))
    throw new DeliveryStorageCorruptionError("Shard pickup time is invalid.");
  return new Date(ms);
}
function owned(shard: ShardIndex, worker: WorkerId, now: number, lease: number): ShardSession {
  return new ShardSession(shard, worker, new Date(now), new Date(now + lease));
}
function toRecord(value: ShardSession): ShardSessionRecord {
  if (value.worker === undefined) throw new Error("Shard worker is invalid.");
  return create(ShardSessionRecordSchema, {
    index: wireId(value.shard),
    whenLastPicked: {
      seconds: BigInt(Math.floor(value.pickedUpAt.getTime() / 1000)),
      nanos: (value.pickedUpAt.getTime() % 1000) * 1e6,
    },
    worker: value.worker,
  });
}
function unowned(value: ShardSession): ShardSessionRecord {
  return create(ShardSessionRecordSchema, {
    index: wireId(value.shard),
    whenLastPicked: {
      seconds: BigInt(Math.floor(value.pickedUpAt.getTime() / 1000)),
      nanos: (value.pickedUpAt.getTime() % 1000) * 1e6,
    },
  });
}
function same(a: ShardSession, b: ShardSession): boolean {
  return (
    a.shard.key() === b.shard.key() &&
    a.pickedUpAt.getTime() === b.pickedUpAt.getTime() &&
    a.worker?.nodeId?.value === b.worker?.nodeId?.value &&
    a.worker?.value === b.worker?.value
  );
}
function context(value: StorageContext): StorageContext {
  return value.multitenant
    ? {
        name: `${value.name}.delivery.shards`,
        multitenant: true,
        ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
      }
    : { name: `${value.name}.delivery.shards`, multitenant: false };
}
function copy(value: StorageContext): StorageContext {
  return {
    name: value.name,
    multitenant: value.multitenant,
    ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
  };
}
function concurrent(label: string): Error {
  return new Error(`${label} could not be completed due to concurrent changes.`);
}
