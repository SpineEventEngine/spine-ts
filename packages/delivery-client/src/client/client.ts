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
import { DeliveryTimers } from "./delivery-timers.js";
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
  InboxWorkRequestSchema,
  type InboxWorkResult,
  DeliveryShardPickupSchema,
  type DeliveryShardPickup,
  type DeliveryShardPickupOutcome,
  DeliverySessionHandleSchema,
  type DeliverySessionHandle,
  ShardObservingService,
  ReadMessagesSinceTimeSchema as ReadSinceTimeSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  ReleaseExpiredSessionsSchema,
  WriteMessageSchema,
  WriteMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import { InboxMessageIdSchema } from "@spine-event-engine/proto/delivery";
import {
  DeliveryOutcomeUnknownError,
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
 * Captures the shard and worker used to validate every reply to this pickup.
 */
interface PreparedPickup {
  /**
   * The detached request reused on retry.
   */
  readonly request: DeliveryShardPickup;

  /**
   * The requested shard.
   */
  readonly shard: ShardIndex;

  /**
   * The worker identity sent in the request.
   */
  readonly worker: DeliveryWorkerId;
}

/**
 * Connects Node applications to the Delivery server's inbox, shard, and work observation services.
 */
export class DeliveryClient {
  readonly #inbox: ReturnType<typeof createClient<typeof InboxService>>;

  readonly #shards: ReturnType<typeof createClient<typeof ShardService>>;

  readonly #managed: ReturnType<typeof createClient<typeof ManagedShardService>>;

  readonly #admin: ReturnType<typeof createClient<typeof AdminService>>;

  readonly #observing: ReturnType<typeof createClient<typeof ShardObservingService>>;

  readonly #pageSize: number;

  readonly #readRetries: number;

  readonly #retryBackoffMs: number;

  readonly #observationReconnects: number;

  readonly #observationReconnectBackoffMs: number;

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
    this.#inbox = createClient(InboxService, transport);
    this.#shards = createClient(ShardService, transport);
    this.#managed = createClient(ManagedShardService, transport);
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
   * Opens an HTTP/2 gRPC connection to a Delivery server.
   * Managed sessions and work notifications use services provided by the TS server.
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
        ...(normalized.maxInboundMessageBytes === undefined
          ? {}
          : { readMaxBytes: normalized.maxInboundMessageBytes }),
        ...(normalized.maxOutboundMessageBytes === undefined
          ? {}
          : { writeMaxBytes: normalized.maxOutboundMessageBytes }),
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

    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#admin.getShardInfo(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );

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
    const setupTimeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs);
    const controller = new AbortController();
    const callerAbort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", callerAbort, { once: true });
    this.#activeReads.add(controller);
    return new ShardObservationStream({
      signal: controller.signal,
      setupTimeoutMs,
      reconnects,
      reconnectBackoffMs: this.#observationReconnectBackoffMs,
      open: (signal) => this.#admin.subscribeToShardUpdates(create(EmptySchema), { signal }),
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

    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findOne(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );

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

    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findManyInShard(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );

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

    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.newestMessageToDeliver(
        request,
        DeliveryRequestCodec.callOptions(signal, timeoutMs),
      ),
    );

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
    const result = await this.#pickUp(this.#preparePickup(shardIndex, workerId), options, "RAW");
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
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs);
    const deadline = timeoutMs === undefined ? Infinity : Time.monotonicTime() + timeoutMs;
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    const cancelTimer = DeliveryTimers.after(() => {
      controller.abort(new Error("Managed pickup timed out."));
    }, timeoutMs);
    try {
      return await this.#recoverManagedPickup(
        this.#preparePickup(shardIndex, workerId),
        options,
        deadline,
        controller,
      );
    } finally {
      cancelTimer?.();
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  /**
   * Recovers one ambiguous managed pickup under its original deadline.
   *
   * @param pickup Holds the validated request and its original identity.
   * @param options Supplies caller operation settings.
   * @param deadline Ends the total operation in monotonic milliseconds.
   * @param controller Links caller, client closure, and deadline cancellation.
   * @returns A definitive pickup result.
   */
  async #recoverManagedPickup(
    pickup: PreparedPickup,
    options: DeliveryMutationOptions,
    deadline: number,
    controller: AbortController,
  ): Promise<DeliveryManagedPickupOutcome> {
    let unknown: DeliveryOutcomeUnknownError | undefined;
    let ambiguousCount = 0;
    for (;;) {
      this.#checkPickupCancellation(controller, options.signal, unknown);
      const remaining = this.#pickupRemaining(deadline, pickup.shard, unknown);
      const started = Time.monotonicTime();
      try {
        const result = await this.#attemptManaged(pickup, options, controller.signal, remaining);
        if (result.kind === "PICKED") pickupSendTimes.set(result.session, started);
        return result;
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
   * @param pickup Holds the validated request and its original identity.
   * @param options Supplies the original call settings.
   * @param signal Cancels this attempt with the whole operation.
   * @param remaining Bounds this attempt within the original deadline.
   * @returns One definitive remote pickup result.
   */
  #attemptManaged(
    pickup: PreparedPickup,
    options: DeliveryMutationOptions,
    signal: AbortSignal,
    remaining: number,
  ): Promise<DeliveryManagedPickupOutcome> {
    return this.#pickUp(
      pickup,
      {
        ...options,
        signal,
        ...(Number.isFinite(remaining) ? { timeoutMs: Math.max(1, Math.ceil(remaining)) } : {}),
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
    if (error.cause instanceof ConnectError && error.cause.code === Code.ResourceExhausted)
      throw error;
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
    const delay =
      ambiguousCount === 1
        ? 0
        : Math.min(Number.MAX_SAFE_INTEGER, base * 2 ** (ambiguousCount - 2));
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
   * Creates a detached request before any pickup RPC can run.
   *
   * @param shardIndex Identifies the shard to acquire.
   * @param workerId Identifies this processing run.
   * @returns The wire request and the identity to expect in the reply.
   */
  #preparePickup(shardIndex: ShardIndex, workerId: DeliveryWorkerId): PreparedPickup {
    const shard = DeliveryShardCodec.encode(shardIndex);
    const worker = DeliveryShardCodec.encodeWorker(workerId);
    const request = create(DeliveryShardPickupSchema, { shard, worker });

    return {
      request,
      shard: DeliveryShardCodec.decode(shard),
      worker: DeliveryShardCodec.decodeWorker(worker),
    };
  }

  /**
   * Performs a typed raw or managed pickup.
   */
  async #pickUp(
    pickup: PreparedPickup,
    options: DeliveryMutationOptions,
    kind: "RAW" | "MANAGED",
  ): Promise<DeliveryManagedPickupOutcome> {
    const response = await this.#mutation<DeliveryShardPickupOutcome>(
      kind === "RAW" ? "PICK_UP_SHARD" : "PICK_UP_FOR_DELIVERY",
      [DeliveryShardCodec.snapshot(pickup.shard)],
      options,
      (signal, timeoutMs) => {
        const call = DeliveryRequestCodec.callOptions(signal, timeoutMs);
        return kind === "RAW"
          ? this.#managed.pickShardRaw(pickup.request, call)
          : this.#managed.pickShardForDelivery(pickup.request, call);
      },
    );
    return this.#decodePickup(response, pickup.shard, pickup.worker);
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
   * Marks the current inbox message at the given ID delivered under a managed session.
   *
   * @param session Supplies the managed session handle.
   * @param id Identifies the inbox message from the current page.
   * @param options Bounds or cancels the mutation.
   * @returns Whether the ID was marked delivered and its first retention deadline when present.
   */
  async markDelivered(
    session: RemoteShardSession,
    id: InboxMessageId,
    options: DeliveryMutationOptions = {},
  ): Promise<InboxWorkResult> {
    const result = await this.#workMutation("ACKNOWLEDGE", session, id, options, (request, call) =>
      this.#managed.markDelivered(request, call),
    );
    if (result.whenKeepUntil !== undefined) DeliveryShardCodec.timestamp(result.whenKeepUntil);
    return result;
  }

  /**
   * Removes the current pending inbox message at the given ID.
   *
   * @param session Supplies the managed session handle.
   * @param id Identifies the inbox message from the current page.
   * @param options Bounds or cancels the mutation.
   * @returns Whether the session-checked removal completed.
   */
  async removeDuplicate(
    session: RemoteShardSession,
    id: InboxMessageId,
    options: DeliveryMutationOptions = {},
  ): Promise<boolean> {
    const result = await this.#workMutation(
      "REMOVE_DUPLICATE",
      session,
      id,
      options,
      (request, call) => this.#managed.removeDuplicate(request, call),
    );
    return result.matched;
  }

  /**
   * Removes expired delivered inbox messages in the managed session's shard.
   *
   * @param session Supplies the managed session handle.
   * @param options Bounds or cancels the mutation.
   * @returns Completion after the server applies one shard predicate.
   */
  async removeExpiredDelivered(
    session: RemoteShardSession,
    options: DeliveryMutationOptions = {},
  ): Promise<void> {
    await this.#mutation(
      "REMOVE_EXPIRED_DELIVERED",
      [DeliveryShardCodec.snapshot(session.shard)],
      options,
      (signal, timeoutMs) =>
        this.#managed.removeExpiredDelivered(
          this.#encodeSession(session),
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        ),
    );
  }

  /**
   * Sends one complete inbox ID with the live managed session.
   *
   * @param operation Names the mutation for uncertain-outcome reporting.
   * @param session Supplies the managed session handle.
   * @param id Identifies the current inbox message.
   * @param options Bounds or cancels the request.
   * @param invoke Calls the selected managed method.
   * @returns The server's mutation result.
   */
  async #workMutation(
    operation: DeliveryOutcomeUnknownError["operation"],
    session: RemoteShardSession,
    id: InboxMessageId,
    options: DeliveryMutationOptions,
    invoke: (
      request: ReturnType<typeof create<typeof InboxWorkRequestSchema>>,
      call: ReturnType<typeof DeliveryRequestCodec.callOptions>,
    ) => Promise<InboxWorkResult>,
  ): Promise<InboxWorkResult> {
    const request = create(InboxWorkRequestSchema, {
      session: this.#encodeSession(session),
      id: create(InboxMessageIdSchema, {
        uuid: DeliveryMessageCodec.encodeId(id),
        index: DeliveryShardCodec.encode(id.shard),
      }),
    });
    const result = await this.#mutation(
      operation,
      [`${String(id.shard.index)}/${String(id.shard.ofTotal)}:${id.value}`],
      options,
      (signal, timeoutMs) => invoke(request, DeliveryRequestCodec.callOptions(signal, timeoutMs)),
    );
    if (result.whenKeepUntil !== undefined && (operation !== "ACKNOWLEDGE" || !result.matched))
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

        return this.#shards.releaseSessions(
          request,
          DeliveryRequestCodec.callOptions(signal, timeoutMs),
        );
      },
    );
    try {
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
    operation: (signal: AbortSignal, timeoutMs: number | undefined) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs);
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    const cancelTimer = DeliveryTimers.after(() => {
      controller.abort(new ConnectError("Delivery read timed out.", Code.DeadlineExceeded));
    }, timeoutMs);
    try {
      return await this.#retryRead(controller.signal, timeoutMs, operation);
    } finally {
      cancelTimer?.();
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  /**
   * Retries a read within the caller's original deadline.
   *
   * @typeParam T The RPC response.
   * @param signal Ends both a pending attempt and a retry delay.
   * @param timeoutMs Supplies the caller's total read time, when specified.
   * @param operation Reads once with the time left for this attempt.
   * @returns The response from the successful attempt.
   */
  async #retryRead<T>(
    signal: AbortSignal,
    timeoutMs: number | undefined,
    operation: (signal: AbortSignal, timeoutMs: number | undefined) => Promise<T>,
  ): Promise<T> {
    const deadline = timeoutMs === undefined ? Infinity : Time.monotonicTime() + timeoutMs;
    let remaining = timeoutMs;
    for (let attempt = 0; ; attempt++) {
      try {
        signal.throwIfAborted();
        return await operation(signal, remaining);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof ConnectError && error.code === Code.ResourceExhausted) throw error;
        if (!DeliveryClient.#isRetryableReadError(error)) throw DeliveryRequestCodec.protocol();
        if (attempt === this.#readRetries) throw error;
        await DeliveryClient.#pause(this.#retryBackoffMs, signal);
        if (Number.isFinite(deadline)) {
          remaining = Math.ceil(deadline - Time.monotonicTime());
          if (remaining <= 0)
            throw new ConnectError("Delivery read timed out.", Code.DeadlineExceeded);
        }
      }
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
    invoke: (signal: AbortSignal | undefined, timeoutMs: number | undefined) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw new Error("Delivery client is closed.");
    if (options.signal?.aborted) throw options.signal.reason;
    const timeoutMs = DeliveryRequestCodec.timeout(options.timeoutMs);
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    const cancelTimer = DeliveryTimers.after(() => {
      controller.abort(new ConnectError("Delivery mutation timed out.", Code.DeadlineExceeded));
    }, timeoutMs);
    try {
      return await invoke(controller.signal, timeoutMs);
    } catch (error) {
      throw DeliveryClient.#mutationFailure(operation, reconciliation, error);
    } finally {
      cancelTimer?.();
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }

  /**
   * Preserves an uncertain write outcome while exposing safe transport diagnostics.
   *
   * @param operation Names the mutation.
   * @param reconciliation Identifies the row or shard the caller can inspect.
   * @param error Supplies the transport failure.
   * @returns The error to report to the caller.
   */
  static #mutationFailure(
    operation: DeliveryOutcomeUnknownError["operation"],
    reconciliation: readonly string[] | readonly ShardIndex[] | "ALL_SHARDS",
    error: unknown,
  ): Error {
    if (error instanceof ConnectError) {
      if (
        [
          Code.InvalidArgument,
          Code.Unauthenticated,
          Code.PermissionDenied,
          Code.Unimplemented,
          Code.FailedPrecondition,
        ].includes(error.code)
      )
        return new ConnectError("Delivery server rejected the request.", error.code);
      if (error.code === Code.ResourceExhausted)
        return new DeliveryOutcomeUnknownError(operation, reconciliation, {
          cause: new ConnectError("Delivery transport resource exhausted.", error.code),
        });
    }
    return new DeliveryOutcomeUnknownError(operation, reconciliation);
  }

  static #pause(delay: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted)
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error("Delivery read aborted."),
      );
    return new Promise<void>((resolve, reject) => {
      const cancelTimer = DeliveryTimers.after(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, delay);
      const abort = () => {
        cancelTimer?.();
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

const pickupSendTimes = new WeakMap<RemoteShardSession, number>();

/**
 * Provides package-internal Admin observations without extending the public client API.
 */
export const deliveryClientAccess: Readonly<{
  observeOnce: (
    client: DeliveryClient,
    options?: DeliveryFindOneOptions,
  ) => DeliveryShardObservationStream;

  /**
   * Returns the successful attempt's local send time for a managed grant.
   */
  pickupSentAt: (session: RemoteShardSession) => number;
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

  /**
   * Reads the successful attempt's local send time for a managed grant.
   *
   * @param session Supplies the granted session.
   * @returns Its local send time.
   */
  pickupSentAt(session) {
    const sentAt = pickupSendTimes.get(session);
    if (sentAt === undefined) throw new TypeError("Delivery client pickup time is unavailable.");
    return sentAt;
  },
});
