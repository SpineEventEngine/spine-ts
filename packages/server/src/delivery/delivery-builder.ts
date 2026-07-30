import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";

import { ServerEnvironment } from "../server/server-environment.js";
import { Delivery as CoreDelivery, type OnDeliveryMessage } from "./delivery.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "./delivery-ports.js";
import type { DeliveryControlledRun } from "./delivery-run-control.js";
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
const controlledDeliveryRunners = new WeakMap<
  Delivery,
  (options: DeliveryControlledRun) => Promise<DeliveryResult>
>();

/** Provides package-local controls for builder-created deliveries. */
export interface DeliveryControls {
  /**
   * Finds controlled execution for one builder-created delivery.
   *
   * @param delivery The builder-created delivery.
   * @returns Its controlled runner, if present.
   */
  runner(
    delivery: Delivery,
  ): ((options: DeliveryControlledRun) => Promise<DeliveryResult>) | undefined;
}

/** Exposes package-local controls for builder-created deliveries. */
export const deliveryControls: DeliveryControls = Object.freeze({
  /** Finds controlled execution for a builder-created delivery. */
  runner(
    delivery: Delivery,
  ): ((options: DeliveryControlledRun) => Promise<DeliveryResult>) | undefined {
    return controlledDeliveryRunners.get(delivery);
  },
});

/** Assigns inbox targets to durable delivery shards. */
export interface DeliveryStrategy {
  /** Positive number of shards addressable by this strategy. */
  readonly shardCount: number;
  /**
   * Returns the shard for one target identity and type.
   *
   * @param targetId The target identity.
   * @param targetType The target type URL.
   * @returns The durable shard for the target.
   */
  shardFor(targetId: string, targetType: string): ShardIndex;
}

/** Places every target in one local shard. */
export class UniformAcrossAllShards implements DeliveryStrategy {
  static readonly #single = new UniformAcrossAllShards(1);
  /**
   * Returns a strategy with the requested positive number of shards.
   *
   * @param shards The number of addressable shards.
   * @returns A uniform shard strategy.
   */
  static forNumber(shards: number): UniformAcrossAllShards {
    return new UniformAcrossAllShards(shards);
  }

  /**
   * Returns the shared single-shard strategy.
   *
   * @returns The shared single-shard strategy.
   */
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

  /**
   * Determines a stable shard from a target identity.
   *
   * @param targetId The target identity.
   * @param targetType The target type URL.
   * @returns The stable shard for the target.
   */
  shardFor(targetId: string, targetType: string): ShardIndex {
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("Delivery target ID must be a non-empty string.");
    }
    if (typeof targetType !== "string" || targetType.length === 0) {
      throw new Error("Delivery target type must be a non-empty string.");
    }
    return new ShardIndex(
      DeliveryValues.hash(`${targetType}:${targetId}`) % this.shardCount,
      this.shardCount,
    );
  }
}

/** Observes finite local delivery without owning scheduling or retry policy. */
export interface DeliveryMonitor {
  /**
   * Observes exclusive pickup before page work.
   *
   * @param shard The picked shard.
   */
  onStarted?(shard: ShardIndex): void;
  /**
   * Observes a released page.
   *
   * @param page The completed page.
   * @returns `false` to stop the run, otherwise `undefined`.
   */
  onPage?(page: DeliveryPage): boolean | undefined;
  /**
   * Observes a shard owned by another node.
   *
   * @param shard The unavailable shard.
   */
  onSkipped?(shard: ShardIndex): void;
  /**
   * Observes a released failed page.
   *
   * @param page The failed page.
   */
  onFailure?(page: DeliveryPage): void;
  /**
   * Observes a fulfilled run after all release work.
   *
   * @param result The terminal run result.
   */
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
  readonly inbox: DeliveryInbox;
  /**
   * Executes one finite local shard delivery.
   *
   * @param options The shard and endpoint callback.
   * @returns The terminal finite-run result.
   */
  run(options: DeliveryRunOptions): Promise<DeliveryResult>;
}

/** Configures and snapshots one public {@link Delivery}. */
export class DeliveryBuilder {
  #context: StorageContext | undefined;
  #storageFactory: StorageFactory | undefined;
  #workRegistry: DeliveryWorkRegistry | undefined;
  #inbox: DeliveryInbox | undefined;
  #strategy: DeliveryStrategy | undefined;
  #monitor: DeliveryMonitor | undefined;
  #pageSize: number | undefined;
  #batchSize: number | undefined;
  #node: string | undefined;

  /**
   * Sets the storage namespace for inbox, attempts, and shard records.
   *
   * @param context The delivery storage namespace.
   * @returns This builder.
   */
  withContext(context: StorageContext): this {
    this.#context = DeliveryValues.snapshotContext(context);
    return this;
  }

  /** Sets the storage factory.
   * @param storageFactory The durable storage factory.
   * @returns This builder.
   */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /** Sets the registry used for exclusive shard pickup.
   * @param workRegistry The shard work registry.
   * @returns This builder.
   */
  withWorkRegistry(workRegistry: DeliveryWorkRegistry): this {
    this.#workRegistry = workRegistry;
    return this;
  }

  /** Sets an inbox port instead of the local durable inbox default.
   * @param inbox The inbox port.
   * @returns This builder.
   */
  withInbox(inbox: DeliveryInbox): this {
    this.#inbox = inbox;
    return this;
  }

  /** Sets the target-to-shard strategy.
   * @param strategy The target strategy.
   * @returns This builder.
   */
  withStrategy(strategy: DeliveryStrategy): this {
    this.#strategy = DeliveryValues.requireStrategy(strategy);
    return this;
  }

  /** Sets finite-run observation and cancellation.
   * @param monitor The run monitor.
   * @returns This builder.
   */
  withMonitor(monitor: DeliveryMonitor): this {
    this.#monitor = monitor;
    return this;
  }

  /** Sets the positive accepted-work bound for one page.
   * @param pageSize The positive page size.
   * @returns This builder.
   */
  withPageSize(pageSize: number): this {
    this.#pageSize = DeliveryValues.requireBound(
      "Delivery page size",
      pageSize,
      inboxStorageAccess.maxReadLimit,
    );
    return this;
  }

  /** Sets the positive number of pages admitted by one local run.
   * @param batchSize The positive page count.
   * @returns This builder.
   */
  withBatchSize(batchSize: number): this {
    this.#batchSize = DeliveryValues.requireBound("Delivery batch size", batchSize, maxBatchSize);
    return this;
  }

  /** Sets the node identity used for shard pickup.
   * @param node The non-empty node identity.
   * @returns This builder.
   */
  withNode(node: string): this {
    if (typeof node !== "string" || node.length === 0) {
      throw new Error("Delivery node must be a non-empty string.");
    }
    this.#node = node;
    return this;
  }

  /**
   * Creates one immutable delivery from the current builder configuration.
   *
   * @returns The configured delivery.
   */
  build(): Delivery {
    const context = this.#context ?? defaultContext;
    const strategy = DeliveryValues.snapshotStrategy(
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
      this.#workRegistry instanceof ShardedWorkRegistry &&
      !shardedWorkRegistryAccess.matches(this.#workRegistry, context, storageFactory)
    ) {
      throw new Error("Delivery work registry must use the delivery storage context and factory.");
    }
    const workRegistry = this.#workRegistry ?? new ShardedWorkRegistry({ context, storageFactory });
    const inboxSessionKind = this.#inbox?.sessionKind ?? "LEASED";
    if (inboxSessionKind !== workRegistry.sessionKind)
      throw new Error("Delivery inbox and work registry session kinds must match.");
    const core = new CoreDelivery({
      context,
      storageFactory,
      workRegistry,
      ...(this.#inbox === undefined ? {} : { inbox: this.#inbox }),
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
  readonly inbox: DeliveryInbox;
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
    controlledDeliveryRunners.set(this, (options) => core.runControlled(options));
    Object.freeze(this);
  }

  run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    return this.#core.run(options);
  }
}

/** Groups immutable delivery configuration operations. */
const DeliveryValues = Object.freeze({
  requireStrategy(strategy: DeliveryStrategy): DeliveryStrategy {
    if (!Number.isSafeInteger(strategy.shardCount) || strategy.shardCount <= 0) {
      throw new Error("Delivery strategy shard count must be a positive safe integer.");
    }
    return strategy;
  },
  snapshotStrategy(strategy: DeliveryStrategy): DeliveryStrategy {
    const shardCount = this.requireStrategy(strategy).shardCount;
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
  },
  hash(value: string): number {
    let result = 0;
    for (const character of value) {
      result = (result * 31 + character.charCodeAt(0)) >>> 0;
    }
    return result;
  },
  requireBound(name: string, value: number, max: number): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer.`);
    }
    if (value > max) {
      throw new Error(`${name} must be at most ${String(max)}.`);
    }
    return value;
  },
  snapshotContext(context: StorageContext): StorageContext {
    if (typeof context.name !== "string" || context.name.length === 0) {
      throw new Error("Delivery storage context name must be a non-empty string.");
    }
    return Object.freeze({ ...context });
  },
});
