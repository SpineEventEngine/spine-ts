import type { StorageContext, StorageFactory } from "@spine-ts/storage";

import { ServerEnvironment } from "../server/server-environment.js";
import { Delivery as CoreDelivery, type OnDeliveryMessage } from "./delivery.js";
import type { Inbox } from "./inbox.js";
import { inboxStorageAccess } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry, shardedWorkRegistryAccess } from "./sharded-work-registry.js";

const defaultContext: StorageContext = Object.freeze({
  name: "__System_Delivery__",
  multitenant: false,
});
const defaultPageSize = 100;
const defaultBatchSize = 100;
const maxBatchSize = 1_000;

/** Assigns inbox targets to durable delivery shards. */
export interface DeliveryStrategy {
  /** Positive number of shards addressable by this strategy. */
  readonly shardCount: number;
  /** Return the shard for one target identity and type. */
  shardFor(targetId: string, targetType: string): ShardIndex;
}

/** Places every target in one local shard. */
export class UniformAcrossAllShards implements DeliveryStrategy {
  static readonly #single = new UniformAcrossAllShards(1);
  /** Return a strategy that uses the requested positive number of shards. */
  static forNumber(shards: number): UniformAcrossAllShards {
    return new UniformAcrossAllShards(shards);
  }

  /** Return the shared single-shard strategy. */
  static singleShard(): UniformAcrossAllShards {
    return this.#single;
  }

  /** Number of uniformly distributed shards. */
  readonly shardCount: number;

  private constructor(shards: number) {
    if (!Number.isSafeInteger(shards) || shards <= 0) {
      throw new Error("Delivery shard count must be a positive safe integer.");
    }
    this.shardCount = shards;
    Object.freeze(this);
  }

  /** Determine a stable shard from a target identity. */
  shardFor(targetId: string, targetType: string): ShardIndex {
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("Delivery target ID must be a non-empty string.");
    }
    if (typeof targetType !== "string" || targetType.length === 0) {
      throw new Error("Delivery target type must be a non-empty string.");
    }
    return new ShardIndex(hash(`${targetType}:${targetId}`) % this.shardCount, this.shardCount);
  }
}

/** Observes finite local delivery without owning scheduling or retry policy. */
export interface DeliveryMonitor {
  /** Called after exclusive pickup and before page work. Throwing aborts the run after release. */
  onStarted?(shard: ShardIndex): void;
  /** Called after every released page; return `false` to stop, or throw to reject the run. */
  onPage?(page: DeliveryPage): boolean | undefined;
  /** Called when another node owns the shard. Throwing rejects without terminal notification. */
  onSkipped?(shard: ShardIndex): void;
  /** Called after a released failed page. Throwing rejects without terminal notification. */
  onFailure?(page: DeliveryPage): void;
  /** Last hook for a fulfilled run; throwing rejects the returned promise after all release work. */
  onCompleted?(result: DeliveryResult): void;
}

/** Immutable outcome of one finite local delivery run. */
export interface DeliveryResult {
  /** Terminal reason for this local run. */
  readonly status: "COMPLETED" | "SKIPPED" | "STOPPED" | "FAILED" | "PAUSED";
  /** Frozen ordered primitive page summaries, bounded by the configured batch size. */
  readonly pages: readonly DeliveryPage[];
}

/** Immutable primitive summary of one bounded loop page. */
export interface DeliveryPage {
  /** Why this bounded page stopped. */
  readonly status: "IDLE" | "SKIPPED" | "STOPPED" | "FAILED" | "PAUSED";
  /** Pending rows examined. */
  readonly processed: number;
  /** Rows whose endpoint callback ran. */
  readonly accepted: number;
  /** Rows durably marked delivered. */
  readonly delivered: number;
  /** Failures observed without exposing mutable payloads or errors. */
  readonly failed: number;
}

/** Options for one finite local delivery run. */
export interface DeliveryRunOptions {
  /** Framework endpoint invoked for each available inbox row. */
  readonly onMessage: OnDeliveryMessage;
  /**
   * Shard to process; defaults to the strategy's only shard when applicable.
   * An explicit shard's `ofTotal` must equal the strategy's resolved `shardCount`.
   */
  readonly shard?: ShardIndex;
}

/** Builder-owned public delivery view. */
export interface Delivery {
  /** Immutable storage namespace selected for this delivery. */
  readonly context: StorageContext;
  /** Storage factory selected for durable delivery records. */
  readonly storageFactory: StorageFactory;
  /** Target-to-shard strategy selected for inbox writes and runs. */
  readonly strategy: DeliveryStrategy;
  /** Node identity used for exclusive shard pickup. */
  readonly node: string;
  /** Maximum accepted work per internal delivery page, from 1 through 1000. */
  readonly pageSize: number;
  /** Maximum retained page summaries per finite run, from 1 through 1000. */
  readonly batchSize: number;
  /** Durable inbox facade. */
  readonly inbox: Inbox;
  /** Run one finite local shard delivery. */
  run(options: DeliveryRunOptions): Promise<DeliveryResult>;
}

/** Configures and snapshots one public {@link Delivery}. */
export class DeliveryBuilder {
  #context: StorageContext | undefined;
  #storageFactory: StorageFactory | undefined;
  #workRegistry: ShardedWorkRegistry | undefined;
  #strategy: DeliveryStrategy | undefined;
  #monitor: DeliveryMonitor | undefined;
  #pageSize: number | undefined;
  #batchSize: number | undefined;
  #node: string | undefined;

  /** Configure the storage namespace for inbox, attempts, and shard records. */
  withContext(context: StorageContext): this {
    this.#context = snapshotContext(context);
    return this;
  }

  /** Configure the storage factory. */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /** Configure the registry used for exclusive shard pickup. */
  withWorkRegistry(workRegistry: ShardedWorkRegistry): this {
    this.#workRegistry = workRegistry;
    return this;
  }

  /** Configure the target-to-shard strategy. */
  withStrategy(strategy: DeliveryStrategy): this {
    this.#strategy = requireDeliveryStrategy(strategy);
    return this;
  }

  /** Configure finite-run observation and cancellation. */
  withMonitor(monitor: DeliveryMonitor): this {
    this.#monitor = monitor;
    return this;
  }

  /** Configure the positive accepted-work bound for one page. */
  withPageSize(pageSize: number): this {
    this.#pageSize = requireBound("Delivery page size", pageSize, inboxStorageAccess.maxReadLimit);
    return this;
  }

  /** Configure the positive number of pages admitted by one local run. */
  withBatchSize(batchSize: number): this {
    this.#batchSize = requireBound("Delivery batch size", batchSize, maxBatchSize);
    return this;
  }

  /** Configure the node identity used for shard pickup. */
  withNode(node: string): this {
    if (typeof node !== "string" || node.length === 0) {
      throw new Error("Delivery node must be a non-empty string.");
    }
    this.#node = node;
    return this;
  }

  /** Resolve the current builder configuration into one immutable delivery. */
  build(): Delivery {
    const context = this.#context ?? defaultContext;
    const strategy = snapshotDeliveryStrategy(
      this.#strategy ?? UniformAcrossAllShards.singleShard(),
    );
    let storageFactory = this.#storageFactory;
    let node = this.#node;
    if (storageFactory === undefined || node === undefined) {
      const environment = ServerEnvironment.instance();
      storageFactory ??= environment.storageFactory;
      node ??= environment.nodeId;
    }
    if (
      this.#workRegistry !== undefined &&
      !shardedWorkRegistryAccess.matches(this.#workRegistry, context, storageFactory)
    ) {
      throw new Error("Delivery work registry must use the delivery storage context and factory.");
    }
    const workRegistry = this.#workRegistry ?? new ShardedWorkRegistry({ context, storageFactory });
    const core = new CoreDelivery({
      context,
      storageFactory,
      workRegistry,
      strategy,
      ...(this.#monitor === undefined ? {} : { monitor: this.#monitor }),
      pageSize: this.#pageSize ?? defaultPageSize,
      batchSize: this.#batchSize ?? defaultBatchSize,
      node,
    });
    return new BuiltDelivery(core);
  }
}

class BuiltDelivery implements Delivery {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly strategy: DeliveryStrategy;
  readonly node: string;
  readonly pageSize: number;
  readonly batchSize: number;
  readonly inbox: Inbox;
  readonly #core: CoreDelivery;

  constructor(core: CoreDelivery) {
    this.#core = core;
    this.context = core.context;
    this.storageFactory = core.storageFactory;
    this.strategy = core.strategy;
    this.node = core.node;
    this.pageSize = core.pageSize;
    this.batchSize = core.batchSize;
    this.inbox = core.inbox;
    Object.freeze(this);
  }

  run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    return this.#core.run(options);
  }
}

function requireDeliveryStrategy(strategy: DeliveryStrategy): DeliveryStrategy {
  if (!Number.isSafeInteger(strategy.shardCount) || strategy.shardCount <= 0) {
    throw new Error("Delivery strategy shard count must be a positive safe integer.");
  }
  return strategy;
}

function snapshotDeliveryStrategy(strategy: DeliveryStrategy): DeliveryStrategy {
  const shardCount = requireDeliveryStrategy(strategy).shardCount;
  return Object.freeze({
    shardCount,
    shardFor(targetId: string, targetType: string): ShardIndex {
      const shard = strategy.shardFor(targetId, targetType);
      if (shard.ofTotal !== shardCount) {
        throw new Error("Delivery strategy shard total must equal its resolved shard count.");
      }
      return shard;
    },
  });
}

function hash(value: string): number {
  let result = 0;
  for (const character of value) {
    result = (result * 31 + character.charCodeAt(0)) >>> 0;
  }
  return result;
}

function requireBound(name: string, value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  if (value > max) {
    throw new Error(`${name} must be at most ${String(max)}.`);
  }
  return value;
}

function snapshotContext(context: StorageContext): StorageContext {
  if (typeof context.name !== "string" || context.name.length === 0) {
    throw new Error("Delivery storage context name must be a non-empty string.");
  }
  return Object.freeze({ ...context });
}
