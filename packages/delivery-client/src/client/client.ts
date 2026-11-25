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
import { Time } from "@spine-event-engine/core/time";
import {
  InboxService,
  AdminService,
  ShardService,
  ManagedShardService,
  GuardedInboxService,
  GuardedInboxRequestSchema,
  GuardedInboxResultSchema,
  type GuardedInboxResult,
  DeliveryShardPickupSchema,
  DeliveryShardPickupOutcomeSchema as PickupOutcomeSchema,
  type DeliveryShardPickupOutcome,
  DeliverySessionHandleSchema,
  type DeliverySessionHandle,
  ShardObservingService,
  PageOfMessagesSchema,
  ReadMessagesSinceTimeSchema as ReadSinceTimeSchema,
  OptionalInboxMessageSchema,
  ShardInfoListSchema,
  ExpiredSessionsReleasedSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  ReleaseExpiredSessionsSchema,
  WriteMessageSchema,
  WriteMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import { InboxMessageIdSchema, ShardIndexSchema } from "@spine-event-engine/proto/delivery";
import type { InboxMessage as WireInboxMessage } from "@spine-event-engine/proto/delivery";
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
  type DeliveryManagedPickupOutcome,
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
  DeliveryManagedPickupOutcome,
} from "./types.js";

/**
 * Provides a Node client for the frozen delivery-server gRPC API.
 */
export class DeliveryClient {
  readonly #inbox: ReturnType<typeof createClient<typeof InboxService>>;

  readonly #shards: ReturnType<typeof createClient<typeof ShardService>>;

  readonly #managed: ReturnType<typeof createClient<typeof ManagedShardService>>;

  readonly #guarded: ReturnType<typeof createClient<typeof GuardedInboxService>>;

  readonly #admin: ReturnType<typeof createClient<typeof AdminService>>;

  readonly #observing: ReturnType<typeof createClient<typeof ShardObservingService>>;

  readonly #pageSize: number;

  readonly #readRetries: number;

  readonly #retryBackoffMs: number;

  readonly #observationReconnects: number;

  readonly #observationReconnectBackoffMs: number;

  readonly #observationBufferSize: number;

  readonly #activeReads = new Set<AbortController>();

  readonly #onCloseOwnedTransport: (() => void) | undefined;

  #closed = false;

  /**
   * Creates a client with bounded delivery RPCs and a transport-close callback.
   * @param transport The Connect transport used for delivery RPCs.
   * @param options The validated page, retry, timeout, and observation settings.
   * @param onCloseOwnedTransport Closes the HTTP/2 transport created by this client, when present.
   */
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
    this.#managed = createClient(ManagedShardService, transport);
    this.#guarded = createClient(GuardedInboxService, transport);
    this.#admin = createClient(AdminService, transport);
    this.#observing = createClient(ShardObservingService, transport);
    this.#onCloseOwnedTransport = onCloseOwnedTransport;
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

  /**
   * Streams advisory free-shard notices from one server connection.
   *
   * An idle stream stays open without a first response. Reopening this method
   * starts a fresh server discovery scan. The caller controls reconnection.
   *
   * @param options Supplies cancellation for the stream lifetime.
   * @returns Validated shard indexes that a worker may try to pick up.
   */
  async *observeAvailableShards(
    options: Pick<DeliveryFindOneOptions, "signal"> = {},
  ): AsyncIterable<ShardIndex> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const controller = new AbortController();
    let active = true;
    const finish = () => {
      if (!active) return;
      active = false;
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    };
    const abort = () => {
      controller.abort(options.signal?.reason);
      finish();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", finish, { once: true });
    this.#activeReads.add(controller);
    try {
      for await (const notice of this.#observing.observeAll(
        create(EmptySchema),
        DeliveryRequestCodec.callOptions(controller.signal),
      )) {
        if (notice.shard === undefined) throw DeliveryRequestCodec.protocol();
        yield DeliveryShardCodec.decode(notice.shard);
      }
    } finally {
      controller.abort();
      finish();
    }
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
   * Reads one bounded page through the JVM InboxService timestamp query.
   * @param shardIndex Identifies the shard to read.
   * @param options Supplies the exclusive time bound, page size, and read bounds.
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
    const request = create(ReadSinceTimeSchema, {
      shard: DeliveryShardCodec.encode(shardIndex),
      pageSize: size,
      ...(sinceWhen === undefined ? {} : { sinceWhen }),
    });
    DeliveryRequestCodec.requestBytes(ReadSinceTimeSchema, request);
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
    const result = await this.#pickUp(shardIndex, workerId, options, "RAW");
    return result.kind === "PICKED" ? result.session : undefined;
  }

  /**
   * Acquires pending work or recovers the live managed session of the same worker.
   *
   * @param shardIndex Identifies the requested shard.
   * @param workerId Identifies one stable processing run.
   * @param options Bounds or cancels the mutation.
   * @returns The complete managed outcome, including the handle on success.
   */
  async pickUpForDelivery(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions = {},
  ): Promise<DeliveryManagedPickupOutcome> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs ?? 30_000);
    const deadline = Time.monotonicTime() + timeoutMs;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    const timer = setTimeout(() => {
      controller.abort(new Error("Managed pickup timed out."));
    }, timeoutMs);
    try {
      return await this.#recoverManagedPickup(shardIndex, workerId, options, deadline, controller);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  /**
   * Recovers one ambiguous managed pickup under its original deadline.
   *
   * @param shardIndex Identifies the unchanged requested shard.
   * @param workerId Identifies the unchanged worker run.
   * @param options Supplies caller operation settings.
   * @param deadline Ends the total operation in monotonic milliseconds.
   * @param controller Links caller, client closure, and deadline cancellation.
   * @returns A definitive pickup result.
   */
  async #recoverManagedPickup(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
    deadline: number,
    controller: AbortController,
  ): Promise<DeliveryManagedPickupOutcome> {
    let unknown: DeliveryOutcomeUnknownError | undefined;
    let ambiguousCount = 0;
    for (;;) {
      this.#checkPickupCancellation(controller, options.signal, unknown);
      const remaining = this.#pickupRemaining(deadline, shardIndex, unknown);
      const started = Time.monotonicTime();
      try {
        return await this.#attemptManaged(
          shardIndex,
          workerId,
          options,
          controller.signal,
          remaining,
        );
      } catch (error) {
        unknown = await this.#handleUnknownPickup(
          error,
          started,
          deadline,
          controller,
          options.signal,
          ++ambiguousCount,
        );
      }
    }
  }

  /**
   * Calculates remaining time or reports the last ambiguous pickup outcome.
   *
   * @param deadline Ends the total operation.
   * @param shardIndex Identifies the requested shard in an initial timeout.
   * @param unknown Supplies a previous ambiguous outcome, when present.
   * @returns Remaining monotonic milliseconds.
   */
  #pickupRemaining(
    deadline: number,
    shardIndex: ShardIndex,
    unknown: DeliveryOutcomeUnknownError | undefined,
  ): number {
    const remaining = deadline - Time.monotonicTime();
    if (remaining > 0) return remaining;
    throw unknown ?? new DeliveryOutcomeUnknownError("PICK_UP_FOR_DELIVERY", [shardIndex]);
  }

  /**
   * Repeats the same worker and shard with the time left from the first call.
   *
   * @param shardIndex Identifies the unchanged shard.
   * @param workerId Identifies the unchanged worker.
   * @param options Supplies the original call settings.
   * @param signal Cancels this attempt with the whole operation.
   * @param remaining Bounds this attempt within the original deadline.
   * @returns One definitive remote pickup result.
   */
  #attemptManaged(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
    signal: AbortSignal,
    remaining: number,
  ): Promise<DeliveryManagedPickupOutcome> {
    return this.#pickUp(
      shardIndex,
      workerId,
      {
        ...options,
        signal,
        timeoutMs: Math.max(1, Math.ceil(remaining)),
      },
      "MANAGED",
    );
  }

  /**
   * Paces one ambiguous pickup or reports its terminating cause.
   *
   * @param error Supplies the failed attempt's outcome.
   * @param started Marks when that attempt began.
   * @param deadline Ends the whole operation.
   * @param controller Tracks whole operation cancellation.
   * @param caller Tracks caller cancellation.
   * @param count Counts ambiguous attempts.
   * @returns The ambiguous outcome when recovery may continue.
   */
  async #handleUnknownPickup(
    error: unknown,
    started: number,
    deadline: number,
    controller: AbortController,
    caller: AbortSignal | undefined,
    count: number,
  ): Promise<DeliveryOutcomeUnknownError> {
    if (!(error instanceof DeliveryOutcomeUnknownError)) throw error;
    this.#checkPickupCancellation(controller, caller, error);
    const duration = Math.max(1, Math.ceil(Time.monotonicTime() - started));
    try {
      if (await this.#waitForPickupRecovery(deadline, controller.signal, count, duration))
        throw error;
    } catch (waitError) {
      this.#checkPickupCancellation(controller, caller, error);
      throw waitError;
    }
    return error;
  }

  /**
   * Waits between uncertain pickups without crossing the original deadline.
   *
   * @param deadline Ends the total pickup operation in monotonic milliseconds.
   * @param signal Cancels the wait when the operation stops.
   * @param ambiguousCount Counts consecutive uncertain attempts.
   * @param attemptDuration Measures the preceding attempt in milliseconds.
   * @returns Whether the deadline prevents another attempt.
   */
  async #waitForPickupRecovery(
    deadline: number,
    signal: AbortSignal,
    ambiguousCount: number,
    attemptDuration: number,
  ): Promise<boolean> {
    const remaining = Math.max(0, deadline - Time.monotonicTime());
    const base = Math.max(this.#retryBackoffMs, attemptDuration);
    const delay = ambiguousCount === 1 ? 0 : base * 2 ** (ambiguousCount - 2);
    const exhausted = delay >= remaining;
    await DeliveryClient.#pause(exhausted ? remaining : delay, signal);
    return exhausted;
  }

  /**
   * Reports the first cause that ended a managed pickup operation.
   *
   * @param controller Tracks the linked operation cancellation.
   * @param caller Tracks explicit caller cancellation.
   * @param unknown Supplies the last ambiguous remote outcome.
   */
  #checkPickupCancellation(
    controller: AbortController,
    caller: AbortSignal | undefined,
    unknown: DeliveryOutcomeUnknownError | undefined,
  ): void {
    if (!controller.signal.aborted) return;
    if (caller?.aborted) throw caller.reason;
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (unknown !== undefined) throw unknown;
    throw controller.signal.reason;
  }

  /**
   * Performs a typed raw or managed pickup.
   */
  async #pickUp(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions,
    kind: "RAW" | "MANAGED",
  ): Promise<DeliveryManagedPickupOutcome> {
    const request = create(DeliveryShardPickupSchema, {
      shard: DeliveryShardCodec.encode(shardIndex),
      worker: DeliveryShardCodec.encodeWorker(workerId),
    });
    DeliveryRequestCodec.requestBytes(DeliveryShardPickupSchema, request);
    const response = await this.#mutation<DeliveryShardPickupOutcome>(
      kind === "RAW" ? "PICK_UP_SHARD" : "PICK_UP_FOR_DELIVERY",
      [DeliveryShardCodec.snapshot(shardIndex)],
      options,
      (signal, timeoutMs) => {
        const call = DeliveryRequestCodec.callOptions(signal, timeoutMs);
        return kind === "RAW"
          ? this.#managed.pickShardRaw(request, call)
          : this.#managed.pickShardForDelivery(request, call);
      },
    );
    return this.#decodePickup(response, shardIndex, workerId);
  }

  /**
   * Decodes one definitive typed pickup outcome.
   *
   * @param response Supplies the wire outcome.
   * @param shardIndex Identifies the requested shard.
   * @param workerId Identifies the requesting worker.
   * @returns The detached pickup result.
   */
  #decodePickup(
    response: DeliveryShardPickupOutcome,
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
  ): DeliveryManagedPickupOutcome {
    DeliveryRequestCodec.responseBytes(PickupOutcomeSchema, response);
    const result = (response as Partial<DeliveryShardPickupOutcome>).result;
    if (result === undefined) throw DeliveryRequestCodec.protocol();
    switch (result.case) {
      case "pickedUp":
        return Object.freeze({
          kind: "PICKED" as const,
          session: DeliveryShardCodec.decodePicked(result.value, shardIndex, workerId),
        });
      case "busy":
        if (result.value.worker === undefined || result.value.whenPicked === undefined)
          throw DeliveryRequestCodec.protocol();
        return Object.freeze({
          kind: "BUSY" as const,
          worker: DeliveryShardCodec.decodeWorker(result.value.worker),
          whenPicked: DeliveryShardCodec.timestamp(result.value.whenPicked),
        });
      case "noWork":
        return Object.freeze({ kind: "NO_WORK" as const });
      default:
        throw DeliveryRequestCodec.protocol();
    }
  }

  /**
   * Updates only the live shard session identified by the supplied handle.
   *
   * @param value Supplies the complete session handle.
   * @param options Bounds or cancels the renewal.
   * @returns The refreshed handle with the same session identity.
   */
  async renew(
    value: RemoteShardSession,
    options: DeliveryMutationOptions = {},
  ): Promise<RemoteShardSession> {
    const request = this.#encodeSession(value);
    const response = await this.#mutation<DeliverySessionHandle>(
      "RENEW_SHARD",
      [DeliveryShardCodec.snapshot(value.shard)],
      options,
      (signal, timeoutMs) =>
        this.#managed.renewShardSession(
          request,
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        ),
    );
    DeliveryRequestCodec.responseBytes(DeliverySessionHandleSchema, response);
    const renewed = DeliveryShardCodec.decodePicked(response, value.shard, value.worker);
    if (renewed.sessionId !== value.sessionId) throw DeliveryRequestCodec.protocol();
    return renewed;
  }

  /**
   * Removes only the live shard session identified by the supplied handle.
   *
   * @param value Supplies the complete session handle.
   * @param options Bounds or cancels the release.
   * @returns Completion after the matching session is released.
   */
  async release(value: RemoteShardSession, options: DeliveryMutationOptions = {}): Promise<void> {
    const request = this.#encodeSession(value);
    await this.#mutation(
      "RELEASE_SHARD",
      [DeliveryShardCodec.snapshot(value.shard)],
      options,
      (signal, timeoutMs) =>
        this.#managed.releaseShardSession(
          request,
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        ),
    );
  }

  /**
   * Completes an exact original wire read row, including unknown fields, with
   * one guarded RPC under the current managed session. An unknown outcome
   * raises `DeliveryOutcomeUnknownError` with its full message ID.
   *
   * @param session Supplies the managed session handle.
   * @param expected Supplies the original wire row from a remote read.
   * @param options Bounds or cancels the guarded mutation.
   * @returns The stored completion, or `undefined` for a stale row.
   */
  async acknowledgeGuarded(
    session: RemoteShardSession,
    expected: WireInboxMessage,
    options: DeliveryMutationOptions = {},
  ): Promise<WireInboxMessage | undefined> {
    const result = await this.#guardedMutation(
      "ACKNOWLEDGE",
      session,
      expected,
      options,
      (request, call) => this.#guarded.acknowledge(request, call),
    );
    if (!result.matched) return undefined;
    if (result.message === undefined) throw DeliveryRequestCodec.protocol();
    DeliveryMessageCodec.validateAcknowledgement(expected, result.message);
    return DeliveryMessageCodec.copyWire(result.message);
  }

  /**
   * Removes an exact original pending wire read row, including unknown fields,
   * with one guarded RPC under the current managed session. An unknown outcome
   * raises `DeliveryOutcomeUnknownError` with its full message ID.
   *
   * @param session Supplies the managed session handle.
   * @param expected Supplies the original wire row.
   * @param options Bounds or cancels the guarded mutation.
   * @returns Whether the row matched or was already absent.
   */
  removeDuplicateGuarded(
    session: RemoteShardSession,
    expected: WireInboxMessage,
    options: DeliveryMutationOptions = {},
  ): Promise<boolean> {
    return this.#guardedMutation(
      "REMOVE_DUPLICATE_GUARDED",
      session,
      expected,
      options,
      (request, call) => this.#guarded.removePendingDuplicate(request, call),
    ).then((result) => result.matched);
  }

  /**
   * Removes an exact original delivered wire read row, including unknown fields,
   * with one guarded RPC under the current managed session. An unknown outcome
   * raises `DeliveryOutcomeUnknownError` with its full message ID.
   *
   * @param session Supplies the managed session handle.
   * @param expected Supplies the original wire row.
   * @param options Bounds or cancels the guarded mutation.
   * @returns Whether the row matched or was already absent.
   */
  removeDeliveredGuarded(
    session: RemoteShardSession,
    expected: WireInboxMessage,
    options: DeliveryMutationOptions = {},
  ): Promise<boolean> {
    return this.#guardedMutation(
      "REMOVE_DELIVERED_GUARDED",
      session,
      expected,
      options,
      (request, call) => this.#guarded.removeExpiredDelivered(request, call),
    ).then((result) => result.matched);
  }

  /**
   * Sends one row and session atomically to the guarded Inbox service.
   *
   * @param operation Names the mutation for uncertain-outcome reporting.
   * @param session Supplies the managed session handle.
   * @param expected Supplies the exact read row.
   * @param options Bounds or cancels the request.
   * @param invoke Calls the selected guarded method.
   * @returns The validated guarded result.
   */
  async #guardedMutation(
    operation: DeliveryOutcomeUnknownError["operation"],
    session: RemoteShardSession,
    expected: WireInboxMessage,
    options: DeliveryMutationOptions,
    invoke: (
      request: ReturnType<typeof create<typeof GuardedInboxRequestSchema>>,
      call: ReturnType<typeof DeliveryRequestCodec.callOptions>,
    ) => Promise<GuardedInboxResult>,
  ): Promise<GuardedInboxResult> {
    const request = create(GuardedInboxRequestSchema, {
      session: this.#encodeSession(session),
      expected: DeliveryMessageCodec.copyWire(expected),
    });
    DeliveryRequestCodec.requestBytes(GuardedInboxRequestSchema, request);
    const result = await this.#mutation(
      operation,
      [DeliveryMessageCodec.fullId(expected)],
      options,
      (signal, timeoutMs) => invoke(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
    DeliveryRequestCodec.responseBytes(GuardedInboxResultSchema, result);
    if (result.message !== undefined && (operation !== "ACKNOWLEDGE" || !result.matched))
      throw DeliveryRequestCodec.protocol();
    return result;
  }

  /**
   * Encodes and validates a complete session handle for a mutation.
   */
  #encodeSession(value: RemoteShardSession) {
    const candidate = value as Partial<RemoteShardSession>;
    if (
      typeof candidate.sessionId !== "string" ||
      !candidate.sessionId ||
      typeof candidate.whenPicked?.seconds !== "bigint" ||
      !Number.isInteger(candidate.whenPicked.nanos) ||
      typeof candidate.lifetime?.seconds !== "bigint" ||
      !Number.isInteger(candidate.lifetime.nanos)
    )
      throw new TypeError("Delivery shard session is invalid.");
    const request = create(DeliverySessionHandleSchema, {
      shard: DeliveryShardCodec.encode(value.shard),
      worker: DeliveryShardCodec.encodeWorker(value.worker),
      sessionId: value.sessionId,
      whenPicked: DeliveryShardCodec.timestamp(value.whenPicked),
      lifetime: value.lifetime,
    });
    if (!request.sessionId || request.lifetime === undefined)
      throw new TypeError("Delivery shard session is invalid.");
    DeliveryRequestCodec.requestBytes(DeliverySessionHandleSchema, request);
    return request;
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

  /**
   * Runs a bounded read with configured retries and linked cancellation.
   * @typeParam T The read response type returned by the supplied operation.
   * @param options The timeout and cancellation settings for this read.
   * @param operation The read RPC to invoke on each permitted attempt.
   * @returns The accepted read response.
   */
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

  /**
   * Runs one mutation attempt and reports uncertain remote outcomes for reconciliation.
   * @typeParam T The mutation RPC response type.
   * @param operation The mutation named in an uncertain-outcome error.
   * @param reconciliation Identifiers needed to inspect the remote result.
   * @param options The timeout and cancellation settings for this mutation.
   * @param invoke The single remote RPC attempt.
   * @returns The mutation response when its outcome is known.
   */
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
      if (error instanceof ConnectError) {
        if (
          error.code === Code.InvalidArgument ||
          error.code === Code.Unauthenticated ||
          error.code === Code.PermissionDenied ||
          error.code === Code.Unimplemented ||
          error.code === Code.FailedPrecondition
        )
          throw new ConnectError("Delivery server rejected the request.", error.code);
      }
      throw new DeliveryOutcomeUnknownError(operation, reconciliation);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  static #pause(delay: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted)
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error("Delivery read aborted."),
      );
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      const abort = () => {
        clearTimeout(timer);
        reject(
          signal?.reason instanceof Error ? signal.reason : new Error("Delivery read aborted."),
        );
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  static #isRetryableReadError(error: unknown): boolean {
    if (!(error instanceof ConnectError)) return true;
    return error.code === Code.Unavailable || error.code === Code.DeadlineExceeded;
  }
}

const deliveryClientObservations = new WeakMap<
  DeliveryClient,
  (options: DeliveryFindOneOptions) => DeliveryShardObservationStream
>();

/**
 * Provides package-internal Admin observations without extending the public client API.
 */
export const deliveryClientAccess: Readonly<{
  observeOnce: (
    client: DeliveryClient,
    options?: DeliveryFindOneOptions,
  ) => DeliveryShardObservationStream;
}> = Object.freeze({
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
