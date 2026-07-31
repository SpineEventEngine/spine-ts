import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-event-engine/storage";

import { DeliveryStorageCorruptionError } from "./delivery-storage-error.js";
import { DeliveryLeases } from "./delivery-lease.js";
import { ShardIndex } from "./shard-index.js";

const casRetryLimit = 8;

/**
 * Storage-backed shard registry for pickup, renewal, and release.
 *
 * Delivery drains use renewal as framework-owned lease fencing while endpoint
 * callbacks are active. The registry records shard ownership durably; callers
 * still own production scheduling, supervision, retry policy, and transport
 * topology around these pickup/renew/release operations.
 */
export class ShardedWorkRegistry {
  // prettier-ignore

  /**
   * Local registry pickups create renewable leased sessions.
   */
  readonly sessionKind = "LEASED" as const;
  readonly #context: StorageContext;
  readonly #leaseMs: number;
  readonly #now: () => Date;
  readonly #storageFactory: StorageFactory;

  /**
   * Opens a shard registry over one storage context.
   *
   * @param options Supplies durable storage, lease bounds, and an optional clock.
   */
  constructor(options: ShardedWorkRegistryOptions) {
    this.#context = ShardRegistryValues.copyStorageContext(options.context);
    this.#storageFactory = options.storageFactory;
    this.#leaseMs = DeliveryLeases.requireMs(
      "ShardedWorkRegistry",
      options.leaseMs ?? defaultShardLeaseMs,
    );
    this.#now = options.now ?? (() => new Date());
    registryConfigs.set(this, {
      context: this.#context,
      storageFactory: this.#storageFactory,
    });
    Object.freeze(this);
  }

  /**
   * Acquires one shard if it is free or expired.
   *
   * Invalid caller shard, node, and clock values throw before storage access.
   *
   * @param shard Selects the shard to acquire.
   * @param node Identifies the worker acquiring the shard.
   * @returns The leased session, when the shard is available.
   */
  async pickUp(shard: ShardIndex, node: string): Promise<ShardSession | undefined> {
    const nextShard = ShardRegistryValues.requireInputShard(shard, "Shard index");
    const nextNode = ShardRegistryValues.requireInputText(node, "Shard node", maxSessionTextBytes);
    let now = ShardRegistryValues.requireInputTime(this.#now(), "Shard pickup time");
    const storage = this.#storage();

    try {
      for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
        const currentRecord = await ShardRegistryValues.readShardRecord(storage, nextShard.key());
        const current =
          currentRecord === undefined
            ? undefined
            : ShardRegistryValues.readSession(currentRecord, nextShard.key());
        now = ShardRegistryValues.requireInputTime(this.#now(), "Shard pickup time");
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
        const nextRecord = ShardRegistryValues.writeSession(next);
        const claimed = await ShardRegistryValues.casShardRecord(
          storage,
          nextShard.key(),
          currentRecord,
          nextRecord,
        );

        if (claimed) {
          return next;
        }
      }

      throw ShardRegistryValues.casRetriesExhausted("Shard pickup");
    } finally {
      storage.close();
    }
  }

  /**
   * Updates one shard session when it remains current.
   *
   * @param session Supplies the current shard session.
   * @returns The renewed session, when the lease fence remains valid.
   */
  async renew(session: ShardSession): Promise<ShardSession | undefined> {
    const expected = ShardRegistryValues.snapshotSessionClaim(session);
    let now = ShardRegistryValues.requireInputTime(this.#now(), "Shard renewal time");
    const storage = this.#storage();

    try {
      for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
        const currentRecord = await ShardRegistryValues.readShardRecord(storage, expected.key);
        if (currentRecord === undefined) {
          return undefined;
        }

        const current = ShardRegistryValues.readSession(currentRecord, expected.key);
        now = ShardRegistryValues.requireInputTime(this.#now(), "Shard renewal time");
        if (current.id !== expected.id || current.node !== expected.node) {
          return undefined;
        }
        if (current.expiresAt.getTime() <= now) {
          return undefined;
        }

        const next = new ShardSession(
          current.id,
          current.shard,
          current.node,
          current.pickedUpAt,
          new Date(now + this.#leaseMs),
        );
        if (
          await ShardRegistryValues.casShardRecord(
            storage,
            expected.key,
            currentRecord,
            ShardRegistryValues.writeSession(next),
          )
        ) {
          return next;
        }
      }

      throw ShardRegistryValues.casRetriesExhausted("Shard renewal");
    } finally {
      storage.close();
    }
  }

  /**
   * Removes one shard session when it remains current.
   *
   * @param session Supplies the current shard session.
   * @returns Whether the session was released.
   */
  async release(session: ShardSession): Promise<boolean> {
    const expected = ShardRegistryValues.snapshotSessionClaim(session);
    let now = ShardRegistryValues.requireInputTime(this.#now(), "Shard release time");
    const storage = this.#storage();

    try {
      for (let attempt = 0; attempt < casRetryLimit; attempt += 1) {
        const currentRecord = await ShardRegistryValues.readShardRecord(storage, expected.key);
        if (currentRecord === undefined) {
          return false;
        }

        const current = ShardRegistryValues.readSession(currentRecord, expected.key);
        now = ShardRegistryValues.requireInputTime(this.#now(), "Shard release time");
        if (current.id !== expected.id || current.node !== expected.node) {
          return false;
        }
        if (current.expiresAt.getTime() <= now) {
          return false;
        }

        if (
          await ShardRegistryValues.casShardRecord(storage, expected.key, currentRecord, undefined)
        ) {
          return true;
        }
      }

      throw ShardRegistryValues.casRetriesExhausted("Shard release");
    } finally {
      storage.close();
    }
  }

  #storage(): RecordStorage<string, Any> {
    return this.#storageFactory.createRecordStorage(
      ShardRegistryValues.shardRegistryContext(this.#context),
      shardSessionRecordSpec,
    );
  }
}

/**
 * One active shard pickup session.
 */
export class ShardSession {
  // prettier-ignore

  /**
   * This local session carries a renewable lease.
   */
  readonly kind = "LEASED" as const;

  /**
   * Creates a shard session snapshot.
   *
   * @param id Identifies this pickup session.
   * @param shard Identifies the held shard.
   * @param node Identifies the owning worker node.
   * @param pickedUpAt Records when the shard was acquired.
   * @param expiresAt Records when the lease expires.
   */
  constructor(
    // prettier-ignore

    /**
     * Unique pickup session identifier.
     */
    readonly id: string,

    /**
     * Shard held by this session.
     */
    readonly shard: ShardIndex,

    /**
     * Worker node that owns this session.
     */
    readonly node: string,

    /**
     * Time when the shard was picked up.
     */
    readonly pickedUpAt: Date,

    /**
     * Time when the session lease expires.
     */
    readonly expiresAt: Date,
  ) {
    Object.freeze(this);
  }
}

/**
 * Shard registry construction options.
 */
export interface ShardedWorkRegistryOptions {
  // prettier-ignore

  /**
   * Storage context owning the shard registry.
   */
  readonly context: StorageContext;

  /**
   * Storage factory used for durable session records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Session lease duration in milliseconds, from 1000 to 2147483647 inclusive.
   */
  readonly leaseMs?: number;

  /**
   * Returns the optional clock used for lease expiry decisions.
   *
   * @returns The current registry time.
   */
  readonly now?: () => Date;
}

interface RegistryConfig {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
}

const registryConfigs = new WeakMap<ShardedWorkRegistry, RegistryConfig>();

interface ShardedWorkRegistryAccess {
  matches(
    registry: ShardedWorkRegistry,
    context: StorageContext,
    storageFactory: StorageFactory,
  ): boolean;
}

/**
 * Checks registry storage alignment for the delivery builder.
 * @internal
 */
export const shardedWorkRegistryAccess: ShardedWorkRegistryAccess = Object.freeze({
  matches(
    registry: ShardedWorkRegistry,
    context: StorageContext,
    storageFactory: StorageFactory,
  ): boolean {
    const configured = registryConfigs.get(registry);
    return (
      configured?.storageFactory === storageFactory &&
      ShardRegistryValues.sameContext(configured.context, context)
    );
  },
});

interface StoredShardSession {
  readonly key: string;
  readonly id: string;
  readonly node: string;
  readonly shardIndex: number;
  readonly shardTotal: number;
  readonly pickedUpAtMs: number;
  readonly expiresAtMs: number;
}

interface SessionClaim {
  readonly key: string;
  readonly id: string;
  readonly node: string;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const defaultShardLeaseMs = 30_000;

const shardSessionRecordSpec = new RecordSpec<string, Any>({
  schema: AnySchema,
  storageKey: "spine.delivery.ShardSession:current",
  idKind: "string",
  extractId: (record) => ShardRegistryValues.readStoredSession(record).key,
});

const ShardRegistryValues = Object.freeze({
  readSession(record: Any, expectedKey?: string): ShardSession {
    const stored = ShardRegistryValues.readStoredSession(record, expectedKey);

    return new ShardSession(
      stored.id,
      new ShardIndex(stored.shardIndex, stored.shardTotal),
      stored.node,
      ShardRegistryValues.storedDate(stored.pickedUpAtMs, "Shard pickup time"),
      ShardRegistryValues.storedDate(stored.expiresAtMs, "Shard expiry time"),
    );
  },

  copyStorageContext(context: StorageContext): StorageContext {
    const tenantId = context.tenantId;
    return Object.freeze({
      name: context.name,
      multitenant: context.multitenant,
      ...(tenantId === undefined ? {} : { tenantId }),
    });
  },

  sameContext(first: StorageContext, second: StorageContext): boolean {
    return (
      first.name === second.name &&
      first.multitenant === second.multitenant &&
      first.tenantId === second.tenantId
    );
  },

  casRetriesExhausted(label: string): Error {
    return new Error(`${label} could not be completed due to concurrent changes.`);
  },

  readStoredSession(record: Any, expectedKey?: string): StoredShardSession {
    const decoded = ShardRegistryValues.readSessionRecord(record);
    const shard = ShardRegistryValues.readSessionShard(decoded);
    const key = ShardRegistryValues.readSessionKey(decoded, shard, expectedKey);

    return ShardRegistryValues.buildStoredSession(decoded, shard, key);
  },

  readSessionRecord(record: Any): Record<string, unknown> {
    const typeUrl = ShardRegistryValues.readRecordTypeUrl(record);
    if (typeUrl !== shardSessionTypeUrl) {
      throw new DeliveryStorageCorruptionError(
        `Shard session record type URL "${typeUrl}" is invalid.`,
      );
    }

    const value = ShardRegistryValues.readStoredBytes(record);
    if (value.byteLength > maxSessionRecordBytes) {
      throw new DeliveryStorageCorruptionError(
        `Shard session record exceeds ${String(maxSessionRecordBytes)} bytes and cannot be read.`,
      );
    }

    try {
      const decoded = JSON.parse(ShardRegistryValues.decodeStoredUtf8(value)) as unknown;
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
  },

  readRecordTypeUrl(record: Any): string {
    try {
      return ShardRegistryValues.requireStoredText(
        Reflect.get(record, "typeUrl"),
        "Shard session record type URL",
      );
    } catch (error) {
      if (error instanceof DeliveryStorageCorruptionError) {
        throw error;
      }

      throw new DeliveryStorageCorruptionError("Shard session record type URL is invalid.", {
        cause: error,
      });
    }
  },

  readSessionShard(decoded: Record<string, unknown>): ShardIndex {
    return ShardRegistryValues.storedShardIndex(
      ShardRegistryValues.requireNumber(Reflect.get(decoded, "shardIndex"), "Shard session index"),
      ShardRegistryValues.requireNumber(Reflect.get(decoded, "shardTotal"), "Shard session total"),
      "Shard session",
    );
  },

  readSessionKey(
    decoded: Record<string, unknown>,
    shard: ShardIndex,
    expectedKey?: string,
  ): string {
    const key = ShardRegistryValues.requireStoredText(
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
  },

  buildStoredSession(
    decoded: Record<string, unknown>,
    shard: ShardIndex,
    key: string,
  ): StoredShardSession {
    return Object.freeze({
      key,
      id: ShardRegistryValues.requireStoredText(
        Reflect.get(decoded, "id"),
        "Shard session ID",
        maxSessionTextBytes,
      ),
      node: ShardRegistryValues.requireStoredText(
        Reflect.get(decoded, "node"),
        "Shard session node",
        maxSessionTextBytes,
      ),
      shardIndex: shard.index,
      shardTotal: shard.ofTotal,
      pickedUpAtMs: ShardRegistryValues.requireNumber(
        Reflect.get(decoded, "pickedUpAtMs"),
        "Shard pickup time",
      ),
      expiresAtMs: ShardRegistryValues.requireNumber(
        Reflect.get(decoded, "expiresAtMs"),
        "Shard expiry time",
      ),
    });
  },

  decodeStoredUtf8(value: Uint8Array): string {
    try {
      return utf8Decoder.decode(value);
    } catch (error) {
      throw new DeliveryStorageCorruptionError("Shard session record contains invalid UTF-8.", {
        cause: error,
      });
    }
  },

  async readShardRecord(
    storage: RecordStorage<string, Any>,
    key: string,
  ): Promise<Any | undefined> {
    try {
      return await storage.read(key);
    } catch (error) {
      throw ShardRegistryValues.shardStorageError(error);
    }
  },

  async casShardRecord(
    storage: RecordStorage<string, Any>,
    key: string,
    expected: Any | undefined,
    next: Any | undefined,
  ): Promise<boolean> {
    try {
      return await storage.compareAndSet(key, expected, next);
    } catch (error) {
      throw ShardRegistryValues.shardStorageError(error);
    }
  },

  shardStorageError(error: unknown): Error {
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
  },

  readStoredBytes(record: Any): Uint8Array {
    try {
      const value = Reflect.get(record, "value") as unknown;
      if (!(value instanceof Uint8Array)) {
        throw new DeliveryStorageCorruptionError(
          "Shard session record value must be a Uint8Array.",
        );
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
  },

  storedShardIndex(index: number, total: number, label: string): ShardIndex {
    try {
      return new ShardIndex(index, total);
    } catch (error) {
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`, { cause: error });
    }
  },

  shardRegistryContext(context: StorageContext): StorageContext {
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
  },

  writeSession(session: ShardSession): Any {
    const stored: StoredShardSession = {
      key: session.shard.key(),
      id: ShardRegistryValues.requireInputText(session.id, "Shard session ID", maxSessionTextBytes),
      node: ShardRegistryValues.requireInputText(
        session.node,
        "Shard session node",
        maxSessionTextBytes,
      ),
      shardIndex: session.shard.index,
      shardTotal: session.shard.ofTotal,
      pickedUpAtMs: ShardRegistryValues.requireInputTime(session.pickedUpAt, "Shard pickup time"),
      expiresAtMs: ShardRegistryValues.requireInputTime(session.expiresAt, "Shard expiry time"),
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
  },

  snapshotSessionClaim(session: unknown): SessionClaim {
    if (typeof session !== "object" || session === null) {
      throw new Error("Shard session is invalid.");
    }

    try {
      const shard = ShardRegistryValues.requireInputShard(
        Reflect.get(session, "shard"),
        "Shard session shard",
      );

      return Object.freeze({
        key: shard.key(),
        id: ShardRegistryValues.requireInputText(
          Reflect.get(session, "id"),
          "Shard session ID",
          maxSessionTextBytes,
        ),
        node: ShardRegistryValues.requireInputText(
          Reflect.get(session, "node"),
          "Shard session node",
          maxSessionTextBytes,
        ),
      });
    } catch (error) {
      throw new Error("Shard session is invalid.", { cause: error });
    }
  },

  requireNumber(value: unknown, label: string): number {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new DeliveryStorageCorruptionError(`${label} must be a finite integer.`);
    }

    return value as number;
  },

  requireStoredText(value: unknown, label: string, maxBytes = maxSessionTextBytes): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DeliveryStorageCorruptionError(`${label} must be a non-empty string.`);
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      throw new DeliveryStorageCorruptionError(
        `${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`,
      );
    }

    return value;
  },

  requireInputText(value: unknown, label: string, maxBytes = maxSessionTextBytes): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string.`);
    }
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      throw new Error(`${label} exceeds ${String(maxBytes)} bytes and cannot be stored.`);
    }

    return value;
  },

  requireInputShard(value: unknown, label: string): ShardIndex {
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

    const index = ShardRegistryValues.requireInputInteger(indexValue, `${label} index`);
    const total = ShardRegistryValues.requireInputInteger(totalValue, `${label} total`);

    try {
      return new ShardIndex(index, total);
    } catch (error) {
      throw new Error(`${label} is invalid.`, { cause: error });
    }
  },

  requireInputInteger(value: unknown, label: string): number {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new Error(`${label} must be a finite integer.`);
    }

    return value as number;
  },

  requireInputTime(value: Date, label: string): number {
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
  },

  storedDate(value: number, label: string): Date {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new DeliveryStorageCorruptionError(`${label} is invalid.`);
    }

    return date;
  },
});

const shardSessionTypeUrl = "type.spine-ts.dev/internal/ShardSessionRecord";
const maxSessionRecordBytes = 512 * 1024;
const maxSessionTextBytes = 16 * 1024;
const maxSessionKeyBytes = 64 * 1024;
