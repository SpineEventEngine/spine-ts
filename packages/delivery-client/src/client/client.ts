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

import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Transport } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";

import type { InboxMessage, InboxMessageId } from "@spine-event-engine/server";
import { ShardIndex } from "@spine-event-engine/server";
import {
  InboxService,
  AdminService,
  ShardService,
  PageOfMessagesSchema,
  OptionalInboxMessageSchema,
  ShardInfoListSchema,
  LiquorPickUpOutcomeSchema as PickUpOutcomeSchema,
  ExpiredSessionsReleasedSchema,
  PickUpShardSchema,
  ReadMessagesSinceTimeSchema as ReadMessagesSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  WriteMessageSchema,
  WriteMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import { InboxMessageIdSchema, ShardIndexSchema } from "@spine-event-engine/proto/delivery";
import {
  DeliveryOutcomeUnknownError,
  MAX_DELIVERY_RPC_BYTES,
  MAX_DELIVERY_TRACKED_SHARDS,
  type DeliveryClientOptions,
  type DeliveryFindOneOptions,
  type DeliveryMutationOptions,
  type DeliveryReadPageOptions,
  type DeliveryShardObservationStream,
  type DeliveryWorkerId,
  type ReleasedShardSession,
  type RemoteShardObservation,
  type RemoteShardSession,
} from "./types.js";
import { ShardObservationStream } from "./shard-observation.js";
import { DeliveryMessageCodec, DeliveryRequestCodec, DeliveryShardCodec } from "../wire/codec.js";

export {
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  DeliveryShardObservationError,
  ShardObservationOverflowError,
  MAX_DELIVERY_BATCH_MESSAGES,
  MAX_INBOX_PAYLOAD_BYTES,
  MAX_DELIVERY_RPC_BYTES,
} from "./types.js";
export type {
  DeliveryClientOptions,
  DeliveryFindOneOptions,
  DeliveryMutationOptions,
  DeliveryReadPageOptions,
  DeliveryShardObservationStream,
  DeliveryWorkerId,
  ReleasedShardSession,
  RemoteShardObservation,
  RemoteShardSession,
} from "./types.js";

/**
 * Provides a Node client for the frozen delivery-server gRPC API.
 */
export class DeliveryClient {
  readonly #inbox: ReturnType<typeof createClient<typeof InboxService>>;
  readonly #shards: ReturnType<typeof createClient<typeof ShardService>>;
  readonly #admin: ReturnType<typeof createClient<typeof AdminService>>;
  readonly #pageSize: number;
  readonly #readRetries: number;
  readonly #retryBackoffMs: number;
  readonly #observationReconnects: number;
  readonly #observationReconnectBackoffMs: number;
  readonly #observationBufferSize: number;
  readonly #activeReads = new Set<AbortController>();
  readonly #onCloseOwnedTransport: (() => void) | undefined;
  #closed = false;

  private constructor(
    transport: Transport,
    options: DeliveryClientOptions,
    onCloseOwnedTransport?: () => void,
  ) {
    this.#pageSize = DeliveryRequestCodec.pageSize(options.pageSize ?? 100);
    this.#readRetries = DeliveryRequestCodec.retries(options.readRetries ?? 0);
    this.#retryBackoffMs = DeliveryRequestCodec.backoff(options.retryBackoffMs ?? 0);
    this.#observationReconnects = DeliveryRequestCodec.retries(options.observationReconnects ?? 0);
    this.#observationReconnectBackoffMs = DeliveryRequestCodec.backoff(
      options.observationReconnectBackoffMs ?? 0,
    );
    this.#observationBufferSize = DeliveryRequestCodec.bounded(
      options.observationBufferSize ?? 100,
      1,
      1_000,
      "Delivery observation buffer size",
    );
    this.#inbox = createClient(InboxService, transport);
    this.#shards = createClient(ShardService, transport);
    this.#admin = createClient(AdminService, transport);
    this.#onCloseOwnedTransport = onCloseOwnedTransport;
    deliveryClientProbes.set(this, (shardIndex, workerId, options) =>
      this.#probePickUp(shardIndex, workerId, options),
    );
    deliveryClientObservations.set(this, (options) => this.#observeShardUpdates(options, 0));
  }

  /**
   * Gets the bounded page size configured for this client.
   * @returns The maximum number of messages requested by default.
   */
  get pageSize(): number {
    return this.#pageSize;
  }

  /**
   * Creates a client over a caller-owned standard Connect transport.
   * @param transport Sends requests to the remote delivery service.
   * @param options Configures bounded reads and observations.
   * @returns A client that never closes the supplied transport.
   */
  static usingTransport(transport: Transport, options: DeliveryClientOptions = {}): DeliveryClient {
    return new DeliveryClient(transport, options);
  }

  /**
   * Connects to a JVM delivery server with a client-owned HTTP/2 gRPC session.
   *
   * The URL and options are validated before opening the session. `close()` is
   * synchronous: it aborts active calls and the owned session immediately; it
   * does not wait for remote stream cleanup. Use {@link usingTransport} when
   * the caller owns the transport lifecycle.
   * @param baseUrl Supplies the absolute HTTP(S) delivery-server origin.
   * @param options Configures bounded reads and observations.
   * @returns A client that aborts its owned session when closed.
   */
  static connectTo(baseUrl: string, options: DeliveryClientOptions = {}): DeliveryClient {
    const normalized = DeliveryRequestCodec.normalize(options);
    DeliveryRequestCodec.baseUrl(baseUrl);
    const sessions = new Http2SessionManager(baseUrl);
    return new DeliveryClient(
      createGrpcTransport({
        baseUrl,
        sessionManager: sessions,
        readMaxBytes: MAX_DELIVERY_RPC_BYTES,
        writeMaxBytes: MAX_DELIVERY_RPC_BYTES,
      }),
      normalized,
      () => {
        sessions.abort();
      },
    );
  }

  /**
   * Reads validated detached Admin observations.
   * @param options Bounds or cancels the read.
   * @returns Detached observations that callers may safely mutate.
   */
  async shardSnapshot(
    options: DeliveryFindOneOptions = {},
  ): Promise<readonly RemoteShardObservation[]> {
    const request = create(EmptySchema);
    DeliveryRequestCodec.requestBytes(EmptySchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#admin.getShardInfo(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
    DeliveryRequestCodec.responseBytes(ShardInfoListSchema, response);
    if (response.shards.length > MAX_DELIVERY_TRACKED_SHARDS) throw DeliveryRequestCodec.protocol();
    return Object.freeze(
      response.shards.map((value) => DeliveryShardCodec.decodeObservation(value)),
    );
  }

  /**
   * Starts an ACK-gated Admin shard-update observation stream.
   * @param options Bounds stream setup and cancels its lifetime.
   * @returns A cancellable stream of detached shard observations.
   */
  observeShardUpdates(options: DeliveryFindOneOptions = {}): DeliveryShardObservationStream {
    return this.#observeShardUpdates(options, this.#observationReconnects);
  }

  #observeShardUpdates(
    options: DeliveryFindOneOptions,
    reconnects: number,
  ): DeliveryShardObservationStream {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const controller = new AbortController();
    const callerAbort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", callerAbort, { once: true });
    this.#activeReads.add(controller);
    return new ShardObservationStream({
      signal: controller.signal,
      setupTimeoutMs: DeliveryRequestCodec.timeout(options.timeoutMs ?? 30_000),
      capacity: this.#observationBufferSize,
      reconnects,
      reconnectBackoffMs: this.#observationReconnectBackoffMs,
      open: (signal) =>
        this.#admin.subscribeToShardUpdates(
          create(EmptySchema),
          DeliveryRequestCodec.callOptions(signal),
        ),
      acknowledge: (frame) => frame.value.case === "created" && frame.value.value,
      decodeUpdate: (frame) => {
        if (frame.value.case !== "update") throw DeliveryRequestCodec.protocol();
        return DeliveryShardCodec.decodeUpdate(frame.value.value);
      },
      finish: () => {
        options.signal?.removeEventListener("abort", callerAbort);
        this.#activeReads.delete(controller);
      },
      cancel: () => {
        controller.abort(new Error("Delivery shard observation cancelled."));
      },
    });
  }

  /**
   * Finds and decodes one inbox message.
   * @param id Identifies the inbox message and its shard.
   * @param options Bounds or cancels the safe read.
   * @returns The detached message, or `undefined` when absent.
   */
  async findOne(
    id: InboxMessageId,
    options: DeliveryFindOneOptions = {},
  ): Promise<InboxMessage | undefined> {
    const request = create(InboxMessageIdSchema, {
      uuid: DeliveryMessageCodec.encodeId(id),
      index: DeliveryShardCodec.encode(id.shard),
    });
    DeliveryRequestCodec.requestBytes(InboxMessageIdSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findOne(request, { timeoutMs, signal }),
    );
    DeliveryRequestCodec.responseBytes(OptionalInboxMessageSchema, response);
    return response.message === undefined
      ? undefined
      : DeliveryMessageCodec.decode(response.message, id.shard);
  }

  /**
   * Reads and decodes the first bounded ordered page for one shard.
   *
   * A server rejects an encoded response above 4 MiB with `RESOURCE_EXHAUSTED`;
   * retry this safe read with a smaller `pageSize`.
   * @param shardIndex Identifies the shard to read.
   * @param options Supplies page continuation, size, and read bounds.
   * @returns Detached messages in remote timestamp order.
   */
  async readPage(
    shardIndex: ShardIndex,
    options: DeliveryReadPageOptions = {},
  ): Promise<readonly InboxMessage[]> {
    const size =
      options.pageSize === undefined
        ? this.#pageSize
        : DeliveryRequestCodec.pageSize(options.pageSize);
    const sinceWhen =
      options.sinceWhen === undefined
        ? undefined
        : DeliveryRequestCodec.timestamp(options.sinceWhen);
    const request = create(ReadMessagesSchema, {
      shard: DeliveryShardCodec.encode(shardIndex),
      pageSize: size,
      ...(sinceWhen === undefined ? {} : { sinceWhen }),
    });
    DeliveryRequestCodec.requestBytes(ReadMessagesSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findManyInShard(request, { timeoutMs, signal }),
    );
    DeliveryRequestCodec.responseBytes(PageOfMessagesSchema, response);
    if (response.message.length > size) throw DeliveryRequestCodec.protocol();
    return Object.freeze(
      response.message.map((message) => DeliveryMessageCodec.decode(message, shardIndex)),
    );
  }

  /**
   * Finds and decodes the newest pending message in a shard.
   * @param shardIndex Identifies the shard to inspect.
   * @param options Bounds or cancels the safe read.
   * @returns The detached newest message, or `undefined` when absent.
   */
  async newestPending(
    shardIndex: ShardIndex,
    options: DeliveryFindOneOptions = {},
  ): Promise<InboxMessage | undefined> {
    const request = DeliveryShardCodec.encode(shardIndex);
    DeliveryRequestCodec.requestBytes(ShardIndexSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.newestMessageToDeliver(request, { timeoutMs, signal }),
    );
    DeliveryRequestCodec.responseBytes(OptionalInboxMessageSchema, response);
    return response.message === undefined
      ? undefined
      : DeliveryMessageCodec.decode(response.message, shardIndex);
  }

  /**
   * Writes one message with exactly one delivery-server RPC attempt.
   * @param message Supplies the message to write.
   * @param options Bounds or cancels the mutation.
   * @returns A promise that completes after the delivery server accepts the message.
   */
  async writeOne(message: InboxMessage, options: DeliveryMutationOptions = {}): Promise<void> {
    const wire = DeliveryMessageCodec.encode(message);
    const request = create(WriteMessageSchema, { message: wire });
    DeliveryRequestCodec.requestBytes(WriteMessageSchema, request);
    await this.#mutation("WRITE_ONE", [message.id.value], options, (signal, timeoutMs) =>
      this.#inbox.writeOne(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
  }

  /**
   * Removes one message with exactly one delivery-server RPC attempt.
   * @param message Supplies the message to remove.
   * @param options Bounds or cancels the mutation.
   * @returns A promise that completes after the delivery server removes the message.
   */
  async removeOne(message: InboxMessage, options: DeliveryMutationOptions = {}): Promise<void> {
    const wire = DeliveryMessageCodec.encode(message);
    const request = create(RemoveMessageSchema, { message: wire });
    DeliveryRequestCodec.requestBytes(RemoveMessageSchema, request);
    await this.#mutation("REMOVE_ONE", [message.id.value], options, (signal, timeoutMs) =>
      this.#inbox.removeOne(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
  }

  /**
   * Writes one bounded same-shard batch with exactly one delivery-server RPC attempt.
   * @param messages Supplies the messages to write.
   * @param options Bounds or cancels the mutation.
   * @returns A promise that completes after the delivery server accepts the batch.
   */
  async writeMany(
    messages: readonly InboxMessage[],
    options: DeliveryMutationOptions = {},
  ): Promise<void> {
    const batch = DeliveryMessageCodec.encodeBatch(messages);
    const request = create(WriteMessagesSchema, { shard: batch.shard, message: batch.messages });
    DeliveryRequestCodec.requestBytes(WriteMessagesSchema, request);
    await this.#mutation("WRITE_MANY", batch.ids, options, (signal, timeoutMs) =>
      this.#inbox.writeMany(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
  }

  /**
   * Removes one bounded same-shard batch with exactly one delivery-server RPC attempt.
   * @param messages Supplies the messages to remove.
   * @param options Bounds or cancels the mutation.
   * @returns A promise that completes after the delivery server removes the batch.
   */
  async removeMany(
    messages: readonly InboxMessage[],
    options: DeliveryMutationOptions = {},
  ): Promise<void> {
    const batch = DeliveryMessageCodec.encodeBatch(messages);
    const request = create(RemoveMessagesSchema, { shard: batch.shard, message: batch.messages });
    DeliveryRequestCodec.requestBytes(RemoveMessagesSchema, request);
    await this.#mutation("REMOVE_MANY", batch.ids, options, (signal, timeoutMs) =>
      this.#inbox.removeMany(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
  }

  /**
   * Acquires a shard once.
   * @param shardIndex Identifies the shard to acquire.
   * @param workerId Identifies the worker requesting exclusive ownership.
   * @param options Bounds or cancels the mutation.
   * @returns A detached exclusive session, or `undefined` when held elsewhere.
   */
  async pickUp(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions = {},
  ): Promise<RemoteShardSession | undefined> {
    const result = await this.#probePickUp(shardIndex, workerId, options);
    return result.kind === "PICKED" ? result.session : undefined;
  }

  async #probePickUp(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
  ): Promise<RemoteShardProbe> {
    const requestedShard = DeliveryShardCodec.encode(shardIndex);
    const requestedWorker = DeliveryShardCodec.encodeWorker(workerId);
    const response = await this.#mutation(
      "PICK_UP_SHARD",
      [DeliveryShardCodec.snapshot(shardIndex)],
      options,
      async (signal, timeoutMs) => {
        const request = create(PickUpShardSchema, {
          shard: requestedShard,
          worker: requestedWorker,
        });
        DeliveryRequestCodec.requestBytes(PickUpShardSchema, request);
        return {
          kind: "PICKED" as const,
          value: await this.#shards.pickShard(
            request,
            DeliveryRequestCodec.callOptions(signal, timeoutMs),
          ),
        };
      },
    );
    DeliveryRequestCodec.responseBytes(PickUpOutcomeSchema, response.value);
    if (response.value.value.case === "alreadyPickedUp") {
      const held = response.value.value.value;
      DeliveryShardCodec.validatePicked(held, shardIndex);
      if (held.worker === undefined || held.whenPicked === undefined)
        throw DeliveryRequestCodec.protocol();
      return Object.freeze({
        kind: "ALREADY_PICKED" as const,
        session: Object.freeze({
          kind: "EXCLUSIVE" as const,
          shard: DeliveryShardCodec.snapshot(shardIndex),
          worker: DeliveryShardCodec.decodeWorker(held.worker),
          whenPicked: DeliveryShardCodec.date(held.whenPicked),
        }),
      });
    }
    if (response.value.value.case !== "pickedUp") throw DeliveryRequestCodec.protocol();
    const picked = DeliveryShardCodec.decodePicked(
      response.value.value.value,
      shardIndex,
      workerId,
    );
    return Object.freeze({ kind: "PICKED" as const, session: picked });
  }

  /**
   * Performs one exclusive shard-session release.
   * @param value Supplies the session to release.
   * @param options Bounds or cancels the mutation.
   * @returns A promise that completes after the delivery server releases the session.
   */
  async release(value: RemoteShardSession, options: DeliveryMutationOptions = {}): Promise<void> {
    const sessionShard = DeliveryShardCodec.encode(value.shard);
    const sessionWorker = DeliveryShardCodec.encodeWorker(value.worker);
    if (!(value.whenPicked instanceof Date) || Number.isNaN(value.whenPicked.getTime()))
      throw new TypeError("Delivery shard session is invalid.");
    await this.#mutation(
      "RELEASE_SHARD",
      [DeliveryShardCodec.snapshot(value.shard)],
      options,
      (signal, timeoutMs) => {
        const request = create(ReleaseShardSchema, { shard: sessionShard, worker: sessionWorker });
        DeliveryRequestCodec.requestBytes(ReleaseShardSchema, request);
        return this.#shards.releaseSession(
          request,
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        );
      },
    );
  }

  /**
   * Performs releases for sessions inactive for a positive duration.
   * @param inactivityMs Supplies the minimum inactivity in milliseconds.
   * @param options Bounds or cancels the mutation.
   * @returns Detached sessions released by the remote service.
   */
  async releaseExpired(
    inactivityMs: number,
    options: DeliveryMutationOptions = {},
  ): Promise<readonly ReleasedShardSession[]> {
    const inactivityPeriod = DeliveryRequestCodec.duration(inactivityMs);
    const response = await this.#mutation(
      "RELEASE_EXPIRED",
      "ALL_SHARDS",
      options,
      (signal, timeoutMs) => {
        const request = create(ReleaseExpiredSessionsSchema, { inactivityPeriod });
        DeliveryRequestCodec.requestBytes(ReleaseExpiredSessionsSchema, request);
        return this.#shards.releaseSessions(
          request,
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        );
      },
    );
    try {
      DeliveryRequestCodec.responseBytes(ExpiredSessionsReleasedSchema, response);
      if (response.shard.length > MAX_DELIVERY_TRACKED_SHARDS)
        throw DeliveryRequestCodec.protocol();
      return Object.freeze(response.shard.map((value) => DeliveryShardCodec.decodeReleased(value)));
    } catch {
      throw new DeliveryOutcomeUnknownError("RELEASE_EXPIRED", "ALL_SHARDS");
    }
  }

  /**
   * Closes this client by permanently aborting active reads and streams. This synchronous, idempotent
   * method also aborts an owned HTTP/2 session, but never closes injected transport.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const controller of this.#activeReads)
      controller.abort(new Error("Delivery client is closed."));
    this.#onCloseOwnedTransport?.();
  }

  async #read<T>(
    options: DeliveryFindOneOptions,
    operation: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs ?? 30_000);
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await operation(controller.signal, timeoutMs);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (error instanceof ConnectError && error.code === Code.ResourceExhausted) throw error;
          if (!DeliveryClient.#isRetryableReadError(error)) throw DeliveryRequestCodec.protocol();
          if (attempt === this.#readRetries) throw error;
          await DeliveryClient.#pause(this.#retryBackoffMs, controller.signal);
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  async #mutation<T>(
    operation: DeliveryOutcomeUnknownError["operation"],
    reconciliation: readonly string[] | readonly ShardIndex[] | "ALL_SHARDS",
    options: DeliveryMutationOptions,
    invoke: (signal: AbortSignal | undefined, timeoutMs: number) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs ?? 30_000);
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    try {
      return await invoke(controller.signal, timeoutMs);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.InvalidArgument)
        throw DeliveryRequestCodec.protocol();
      throw new DeliveryOutcomeUnknownError(operation, reconciliation);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  static #pause(delay: number, signal: AbortSignal): Promise<void> {
    if (delay === 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("Delivery read aborted."),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
    });
  }

  static #isRetryableReadError(error: unknown): boolean {
    if (!(error instanceof ConnectError)) return true;
    return error.code === Code.Unavailable || error.code === Code.DeadlineExceeded;
  }
}

type RemoteShardProbe =
  | Readonly<{ readonly kind: "PICKED"; readonly session: RemoteShardSession }>
  | Readonly<{ readonly kind: "ALREADY_PICKED"; readonly session: RemoteShardSession }>;

const deliveryClientProbes = new WeakMap<
  DeliveryClient,
  (
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
  ) => Promise<RemoteShardProbe>
>();

const deliveryClientObservations = new WeakMap<
  DeliveryClient,
  (options: DeliveryFindOneOptions) => DeliveryShardObservationStream
>();

/**
 * Provides package-internal frozen-wire ownership probes without extending the public client API.
 */
export const deliveryClientAccess: Readonly<{
  probePickUp: (
    client: DeliveryClient,
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
  ) => Promise<RemoteShardProbe>;
  observeOnce: (
    client: DeliveryClient,
    options?: DeliveryFindOneOptions,
  ) => DeliveryShardObservationStream;
}> = Object.freeze({
  probePickUp(
    client: DeliveryClient,
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
  ): Promise<RemoteShardProbe> {
    const probe = deliveryClientProbes.get(client);
    if (probe === undefined) throw new TypeError("Delivery client probe access is unavailable.");
    return probe(shardIndex, workerId, options);
  },
  observeOnce(
    client: DeliveryClient,
    options: DeliveryFindOneOptions = {},
  ): DeliveryShardObservationStream {
    const observe = deliveryClientObservations.get(client);
    if (observe === undefined)
      throw new TypeError("Delivery client observation access is unavailable.");
    return observe(options);
  },
});
