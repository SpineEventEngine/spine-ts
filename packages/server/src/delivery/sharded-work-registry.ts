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

const casRetryLimit = 8;

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

  /**
   * Pick up one shard if it is free or expired.
   *
   * Invalid caller shard, node, and clock values throw before storage access.
   */
  async pickUp(shard: ShardIndex, node: string): Promise<ShardSession | undefined> {
    const nextShard = requireInputShard(shard, "Shard index");
    const nextNode = requireInputText(node, "Shard node", maxSessionTextBytes);
    let now = requireInputTime(this.#now(), "Shard pickup time");
    const storage = this.#storage();

    try {
      for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
        const currentRecord = await readShardRecord(storage, nextShard.key());
        const current =
          currentRecord === undefined ? undefined : readSession(currentRecord, nextShard.key());
        if (current !== undefined && current.expiresAt.getTime() > now) {
          return undefined;
        }

        const next = new ShardSession(
          randomUUID(),
          nextShard,
          nextNode,
          new Date(now),
          new Date(now + this.#leaseMs),
        );
        const nextRecord = writeSession(next);
        const claimed = await casShardRecord(storage, nextShard.key(), currentRecord, nextRecord);

        if (claimed) {
          return next;
        }
        now = requireInputTime(this.#now(), "Shard pickup time");
      }

      throw casRetriesExhausted("Shard pickup");
    } finally {
      storage.close();
    }
  }

  /** Release one shard session if it is still current. */
  async release(session: ShardSession): Promise<boolean> {
    const expected = snapshotReleaseSession(session);
    const storage = this.#storage();

    try {
      for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
        const currentRecord = await readShardRecord(storage, expected.key);
        if (currentRecord === undefined) {
          return false;
        }

        const current = readSession(currentRecord, expected.key);
        if (current.id !== expected.id || current.node !== expected.node) {
          return false;
        }

        if (await casShardRecord(storage, expected.key, currentRecord, undefined)) {
          return true;
        }
      }

      throw casRetriesExhausted("Shard release");
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

/** One active shard pickup session. */
export class ShardSession {
  /** Create a shard session snapshot. */
  constructor(
    /** Unique pickup session identifier. */
    readonly id: string,
    /** Shard claimed by this session. */
    readonly shard: ShardIndex,
    /** Worker node that owns this session. */
    readonly node: string,
    /** Time when the shard was picked up. */
    readonly pickedUpAt: Date,
    /** Time when the session lease expires. */
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
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

interface ReleaseSession {
  readonly key: string;
  readonly id: string;
  readonly node: string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const shardSessionRecordSpec = new RecordSpec<string, Any>({
  schema: AnySchema,
  extractId: (record) => readStoredSession(record).key,
});

function readSession(record: Any, expectedKey?: string): ShardSession {
  const stored = readStoredSession(record, expectedKey);

  return new ShardSession(
    stored.id,
    new ShardIndex(stored.shardIndex, stored.shardTotal),
    stored.node,
    storedDate(stored.pickedUpAtMs, "Shard pickup time"),
    storedDate(stored.expiresAtMs, "Shard expiry time"),
  );
}

function casRetriesExhausted(label: string): Error {
  return new Error(`${label} could not be completed due to concurrent changes.`);
}

function readStoredSession(record: Any, expectedKey?: string): StoredShardSession {
  const decoded = readSessionRecord(record);
  const shard = readSessionShard(decoded);
  const key = readSessionKey(decoded, shard, expectedKey);

  return buildStoredSession(decoded, shard, key);
}

function readSessionRecord(record: Any): Record<string, unknown> {
  const typeUrl = readRecordTypeUrl(record);
  if (typeUrl !== shardSessionTypeUrl) {
    throw new DeliveryStorageCorruptionError(
      `Shard session record type URL "${typeUrl}" is invalid.`,
    );
  }

  const value = readStoredBytes(record);
  if (value.byteLength > maxSessionRecordBytes) {
    throw new DeliveryStorageCorruptionError(
      `Shard session record exceeds ${String(maxSessionRecordBytes)} bytes and cannot be read.`,
    );
  }

  try {
    const decoded = JSON.parse(decodeStoredUtf8(value)) as unknown;
    if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
      throw new DeliveryStorageCorruptionError("Shard session record is not a JSON object.");
    }

    return decoded as Record<string, unknown>;
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError("Shard session record contains malformed JSON.", {
      cause: error,
    });
  }
}

function readRecordTypeUrl(record: Any): string {
  try {
    return requireStoredText(Reflect.get(record, "typeUrl"), "Shard session record type URL");
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError("Shard session record type URL is invalid.", {
      cause: error,
    });
  }
}

function readSessionShard(decoded: Record<string, unknown>): ShardIndex {
  return storedShardIndex(
    requireNumber(Reflect.get(decoded, "shardIndex"), "Shard session index"),
    requireNumber(Reflect.get(decoded, "shardTotal"), "Shard session total"),
    "Shard session",
  );
}

function readSessionKey(
  decoded: Record<string, unknown>,
  shard: ShardIndex,
  expectedKey?: string,
): string {
  const key = requireStoredText(
    Reflect.get(decoded, "key"),
    "Shard session key",
    maxSessionKeyBytes,
  );
  if (key !== shard.key()) {
    throw new DeliveryStorageCorruptionError("Shard session key does not match shard.");
  }
  if (expectedKey !== undefined && key !== expectedKey) {
    throw new DeliveryStorageCorruptionError(
      `Shard session "${key}" does not match storage key "${expectedKey}".`,
    );
  }

  return key;
}

function buildStoredSession(
  decoded: Record<string, unknown>,
  shard: ShardIndex,
  key: string,
): StoredShardSession {
  return Object.freeze({
    key,
    id: requireStoredText(Reflect.get(decoded, "id"), "Shard session ID", maxSessionTextBytes),
    node: requireStoredText(
      Reflect.get(decoded, "node"),
      "Shard session node",
      maxSessionTextBytes,
    ),
    shardIndex: shard.index,
    shardTotal: shard.ofTotal,
    pickedUpAtMs: requireNumber(Reflect.get(decoded, "pickedUpAtMs"), "Shard pickup time"),
    expiresAtMs: requireNumber(Reflect.get(decoded, "expiresAtMs"), "Shard expiry time"),
  });
}

function decodeStoredUtf8(value: Uint8Array): string {
  try {
    return utf8Decoder.decode(value);
  } catch (error) {
    throw new DeliveryStorageCorruptionError("Shard session record contains invalid UTF-8.", {
      cause: error,
    });
  }
}

async function readShardRecord(
  storage: RecordStorage<string, Any>,
  key: string,
): Promise<Any | undefined> {
  try {
    return await storage.read(key);
  } catch (error) {
    throw shardStorageError(error);
  }
}

async function casShardRecord(
  storage: RecordStorage<string, Any>,
  key: string,
  expected: Any | undefined,
  next: Any | undefined,
): Promise<boolean> {
  try {
    return await storage.compareAndSet(key, expected, next);
  } catch (error) {
    throw shardStorageError(error);
  }
}

function shardStorageError(error: unknown): Error {
  if (
    error instanceof Error &&
    (error.message === "Storage record could not be cloned." ||
      error.message === "Storage value could not be cloned.")
  ) {
    return new DeliveryStorageCorruptionError("Shard session record is invalid.", {
      cause: error,
    });
  }

  return error instanceof Error ? error : new Error(String(error));
}

function readStoredBytes(record: Any): Uint8Array {
  try {
    const value = Reflect.get(record, "value") as unknown;
    if (!(value instanceof Uint8Array)) {
      throw new DeliveryStorageCorruptionError("Shard session record value must be a Uint8Array.");
    }

    return value;
  } catch (error) {
    if (error instanceof DeliveryStorageCorruptionError) {
      throw error;
    }

    throw new DeliveryStorageCorruptionError("Shard session record value is invalid.", {
      cause: error,
    });
  }
}

function storedShardIndex(index: number, total: number, label: string): ShardIndex {
  try {
    return new ShardIndex(index, total);
  } catch (error) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`, { cause: error });
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
    id: requireInputText(session.id, "Shard session ID", maxSessionTextBytes),
    node: requireInputText(session.node, "Shard session node", maxSessionTextBytes),
    shardIndex: session.shard.index,
    shardTotal: session.shard.ofTotal,
    pickedUpAtMs: requireInputTime(session.pickedUpAt, "Shard pickup time"),
    expiresAtMs: requireInputTime(session.expiresAt, "Shard expiry time"),
  };
  const value = Buffer.from(JSON.stringify(stored), "utf8");

  if (value.byteLength > maxSessionRecordBytes) {
    throw new Error(
      `Shard session record exceeds ${String(maxSessionRecordBytes)} bytes and cannot be stored.`,
    );
  }

  return create(AnySchema, {
    typeUrl: shardSessionTypeUrl,
    value,
  });
}

function snapshotReleaseSession(session: unknown): ReleaseSession {
  if (typeof session !== "object" || session === null) {
    throw new Error("Shard session is invalid.");
  }

  try {
    const shard = requireInputShard(Reflect.get(session, "shard"), "Shard session shard");

    return Object.freeze({
      key: shard.key(),
      id: requireInputText(Reflect.get(session, "id"), "Shard session ID", maxSessionTextBytes),
      node: requireInputText(
        Reflect.get(session, "node"),
        "Shard session node",
        maxSessionTextBytes,
      ),
    });
  } catch (error) {
    throw new Error("Shard session is invalid.", { cause: error });
  }
}

function requireNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireStoredText(value: unknown, label: string, maxBytes = maxSessionTextBytes): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new DeliveryStorageCorruptionError(
      `${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`,
    );
  }

  return value;
}

function requireInputText(value: unknown, label: string, maxBytes = maxSessionTextBytes): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new Error(`${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`);
  }

  return value;
}

function requireInputShard(value: unknown, label: string): ShardIndex {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${label} is invalid.`);
  }

  let indexValue: unknown;
  let totalValue: unknown;
  try {
    indexValue = Reflect.get(value, "index");
    totalValue = Reflect.get(value, "ofTotal");
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  const index = requireInputInteger(indexValue, `${label} index`);
  const total = requireInputInteger(totalValue, `${label} total`);

  try {
    return new ShardIndex(index, total);
  } catch (error) {
    throw new Error(`${label} is invalid.`, { cause: error });
  }
}

function requireInputInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite integer.`);
  }

  return value as number;
}

function requireInputTime(value: Date, label: string): number {
  if (!(value instanceof Date)) {
    throw new Error(`${label} is invalid.`);
  }

  let time: number;
  try {
    time = value.getTime();
  } catch (error) {
    throw new Error(`${label} is invalid.`, { cause: error });
  }
  if (!Number.isFinite(time)) {
    throw new Error(`${label} is invalid.`);
  }

  return time;
}

function storedDate(value: number, label: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
  }

  return date;
}

const shardSessionTypeUrl = "type.spine-ts.dev/internal/ShardSessionRecord";
const maxSessionRecordBytes = 512 * 1024;
const maxSessionTextBytes = 16 * 1024;
const maxSessionKeyBytes = 64 * 1024;
