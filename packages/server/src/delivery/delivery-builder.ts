import type { Any } from "@bufbuild/protobuf/wkt";
import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";
import type { WorkerId } from "@spine-event-engine/proto/delivery";

import { ServerEnvironment } from "../server/server-environment.js";
import { Delivery as CoreDelivery, type OnDeliveryMessage } from "./delivery.js";
import { DeliveryMonitor } from "./delivery-monitor.js";
import { InboxTargets } from "./inbox.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "./delivery-ports.js";
import type { DeliveryControlledRun } from "./delivery-run-control.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry, shardedWorkRegistryAccess } from "./sharded-work-registry.js";

const defaultContext: StorageContext = Object.freeze({
  name: "__System_Delivery__",
  multitenant: false,
});
const defaultPageSize = 100;
const controlledDeliveryRunners = new WeakMap<
  Delivery,
  (options: DeliveryControlledRun) => Promise<DeliveryResult>
>();

/**
 * Provides package-local controls for builder-created deliveries.
 */
export interface DeliveryControls {
  // prettier-ignore

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

/**
 * Exposes package-local controls for builder-created deliveries.
 */
export const deliveryControls: DeliveryControls = Object.freeze({
  // prettier-ignore

  /**
   * Finds controlled execution for a builder-created delivery.
   */
  runner(
    delivery: Delivery,
  ): ((options: DeliveryControlledRun) => Promise<DeliveryResult>) | undefined {
    return controlledDeliveryRunners.get(delivery);
  },
});

/**
 * Assigns inbox targets to durable delivery shards.
 */
export interface DeliveryStrategy {
  // prettier-ignore

  /**
   * Positive number of shards addressable by this strategy.
   */
  readonly shardCount: number;

  /**
   * Returns the shard for one target identity and type.
   *
   * @param targetId The target identity.
   * @param targetType The target type URL.
   * @returns The durable shard for the target.
   */
  shardFor(targetId: Any, targetType: string): ShardIndex;
}

/**
 * Places every target in one local shard.
 */
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

  /**
   * Number of uniformly distributed shards.
   */
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
  shardFor(targetId: Any, targetType: string): ShardIndex {
    if (typeof targetId.typeUrl !== "string" || targetId.typeUrl.length === 0) {
      throw new Error("Delivery target ID must be a non-default Any.");
    }
    if (typeof targetType !== "string" || targetType.length === 0) {
      throw new Error("Delivery target type must be a non-empty string.");
    }
    return new ShardIndex(
      DeliveryValues.hash(`${targetType}:${InboxTargets.shardKey(targetId)}`) % this.shardCount,
      this.shardCount,
    );
  }
}

export { DeliveryMonitor, type DeliveryStatistics } from "./delivery-monitor.js";

/**
 * Immutable outcome of one finite local delivery run.
 */
export interface DeliveryResult {
  // prettier-ignore

  /**
   * Terminal reason for this local run.
   */
  readonly status: "COMPLETED" | "SKIPPED" | "STOPPED" | "FAILED";
}

/**
 * Options for one finite local delivery run.
 */
export interface DeliveryRunOptions {
  // prettier-ignore

  /**
   * Framework endpoint invoked for each available inbox row.
   */
  readonly onMessage: OnDeliveryMessage;

  /**
   * Shard to process; defaults to the strategy's only shard when applicable.
   * An explicit shard's `ofTotal` must equal the strategy's resolved `shardCount`.
   */
  readonly shard?: ShardIndex;
}

/**
 * Builder-owned public delivery view.
 */
export interface Delivery {
  // prettier-ignore

  /**
   * Immutable storage namespace selected for this delivery.
   */
  readonly context: StorageContext;

  /**
   * Storage factory selected for durable delivery records.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Target-to-shard strategy selected for inbox writes and runs.
   */
  readonly strategy: DeliveryStrategy;

  /**
   * Node identity used for exclusive shard pickup.
   */
  readonly node: string;

  /**
   * Identifies the complete opaque worker used for shard ownership.
   */
  readonly worker: WorkerId;

  /**
   * Maximum accepted work per internal delivery page, from 1 through 1000.
   */
  readonly pageSize: number;

  /**
   * Durable inbox facade.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Executes one finite local shard delivery.
   *
   * @param options The shard and endpoint callback.
   * @returns The terminal finite-run result.
   */
  run(options: DeliveryRunOptions): Promise<DeliveryResult>;
}

/**
 * Configures and snapshots one public {@link Delivery}.
 */
export class DeliveryBuilder {
  #context: StorageContext | undefined;
  #storageFactory: StorageFactory | undefined;
  #workRegistry: DeliveryWorkRegistry | undefined;
  #inbox: DeliveryInbox | undefined;
  #strategy: DeliveryStrategy | undefined;
  #monitor: DeliveryMonitor | undefined;
  #pageSize: number | undefined;
  #node: string | undefined;
  #worker: WorkerId | undefined;

  /**
   * Sets the storage namespace for Inbox and shard records.
   *
   * @param context The delivery storage namespace.
   * @returns This builder.
   */
  withContext(context: StorageContext): this {
    this.#context = DeliveryValues.snapshotContext(context);
    return this;
  }

  /**
   * Sets the storage factory.
   *
   * @param storageFactory The durable storage factory.
   * @returns This builder.
   */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /**
   * Sets the registry used for exclusive shard pickup.
   *
   * @param workRegistry The shard work registry.
   * @returns This builder.
   */
  withWorkRegistry(workRegistry: DeliveryWorkRegistry): this {
    this.#workRegistry = workRegistry;
    return this;
  }

  /**
   * Sets an inbox port instead of the local durable inbox default.
   *
   * @param inbox The inbox port.
   * @returns This builder.
   */
  withInbox(inbox: DeliveryInbox): this {
    this.#inbox = inbox;
    return this;
  }

  /**
   * Sets the target-to-shard strategy.
   *
   * @param strategy The target strategy.
   * @returns This builder.
   */
  withStrategy(strategy: DeliveryStrategy): this {
    this.#strategy = DeliveryValues.requireStrategy(strategy);
    return this;
  }

  /**
   * Sets finite-run observation and cancellation.
   *
   * @param monitor The run monitor.
   * @returns This builder.
   */
  withMonitor(monitor: DeliveryMonitor): this {
    this.#monitor = monitor;
    return this;
  }

  /**
   * Sets the positive accepted-work bound for one page.
   *
   * @param pageSize The positive page size.
   * @returns This builder.
   */
  withPageSize(pageSize: number): this {
    this.#pageSize = DeliveryValues.requireBound("Delivery page size", pageSize, 1_000);
    return this;
  }

  /**
   * Sets the node identity used for shard pickup.
   *
   * @param node The non-empty node identity.
   * @returns This builder.
   */
  withNode(node: string): this {
    if (typeof node !== "string" || node.length === 0) {
      throw new Error("Delivery node must be a non-empty string.");
    }
    if (this.#worker?.nodeId?.value !== undefined && this.#worker.nodeId.value !== node) {
      throw new Error("Delivery node must match the configured worker node.");
    }
    this.#node = node;
    return this;
  }

  /**
   * Sets the complete opaque worker identity used for shard ownership.
   *
   * @param worker The generated worker identity for this delivery lifetime.
   * @returns This builder.
   */
  withWorker(worker: WorkerId): this {
    if (
      worker.nodeId === undefined ||
      worker.nodeId.value.trim() === "" ||
      worker.value.trim() === ""
    ) {
      throw new Error("Delivery worker must contain non-blank node and value.");
    }
    if (this.#node !== undefined && this.#node !== worker.nodeId.value) {
      throw new Error("Delivery worker node must match the configured delivery node.");
    }
    this.#worker = DeliveryValues.snapshotWorker(worker);
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
      node ??= this.#worker?.nodeId?.value ?? environment.nodeId;
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
      node,
      ...(this.#worker === undefined ? {} : { worker: this.#worker }),
    });
    return new BuiltDelivery(core);
  }
}

class BuiltDelivery implements Delivery {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly strategy: DeliveryStrategy;
  readonly node: string;
  readonly worker: WorkerId;
  readonly pageSize: number;
  readonly inbox: DeliveryInbox;
  readonly #core: CoreDelivery;

  constructor(core: CoreDelivery) {
    this.#core = core;
    this.context = core.context;
    this.storageFactory = core.storageFactory;
    this.strategy = core.strategy;
    this.node = core.node;
    this.worker = core.worker;
    this.pageSize = core.pageSize;
    this.inbox = core.inbox;
    controlledDeliveryRunners.set(this, (options) => core.runControlled(options));
    Object.freeze(this);
  }

  run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    return this.#core.run(options);
  }
}

/**
 * Groups immutable delivery configuration operations.
 */
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
      shardFor(targetId: Any, targetType: string): ShardIndex {
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
  snapshotWorker(worker: WorkerId): WorkerId {
    const nodeId = worker.nodeId;
    if (nodeId === undefined) throw new Error("Delivery worker must include a node identifier.");
    return Object.freeze({
      nodeId: Object.freeze({ value: nodeId.value }),
      value: worker.value,
    }) as WorkerId;
  },
});
