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
import {
  InboxRetention,
  deliveryPortAccess,
  type InboxMessageInput,
} from "@spine-event-engine/server/spi/delivery";
import { ShardIndex } from "@spine-event-engine/server";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { DeliveryClient } from "../client/client.js";
import {
  DeliveryPagingError,
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
 * Adapts a delivery-server client to the server-owned inbox port.
 */
export class RemoteInbox implements DeliveryInbox {
  // prettier-ignore

  readonly #pages = new WeakMap<DeliveryWorkSession, {
    writes: InboxMessage[];
    removals: InboxMessage[];
  }>();

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
    Object.defineProperty(this, deliveryPortAccess, {
      value: (
        messages: readonly InboxMessage[],
        session: DeliveryWorkSession,
        options: DeliveryOperationOptions | undefined,
        process: (isRecent?: (message: InboxMessage) => boolean) => Promise<boolean>,
        onWritesStored: () => void,
      ) => this.#applyPage(messages, session, options, process, onWritesStored),
    });
    Object.freeze(this);
  }

  /**
   * Runs one page and flushes changed rows before removals.
   *
   * @param messages Supplies the page read from InboxService.
   * @param session Identifies the current worker session.
   * @param options Carries cancellation for the batch RPCs.
   * @param process Dispatches the page with full-precision retention checks.
   * @param onWritesStored Reports durable completion writes before removals.
   * @returns Whether processing continued through the complete page.
   * @internal
   */
  async #applyPage(
    messages: readonly InboxMessage[],
    session: DeliveryWorkSession,
    options: DeliveryOperationOptions | undefined,
    process: (isRecent?: (message: InboxMessage) => boolean) => Promise<boolean>,
    onWritesStored: () => void,
  ): Promise<boolean> {
    const now = Time.currentTime();
    const nowNs = now.seconds * 1_000_000_000n + BigInt(now.nanos);
    const removals = messages.filter((message) => {
      if (message.status !== "DELIVERED") return false;
      const deadline = DeliveryMessageCodec.retentionDeadline(message);
      return (
        deadline === undefined || nowNs > deadline.seconds * 1_000_000_000n + BigInt(deadline.nanos)
      );
    });
    const page = { writes: [] as InboxMessage[], removals };
    this.#pages.set(session, page);
    try {
      if (
        !(await process((message) => {
          const deadline = DeliveryMessageCodec.retentionDeadline(message);
          return (
            deadline !== undefined &&
            deadline.seconds * 1_000_000_000n + BigInt(deadline.nanos) > nowNs
          );
        }))
      )
        return false;
      if (page.writes.length > 0) {
        await this.client.writeMany(page.writes, options);
        onWritesStored();
      }
      if (page.removals.length > 0) await this.client.removeMany(page.removals, options);
      return true;
    } finally {
      this.#pages.delete(session);
    }
  }

  /**
   * Returns the current page for one session.
   */
  #page(session: DeliveryWorkSession | undefined) {
    const page = session === undefined ? undefined : this.#pages.get(session);
    if (page === undefined) throw new DeliveryProtocolError();
    return page;
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
   * Records the completed message for the page's batch write.
   *
   * @param message Supplies the pending message from the current page.
   * @param options Bounds or cancels the mutation.
   * @param session Supplies the current local exclusive session.
   * @returns The staged completion with its first deadline. Storage completes
   * when the page's WriteMany call succeeds.
   */
  markDelivered(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
    session?: DeliveryWorkSession,
  ): Promise<InboxMessage | undefined> {
    const now = Time.currentTime();
    const completed = {
      ...message,
      status: "DELIVERED" as const,
      keepUntil: InboxRetention.deadline(DeliveryShardCodec.date(now).getTime()),
    };
    const seconds = now.seconds + BigInt(Math.floor(InboxRetention.durationMs / 1_000));
    const nanos = now.nanos + (InboxRetention.durationMs % 1_000) * 1_000_000;
    const deadline = create(TimestampSchema, {
      seconds: seconds + BigInt(Math.floor(nanos / 1_000_000_000)),
      nanos: nanos % 1_000_000_000,
    });
    DeliveryMessageCodec.retainWire(message, completed, deadline);
    this.#page(session).writes.push(completed);
    return Promise.resolve(Object.freeze(completed));
  }

  /**
   * Records a pending duplicate for removal after page completion writes.
   *
   * @param message Supplies the pending message from the current page.
   * @param options Bounds or cancels the mutation.
   * @param session Supplies the current local exclusive session.
   * @returns Whether removal was staged. Storage completes when the page's
   * RemoveMany call succeeds.
   */
  removeDuplicate(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
    session?: DeliveryWorkSession,
  ): Promise<boolean> {
    this.#page(session).removals.push(message);
    return Promise.resolve(true);
  }
}

/**
 * Adapts remote shard sessions to the server work registry.
 */
export class RemoteWorkRegistry implements DeliveryWorkRegistry {
  /**
   * The session kind returned by the remote shard service.
   */
  readonly sessionKind = "EXCLUSIVE" as const;

  readonly #sessions = new WeakMap<ExclusiveDeliveryWorkSession, RemoteShardSession>();

  /**
   * Creates the registry over a delivery client.
   *
   * @param client Sends shard RPCs to the Delivery server.
   */
  constructor(private readonly client: DeliveryClient) {}

  /**
   * Creates a distinct worker identity for one concurrent run.
   *
   * @param worker Supplies the configured application node.
   * @returns A worker ID for one run.
   */
  workerForRun(worker: WorkerId): WorkerId {
    const configuredNode = RemoteValues.worker(worker).nodeId;
    return create(WorkerIdSchema, { nodeId: { value: configuredNode }, value: randomUUID() });
  }

  /**
   * Acquires one shard for one worker.
   *
   * @param shardIndex Identifies the requested shard.
   * @param worker Identifies the worker requesting it.
   * @param options Bounds or cancels the remote call.
   * @returns A session, or `undefined` while another worker holds the shard.
   */
  async pickUp(
    shardIndex: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    const remote = await this.client.pickUp(shardIndex, RemoteValues.worker(worker), options);
    if (remote === undefined) return undefined;
    const session = RemoteValues.freeze({
      kind: "EXCLUSIVE" as const,
      shard: DeliveryShardCodec.snapshot(shardIndex),
    });
    this.#sessions.set(session, remote);
    return session;
  }

  /**
   * Removes the session when this registry recorded its pickup.
   *
   * @param session Identifies the locally recorded pickup.
   * @param options Bounds or cancels the remote call.
   * @returns Whether this registry released the session.
   */
  async release(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    if (session.kind !== "EXCLUSIVE") return false;
    const remote = this.#sessions.get(session);
    if (remote === undefined) return false;
    this.#sessions.delete(session);
    await this.client.release(remote, options);
    return true;
  }

  /**
   * Returns the local session while this registry has not released it. The
   * server's current shard record is not read by this check.
   *
   * @param session Identifies the session to check.
   * @returns The session while still recorded locally.
   */
  validateOwnership(
    session: DeliveryWorkSession,
  ): Promise<ExclusiveDeliveryWorkSession | undefined> {
    return Promise.resolve(
      session.kind === "EXCLUSIVE" && this.#sessions.has(session) ? session : undefined,
    );
  }
}

/**
 * Groups immutable remote-adapter value operations.
 */
const RemoteValues = Object.freeze({
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
