import { create } from "@bufbuild/protobuf";
import { randomUUID } from "node:crypto";
import { WorkerIdSchema, type WorkerId } from "@spine-event-engine/proto/delivery";
import type { StorageContext, StorageFactory } from "@spine-event-engine/storage";

import type { DeliveryControlledRun } from "./delivery-run-control.js";
import {
  AlreadyPickedUp,
  DeliveryMonitor,
  FailedPickUp,
  FailedReception,
  type DeliveryStatistics,
} from "./delivery-monitor.js";
import type { DeliveryInbox, DeliveryWorkRegistry } from "./delivery-ports.js";
import { Inbox, type InboxMessage } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";
import type { DeliveryResult, DeliveryRunOptions, DeliveryStrategy } from "./delivery-builder.js";

/**
 * Describes an endpoint snapshot supplied for direct Inbox delivery.
 */
export type DeliveryEndpointMessage = InboxMessage;

/**
 * Dispatches one persisted Inbox message to an endpoint.
 *
 * @param message The message to dispatch.
 * @returns A promise that settles when endpoint dispatch completes.
 */
export type OnDeliveryMessage = (message: DeliveryEndpointMessage) => void | Promise<void>;

/**
 * Summarizes one finite direct delivery run.
 */
export interface DeliveryRun {
  // prettier-ignore

  /**
   * Identifies the terminal delivery outcome.
   */
  readonly status: "DRAINED" | "SKIPPED" | "FAILED" | "STOPPED";

  /**
   * Counts messages considered for dispatch.
   */
  readonly processed: number;

  /**
   * Counts messages admitted to the endpoint.
   */
  readonly accepted: number;

  /**
   * Counts messages durably acknowledged as delivered.
   */
  readonly delivered: number;

  /**
   * Counts dispatch or acknowledgement failures.
   */
  readonly failed: number;

  /**
   * Lists ephemeral delivery failures.
   */
  readonly failures: readonly DeliveryFailure[];
}

/**
 * Describes ephemeral delivery failure evidence that is never persisted.
 */
export interface DeliveryFailure {
  // prettier-ignore

  /**
   * Identifies the message associated with the failure.
   */
  readonly message: InboxMessage;

  /**
   * Supplies the observed failure.
   */
  readonly error: unknown;
}

/**
 * Executes direct Inbox delivery for one complete worker identity.
 */
export class Delivery {
  // prettier-ignore

  /**
   * Identifies the immutable storage namespace.
   */
  readonly context: StorageContext;

  /**
   * Supplies durable record storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Maps targets to delivery shards.
   */
  readonly strategy: DeliveryStrategy;

  /**
   * Identifies this worker's opaque durable ownership identity.
   */
  readonly worker: WorkerId;

  /**
   * Names the worker node for compatibility integrations.
   */
  readonly node: string;

  /**
   * Bounds each direct Inbox read.
   */
  readonly pageSize: number;

  /**
   * Retains the configured batch size for integrations.
   */
  readonly batchSize: number;

  /**
   * Reads and acknowledges direct Inbox rows.
   */
  readonly inbox: DeliveryInbox;

  /**
   * Acquires and releases direct shard ownership.
   */
  readonly shards: DeliveryWorkRegistry;
  readonly #monitor: DeliveryMonitor;

  /**
   * Creates direct delivery from immutable options.
   *
   * @param options The delivery configuration.
   */
  constructor(options: DeliveryOptions) {
    this.context = Object.freeze({ ...options.context });
    this.storageFactory = options.storageFactory;
    this.strategy = options.strategy ?? { shardCount: 1, shardFor: () => ShardIndex.single() };
    this.worker = options.worker ?? workerId(options.node ?? "local");
    this.node = this.worker.nodeId?.value ?? "local";
    this.pageSize = options.pageSize ?? 100;
    this.batchSize = options.batchSize ?? 100;
    this.inbox =
      options.inbox ??
      new Inbox(new InboxStorage({ context: this.context, storageFactory: this.storageFactory }));
    this.shards =
      options.workRegistry ??
      new ShardedWorkRegistry({ context: this.context, storageFactory: this.storageFactory });
    this.#monitor = options.monitor ?? new DeliveryMonitor();
    Object.freeze(this);
  }

  /**
   * Executes one finite shard delivery.
   *
   * @param options The selected shard and endpoint callback.
   * @returns The terminal public delivery result.
   */
  async run(options: DeliveryRunOptions): Promise<DeliveryResult> {
    const shard = options.shard ?? ShardIndex.single();
    const run = await this.drain(shard, { onMessage: options.onMessage });
    return Object.freeze({
      status:
        run.status === "SKIPPED"
          ? "SKIPPED"
          : run.status === "FAILED"
            ? "FAILED"
            : run.status === "STOPPED"
              ? "STOPPED"
              : "COMPLETED",
      pages: Object.freeze([]),
    });
  }

  /**
   * Executes one finite shard delivery under an operation signal.
   *
   * @param options The controlled shard, endpoint, and cancellation signal.
   * @returns The terminal public delivery result.
   */
  runControlled(options: DeliveryControlledRun): Promise<DeliveryResult> {
    const shard = options.shard;
    return this.drain(shard, {
      onMessage: options.onMessage,
      operation: { signal: options.signal },
    }).then((run) =>
      Object.freeze({
        status:
          run.status === "SKIPPED"
            ? "SKIPPED"
            : run.status === "FAILED"
              ? "FAILED"
              : run.status === "STOPPED"
                ? "STOPPED"
                : "COMPLETED",
        pages: Object.freeze([]),
      }),
    );
  }

  /**
   * Delivers the selected message's shard for local handoff integration.
   *
   * @param message The message selecting the shard to drain.
   * @param input The endpoint callback or callback configuration.
   * @returns The terminal direct-delivery result.
   */
  async drainMessage(
    message: InboxMessage,
    input: OnDeliveryMessage | { readonly node?: string; readonly onMessage: OnDeliveryMessage },
  ): Promise<DeliveryRun> {
    const onMessage = typeof input === "function" ? input : input.onMessage;
    return this.drain(message.shard, { onMessage });
  }

  /**
   * Executes one owned shard drain while containing monitor and endpoint failures.
   *
   * @param shard The shard to acquire and drain.
   * @param options The endpoint and optional operation signal.
   * @returns The terminal direct-delivery result.
   */
  async drain(shard: ShardIndex, options: DeliveryDrainOptions): Promise<DeliveryRun> {
    if (options.operation?.signal?.aborted) return result("STOPPED");
    let session;
    try {
      session = await this.shards.pickUp(shard, this.worker, options.operation);
    } catch (error) {
      await safely(async () =>
        (await this.#monitor.onShardPickUpFailure(new FailedPickUp(shard, error))).execute(),
      );
      return result("FAILED");
    }
    if (session === undefined) {
      await safely(async () =>
        (await this.#monitor.onShardAlreadyPicked(new AlreadyPickedUp(shard))).execute(),
      );
      return result("SKIPPED");
    }
    const statistics = counts();
    let current = session;
    const renew = async (): Promise<boolean> => {
      if (current.kind !== "LEASED" || this.shards.renew === undefined) return true;
      const renewed = await this.shards.renew(current, options.operation);
      if (renewed === undefined) return false;
      current = renewed;
      return true;
    };
    try {
      if (!(await safelyBoolean(() => this.#monitor.shouldContinueAfter("DELIVERY"))))
        return result("STOPPED", statistics);
      if (!(await safely(() => this.#monitor.onDeliveryStarted(shard))))
        return result("STOPPED", statistics);
      const blockedTargets = new Set<string>();
      for (;;) {
        const messages = await this.inbox.read(shard, {
          statuses: ["TO_DELIVER"],
          limit: this.pageSize,
        });
        if (messages.length === 0) break;
        const deliveredBefore = statistics.delivered;
        for (const message of messages) {
          if (options.operation?.signal?.aborted) return result("STOPPED", statistics);
          if (!isEndpointMessage(message)) continue;
          const target = `${message.inboxId.targetTypeUrl}:${message.inboxId.targetId}`;
          if (blockedTargets.has(target)) continue;
          statistics.processed += 1;
          if (!(await safelyBoolean(() => this.#monitor.shouldContinueAfter("PAGE"))))
            return result("STOPPED", statistics);
          if (!(await renew())) return result("STOPPED", statistics);
          try {
            statistics.accepted += 1;
            await options.onMessage(message);
            if (options.operation?.signal?.aborted) return result("STOPPED", statistics);
            if (!(await renew())) return result("STOPPED", statistics);
            if ((await this.inbox.markDelivered(message, options.operation)) === undefined)
              throw new Error("Inbox message was not marked delivered.");
            statistics.delivered += 1;
          } catch (error) {
            statistics.failed += 1;
            const reception = new FailedReception(
              message,
              error,
              async () => {
                if (!(await renew())) throw new Error("Shard ownership was lost.");
                if ((await this.inbox.markDelivered(message, options.operation)) === undefined)
                  throw new Error("Inbox message was not marked delivered.");
                statistics.delivered += 1;
              },
              async () => {
                await options.onMessage(message);
                if (!(await renew())) throw new Error("Shard ownership was lost.");
                if ((await this.inbox.markDelivered(message, options.operation)) === undefined)
                  throw new Error("Inbox message was not marked delivered.");
                statistics.delivered += 1;
              },
            );
            const action = await safelyValue(
              () => this.#monitor.onReceptionFailure(reception),
              reception.markDelivered(),
            );
            if (
              !(await safely(() => action.execute())) &&
              !(await safely(() => reception.markDelivered().execute()))
            ) {
              blockedTargets.add(target);
            }
          }
        }
        // A retained pending row whose target is blocked cannot become
        // actionable in this ownership epoch. Stop rather than rescan it.
        if (statistics.delivered === deliveredBefore) break;
      }
      return result("DRAINED", statistics);
    } finally {
      await safely(async () => {
        await this.shards.release(current, options.operation);
      });
      await safely(() =>
        this.#monitor.onDeliveryCompleted(
          Object.freeze({
            processed: statistics.processed,
            delivered: statistics.delivered,
            failed: statistics.failed,
          } satisfies DeliveryStatistics),
        ),
      );
    }
  }
}

/**
 * Configures one direct delivery owner.
 */
export interface DeliveryOptions {
  // prettier-ignore

  /**
   * Identifies the storage namespace.
   */
  readonly context: StorageContext;

  /**
   * Supplies durable record storage.
   */
  readonly storageFactory: StorageFactory;

  /**
   * Supplies direct shard ownership when customized.
   */
  readonly workRegistry?: DeliveryWorkRegistry;

  /**
   * Supplies direct Inbox access when customized.
   */
  readonly inbox?: DeliveryInbox;

  /**
   * Maps targets to shards when customized.
   */
  readonly strategy?: DeliveryStrategy;

  /**
   * Supplies delivery lifecycle and failure policy hooks.
   */
  readonly monitor?: DeliveryMonitor;

  /**
   * Supplies a complete opaque worker identity.
   */
  readonly worker?: WorkerId;

  /**
   * Names the node used to derive a default worker identity.
   */
  readonly node?: string;

  /**
   * Bounds each direct Inbox read.
   */
  readonly pageSize?: number;

  /**
   * Retains a batch-size integration setting.
   */
  readonly batchSize?: number;
}

/**
 * Configures one direct shard drain.
 */
export interface DeliveryDrainOptions {
  // prettier-ignore

  /**
   * Dispatches supported Inbox messages.
   */
  readonly onMessage: OnDeliveryMessage;

  /**
   * Propagates cancellation through the drain.
   */
  readonly operation?: import("./delivery-ports.js").DeliveryOperationOptions;
}
function workerId(node: string): WorkerId {
  return create(WorkerIdSchema, { nodeId: { value: node }, value: randomUUID() });
}
function counts() {
  return { processed: 0, accepted: 0, delivered: 0, failed: 0 };
}
function result(status: DeliveryRun["status"], value = counts()): DeliveryRun {
  return Object.freeze({ status, ...value, failures: Object.freeze([]) });
}
async function safely(action: () => void | Promise<void>): Promise<boolean> {
  try {
    await action();
    return true;
  } catch {
    return false;
  }
}
async function safelyBoolean(action: () => boolean | Promise<boolean>): Promise<boolean> {
  try {
    return await action();
  } catch {
    return false;
  }
}
async function safelyValue<T>(action: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await action();
  } catch {
    return fallback;
  }
}
function isEndpointMessage(message: InboxMessage): boolean {
  return (
    message.label === "HANDLE_COMMAND" ||
    message.label === "UPDATE_SUBSCRIBER" ||
    message.label === "REACT_UPON_EVENT"
  );
}
