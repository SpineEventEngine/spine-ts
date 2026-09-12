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
import { TenantIdSchema } from "@spine-event-engine/proto";
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
import type { DeliveryInbox, DeliveryWorkRegistry, DeliveryWorkSession } from "./delivery-ports.js";
import { Inbox, InboxTargets, type InboxMessage } from "./inbox.js";
import { InboxStorage } from "./inbox-storage.js";
import { ShardIndex } from "./shard-index.js";
import { ShardedWorkRegistry } from "./sharded-work-registry.js";
import { withDeliveryCommitFence } from "../repository/commit-fence.js";
import type { DeliveryResult, DeliveryRunOptions, DeliveryStrategy } from "./delivery-builder.js";

const deliveryFailureLimit = 100;

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

interface DirectDrainInput {
  readonly onMessage: OnDeliveryMessage;
  readonly onDelivered?: (message: InboxMessage) => void;
  readonly onDuplicateRemoved?: (message: InboxMessage) => void;
  readonly acceptMessage?: (message: InboxMessage) => boolean;
}

type DirectDrainRequest =
  | OnDeliveryMessage
  | {
      readonly node?: string;
      readonly onMessage: OnDeliveryMessage;
      readonly onDelivered?: (message: InboxMessage) => void;
      readonly onDuplicateRemoved?: (message: InboxMessage) => void;
      readonly acceptMessage?: (message: InboxMessage) => boolean;
    };

/**
 * Reports one direct drain and whether it durably resolved the selected message.
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
   * Indicates whether this drain marked the selected message delivered or
   * removed it as a duplicate.
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
    this.context = Delivery.#contextSnapshot(options.context);
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
  async drainMessage(message: InboxMessage, input: DirectDrainRequest): Promise<DeliveryDirectRun> {
    return this.#drainDirect(message, this.#directInput(input));
  }

  #directInput(input: Parameters<Delivery["drainMessage"]>[1]): DirectDrainInput {
    return typeof input === "function" ? { onMessage: input } : input;
  }

  static #contextSnapshot(context: StorageContext): StorageContext {
    return Object.freeze(
      context.multitenant
        ? {
            name: context.name,
            multitenant: true,
            tenantId: clone(TenantIdSchema, context.tenantId),
          }
        : { name: context.name, multitenant: false },
    );
  }

  async #drainDirect(message: InboxMessage, input: DirectDrainInput): Promise<DeliveryDirectRun> {
    let acknowledged = false;
    const run = await this.drain(message.shard, {
      onMessage: input.onMessage,
      ...(input.acceptMessage === undefined ? {} : { acceptMessage: input.acceptMessage }),
      onDelivered: (next) => {
        acknowledged ||=
          next.id.value === message.id.value && next.id.shard.key() === message.id.shard.key();
        input.onDelivered?.(next);
      },
      onDuplicateRemoved: (next) => {
        acknowledged ||=
          next.id.value === message.id.value && next.id.shard.key() === message.id.shard.key();
        input.onDuplicateRemoved?.(next);
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
    return new DeliveryDrain({
      inbox: this.inbox,
      monitor: this.#monitor,
      options,
      pageSize: this.pageSize,
      session,
      shards: this.shards,
      shard,
    }).run();
  }
}

class DeliveryDrain {
  readonly #statistics = counts();
  readonly #failures: DeliveryFailure[] = [];
  readonly #deduplication: DeliveryDeduplication;
  readonly #blockedTargets = new Set<string>();
  #current: DeliveryWorkSession;
  #ownershipLost = false;
  #failureLimitReached = false;

  constructor(private readonly input: DeliveryDrainInputState) {
    this.#current = input.session;
    this.#deduplication = new DeliveryDeduplication(input.inbox);
  }

  async run(): Promise<DeliveryRun> {
    let run: DeliveryRun;
    try {
      run = (await this.#canStart()) ? await this.#readPages() : this.#complete("STOPPED");
    } catch (error) {
      if (!(await this.#release())) return this.#complete("FAILED");
      throw error;
    }
    return (await this.#release()) ? run : this.#complete("FAILED");
  }

  async #release(): Promise<boolean> {
    const released = await safelyValue(
      () => this.input.shards.release(this.#current, this.input.options.operation),
      false,
    );
    if (released) await safely(() => this.#completeMonitoring());
    return released;
  }

  async #canStart(): Promise<boolean> {
    if (!(await safelyBoolean(() => this.input.monitor.shouldContinueAfter("DELIVERY"))))
      return false;
    return safely(() => this.input.monitor.onDeliveryStarted(this.input.shard));
  }

  async #readPages(): Promise<DeliveryRun> {
    let after: import("./inbox.js").InboxReadContinuation | undefined;
    for (;;) {
      const messages = await this.#readPage(after);
      if (messages.length === 0) return this.#complete("DRAINED");
      const deliveredBefore = this.#statistics.delivered;
      if (!(await this.#processPage(messages))) return this.#complete("STOPPED");
      if (!(await this.#cleanupPage(messages))) return this.#complete("STOPPED");
      const next = this.#nextPage(messages, deliveredBefore);
      if (next.complete) return this.#complete("DRAINED");
      after = next.after;
    }
  }

  #readPage(after: import("./inbox.js").InboxReadContinuation | undefined) {
    return this.input.inbox.read(this.input.shard, {
      limit: this.input.pageSize,
      ...(after === undefined ? {} : { after }),
      ...(this.input.options.operation ?? {}),
    });
  }

  async #processPage(messages: readonly InboxMessage[]): Promise<boolean> {
    const page = this.#deduplication.page(messages);
    for (const message of messages) {
      if (!(await this.#processMessage(message, page))) return false;
      if (this.#failureLimitReached) return false;
    }
    return true;
  }

  async #processMessage(message: InboxMessage, page: ReturnType<DeliveryDeduplication["page"]>) {
    if (this.input.options.operation?.signal?.aborted) return false;
    if (this.#shouldSkip(message)) return true;
    const target = this.#targetKey(message);
    if (this.#blockedTargets.has(target)) return true;
    this.#statistics.processed += 1;
    if (!(await this.#mayProcess())) return false;
    if (page.isDuplicate(message)) return this.#removeDuplicate(message, target);
    return this.#deliver(message, target);
  }

  #shouldSkip(message: InboxMessage): boolean {
    return (
      message.status !== "TO_DELIVER" ||
      !isEndpointMessage(message) ||
      (this.input.options.acceptMessage !== undefined && !this.input.options.acceptMessage(message))
    );
  }

  #targetKey(message: InboxMessage): string {
    return `${message.inboxId.targetTypeUrl}:${InboxTargets.key(message.inboxId.targetId)}`;
  }

  async #mayProcess(): Promise<boolean> {
    return (
      (await safelyBoolean(() => this.input.monitor.shouldContinueAfter("PAGE"))) &&
      (await this.#validate())
    );
  }

  async #removeDuplicate(message: InboxMessage, target: string): Promise<boolean> {
    try {
      if (
        !(await this.input.inbox.removeDuplicate(
          message,
          this.#current,
          this.input.options.operation,
        ))
      )
        throw new Error("Inbox duplicate was not removed.");
      this.input.options.onDuplicateRemoved?.(message);
    } catch (error) {
      this.#recordFailure(message, error);
      this.#blockedTargets.add(target);
    }
    return true;
  }

  async #deliver(message: InboxMessage, target: string): Promise<boolean> {
    try {
      this.#statistics.accepted += 1;
      await this.#dispatch(message);
      if (this.input.options.operation?.signal?.aborted || !(await this.#validate())) return false;
      await this.#markDelivered(message);
    } catch (error) {
      await this.#handleReceptionFailure(message, target, error);
      if (this.#ownershipLost) return false;
    }
    return true;
  }

  async #handleReceptionFailure(
    message: InboxMessage,
    target: string,
    error: unknown,
  ): Promise<void> {
    this.#recordFailure(message, error);
    const reception = new FailedReception(
      message,
      error,
      () => this.#acknowledge(message),
      () => this.#repeat(message),
    );
    const action = await safelyValue(
      () => this.input.monitor.onReceptionFailure(reception),
      reception.markDelivered(),
    );
    if (
      !(await safely(() => action.execute())) &&
      !(await safely(() => reception.markDelivered().execute()))
    )
      this.#blockedTargets.add(target);
  }

  async #acknowledge(message: InboxMessage): Promise<void> {
    if (!(await this.#validate())) throw new Error("Shard ownership was lost.");
    await this.#markDelivered(message);
  }

  async #repeat(message: InboxMessage): Promise<void> {
    await this.#dispatch(message);
    await this.#acknowledge(message);
  }

  async #dispatch(message: InboxMessage): Promise<void> {
    await withDeliveryCommitFence(
      async () => {
        if (!(await this.#validate())) throw new Error("Shard ownership was lost.");
      },
      () => Promise.resolve(this.input.options.onMessage(message)),
    );
  }

  async #markDelivered(message: InboxMessage): Promise<void> {
    if ((await this.input.inbox.markDelivered(message, this.input.options.operation)) === undefined)
      throw new Error("Inbox message was not marked delivered.");
    this.#deduplication.recordDelivered(message);
    this.#statistics.delivered += 1;
    this.input.options.onDelivered?.(message);
  }

  async #cleanupPage(messages: readonly InboxMessage[]): Promise<boolean> {
    if (this.input.inbox.removeDelivered === undefined) return true;
    if (!(await this.#validate())) return false;
    for (const message of messages) {
      if (message.status === "DELIVERED" && !(await this.#removeDelivered(message))) return false;
    }
    return true;
  }

  async #removeDelivered(message: InboxMessage): Promise<boolean> {
    if (this.input.inbox.removeDelivered === undefined) return true;
    if (this.input.options.operation?.signal?.aborted || !(await this.#validate())) return false;
    const removed = await this.input.inbox.removeDelivered(
      message,
      this.#current,
      this.input.options.operation,
    );
    return !this.input.options.operation?.signal?.aborted && (removed || (await this.#validate()));
  }

  #nextPage(messages: readonly InboxMessage[], deliveredBefore: number) {
    if (this.#statistics.delivered !== deliveredBefore) return { complete: false };
    const last = messages.at(-1);
    if (last === undefined || messages.length < this.input.pageSize) return { complete: true };
    return {
      complete: false,
      after: { messageId: last.id.value, whenReceived: last.whenReceived, version: last.version },
    };
  }

  async #validate(): Promise<boolean> {
    const current = await safelyValue(
      () => this.input.shards.validateOwnership(this.#current, this.input.options.operation),
      undefined,
    );
    if (current === undefined) this.#ownershipLost = true;
    else this.#current = current;
    return current !== undefined;
  }

  #recordFailure(message: InboxMessage, error: unknown): void {
    this.#statistics.failed += 1;
    if (this.#failures.length < deliveryFailureLimit)
      this.#failures.push(Object.freeze({ message: snapshot(message), error }));
    this.#failureLimitReached = this.#failures.length === deliveryFailureLimit;
  }

  #complete(status: DeliveryRun["status"]): DeliveryRun {
    return result(status, this.#statistics, this.#failures);
  }

  #completeMonitoring(): Promise<void> {
    return Promise.resolve(
      this.input.monitor.onDeliveryCompleted(
        Object.freeze({
          processed: this.#statistics.processed,
          delivered: this.#statistics.delivered,
          failed: this.#statistics.failed,
        } satisfies DeliveryStatistics),
      ),
    );
  }
}

interface DeliveryDrainInputState {
  readonly inbox: DeliveryInbox;
  readonly monitor: DeliveryMonitor;
  readonly options: DeliveryDrainOptions;
  readonly pageSize: number;
  readonly session: DeliveryWorkSession;
  readonly shard: ShardIndex;
  readonly shards: DeliveryWorkRegistry;
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
   * Observes successful removal of a duplicate Inbox message.
   *
   * @param message Contains the removed duplicate.
   * @internal
   */
  readonly onDuplicateRemoved?: (message: InboxMessage) => void;

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

class DeliveryDeduplication {
  readonly #recent: RecentDeliveries;

  constructor(inbox: DeliveryInbox) {
    const current = recentDeliveries.get(inbox);
    this.#recent = current ?? new RecentDeliveries();
    if (current === undefined) recentDeliveries.set(inbox, this.#recent);
  }

  page(messages: readonly InboxMessage[]): DeliveryPageDeduplication {
    return new DeliveryPageDeduplication(messages, this.#recent);
  }

  recordDelivered(message: InboxMessage): void {
    this.#recent.add(message);
  }
}

class DeliveryPageDeduplication {
  readonly #identities: Set<string>;

  constructor(
    messages: readonly InboxMessage[],
    private readonly recent: RecentDeliveries,
  ) {
    this.#identities = new Set(
      messages
        .filter(
          (message) =>
            message.status === "DELIVERED" &&
            message.keepUntil !== undefined &&
            message.keepUntil.getTime() > Date.now(),
        )
        .map((message) => RecentDeliveries.key(message)),
    );
  }

  isDuplicate(message: InboxMessage): boolean {
    const identity = RecentDeliveries.key(message);
    if (this.#identities.has(identity) || this.recent.has(identity)) return true;
    this.#identities.add(identity);
    return false;
  }
}

class RecentDeliveries {
  readonly #identities = new Map<string, undefined>();

  has(identity: string): boolean {
    return this.#identities.has(identity);
  }

  add(message: InboxMessage): void {
    const identity = RecentDeliveries.key(message);
    this.#identities.delete(identity);
    this.#identities.set(identity, undefined);
    if (this.#identities.size > 1_000) {
      const oldest = this.#identities.keys().next().value;
      if (oldest !== undefined) this.#identities.delete(oldest);
    }
  }

  static key(message: InboxMessage): string {
    return JSON.stringify([
      message.signalId,
      message.inboxId.targetTypeUrl,
      InboxTargets.key(message.inboxId.targetId),
    ]);
  }
}

const recentDeliveries = new WeakMap<DeliveryInbox, RecentDeliveries>();
