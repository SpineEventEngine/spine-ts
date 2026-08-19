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
import { AnySchema } from "@bufbuild/protobuf/wkt";
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
import { Inbox, InboxTargets, type InboxMessage } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";
import { withDeliveryCommitFence } from "../repository/commit-fence.js";
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
 * Reports one direct drain and whether it durably acknowledged the selected message.
 *
 * @internal
 */
export interface DeliveryDirectRun {
  // prettier-ignore

  /**
   * Contains the terminal shard-drain outcome.
   */
  readonly run: DeliveryRun;

  /**
   * Indicates whether this drain durably marked the selected message delivered.
   */
  readonly acknowledged: boolean;
}

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
    if (
      options.worker !== undefined &&
      options.node !== undefined &&
      options.worker.nodeId?.value !== options.node
    ) {
      throw new Error("Delivery worker node must match the configured delivery node.");
    }
    this.context = Object.freeze({ ...options.context });
    this.storageFactory = options.storageFactory;
    this.strategy = options.strategy ?? { shardCount: 1, shardFor: () => ShardIndex.single() };
    this.worker =
      options.worker === undefined
        ? workerId(options.node ?? "local")
        : snapshotWorker(options.worker);
    this.node = this.worker.nodeId?.value ?? "local";
    this.pageSize = options.pageSize ?? 100;
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
      ...(options.acceptMessage === undefined ? {} : { acceptMessage: options.acceptMessage }),
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
    input:
      | OnDeliveryMessage
      | {
          readonly node?: string;
          readonly onMessage: OnDeliveryMessage;

          /**
           * Observes a durable delivered transition.
           *
           * @param message Contains the acknowledged Inbox message.
           * @internal
           */
          readonly onDelivered?: (message: InboxMessage) => void;

          /**
           * Selects messages owned by this direct callback.
           *
           * @param message Contains a pending Inbox message.
           * @returns `true` when the callback owns the message.
           * @internal
           */
          readonly acceptMessage?: (message: InboxMessage) => boolean;
        },
  ): Promise<DeliveryDirectRun> {
    const onMessage = typeof input === "function" ? input : input.onMessage;
    const observeDelivered = typeof input === "function" ? undefined : input.onDelivered;
    let acknowledged = false;
    const run = await this.drain(message.shard, {
      onMessage,
      ...(typeof input === "function" || input.acceptMessage === undefined
        ? {}
        : { acceptMessage: input.acceptMessage }),
      onDelivered: (next) => {
        acknowledged ||=
          next.id.value === message.id.value && next.id.shard.key() === message.id.shard.key();
        observeDelivered?.(next);
      },
    });
    return Object.freeze({ run, acknowledged });
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
    if (options.operation?.signal?.aborted) {
      const released = await safelyValue(() => this.shards.release(session), false);
      return result(released ? "STOPPED" : "FAILED");
    }
    const statistics = counts();
    const failures: DeliveryFailure[] = [];
    const complete = (
      status: DeliveryRun["status"],
      value = statistics,
      runFailures: readonly DeliveryFailure[] = failures,
    ): DeliveryRun => result(status, value, runFailures);
    let current = session;
    const ownership = { lost: false };
    const validate = async (): Promise<boolean> => {
      const validated = await safelyValue(
        () => this.shards.validateOwnership(current, options.operation),
        undefined,
      );
      if (validated === undefined) {
        ownership.lost = true;
        return false;
      }
      current = validated;
      return true;
    };
    const cleanupPage = async (): Promise<boolean> => {
      if (this.inbox.removeDelivered === undefined) return true;
      if (!(await validate())) return false;
      let after: import("./inbox.js").InboxReadContinuation | undefined;
      for (let page = 0; page < 2; page += 1) {
        let removedAny = false;
        const delivered = await this.inbox.read(shard, {
          statuses: ["DELIVERED"],
          limit: this.pageSize,
          ...(after === undefined ? {} : { after }),
          ...(options.operation ?? {}),
        });
        for (const message of delivered) {
          if (options.operation?.signal?.aborted || !(await validate())) return false;
          const removed = await this.inbox.removeDelivered(message, current, options.operation);
          if (options.operation?.signal?.aborted || (!removed && !(await validate()))) return false;
          removedAny ||= removed;
        }
        const last = delivered.at(-1);
        if (removedAny || last === undefined || delivered.length < this.pageSize) break;
        after = {
          messageId: last.id.value,
          whenReceived: last.whenReceived,
          version: last.version,
        };
      }
      return true;
    };
    const dispatch = (message: InboxMessage): Promise<void> =>
      withDeliveryCommitFence(
        async () => {
          if (!(await validate())) throw new Error("Shard ownership was lost.");
        },
        () => Promise.resolve(options.onMessage(message)),
      );
    const markDelivered = async (message: InboxMessage): Promise<void> => {
      if ((await this.inbox.markDelivered(message, options.operation)) === undefined)
        throw new Error("Inbox message was not marked delivered.");
      statistics.delivered += 1;
      options.onDelivered?.(message);
    };
    try {
      if (!(await safelyBoolean(() => this.#monitor.shouldContinueAfter("DELIVERY"))))
        return complete("STOPPED");
      if (!(await safely(() => this.#monitor.onDeliveryStarted(shard)))) return complete("STOPPED");
      const blockedTargets = new Set<string>();
      let after: import("./inbox.js").InboxReadContinuation | undefined;
      for (;;) {
        const messages = await this.inbox.read(shard, {
          statuses: ["TO_DELIVER"],
          limit: this.pageSize,
          ...(after === undefined ? {} : { after }),
          ...(options.operation ?? {}),
        });
        if (messages.length === 0) {
          if (!(await cleanupPage())) return complete("STOPPED");
          break;
        }
        const deliveredBefore = statistics.delivered;
        for (const message of messages) {
          if (options.operation?.signal?.aborted) return complete("STOPPED");
          if (!isEndpointMessage(message)) continue;
          if (options.acceptMessage !== undefined && !options.acceptMessage(message)) continue;
          const target = `${message.inboxId.targetTypeUrl}:${InboxTargets.key(message.inboxId.targetId)}`;
          if (blockedTargets.has(target)) continue;
          statistics.processed += 1;
          if (!(await safelyBoolean(() => this.#monitor.shouldContinueAfter("PAGE"))))
            return complete("STOPPED");
          if (!(await validate())) return complete("STOPPED");
          try {
            statistics.accepted += 1;
            await dispatch(message);
            if (options.operation?.signal?.aborted) return complete("STOPPED");
            if (!(await validate())) return complete("STOPPED");
            await markDelivered(message);
          } catch (error) {
            statistics.failed += 1;
            failures.push(Object.freeze({ message: snapshot(message), error }));
            const reception = new FailedReception(
              message,
              error,
              async () => {
                if (!(await validate())) throw new Error("Shard ownership was lost.");
                await markDelivered(message);
              },
              async () => {
                await dispatch(message);
                if (!(await validate())) throw new Error("Shard ownership was lost.");
                await markDelivered(message);
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
            if (ownership.lost) return complete("STOPPED");
          }
        }
        if (!(await cleanupPage())) return complete("STOPPED");
        const last = messages.at(-1);
        if (statistics.delivered !== deliveredBefore) {
          after = undefined;
          continue;
        }
        if (last === undefined || messages.length < this.pageSize) break;
        after = {
          messageId: last.id.value,
          whenReceived: last.whenReceived,
          version: last.version,
        };
        // Reached a full page without progress: continue past it once. A later
        // independent target may still be actionable; exhaustion ends the run.
      }
      return complete("DRAINED");
    } finally {
      const released = await safelyValue(
        () => this.shards.release(current, options.operation),
        false,
      );
      if (!released) {
        // The release result changes the terminal delivery outcome: a shard is
        // not complete until ownership is confirmed released.
        // eslint-disable-next-line no-unsafe-finally
        return complete("FAILED");
      }
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
   * Observes a durable delivered transition.
   *
   * @param message Contains the acknowledged Inbox message.
   * @internal
   */
  readonly onDelivered?: (message: InboxMessage) => void;

  /**
   * Determines whether this drain callback owns a message.
   *
   * @param message Contains a pending Inbox message.
   * @returns `true` when the callback owns the message.
   * @internal
   */
  readonly acceptMessage?: (message: InboxMessage) => boolean;

  /**
   * Propagates cancellation through the drain.
   */
  readonly operation?: import("./delivery-ports.js").DeliveryOperationOptions;
}
function workerId(node: string): WorkerId {
  return create(WorkerIdSchema, { nodeId: { value: node }, value: randomUUID() });
}
function snapshotWorker(worker: WorkerId): WorkerId {
  return Object.freeze({
    nodeId: Object.freeze({ value: worker.nodeId?.value ?? "" }),
    value: worker.value,
  }) as WorkerId;
}
function counts() {
  return { processed: 0, accepted: 0, delivered: 0, failed: 0 };
}
function result(
  status: DeliveryRun["status"],
  value = counts(),
  failures: readonly DeliveryFailure[] = [],
): DeliveryRun {
  const run = Object.freeze({ status, ...value, failures: Object.freeze([...failures]) });
  return run;
}
function snapshot(message: InboxMessage): InboxMessage {
  return Object.freeze({
    ...message,
    id: Object.freeze({
      ...message.id,
      shard: new ShardIndex(message.id.shard.index, message.id.shard.ofTotal),
    }),
    inboxId: Object.freeze({ ...message.inboxId }),
    ...(message.signal === undefined ? {} : { signal: clone(AnySchema, message.signal) }),
    shard: new ShardIndex(message.shard.index, message.shard.ofTotal),
    whenReceived: new Date(message.whenReceived),
    ...(message.keepUntil === undefined ? {} : { keepUntil: new Date(message.keepUntil) }),
  });
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
