import { randomUUID } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { AnySchema, type Any } from "@bufbuild/protobuf/wkt";
import {
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

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
  readonly #storageFactory: StorageFactory;

  /** Open a shard registry over one storage context. */
  constructor(options: ShardedWorkRegistryOptions) {
    if (!Number.isInteger(options.leaseMs ?? 30_000) || (options.leaseMs ?? 30_000) <= 0) {
      throw new Error("ShardedWorkRegistry leaseMs must be a positive integer.");
    }
    this.#context = options.context;
    this.#storageFactory = options.storageFactory;
    this.#leaseMs = options.leaseMs ?? 30_000;
    Object.freeze(this);
  }

  /** Pick up one shard if it is free or expired. */
  pickUp(
    shard: ShardIndex,
    node: string,
    now: Date = new Date(),
  ): Promise<ShardSession | undefined> {
    const key = shard.key();

    return ShardRegistryLocks.withLock(this.#storageFactory, key, async () => {
      const storage = this.#storage();

      try {
        const current = await this.#read(storage, shard);
        if (current !== undefined && current.expiresAt.getTime() > now.getTime()) {
          return undefined;
        }

        const session = new ShardSession(
          randomUUID(),
          new ShardIndex(shard.index, shard.ofTotal),
          node,
          new Date(now.getTime()),
          new Date(now.getTime() + this.#leaseMs),
        );
        await storage.write(writeSession(session));
        return session;
      } finally {
        storage.close();
      }
    });
  }

  /** Release one shard session if it is still current. */
  release(session: ShardSession): Promise<boolean> {
    const key = session.shard.key();

    return ShardRegistryLocks.withLock(this.#storageFactory, key, async () => {
      const storage = this.#storage();

      try {
        const current = await this.#read(storage, session.shard);
        if (current?.id !== session.id || current.node !== session.node) {
          return false;
        }

        return await storage.delete(key);
      } finally {
        storage.close();
      }
    });
  }

  async #read(
    storage: RecordStorage<string, Any>,
    shard: ShardIndex,
  ): Promise<ShardSession | undefined> {
    const record = await storage.read(shard.key());
    return record ? readSession(record) : undefined;
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

const ShardRegistryLocks = Object.freeze({
  queues: new WeakMap<StorageFactory, Map<string, Promise<void>>>(),

  async withLock<T>(factory: StorageFactory, key: string, work: () => Promise<T>): Promise<T> {
    const queues = this.queueMap(factory);
    const previous = queues.get(key) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    queues.set(
      key,
      previous.then(() => current),
    );

    try {
      await previous;
      return await work();
    } finally {
      release?.();
      if (queues.get(key) === current) {
        queues.delete(key);
      }
    }
  },

  queueMap(factory: StorageFactory): Map<string, Promise<void>> {
    let queues = this.queues.get(factory);

    if (queues === undefined) {
      queues = new Map<string, Promise<void>>();
      this.queues.set(factory, queues);
    }

    return queues;
  },
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
  if (record.typeUrl !== shardSessionRecordTypeUrl) {
    throw new Error("Shard session record type URL is invalid.");
  }

  const decoded = JSON.parse(Buffer.from(record.value).toString("utf8")) as StoredShardSession;
  if (typeof decoded.key !== "string" || typeof decoded.id !== "string") {
    throw new Error("Shard session record is invalid.");
  }
  return decoded;
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
    id: session.id,
    node: session.node,
    shardIndex: session.shard.index,
    shardTotal: session.shard.ofTotal,
    pickedUpAtMs: session.pickedUpAt.getTime(),
    expiresAtMs: session.expiresAt.getTime(),
  };

  return create(AnySchema, {
    typeUrl: shardSessionRecordTypeUrl,
    value: Buffer.from(JSON.stringify(stored), "utf8"),
  });
}

const shardSessionRecordTypeUrl = "type.spine-ts.dev/internal/ShardSessionRecord";
