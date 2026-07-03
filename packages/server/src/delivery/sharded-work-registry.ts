import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import { ShardIndex } from "./shard-index.js";

/** One active shard pickup session. */
export class ShardSession {
  /** Create a shard session snapshot. */
  constructor(
    readonly id: string,
    readonly shard: ShardIndex,
    readonly node: string,
    readonly pickedUpAt: Date,
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
  }
}

/** Storage-backed shard pickup registry. */
export class ShardedWorkRegistry {
  readonly #context: StorageContext;
  readonly #leaseMs: number;
  readonly #now: () => Date;
  readonly #storageFactory: StorageFactory;

  /** Open a shard registry over one storage context. */
  constructor(options: ShardedWorkRegistryOptions) {
    if (!Number.isInteger(options.leaseMs ?? 30_000) || (options.leaseMs ?? 30_000) <= 0) {
      throw new Error("ShardedWorkRegistry leaseMs must be a positive integer.");
    }
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.#now = options.now ?? (() => new Date());
    Object.freeze(this);
  }

  /** Pick up one shard if it is free or expired. */
  async pickUp(shard: ShardIndex, node: string): Promise<ShardSession | undefined> {
    const storage = this.#storage();

    try {
      for (;;) {
        const now = this.#now();
        const currentRecord = await storage.read(shard.key());
        const current = currentRecord === undefined ? undefined : readSession(currentRecord);
        if (current !== undefined && current.expiresAt.getTime() > now.getTime()) {
          return undefined;
        }

        const next = new ShardSession(
          randomUUID(),
          new ShardIndex(shard.index, shard.ofTotal),
          requireText(node, "Shard node"),
          new Date(now.getTime()),
          new Date(now.getTime() + this.#leaseMs),
        );
        const nextRecord = writeSession(next);
        const claimed = await storage.compareAndSet(shard.key(), currentRecord, nextRecord);

        if (claimed) {
          return next;
        }
      }
    } finally {
      storage.close();
    }
  }

  /** Release one shard session if it is still current. */
  async release(session: ShardSession): Promise<boolean> {
    const storage = this.#storage();

    try {
      for (;;) {
        const currentRecord = await storage.read(session.shard.key());
        if (currentRecord === undefined) {
          return false;
        }

        const current = readSession(currentRecord);
        if (current.id !== session.id || current.node !== session.node) {
          return false;
        }

        if (await storage.compareAndSet(session.shard.key(), currentRecord, undefined)) {
          return true;
        }
      }
    } finally {
      storage.close();
    }
  }

  #storage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      shardRegistryContext(this.#context),
      shardSessionRecordSpec,
    );
  }
}

/** Shard registry construction options. */
export interface ShardedWorkRegistryOptions {
  /** Storage context owning the shard registry. */
  readonly context: StorageContext;
  /** Storage factory used for durable session records. */
  readonly storageFactory: StorageFactory;
  /** Session lease duration in milliseconds. */
  readonly leaseMs?: number;
  /** Optional clock used for lease expiry decisions. */
  readonly now?: () => Date;
}

interface StoredShardSession {
  readonly key: string;
  readonly id: string;
  readonly node: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly pickedUpAtMs: number;
  readonly expiresAtMs: number;
}

const shardSessionRecordSpec = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredSession(record).key,
});

function readSession(record: Any): ShardSession {
  const stored = readStoredSession(record);

  return new ShardSession(
    stored.id,
    new ShardIndex(stored.shardIndex, stored.shardTotal),
    stored.node,
    new Date(stored.pickedUpAtMs),
    new Date(stored.expiresAtMs),
  );
}

function readStoredSession(record: Any): StoredShardSession {
  if (record.typeUrl !== shardSessionTypeUrl) {
    throw new DeliveryStorageCorruptionError(
      `Shard session record type URL "${record.typeUrl}" is invalid.`,
    );
  }

  if (record.value.byteLength > maxSessionRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `Shard session record exceeds ${String(maxSessionRecordBytes)} bytes and cannot be read.`,
    );
  }

  try {
    const decoded = JSON.parse(Buffer.from(record.value).toString("utf8")) as unknown;
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new DeliveryStorageCorruptionError("Shard session record is not a JSON object.");
    }

    const shard = new ShardIndex(
      requireNumber(Reflect.get(decoded, "shardIndex"), "Shard session index"),
      requireNumber(Reflect.get(decoded, "shardTotal"), "Shard session total"),
    );
    const key = requireText(Reflect.get(decoded, "key"), "Shard session key");
    if (key !== shard.key()) {
      throw new DeliveryStorageCorruptionError("Shard session key does not match shard.");
    }

    return Object.freeze({
      key,
      id: requireText(Reflect.get(decoded, "id"), "Shard session ID"),
      node: requireText(Reflect.get(decoded, "node"), "Shard session node"),
      shardIndex: shard.index,
      shardTotal: shard.ofTotal,
      pickedUpAtMs: requireNumber(Reflect.get(decoded, "pickedUpAtMs"), "Shard pickup time"),
      expiresAtMs: requireNumber(Reflect.get(decoded, "expiresAtMs"), "Shard expiry time"),
    });
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError("Shard session record contains malformed JSON.", {
      cause: error,
    });
  }
}

function shardRegistryContext(context: StorageContext): StorageContext {
  return context.multitenant
    ? {
        name: `${context.name}.delivery.shards`,
        multitenant: true,
        ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
      }
    : {
        name: `${context.name}.delivery.shards`,
        multitenant: false,
      };
}

function writeSession(session: ShardSession): Any {
  const stored: StoredShardSession = {
    key: session.shard.key(),
    id: requireText(session.id, "Shard session ID"),
    node: requireText(session.node, "Shard session node"),
    shardIndex: session.shard.index,
    shardTotal: session.shard.ofTotal,
    pickedUpAtMs: requireTime(session.pickedUpAt, "Shard pickup time"),
    expiresAtMs: requireTime(session.expiresAt, "Shard expiry time"),
  };
  const value = Buffer.from(JSON.stringify(stored), "utf8");

  if (value.byteLength > maxSessionRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `Shard session record exceeds ${String(maxSessionRecordBytes)} bytes and cannot be stored.`,
    );
  }

  return create(AnySchema, {
    typeUrl: shardSessionTypeUrl,
    value,
  });
}

function requireNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireTime(value: Date, label: string): number {
  const time = value.getTime();
  if (!Number.isFinite(time)) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  return time;
}

const shardSessionTypeUrl = "type.spine-ts.dev/internal/ShardSessionRecord";
const maxSessionRecordBytes = 512 * 1024;
