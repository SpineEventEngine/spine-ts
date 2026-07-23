import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Transport } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";

import type { InboxMessage, InboxMessageId } from "@spine-ts/server";
import { ShardIndex } from "@spine-ts/server";
import {
  InboxService,
  AdminService,
  ShardService,
  PageOfMessagesSchema,
  OptionalInboxMessageSchema,
  ShardInfoListSchema,
  LiquorPickUpOutcomeSchema,
  ExpiredSessionsReleasedSchema,
  PickUpShardSchema,
  ReadMessagesSinceTimeSchema,
  RemoveMessageSchema,
  RemoveMessagesSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  WriteMessageSchema,
  WriteMessagesSchema,
} from "@spine-ts/proto/delivery-server";
import { InboxMessageIdSchema, ShardIndexSchema } from "@spine-ts/proto/delivery";
import {
  DeliveryOutcomeUnknownError,
  MAX_DELIVERY_RPC_BYTES,
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
import {
  backoff,
  bounded,
  callOptions,
  decodeInboxMessage,
  decodePickedUpSession,
  decodeReleasedSession,
  decodeShardObservation,
  decodeShardUpdate,
  encodeDuration,
  encodeInboxBatch,
  encodeInboxMessage,
  encodeMessageId,
  encodeShard,
  encodeTimestamp,
  encodeWorker,
  normalizeOptions,
  pageSize,
  protocol,
  requestBytes,
  responseBytes,
  retries,
  snapshotShard,
  timeout,
  validBaseUrl,
  validateAlreadyPickedUp,
} from "../wire/codec.js";

export {
  DeliveryOutcomeUnknownError,
  DeliveryPagingError,
  DeliveryProtocolError,
  DeliveryQuarantineError,
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
  RemovalQuarantine,
  RemovalQuarantineRecord,
} from "./types.js";

/** Node delivery-server client over a caller-owned Connect transport. */
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
    this.#pageSize = pageSize(options.pageSize ?? 100);
    this.#readRetries = retries(options.readRetries ?? 0);
    this.#retryBackoffMs = backoff(options.retryBackoffMs ?? 0);
    this.#observationReconnects = retries(options.observationReconnects ?? 0);
    this.#observationReconnectBackoffMs = backoff(options.observationReconnectBackoffMs ?? 0);
    this.#observationBufferSize = bounded(
      options.observationBufferSize ?? 100,
      1,
      1_000,
      "Delivery observation buffer size",
    );
    this.#inbox = createClient(InboxService, transport);
    this.#shards = createClient(ShardService, transport);
    this.#admin = createClient(AdminService, transport);
    this.#onCloseOwnedTransport = onCloseOwnedTransport;
  }

  /** The bounded page size configured for this client. */
  get pageSize(): number {
    return this.#pageSize;
  }

  /** Create a client over a caller-owned standard Connect transport. */
  static usingTransport(transport: Transport, options: DeliveryClientOptions = {}): DeliveryClient {
    return new DeliveryClient(transport, options);
  }

  /**
   * Connect to a JVM delivery server with a client-owned HTTP/2 gRPC session.
   *
   * The URL and options are validated before opening the session. `close()` is
   * synchronous: it aborts active calls and the owned session immediately; it
   * does not wait for remote stream cleanup. Use {@link usingTransport} when
   * the caller owns the transport lifecycle.
   */
  static connectTo(baseUrl: string, options: DeliveryClientOptions = {}): DeliveryClient {
    const normalized = normalizeOptions(options);
    validBaseUrl(baseUrl);
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

  /** Read validated detached Admin observations; callers may mutate returned values safely. */
  async shardSnapshot(
    options: DeliveryFindOneOptions = {},
  ): Promise<readonly RemoteShardObservation[]> {
    const request = create(EmptySchema);
    requestBytes(EmptySchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#admin.getShardInfo(request, callOptions(signal, timeoutMs)),
    );
    responseBytes(ShardInfoListSchema, response);
    if (response.shards.length > 1_000) throw protocol();
    return Object.freeze(response.shards.map(decodeShardObservation));
  }

  /** Start an ACK-gated bounded Admin shard-update observation stream. */
  observeShardUpdates(options: DeliveryFindOneOptions = {}): DeliveryShardObservationStream {
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
      timeoutMs: timeout(options.timeoutMs ?? 30_000),
      capacity: this.#observationBufferSize,
      reconnects: this.#observationReconnects,
      reconnectBackoffMs: this.#observationReconnectBackoffMs,
      open: (signal, timeoutMs) =>
        this.#admin.subscribeToShardUpdates(create(EmptySchema), callOptions(signal, timeoutMs)),
      acknowledge: (frame) => frame.value.case === "created" && frame.value.value,
      decodeUpdate: (frame) => {
        if (frame.value.case !== "update") throw protocol();
        return decodeShardUpdate(frame.value.value);
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

  /** Find and decode one inbox message, or `undefined` when it is absent. */
  async findOne(
    id: InboxMessageId,
    options: DeliveryFindOneOptions = {},
  ): Promise<InboxMessage | undefined> {
    const request = create(InboxMessageIdSchema, {
      uuid: encodeMessageId(id),
      index: encodeShard(id.shard),
    });
    requestBytes(InboxMessageIdSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findOne(request, { timeoutMs, signal }),
    );
    responseBytes(OptionalInboxMessageSchema, response);
    return response.message === undefined
      ? undefined
      : decodeInboxMessage(response.message, id.shard);
  }

  /** Read and decode the first bounded ordered page for one shard. */
  async readPage(
    shardIndex: ShardIndex,
    options: DeliveryReadPageOptions = {},
  ): Promise<readonly InboxMessage[]> {
    const size = options.pageSize === undefined ? this.#pageSize : pageSize(options.pageSize);
    const sinceWhen =
      options.sinceWhen === undefined ? undefined : encodeTimestamp(options.sinceWhen);
    const request = create(ReadMessagesSinceTimeSchema, {
      shard: encodeShard(shardIndex),
      pageSize: size,
      ...(sinceWhen === undefined ? {} : { sinceWhen }),
    });
    requestBytes(ReadMessagesSinceTimeSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.findManyInShard(request, { timeoutMs, signal }),
    );
    responseBytes(PageOfMessagesSchema, response);
    if (response.message.length > size) throw protocol();
    return Object.freeze(
      response.message.map((message) => decodeInboxMessage(message, shardIndex)),
    );
  }

  /** Find and decode the newest pending message in a shard, if one exists. */
  async newestPending(
    shardIndex: ShardIndex,
    options: DeliveryFindOneOptions = {},
  ): Promise<InboxMessage | undefined> {
    const request = encodeShard(shardIndex);
    requestBytes(ShardIndexSchema, request);
    const response = await this.#read(options, (signal, timeoutMs) =>
      this.#inbox.newestMessageToDeliver(request, { timeoutMs, signal }),
    );
    responseBytes(OptionalInboxMessageSchema, response);
    return response.message === undefined
      ? undefined
      : decodeInboxMessage(response.message, shardIndex);
  }

  /** Write one message with exactly one delivery-server RPC attempt. */
  async writeOne(message: InboxMessage, options: DeliveryMutationOptions = {}): Promise<void> {
    const wire = encodeInboxMessage(message);
    const request = create(WriteMessageSchema, { message: wire });
    requestBytes(WriteMessageSchema, request);
    await this.#mutation("WRITE_ONE", [message.id.value], options, (signal, timeoutMs) =>
      this.#inbox.writeOne(request, callOptions(signal, timeoutMs)),
    );
  }

  /** Remove one message with exactly one delivery-server RPC attempt. */
  async removeOne(message: InboxMessage, options: DeliveryMutationOptions = {}): Promise<void> {
    const wire = encodeInboxMessage(message);
    const request = create(RemoveMessageSchema, { message: wire });
    requestBytes(RemoveMessageSchema, request);
    await this.#mutation("REMOVE_ONE", [message.id.value], options, (signal, timeoutMs) =>
      this.#inbox.removeOne(request, callOptions(signal, timeoutMs)),
    );
  }

  /** Write one bounded same-shard batch with exactly one delivery-server RPC attempt. */
  async writeMany(
    messages: readonly InboxMessage[],
    options: DeliveryMutationOptions = {},
  ): Promise<void> {
    const batch = encodeInboxBatch(messages);
    const request = create(WriteMessagesSchema, { shard: batch.shard, message: batch.messages });
    requestBytes(WriteMessagesSchema, request);
    await this.#mutation("WRITE_MANY", batch.ids, options, (signal, timeoutMs) =>
      this.#inbox.writeMany(request, callOptions(signal, timeoutMs)),
    );
  }

  /** Remove one bounded same-shard batch with exactly one delivery-server RPC attempt. */
  async removeMany(
    messages: readonly InboxMessage[],
    options: DeliveryMutationOptions = {},
  ): Promise<void> {
    const batch = encodeInboxBatch(messages);
    const request = create(RemoveMessagesSchema, { shard: batch.shard, message: batch.messages });
    requestBytes(RemoveMessagesSchema, request);
    await this.#mutation("REMOVE_MANY", batch.ids, options, (signal, timeoutMs) =>
      this.#inbox.removeMany(request, callOptions(signal, timeoutMs)),
    );
  }

  /** Pick up a shard once, returning a detached exclusive session safe for caller mutation. */
  async pickUp(
    shardIndex: ShardIndex,
    workerId: DeliveryWorkerId,
    options: DeliveryMutationOptions = {},
  ): Promise<RemoteShardSession | undefined> {
    const requestedShard = encodeShard(shardIndex);
    const requestedWorker = encodeWorker(workerId);
    const response = await this.#mutation(
      "PICK_UP_SHARD",
      [snapshotShard(shardIndex)],
      options,
      (signal, timeoutMs) => {
        const request = create(PickUpShardSchema, {
          shard: requestedShard,
          worker: requestedWorker,
        });
        requestBytes(PickUpShardSchema, request);
        return this.#shards.pickShard(request, callOptions(signal, timeoutMs));
      },
    );
    responseBytes(LiquorPickUpOutcomeSchema, response);
    if (response.value.case === "alreadyPickedUp") {
      validateAlreadyPickedUp(response.value.value, shardIndex);
      return undefined;
    }
    if (response.value.case !== "pickedUp") throw protocol();
    return decodePickedUpSession(response.value.value, shardIndex, workerId);
  }

  /** Release an exclusive shard session once. */
  async release(value: RemoteShardSession, options: DeliveryMutationOptions = {}): Promise<void> {
    const sessionShard = encodeShard(value.shard);
    const sessionWorker = encodeWorker(value.worker);
    if (!(value.whenPicked instanceof Date) || Number.isNaN(value.whenPicked.getTime()))
      throw new TypeError("Delivery shard session is invalid.");
    await this.#mutation(
      "RELEASE_SHARD",
      [snapshotShard(value.shard)],
      options,
      (signal, timeoutMs) => {
        const request = create(ReleaseShardSchema, { shard: sessionShard, worker: sessionWorker });
        requestBytes(ReleaseShardSchema, request);
        return this.#shards.releaseSession(request, callOptions(signal, timeoutMs));
      },
    );
  }

  /** Release and observe all sessions inactive for the supplied positive duration in milliseconds. */
  async releaseExpired(
    inactivityMs: number,
    options: DeliveryMutationOptions = {},
  ): Promise<readonly ReleasedShardSession[]> {
    const inactivityPeriod = encodeDuration(inactivityMs);
    const response = await this.#mutation(
      "RELEASE_EXPIRED",
      "ALL_SHARDS",
      options,
      (signal, timeoutMs) => {
        const request = create(ReleaseExpiredSessionsSchema, { inactivityPeriod });
        requestBytes(ReleaseExpiredSessionsSchema, request);
        return this.#shards.releaseSessions(request, callOptions(signal, timeoutMs));
      },
    );
    responseBytes(ExpiredSessionsReleasedSchema, response);
    if (response.shard.length > 100) throw protocol();
    return Object.freeze(response.shard.map(decodeReleasedSession));
  }

  /**
   * Permanently abort active reads and streams. This synchronous, idempotent
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
    const timeoutMs = timeout(options.timeoutMs ?? 30_000);
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
          if (!retryableReadError(error)) throw protocol();
          if (attempt === this.#readRetries) throw error;
          await pause(this.#retryBackoffMs, controller.signal);
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
    const timeoutMs = timeout(options.timeoutMs ?? 30_000);
    const controller = new AbortController();
    const abort = () => {
      controller.abort(options.signal?.reason);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    this.#activeReads.add(controller);
    try {
      return await invoke(controller.signal, timeoutMs);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.InvalidArgument) throw protocol();
      throw new DeliveryOutcomeUnknownError(operation, reconciliation);
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.#activeReads.delete(controller);
    }
  }
}

function pause(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Delivery read aborted."));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function retryableReadError(error: unknown): boolean {
  if (!(error instanceof ConnectError)) return true;
  return error.code === Code.Unavailable || error.code === Code.DeadlineExceeded;
}
