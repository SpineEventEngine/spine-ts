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

/** Endpoint snapshot supplied for direct Inbox delivery. */
export type DeliveryEndpointMessage = InboxMessage;
/** Endpoint invoked for one persisted Inbox message. */
export type OnDeliveryMessage = (message: DeliveryEndpointMessage) => void | Promise<void>;

/** A finite direct-delivery result retained for package integrations. */
export interface DeliveryRun {
  readonly status: "DRAINED" | "SKIPPED" | "FAILED" | "STOPPED";
  readonly processed: number;
  readonly accepted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly failures: readonly DeliveryFailure[];
}

/** Ephemeral delivery failure evidence; it is never persisted. */
export interface DeliveryFailure {
  readonly message: InboxMessage;
  readonly error: unknown;
}

/** Owns direct Inbox delivery for one worker identity. */
export class Delivery {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly strategy: DeliveryStrategy;
  readonly worker: WorkerId;
  readonly node: string;
  readonly pageSize: number;
  readonly batchSize: number;
  readonly inbox: DeliveryInbox;
  readonly shards: DeliveryWorkRegistry;
  readonly #monitor: DeliveryMonitor;

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

  /** Delivers one exact direct Inbox row for local handoff integration. */
  async drainMessage(
    message: InboxMessage,
    input: OnDeliveryMessage | { readonly node?: string; readonly onMessage: OnDeliveryMessage },
  ): Promise<DeliveryRun> {
    const onMessage = typeof input === "function" ? input : input.onMessage;
    return this.drain(message.shard, { onMessage });
  }

  /** Drains one owned shard and always contains monitor and endpoint failures. */
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
      if (current?.kind !== "LEASED" || this.shards.renew === undefined) return true;
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
        await this.shards.release(current!, options.operation);
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

export interface DeliveryOptions {
  readonly context: StorageContext;
  readonly storageFactory: StorageFactory;
  readonly workRegistry?: DeliveryWorkRegistry;
  readonly inbox?: DeliveryInbox;
  readonly strategy?: DeliveryStrategy;
  readonly monitor?: DeliveryMonitor;
  readonly worker?: WorkerId;
  readonly node?: string;
  readonly pageSize?: number;
  readonly batchSize?: number;
}
export interface DeliveryDrainOptions {
  readonly onMessage: OnDeliveryMessage;
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
