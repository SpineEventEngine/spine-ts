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

import { DeliveryTimers } from "../client/delivery-timers.js";
import { Time } from "@spine-event-engine/core/time";
import { randomUUID } from "node:crypto";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";

import type {
  DeliveryInbox,
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
  DeliveryWorkSession,
  ExclusiveDeliveryWorkSession,
  InboxMessage,
  InboxMessageId,
  InboxReadOptions,
} from "@spine-event-engine/server";
import type { InboxMessageInput } from "@spine-event-engine/server/spi/delivery";
import { ShardIndex } from "@spine-event-engine/server";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { DeliveryClient, deliveryClientAccess } from "../client/client.js";
import { Code, ConnectError } from "@connectrpc/connect";
import {
  DeliveryPagingError,
  DeliveryOutcomeUnknownError,
  DeliveryProtocolError,
  type DeliveryWorkerId,
  type RemoteShardSession,
} from "../client/types.js";
import { DeliveryMessageCodec, DeliveryRequestCodec, DeliveryShardCodec } from "../wire/codec.js";

interface RemoteInboxPage {
  readonly messages: readonly InboxMessage[];
  readonly complete: boolean;
  readonly last: InboxMessage | undefined;
}

/**
 * Shares session bindings between the Inbox and registry adapters of one client.
 */
const RemoteSessionBindings = Object.freeze({
  /**
   * Stores weak client-local session maps.
   */
  cache: new WeakMap<DeliveryClient, WeakMap<DeliveryWorkSession, RemoteShardSession>>(),

  /**
   * Returns the session map shared by adapters using one delivery client.
   *
   * @param client Identifies the remote connection.
   * @returns The client-local session map.
   */
  get(client: DeliveryClient): WeakMap<DeliveryWorkSession, RemoteShardSession> {
    let bindings = RemoteSessionBindings.cache.get(client);
    if (bindings === undefined) {
      bindings = new WeakMap();
      RemoteSessionBindings.cache.set(client, bindings);
    }
    return bindings;
  },
});

/**
 * Adapts a delivery-server client to the server-owned inbox port.
 */
export class RemoteInbox implements DeliveryInbox {
  // prettier-ignore

  /**
   * Remote inbox work requires an exclusive remote shard session.
   */
  readonly sessionKind = "EXCLUSIVE" as const;

  /**
   * Creates a remote inbox.
   *
   * @param client Sends inbox calls to the delivery server.
   */
  constructor(private readonly client: DeliveryClient) {
    Object.freeze(this);
  }

  /**
   * Writes a new inbox message without a completion deadline.
   *
   * @param input Supplies the message fields excluding its generated identity.
   * @param options Bounds or cancels the remote mutation.
   * @returns The written message result.
   */
  async receive(
    input: InboxMessageInput,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage> {
    const message = RemoteValues.receiveMessage(input);
    await this.client.writeOne(message, options);
    return RemoteValues.freeze(message);
  }

  /**
   * Finds the last pending row in the server's complete shard delivery order.
   *
   * @param shard Selects the shard to inspect after normal release.
   * @param options Bounds or cancels the remote read.
   * @returns The newest pending row, when present.
   */
  newestPending(
    shard: ShardIndex,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.client.newestPending(shard, options);
  }

  /**
   * Reads a bounded page of messages from one shard.
   *
   * @param shardIndex Identifies the shard to read.
   * @param options Supplies paging, status filtering, and call bounds.
   * @returns Detached messages in safely continued remote order.
   */
  async read(
    shardIndex: ShardIndex,
    options: InboxReadOptions & DeliveryOperationOptions = {},
  ): Promise<readonly InboxMessage[]> {
    if (options.offset !== undefined && options.offset !== 0) throw new DeliveryPagingError();
    const limit = options.limit ?? this.client.pageSize;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new TypeError("Delivery page size is invalid.");
    RemoteInbox.#validateRead(shardIndex, options.after);
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs);
    const deadline = timeoutMs === undefined ? Infinity : Time.monotonicTime() + timeoutMs;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const cancelTimer = DeliveryTimers.after(() => {
      controller.abort(new Error("Delivery Inbox read timed out."));
    }, timeoutMs);
    try {
      return await this.#readCollected(
        shardIndex,
        { ...options, signal: controller.signal },
        limit,
        deadline,
      );
    } finally {
      cancelTimer?.();
      options.signal?.removeEventListener("abort", abort);
    }
  }

  /**
   * Validates a remote read position even when status filtering returns no rows.
   * @param shardIndex Identifies the requested shard.
   * @param after Holds the exclusive cursor, when present.
   */
  static #validateRead(shardIndex: ShardIndex, after: InboxReadOptions["after"]): void {
    DeliveryShardCodec.encode(shardIndex);
    if (after === undefined) return;
    DeliveryRequestCodec.timestamp(after.whenReceived);
    if (after.messageId.trim().length === 0 || after.version < 0n || after.version > 2_147_483_647n)
      throw new TypeError("Delivery page cursor is invalid.");
  }

  /**
   * Settles a remote page wait on cancellation even if an injected transport does not.
   *
   * @param operation The already-entered remote read.
   * @param signal Cancels the outward wait.
   * @returns The page when it arrives before cancellation.
   */
  static async #awaitPage(
    operation: Promise<readonly InboxMessage[]>,
    signal: AbortSignal,
  ): Promise<readonly InboxMessage[]> {
    if (signal.aborted) throw signal.reason;
    const abort = () => {
      rejectAbort(signal.reason);
    };
    let rejectAbort: (reason: unknown) => void = () => undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    signal.addEventListener("abort", abort, { once: true });
    try {
      return await Promise.race([operation, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async #readPage(
    shardIndex: ShardIndex,
    after: InboxReadOptions["after"],
    limit: number,
    options: DeliveryOperationOptions & {
      readonly signal: AbortSignal;
      readonly timeoutMs?: number;
    },
  ): Promise<RemoteInboxPage> {
    const maxPageSize = 0x7fff_ffff; // The wire page size is a signed int32.
    let pageSize = Math.min(maxPageSize, after === undefined ? limit : limit + 1);
    const sinceWhen = after === undefined ? undefined : RemoteValues.pageAnchor(after.whenReceived);
    for (;;) {
      const page = await RemoteInbox.#awaitPage(
        this.client.readPage(shardIndex, {
          pageSize,
          signal: options.signal,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(sinceWhen === undefined ? {} : { sinceWhen }),
        }),
        options.signal,
      );
      const messages =
        after === undefined ? page : page.filter((message) => RemoteValues.isAfter(message, after));
      const complete = page.length < pageSize;
      if (messages.length || complete) return { messages, complete, last: messages.at(-1) };
      if (pageSize === maxPageSize) throw new DeliveryPagingError();
      pageSize = Math.min(maxPageSize, pageSize * 2);
    }
  }

  async #readCollected(
    shardIndex: ShardIndex,
    options: InboxReadOptions & DeliveryOperationOptions & { readonly signal: AbortSignal },
    limit: number,
    deadline: number,
  ): Promise<readonly InboxMessage[]> {
    let after = options.after;
    const result: InboxMessage[] = [];
    if (options.statuses?.length === 0) return Object.freeze(result);
    while (result.length < limit) {
      if (options.signal.aborted) throw options.signal.reason;
      const remaining = Math.ceil(deadline - Time.monotonicTime());
      if (remaining <= 0) throw new Error("Delivery Inbox read timed out.");
      const page = await this.#readPage(shardIndex, after, limit, {
        ...options,
        ...(Number.isFinite(remaining) ? { timeoutMs: remaining } : {}),
      });
      for (const message of page.messages) {
        if (options.statuses === undefined || options.statuses.includes(message.status))
          result.push(message);
        if (result.length === limit) return Object.freeze(result);
      }
      if (page.complete) return Object.freeze(result);
      if (page.last === undefined) throw new DeliveryPagingError();
      after = {
        messageId: page.last.id.value,
        whenReceived: page.last.whenReceived,
        version: page.last.version,
      };
    }
    return Object.freeze(result);
  }

  /**
   * Reads one message by its remote identity.
   *
   * @param id Identifies the message and shard.
   * @param options Bounds or cancels the remote read.
   * @returns The detached message, or `undefined` when it is absent.
   */
  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.client.findOne(id, options);
  }

  /**
   * Completes the current inbox message by ID under the live session.
   *
   * @param message Supplies the pending message from the current page.
   * @param options Bounds or cancels the mutation.
   * @param session Supplies the current local exclusive session.
   * @returns The completion with its first stored deadline, or `undefined` when
   * the ID is absent.
   * An unknown outcome raises `DeliveryOutcomeUnknownError` for reconciliation.
   */
  async markDelivered(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
    session?: DeliveryWorkSession,
  ): Promise<InboxMessage | undefined> {
    const remote = this.#session(session);
    const { matched, whenKeepUntil } = await this.client.markDelivered(remote, message.id, options);
    if (!matched) return undefined;
    const completed = { ...message, status: "DELIVERED" as const };
    if (whenKeepUntil === undefined) delete completed.keepUntil;
    else completed.keepUntil = DeliveryShardCodec.date(whenKeepUntil);
    return Object.freeze(completed);
  }

  /**
   * Removes expired delivered inbox messages for the current shard session.
   *
   * @param shard Selects the current shard.
   * @param options Bounds or cancels the managed mutation.
   * @param session Supplies the current local exclusive session.
   * @returns True after the server applies its shard predicate.
   */
  async removeExpiredDelivered(
    shard: ShardIndex,
    options?: DeliveryOperationOptions,
    session?: DeliveryWorkSession,
  ): Promise<boolean> {
    const remote = this.#session(session);
    if (remote.shard.index !== shard.index || remote.shard.ofTotal !== shard.ofTotal)
      throw new TypeError("Inbox cleanup shard differs from session.");
    await this.client.removeExpiredDelivered(remote, options);
    return true;
  }

  /**
   * Removes a pending duplicate by ID under the live session.
   *
   * @param message Supplies the pending message from the current page.
   * @param options Bounds or cancels the mutation.
   * @param session Supplies the current local exclusive session.
   * @returns Whether the pending message was removed or its ID was already absent. An unknown outcome
   * raises `DeliveryOutcomeUnknownError` for reconciliation.
   */
  async removeDuplicate(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
    session?: DeliveryWorkSession,
  ): Promise<boolean> {
    return this.client.removeDuplicate(this.#session(session), message.id, options);
  }

  /**
   * Requires the handle issued to this client for a framework session.
   *
   * @param session Supplies the local exclusive fence.
   * @returns Its current remote handle.
   */
  #session(session: DeliveryWorkSession | undefined): RemoteShardSession {
    const handle =
      session === undefined ? undefined : RemoteSessionBindings.get(this.client).get(session);
    if (handle === undefined) throw new DeliveryProtocolError();
    return handle;
  }
}

/**
 * Adapts remote exclusive shard sessions to the server work registry.
 */
class RemoteSessionOwner {
  // prettier-ignore

  /**
   * Maps local sessions to their latest confirmed remote handles.
   */
  readonly #sessions = new WeakMap<ExclusiveDeliveryWorkSession, RemoteShardSession>();

  readonly #pendingRenewals = new WeakMap<
    ExclusiveDeliveryWorkSession,
    Promise<{ handle: RemoteShardSession; sentAt: number }>
  >();

  readonly #knownLiveUntil = new WeakMap<ExclusiveDeliveryWorkSession, number>();

  readonly #releaseOnly = new WeakMap<ExclusiveDeliveryWorkSession, RemoteShardSession>();

  readonly #terminal = new WeakSet<ExclusiveDeliveryWorkSession>();

  /**
   * Creates a registry backed by the supplied delivery client.
   *
   * @param client Sends shard operations to the delivery server.
   */
  constructor(private readonly client: DeliveryClient) {}

  /**
   * Acquires a shard for the supplied complete worker identity.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param worker Identifies the worker requesting work.
   * @param options Bounds or cancels the remote mutation.
   * @returns A local exclusive session, or `undefined` when unavailable.
   */
  async pickUp(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    const result = await this.pickUpForWork(shardIndex, worker, options);
    return result.kind === "PICKED" ? result.session : undefined;
  }

  /**
   * Returns a managed grant or the server's definitive refusal reason.
   *
   * @param shardIndex Selects the shard to acquire.
   * @param worker Identifies this independent run.
   * @param options Bounds or cancels the remote mutation.
   * @returns The granted session, busy, or no-work result.
   */
  async pickUpForWork(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<
    | { readonly kind: "PICKED"; readonly session: ExclusiveDeliveryWorkSession }
    | { readonly kind: "BUSY" | "NO_WORK" }
  > {
    const operation = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    const pickup = await this.client.pickUpForDelivery(
      shardIndex,
      RemoteValues.worker(worker),
      operation,
    );
    if (pickup.kind !== "PICKED") return { kind: pickup.kind };
    const remote = pickup.session;
    const sentAt = deliveryClientAccess.pickupSentAt(remote);
    const session = RemoteValues.freeze({
      kind: "EXCLUSIVE" as const,
      shard: DeliveryShardCodec.snapshot(shardIndex),
    });
    this.#sessions.set(session, remote);
    this.#knownLiveUntil.set(session, sentAt + RemoteValues.lifetimeMs(remote));
    RemoteSessionBindings.get(this.client).set(session, remote);
    return { kind: "PICKED", session };
  }

  /**
   * Removes a previously acquired exclusive session.
   *
   * @param session Supplies the local session to release.
   * @param options Bounds or cancels the remote mutation.
   * @returns Whether this registry released a known session.
   */
  async release(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    if (session.kind !== "EXCLUSIVE") return false;
    const remote = this.#sessions.get(session) ?? this.#releaseOnly.get(session);
    if (remote === undefined) return false;
    this.#terminal.add(session);
    this.#sessions.delete(session);
    this.#knownLiveUntil.delete(session);
    this.#releaseOnly.delete(session);
    RemoteSessionBindings.get(this.client).delete(session);
    const latest = await this.#pendingRenewals.get(session)?.catch(() => undefined);
    await this.client.release(latest?.handle ?? remote, options);
    return true;
  }

  /**
   * Validates the local handle by renewing the matching remote session.
   *
   * @param session Supplies the locally issued exclusive session.
   * @param options Bounds or cancels the renewal.
   * @returns The retained session, or `undefined` when validation fails.
   */
  async validateOwnership(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    if (session.kind !== "EXCLUSIVE") return undefined;
    const remote = this.#sessions.get(session);
    if (remote === undefined || this.#terminal.has(session)) return undefined;
    const previous = this.#pendingRenewals.get(session);
    const renewal = this.#renew(session, remote, previous, options);
    this.#pendingRenewals.set(session, renewal);
    try {
      const { handle: renewed, sentAt } = await renewal;
      if (this.#terminal.has(session)) return undefined;
      if (Time.monotonicTime() >= sentAt + RemoteValues.lifetimeMs(renewed)) {
        this.#invalidate(session);
        return undefined;
      }
      this.#sessions.set(session, renewed);
      this.#knownLiveUntil.set(session, sentAt + RemoteValues.lifetimeMs(renewed));
      RemoteSessionBindings.get(this.client).set(session, renewed);
      return session;
    } catch (error) {
      this.#onFailedRenewal(session, error);
      if (error instanceof ConnectError && error.code === Code.FailedPrecondition) return undefined;
      throw error;
    }
  }

  /**
   * Clears the processing handle and retains an uncertain session for release.
   *
   * @param session Supplies the local session.
   * @param error Supplies the failed renewal outcome.
   */
  #onFailedRenewal(session: ExclusiveDeliveryWorkSession, error: unknown): void {
    if (this.#terminal.has(session)) return;
    const releaseOnly =
      error instanceof DeliveryOutcomeUnknownError ? this.#sessions.get(session) : undefined;
    this.#invalidate(session);
    if (releaseOnly === undefined) return;
    this.#releaseOnly.set(session, releaseOnly);
  }

  /**
   * Sends a renewal only before the previous confirmed lease deadline.
   *
   * @param session Supplies the local session.
   * @param remote Supplies its last confirmed handle.
   * @param previous Serializes an earlier renewal, when present.
   * @param options Bounds or cancels the renewal.
   * @returns The renewed handle and original send time.
   */
  async #renew(
    session: ExclusiveDeliveryWorkSession,
    remote: RemoteShardSession,
    previous: Promise<{ handle: RemoteShardSession; sentAt: number }> | undefined,
    options?: DeliveryOperationOptions,
  ): Promise<{ handle: RemoteShardSession; sentAt: number }> {
    const prior = previous === undefined ? undefined : await previous;
    const latest = prior?.handle ?? remote;
    const deadline =
      prior === undefined
        ? this.#knownLiveUntil.get(session)
        : prior.sentAt + RemoteValues.lifetimeMs(latest);
    if (this.#terminal.has(session)) return { handle: latest, sentAt: prior?.sentAt ?? 0 };
    if (deadline === undefined || Time.monotonicTime() >= deadline)
      throw new ConnectError("Delivery session lifetime elapsed.", Code.FailedPrecondition);
    const sentAt = Time.monotonicTime();
    const handle = await this.client.renew(latest, options);
    return { handle, sentAt };
  }

  /**
   * Returns one third of the server lifetime for an active remote session.
   *
   * @param session Supplies the local exclusive session.
   * @returns The renewal interval, when its handle remains current.
   */
  renewalIntervalMs(session: DeliveryWorkSession): number | undefined {
    if (session.kind !== "EXCLUSIVE" || this.#terminal.has(session)) return undefined;
    const remote = this.#sessions.get(session);
    return remote === undefined ? undefined : RemoteValues.lifetimeMs(remote) / 3;
  }

  /**
   * Removes a session from local validation state.
   *
   * @param session Supplies the session to invalidate.
   */
  #invalidate(session: ExclusiveDeliveryWorkSession): void {
    this.#terminal.add(session);
    this.#sessions.delete(session);
    this.#knownLiveUntil.delete(session);
    this.#releaseOnly.delete(session);
    RemoteSessionBindings.get(this.client).delete(session);
  }
}

/**
 * Adapts one per-registry remote session owner to the server work-registry port.
 */
export class RemoteWorkRegistry implements DeliveryWorkRegistry {
  // prettier-ignore

  /**
   * Identifies the exclusive session model used by the remote registry.
   */
  readonly sessionKind = "EXCLUSIVE" as const;

  readonly #owner: RemoteSessionOwner;

  /**
   * Creates a registry backed by the supplied delivery client.
   *
   * @param client Sends shard operations to the delivery server.
   */
  constructor(client: DeliveryClient) {
    this.#owner = new RemoteSessionOwner(client);
    Object.freeze(this);
  }

  /**
   * Creates a fresh worker identity for one independent asynchronous run.
   *
   * @param worker Supplies the configured application node.
   * @returns The configured node ID and a new UUID for this run.
   */
  workerForRun(worker: WorkerId): WorkerId {
    const configuredNode = RemoteValues.worker(worker).nodeId;
    const value = randomUUID();
    return create(WorkerIdSchema, { nodeId: { value: configuredNode }, value });
  }

  /**
   * Returns one third of the acquired server lifetime.
   *
   * @param session Supplies the acquired local session.
   * @returns Its renewal interval, when still active.
   */
  renewalIntervalMs(session: DeliveryWorkSession): number | undefined {
    return this.#owner.renewalIntervalMs(session);
  }

  /**
   * Acquires a remote shard for a complete worker identity.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param worker Identifies the worker requesting the shard.
   * @param options Bounds or cancels the remote operation.
   * @returns The acquired exclusive session, or `undefined` when unavailable.
   */
  pickUp(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return this.#owner.pickUp(shardIndex, worker, options);
  }

  /**
   * Returns the server's busy and no-work outcomes to managed callers.
   *
   * @param shardIndex Selects the shard to acquire.
   * @param worker Identifies this independent run.
   * @param options Bounds or cancels the remote operation.
   * @returns A managed session, a busy shard, or a shard without pending work.
   */
  pickUpForWork(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): ReturnType<RemoteSessionOwner["pickUpForWork"]> {
    return this.#owner.pickUpForWork(shardIndex, worker, options);
  }

  /**
   * Removes a remote shard session owned by this registry.
   *
   * @param session Identifies the session to release.
   * @param options Bounds or cancels the remote operation.
   * @returns Whether the registry recognized and released the session.
   */
  release(session: DeliveryWorkSession, options?: DeliveryOperationOptions): Promise<boolean> {
    return this.#owner.release(session, options);
  }

  /**
   * Validates current remote ownership before a guarded side effect.
   *
   * @param session Supplies the exclusive session to validate.
   * @param options Bounds or cancels the authoritative observation.
   * @returns The retained session, or `undefined` when validation fails.
   */
  validateOwnership(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return this.#owner.validateOwnership(session, options);
  }
}

/**
 * Groups immutable remote-adapter value operations.
 */
const RemoteValues = Object.freeze({
  /**
   * Converts a positive session Duration to milliseconds.
   *
   * @param session Supplies the server-issued handle.
   * @returns Its full-precision lifetime in milliseconds.
   */
  lifetimeMs(session: RemoteShardSession): number {
    return Number(session.lifetime.seconds) * 1_000 + session.lifetime.nanos / 1_000_000;
  },

  /**
   * Creates a detached message with a generated inbox identity.
   *
   * @param input Supplies the inbox message fields.
   * @returns The encoded inbox message with a generated ID.
   */
  receiveMessage(input: InboxMessageInput): InboxMessage {
    const message = DeliveryMessageCodec.snapshot({
      inboxId: input.inboxId,
      signalId: input.signalId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      label: input.label,
      status: input.status,
      whenReceived: input.whenReceived,
      version: input.version,
      id: RemoteValues.freeze({
        value: randomUUID(),
        shard: DeliveryShardCodec.snapshot(input.shard),
      }),
      shard: DeliveryShardCodec.snapshot(input.shard),
    });
    DeliveryMessageCodec.encode(message);
    return message;
  },

  /**
   * Returns a frozen object with its original type.
   *
   * @typeParam T Object type.
   * @param value Supplies the object to freeze.
   * @returns The frozen object.
   */
  freeze<T extends object>(value: T): T {
    return Object.freeze(value);
  },

  /**
   * Reads from the nanosecond before an exact continuation time.
   * @param value Last received timestamp.
   * @returns Exclusive JVM query bound that includes the cursor row.
   */
  pageAnchor(value: Timestamp): Timestamp | undefined {
    if (value.seconds === -62_135_596_800n && value.nanos === 0) return undefined;
    return value.nanos === 0
      ? create(TimestampSchema, { seconds: value.seconds - 1n, nanos: 999_999_999 })
      : create(TimestampSchema, { seconds: value.seconds, nanos: value.nanos - 1 });
  },

  /**
   * Checks whether a message follows the previous page in the server's delivery order.
   *
   * @param message Candidate from the timestamp query.
   * @param after Last position consumed by the worker.
   * @returns True when this candidate has not yet been visited.
   */
  isAfter(message: InboxMessage, after: NonNullable<InboxReadOptions["after"]>): boolean {
    const time = message.whenReceived;
    if (time.seconds !== after.whenReceived.seconds)
      return time.seconds > after.whenReceived.seconds;
    if (time.nanos !== after.whenReceived.nanos) return time.nanos > after.whenReceived.nanos;
    if (message.version !== after.version) return message.version > after.version;
    return Buffer.compare(Buffer.from(message.id.value), Buffer.from(after.messageId)) > 0;
  },

  /**
   * Validates and copies a worker ID for the remote protocol.
   *
   * @param worker Supplies the worker ID.
   * @returns The detached remote worker ID.
   */
  worker(worker: WorkerId): DeliveryWorkerId {
    const nodeId = worker.nodeId?.value;
    if (
      typeof nodeId !== "string" ||
      nodeId.trim().length === 0 ||
      typeof worker.value !== "string" ||
      worker.value.trim().length === 0
    )
      throw new TypeError("Delivery worker ID is invalid.");
    return RemoteValues.freeze({ nodeId, value: worker.value });
  },
});
