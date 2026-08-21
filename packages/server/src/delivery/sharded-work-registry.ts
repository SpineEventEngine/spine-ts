/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone, create } from "@bufbuild/protobuf";
import { TenantIdSchema } from "@spine-event-engine/proto";
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
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import { DeliveryLeases } from "./delivery-lease.js";
import { ShardIndex } from "./shard-index.js";

const retries = 8;
const leaseDefault = 30_000;

/**
 * Defines direct durable shard-session records keyed by their generated shard index.
 */
export const shardSessionRecordSpec: RecordSpec<WireShardIndex, ShardSessionRecord> =
  new RecordSpec<WireShardIndex, ShardSessionRecord>({
    sourceType: ShardSessionRecordSchema,
    recordType: ShardSessionRecordSchema,
    idSchema: ShardIndexSchema,
    extractId: (record) => {
      if (record.index === undefined)
        throw new DeliveryStorageCorruptionError("Shard session index is missing.");
      return record.index;
    },
  });

/**
 * Coordinates durable exclusive ownership of delivery shards.
 */
export class ShardedWorkRegistry {
  // prettier-ignore

  /**
   * Identifies the renewable leased session model.
   */
  readonly sessionKind = "LEASED" as const;
  readonly #context: StorageContext;
  readonly #factory: StorageFactory;
  readonly #lease: number;
  readonly #now: () => Date;

  /**
   * Opens a registry over direct shard-session storage.
   *
   * @param options Configures durable storage, lease duration, and clock.
   */
  constructor(options: ShardedWorkRegistryOptions) {
    this.#context = copy(options.context);
    this.#factory = options.storageFactory;
    this.#lease = DeliveryLeases.requireMs("ShardedWorkRegistry", options.leaseMs ?? leaseDefault);
    this.#now = options.now ?? (() => new Date());
    configs.set(this, {
      context: this.#context,
      storageFactory: this.#factory,
      lease: this.#lease,
      now: this.#now,
    });
    Object.freeze(this);
  }

  /**
   * Acquires a shard for one complete durable worker identity.
   *
   * @param shard Identifies the shard to acquire.
   * @param worker Identifies the worker requesting ownership.
   * @returns The live owned session, or `undefined` when another worker owns it.
   */
  async pickUp(shard: ShardIndex, worker: WorkerId): Promise<ShardSession | undefined> {
    const nextShard = checkedShard(shard);
    const nextWorker = checkedWorker(worker);
    const storage = this.#storage();
    try {
      atomic(storage);
      for (let i = 0; i < retries; i++) {
        const id = wireId(nextShard);
        const record = await storage.read(id);
        const current = record === undefined ? undefined : session(record, nextShard, this.#lease);
        const now = time(this.#now());
        if (current?.worker !== undefined && current.expiresAt.getTime() > now) {
          return sameWorker(current.worker, nextWorker) ? current : undefined;
        }
        const next = owned(nextShard, nextWorker, now, this.#lease);
        if (await storage.compareAndSet(id, record, toRecord(next))) return next;
      }
      throw concurrent("Shard pickup");
    } finally {
      storage.close();
    }
  }

  /**
   * Returns one renewed exact live shard-session snapshot.
   *
   * @param expected Supplies the previously observed session.
   * @returns The renewed session, or `undefined` when ownership was lost.
   */
  async renew(expected: ShardSession): Promise<ShardSession | undefined> {
    return this.#update(expected);
  }

  /**
   * Returns the renewed exact ownership session.
   *
   * @param expected Supplies the previously observed session.
   * @returns The renewed session, or `undefined` when ownership was lost.
   */
  validateOwnership(expected: ShardSession): Promise<ShardSession | undefined> {
    return this.renew(expected);
  }

  /**
   * Returns whether one exact live shard-session snapshot became unowned.
   *
   * @param expected Supplies the session to release.
   * @returns Whether the session is or became unowned.
   */
  async release(expected: ShardSession): Promise<boolean> {
    const storage = this.#storage();
    try {
      atomic(storage);
      for (let i = 0; i < retries; i++) {
        const record = await storage.read(wireId(expected.shard));
        if (record === undefined) return false;
        const current = session(record, expected.shard, this.#lease);
        if (!same(current, expected) || current.expiresAt.getTime() <= time(this.#now())) {
          return current.worker === undefined;
        }
        if (await storage.compareAndSet(wireId(expected.shard), record, unowned(current)))
          return true;
      }
      throw concurrent("Shard release");
    } finally {
      storage.close();
    }
  }

  /**
   * Returns after draining one exclusively owned shard until a full rescan is empty.
   *
   * @param shard Identifies the shard to drain.
   * @param worker Identifies the worker retaining ownership.
   * @param read Reads the next pending shard contents.
   * @param deliver Delivers one pending value under the current session.
   * @returns A promise that settles after release or ownership loss.
   */
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
      if (current !== undefined) await this.release(current);
    }
  }
  async #update(expected: ShardSession): Promise<ShardSession | undefined> {
    const storage = this.#storage();
    try {
      atomic(storage);
      for (let i = 0; i < retries; i++) {
        const record = await storage.read(wireId(expected.shard));
        if (record === undefined) return undefined;
        const current = session(record, expected.shard, this.#lease);
        const now = time(this.#now());
        if (!same(current, expected)) {
          return current.worker !== undefined &&
            expected.worker !== undefined &&
            sameWorker(current.worker, expected.worker) &&
            current.expiresAt.getTime() > now
            ? current
            : undefined;
        }
        if (current.worker === undefined || current.expiresAt.getTime() <= now) return undefined;
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

/**
 * Represents one exact durable shard ownership snapshot.
 */
export class ShardSession {
  // prettier-ignore

  /**
   * Identifies the leased session model.
   */
  readonly kind = "LEASED" as const;

  /**
   * Creates an immutable shard ownership snapshot.
   *
   * @param shard Identifies the owned shard.
   * @param worker Identifies the owner, or `undefined` for an unowned row.
   * @param pickedUpAt Records the durable pickup time.
   * @param expiresAt Records the derived lease-expiry time.
   */
  constructor(
    readonly shard: ShardIndex,
    readonly worker: WorkerId | undefined,
    readonly pickedUpAt: Date,
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
  }
}

/**
 * Configures direct durable shard-session coordination.
 */
export interface ShardedWorkRegistryOptions {
  // prettier-ignore

  /**
   * Storage context that owns the shard-session family.
   */
  readonly context: StorageContext;

  /**
   * Factory that opens direct shard-session storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Optional lease duration in milliseconds.
   */
  readonly leaseMs?: number;

  /**
   * Returns the current time used to derive ownership expiry.
   *
   * @returns The current time.
   */
  readonly now?: () => Date;
}
const configs = new WeakMap<
  ShardedWorkRegistry,
  { context: StorageContext; storageFactory: StorageFactory; lease: number; now: () => Date }
>();

/**
 * Exposes package-internal registry construction observations for integrations.
 */
export const shardedWorkRegistryAccess: Readonly<{
  matches(
    registry: ShardedWorkRegistry,
    contextValue: StorageContext,
    storageFactory: StorageFactory,
  ): boolean;
}> = Object.freeze({
  matches(
    registry: ShardedWorkRegistry,
    contextValue: StorageContext,
    storageFactory: StorageFactory,
  ): boolean {
    const value = configs.get(registry);
    return (
      value?.storageFactory === storageFactory &&
      value.context.name === contextValue.name &&
      value.context.multitenant === contextValue.multitenant &&
      TenantBoundary.of(value.context).key === TenantBoundary.of(contextValue).key
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
  if (value.nodeId === undefined) throw new Error("Shard worker is invalid.");
  const node = value.nodeId.value;
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
  const index = record.index;
  if (index?.index !== expected.index || index.ofTotal !== expected.ofTotal)
    throw new DeliveryStorageCorruptionError("Shard session does not match its storage ID.");
  const picked = timestamp(record.whenLastPicked);
  const worker = record.worker === undefined ? undefined : checkedWorker(record.worker);
  const expires = picked.getTime() + lease;
  if (!Number.isSafeInteger(expires) || !Number.isFinite(new Date(expires).getTime()))
    throw new DeliveryStorageCorruptionError("Shard lease expiry is invalid.");
  return new ShardSession(expected, worker, picked, new Date(expires));
}
function atomic(storage: RecordStorage<WireShardIndex, ShardSessionRecord>): void {
  if (!storage.atomicCompareAndSet)
    throw new DeliveryStorageCorruptionError("Shard storage requires atomic compare-and-set.");
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
  const expiresAt = now + lease;
  if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(new Date(expiresAt).getTime()))
    throw new Error("Shard lease expiry is invalid.");
  return new ShardSession(shard, worker, new Date(now), new Date(expiresAt));
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
function sameWorker(a: WorkerId, b: WorkerId): boolean {
  return a.nodeId?.value === b.nodeId?.value && a.value === b.value;
}
function context(value: StorageContext): StorageContext {
  return value.multitenant
    ? {
        name: `${value.name}.delivery.shards`,
        multitenant: true,
        tenantId: clone(TenantIdSchema, value.tenantId),
      }
    : { name: `${value.name}.delivery.shards`, multitenant: false };
}
function copy(value: StorageContext): StorageContext {
  return value.multitenant
    ? {
        name: value.name,
        multitenant: true,
        tenantId: clone(TenantIdSchema, value.tenantId),
      }
    : { name: value.name, multitenant: false };
}
function concurrent(label: string): Error {
  return new Error(`${label} could not be completed due to concurrent changes.`);
}
