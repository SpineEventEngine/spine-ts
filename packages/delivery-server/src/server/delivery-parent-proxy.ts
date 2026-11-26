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

import { create, toBinary } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  type HandlerContext,
  type ServiceImpl,
} from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { Time } from "@spine-event-engine/core/time";
import {
  AdminService,
  ExpiredSessionsReleasedSchema,
  GuardedInboxService,
  InboxService,
  ManagedShardService,
  ShardService,
  ShardInfoListSchema,
  ShardObservingService,
  SubscriptionResponseSchema,
  type ExpiredSessionsReleased,
  type ShardInfoList,
  type SubscriptionResponse,
} from "@spine-event-engine/proto/delivery-server";
import { DeliveryShards } from "../core/wire-values.js";
import type { InboxMessage, ShardIndex } from "@spine-event-engine/proto/delivery";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";

import { InboxMessages, InboxShards } from "../core/inbox-service.js";
import { DeliverySessionInputs } from "../core/shard-service.js";
import { MAX_DELIVERY_RESPONSE_SHARDS, MAX_DELIVERY_RPC_BYTES } from "../core/limits.js";
import type { CapacityTicket } from "./capacity-ledger.js";
import { DeliveryChildPool, type DeliveryChildEndpoint } from "./delivery-child-pool.js";
import { DeliveryStreamFanIn } from "./delivery-stream-fan-in.js";

/**
 * Connect transport configured for one private child generation.
 */
type ChildTransport = ReturnType<typeof createGrpcTransport>;

/**
 * HTTP/2 resources retained for one ready private child generation.
 */
interface ChildConnection {
  /**
   * Child identity fenced by generation before use.
   */
  readonly endpoint: DeliveryChildEndpoint;

  /**
   * Tracks active HTTP/2 sessions for prompt terminal shutdown.
   */
  readonly sessions: Http2SessionManager;

  /**
   * Dispatches typed private calls to that child.
   */
  readonly transport: ChildTransport;
}

/**
 * Routes public Delivery RPCs to fixed private child slots.
 */
export class DeliveryParentProxy {
  readonly #connections = new Map<number, ChildConnection>();

  readonly #closed = new AbortController();

  /**
   * Creates public service handlers over a started fixed child pool.
   *
   * @param pool Supplies ready private endpoints and global capacity accounting.
   */
  constructor(private readonly pool: DeliveryChildPool) {}

  /**
   * Stops private transports and background barrier retries.
   */
  close(): void {
    this.#closed.abort();
    for (const connection of this.#connections.values()) connection.sessions.abort();
    this.#connections.clear();
  }

  /**
   * Creates the shard-routed public Inbox service.
   *
   * @returns Validated read and mutation handlers.
   */
  inbox(): ServiceImpl<typeof InboxService> {
    return { ...this.#inboxWrites(), ...this.#inboxRemovals(), ...this.#inboxReads() };
  }

  /**
   * Routes Inbox writes after validating full shard identities.
   */
  #inboxWrites(): Pick<ServiceImpl<typeof InboxService>, "writeOne" | "writeMany"> {
    return {
      writeOne: (request, context) => {
        const row = InboxMessages.required(request.message).message;
        return this.#mutate(this.#slot(row.id?.index), context.signal, (transport, headers) =>
          createClient(InboxService, transport).writeOne(request, this.#forward(context, headers)),
        );
      },
      writeMany: (request, context) => {
        const shard = this.#batchShard(request);
        return this.#mutate(this.#slot(shard), context.signal, (transport, headers) =>
          createClient(InboxService, transport).writeMany(request, this.#forward(context, headers)),
        );
      },
    };
  }

  /**
   * Routes Inbox removals after validating full shard identities.
   */
  #inboxRemovals(): Pick<ServiceImpl<typeof InboxService>, "removeOne" | "removeMany"> {
    return {
      removeOne: (request, context) => {
        const row = InboxMessages.required(request.message).message;
        return this.#mutate(this.#slot(row.id?.index), context.signal, (transport, headers) =>
          createClient(InboxService, transport).removeOne(request, this.#forward(context, headers)),
        );
      },
      removeMany: (request, context) => {
        const shard = this.#batchShard(request);
        return this.#mutate(this.#slot(shard), context.signal, (transport, headers) =>
          createClient(InboxService, transport).removeMany(
            request,
            this.#forward(context, headers),
          ),
        );
      },
    };
  }

  /**
   * Routes Inbox reads without reserving mutation capacity.
   */
  #inboxReads(): Pick<
    ServiceImpl<typeof InboxService>,
    "findOne" | "findManyInShard" | "newestMessageToDeliver"
  > {
    return {
      findOne: (request, context) =>
        this.#read(this.#slot(request.index), context.signal, (transport, headers) =>
          createClient(InboxService, transport).findOne(request, this.#forward(context, headers)),
        ),
      findManyInShard: (request, context) =>
        this.#read(this.#slot(request.shard), context.signal, (transport, headers) =>
          createClient(InboxService, transport).findManyInShard(
            request,
            this.#forward(context, headers),
          ),
        ),
      newestMessageToDeliver: (request, context) =>
        this.#read(this.#slot(request), context.signal, (transport, headers) =>
          createClient(InboxService, transport).newestMessageToDeliver(
            request,
            this.#forward(context, headers),
          ),
        ),
    };
  }

  /**
   * Creates typed raw and managed shard routes.
   *
   * @returns The session-handle service handlers.
   */
  managed(): ServiceImpl<typeof ManagedShardService> {
    return {
      pickShardRaw: (request, context) =>
        this.#pickup(request, context, (transport, headers) =>
          createClient(ManagedShardService, transport).pickShardRaw(
            request,
            this.#forward(context, headers),
          ),
        ),
      pickShardForDelivery: (request, context) =>
        this.#pickup(request, context, (transport, headers) =>
          createClient(ManagedShardService, transport).pickShardForDelivery(
            request,
            this.#forward(context, headers),
          ),
        ),
      renewShardSession: (request, context) =>
        this.#sessionMutation(request, context.signal, (transport, headers) =>
          createClient(ManagedShardService, transport).renewShardSession(
            request,
            this.#forward(context, headers),
          ),
        ),
      releaseShardSession: (request, context) =>
        this.#sessionMutation(request, context.signal, (transport, headers) =>
          createClient(ManagedShardService, transport).releaseShardSession(
            request,
            this.#forward(context, headers),
          ),
        ),
    };
  }

  /**
   * Creates session-guarded acknowledgement and cleanup routes.
   *
   * @returns Guarded Inbox handlers for complete row identities.
   */
  guarded(): ServiceImpl<typeof GuardedInboxService> {
    return {
      acknowledge: (request, context) =>
        this.#guardedMutation(request, context.signal, (transport, headers) =>
          createClient(GuardedInboxService, transport).acknowledge(
            request,
            this.#forward(context, headers),
          ),
        ),
      removePendingDuplicate: (request, context) =>
        this.#guardedMutation(request, context.signal, (transport, headers) =>
          createClient(GuardedInboxService, transport).removePendingDuplicate(
            request,
            this.#forward(context, headers),
          ),
        ),
      removeExpiredDelivered: (request, context) =>
        this.#guardedMutation(request, context.signal, (transport, headers) =>
          createClient(GuardedInboxService, transport).removeExpiredDelivered(
            request,
            this.#forward(context, headers),
          ),
        ),
    };
  }

  /**
   * Creates the frozen raw shard surface with global explicit release.
   *
   * @returns Raw shard handlers.
   */
  shards(): ServiceImpl<typeof ShardService> {
    return {
      pickShard: () =>
        Promise.reject(new ConnectError("Use typed shard pickup.", Code.FailedPrecondition)),
      releaseSession: () =>
        Promise.reject(new ConnectError("Use typed session release.", Code.FailedPrecondition)),
      releaseSessions: (request, context) => this.#globalRelease(request, context),
    };
  }

  /**
   * Aggregates confirmed inactivity releases from every selected child generation.
   */
  async #globalRelease(
    request: Parameters<ServiceImpl<typeof ShardService>["releaseSessions"]>[0],
    context: Parameters<ServiceImpl<typeof ShardService>["releaseSessions"]>[1],
  ): Promise<ExpiredSessionsReleased> {
    const endpoints = this.#allEndpoints();
    const replies = await Promise.all(
      endpoints.map((endpoint) =>
        this.#mutate(
          endpoint.slot,
          context.signal,
          (transport, headers) =>
            createClient(ShardService, transport).releaseSessions(
              request,
              this.#forward(context, headers),
            ),
          endpoint,
        ),
      ),
    );
    this.#assertCurrent(endpoints);
    const shard = replies.flatMap((reply) => reply.shard);
    if (shard.length > MAX_DELIVERY_RESPONSE_SHARDS)
      throw new ConnectError(
        "Global released-session response is too large.",
        Code.ResourceExhausted,
      );
    const response = create(ExpiredSessionsReleasedSchema, { shard });
    if (toBinary(ExpiredSessionsReleasedSchema, response).byteLength > MAX_DELIVERY_RPC_BYTES)
      throw new ConnectError(
        "Global released-session response is too large.",
        Code.ResourceExhausted,
      );
    return response;
  }

  /**
   * Reads an all-slot Admin snapshot or starts an all-slot update stream.
   *
   * @returns Global Admin handlers.
   */
  admin(): ServiceImpl<typeof AdminService> {
    return {
      getShardInfo: (request, context) => this.#adminSnapshot(request, context),
      subscribeToShardUpdates: (request, context) => this.#adminUpdates(request, context),
    };
  }

  /**
   * Combines a complete all-slot Admin snapshot in full shard order.
   */
  async #adminSnapshot(
    request: Parameters<ServiceImpl<typeof AdminService>["getShardInfo"]>[0],
    context: Parameters<ServiceImpl<typeof AdminService>["getShardInfo"]>[1],
  ): Promise<ShardInfoList> {
    const endpoints = this.#allEndpoints();
    const replies = await Promise.all(
      endpoints.map((endpoint) =>
        this.#read(
          endpoint.slot,
          context.signal,
          (transport, headers) =>
            createClient(AdminService, transport).getShardInfo(
              request,
              this.#forward(context, headers),
            ),
          endpoint,
        ),
      ),
    );
    this.#assertCurrent(endpoints);
    const shards = replies
      .flatMap((reply) => reply.shards)
      .sort((a, b) => DeliveryShards.compare(a.index, b.index));
    if (shards.length > MAX_DELIVERY_RESPONSE_SHARDS)
      throw new ConnectError("Global Admin snapshot is too large.", Code.ResourceExhausted);
    const response = create(ShardInfoListSchema, { shards });
    if (toBinary(ShardInfoListSchema, response).byteLength > MAX_DELIVERY_RPC_BYTES)
      throw new ConnectError("Global Admin snapshot is too large.", Code.ResourceExhausted);
    return response;
  }

  /**
   * Waits for every child ACK before publishing one global Admin ACK.
   */
  #adminUpdates(
    request: Parameters<ServiceImpl<typeof AdminService>["subscribeToShardUpdates"]>[0],
    context: Parameters<ServiceImpl<typeof AdminService>["subscribeToShardUpdates"]>[1],
  ): AsyncIterable<SubscriptionResponse> {
    this.#requireOpen();
    const streams = new DeliveryStreamFanIn(
      this.pool,
      "admin",
      (endpoint, signal, onEstablished) => {
        const connection = this.#streamConnection(endpoint);
        return createClient(AdminService, connection.transport).subscribeToShardUpdates(request, {
          ...this.#forward(context, this.#headers(endpoint), signal),
          onHeader: onEstablished,
        });
      },
      (frame) => frame.value.case === "created" && frame.value.value,
    );
    return streams.observe(
      context.signal,
      this.#closed.signal,
      create(SubscriptionResponseSchema, { value: { case: "created", value: true } }),
    );
  }

  /**
   * Creates the public work stream handler over private child streams.
   *
   * @returns The global advisory work observer.
   */
  observing(): ServiceImpl<typeof ShardObservingService> {
    return {
      observeAll: (request, context) => {
        this.#requireOpen();
        const streams = new DeliveryStreamFanIn(
          this.pool,
          "work",
          (endpoint, signal, onEstablished) => {
            const connection = this.#streamConnection(endpoint);
            return createClient(ShardObservingService, connection.transport).observeAll(request, {
              ...this.#forward(context, this.#headers(endpoint), signal),
              onHeader: onEstablished,
            });
          },
        );
        return streams.observe(context.signal, this.#closed.signal);
      },
    };
  }

  /**
   * Maps a validated full shard identity to its fixed child slot.
   */
  #slot(shard: ShardIndex | undefined): number {
    return InboxShards.required(shard).index % this.pool.processCount;
  }

  /**
   * Rejects a mixed-shard batch before any child receives a mutation ticket.
   */
  #batchShard(request: {
    shard?: ShardIndex | undefined;
    message: readonly (InboxMessage | undefined)[];
  }): ShardIndex {
    const shard = InboxShards.required(request.shard);
    InboxMessages.requiredBatchLength(request.message.length);
    InboxShards.ensure(
      request.message.map((row) => InboxMessages.required(row).message),
      shard,
    );
    return shard;
  }

  /**
   * Reuses a private HTTP/2 transport only within one child generation.
   */
  #connection(slot: number): ChildConnection {
    this.#requireOpen();
    const endpoint = this.pool.endpoint(slot);
    const old = this.#connections.get(slot);
    if (old?.endpoint.generation === endpoint.generation) return old;
    old?.sessions.abort();
    const sessions = new Http2SessionManager(endpoint.baseUrl);
    const connection = {
      endpoint,
      sessions,
      transport: createGrpcTransport({ baseUrl: endpoint.baseUrl, sessionManager: sessions }),
    };
    this.#connections.set(slot, connection);
    return connection;
  }

  /**
   * Rejects a stream opened after its selected generation was replaced.
   */
  #streamConnection(endpoint: DeliveryChildEndpoint): ChildConnection {
    const connection = this.#connection(endpoint.slot);
    if (connection.endpoint.generation !== endpoint.generation)
      throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
    return connection;
  }

  /**
   * Authenticates one child call and optionally correlates a mutation ticket.
   */
  #headers(endpoint: DeliveryChildEndpoint, ticket?: CapacityTicket): Headers {
    const headers = new Headers({ authorization: endpoint.credential });
    if (ticket !== undefined) headers.set("x-spine-capacity-sequence", String(ticket.sequence));
    return headers;
  }

  /**
   * Forwards the public caller's remaining deadline with its cancellation signal.
   */
  #forward(
    context: HandlerContext,
    headers: Headers,
    signal = context.signal,
  ): {
    readonly headers: Headers;
    readonly signal: AbortSignal;
    readonly timeoutMs?: number;
  } {
    const remaining = context.timeoutMs();
    if (remaining !== undefined && remaining <= 0)
      throw new ConnectError("Delivery request deadline elapsed.", Code.DeadlineExceeded);
    const active = AbortSignal.any([signal, this.#closed.signal]);
    return remaining === undefined
      ? { headers, signal: active }
      : { headers, signal: active, timeoutMs: remaining };
  }

  /**
   * Rejects new public operations after the parent proxy closes.
   */
  #requireOpen(): void {
    if (this.#closed.signal.aborted)
      throw new ConnectError("Delivery parent proxy is closed.", Code.Unavailable);
  }

  /**
   * Selects every currently ready generation for one global operation.
   */
  #allEndpoints(): DeliveryChildEndpoint[] {
    this.#requireOpen();
    return Array.from({ length: this.pool.processCount }, (_, slot) => this.pool.endpoint(slot));
  }

  /**
   * Refuses a global result after any selected generation changes.
   */
  #assertCurrent(endpoints: readonly DeliveryChildEndpoint[]): void {
    this.#requireOpen();
    if (endpoints.some((endpoint) => !this.pool.current(endpoint)))
      throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
  }

  /**
   * Reads a targeted slot and discards a reply from a retired generation.
   *
   * @typeParam T The child response type.
   */
  async #read<T>(
    slot: number,
    signal: AbortSignal,
    call: (transport: ChildTransport, headers: Headers) => Promise<T>,
    expected?: DeliveryChildEndpoint,
  ): Promise<T> {
    this.#requireOpen();
    const connection = this.#connection(slot);
    if (expected !== undefined && connection.endpoint.generation !== expected.generation)
      throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
    const result = await call(connection.transport, this.#headers(connection.endpoint));
    if (!this.pool.current(connection.endpoint) || this.#closed.signal.aborted || signal.aborted)
      throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
    return result;
  }

  /**
   * Issues the child's next ticket at parent receipt and settles an uncertain reply.
   *
   * @typeParam T The child response type.
   */
  async #mutate<T>(
    slot: number,
    signal: AbortSignal,
    call: (transport: ChildTransport, headers: Headers) => Promise<T>,
    expected?: DeliveryChildEndpoint,
  ): Promise<T> {
    this.#requireOpen();
    if (signal.aborted) throw new ConnectError("Delivery request was cancelled.", Code.Canceled);
    const connection = this.#connection(slot);
    if (expected !== undefined && connection.endpoint.generation !== expected.generation)
      throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
    const ticket = this.pool.ticket(slot, expected);
    try {
      const result = await call(connection.transport, this.#headers(connection.endpoint, ticket));
      if (!this.pool.current(connection.endpoint))
        throw new ConnectError("Delivery child generation changed.", Code.Unavailable);
      return result;
    } catch (error) {
      void this.#settle(connection, ticket);
      throw error;
    }
  }

  /**
   * Uses a correlated child barrier before releasing a slot's next ticket.
   */
  async #settle(connection: ChildConnection, ticket: CapacityTicket): Promise<void> {
    let delay = 0;
    const client = createClient(privateProto.PrivateChildService, connection.transport);
    while (!this.#closed.signal.aborted && this.pool.current(connection.endpoint)) {
      const started = Time.monotonicTime();
      try {
        await client.barrier(
          { slot: BigInt(ticket.slot), generation: ticket.generation, sequence: ticket.sequence },
          { headers: this.#headers(connection.endpoint), signal: this.#closed.signal },
        );
        return;
      } catch {
        if (!this.pool.current(connection.endpoint)) return;
        const observed = Math.max(1, Math.ceil(Time.monotonicTime() - started));
        delay = delay === 0 ? observed : Math.min(delay * 2, Number.MAX_SAFE_INTEGER);
        await this.#pause(delay);
      }
    }
  }

  /**
   * Waits through all Node timer slices or returns on terminal closure.
   */
  async #pause(delay: number): Promise<void> {
    while (delay > 0 && !this.#closed.signal.aborted) {
      const slice = Math.min(delay, 2_147_483_647);
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          this.#closed.signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(finish, slice);
        this.#closed.signal.addEventListener("abort", finish, { once: true });
        if (this.#closed.signal.aborted) finish();
      });
      delay -= slice;
    }
  }

  /**
   * Validates a typed pickup before issuing its child capacity ticket.
   *
   * @typeParam T The typed pickup result.
   */
  #pickup<T>(
    request: {
      shard?: ShardIndex | undefined;
      worker?: Parameters<typeof DeliverySessionInputs.requireWorker>[0];
    },
    context: { signal: AbortSignal },
    call: (transport: ChildTransport, headers: Headers) => Promise<T>,
  ): Promise<T> {
    const shard = DeliverySessionInputs.requireShard(request.shard);
    DeliverySessionInputs.requireWorker(request.worker);
    return this.#mutate(this.#slot(shard), context.signal, call);
  }

  /**
   * Routes a typed session change to the shard's fixed child.
   *
   * @typeParam T The session response.
   */
  #sessionMutation<T>(
    request: { shard?: ShardIndex | undefined },
    signal: AbortSignal,
    call: (transport: ChildTransport, headers: Headers) => Promise<T>,
  ): Promise<T> {
    return this.#mutate(
      this.#slot(DeliverySessionInputs.requireShard(request.shard)),
      signal,
      call,
    );
  }

  /**
   * Rejects a guarded row from another shard before child mutation admission.
   *
   * @typeParam T The guarded mutation result.
   */
  #guardedMutation<T>(
    request: {
      session?: { shard?: ShardIndex | undefined } | undefined;
      expected?: Parameters<typeof InboxMessages.required>[0];
    },
    signal: AbortSignal,
    call: (transport: ChildTransport, headers: Headers) => Promise<T>,
  ): Promise<T> {
    const row = InboxMessages.required(request.expected).message;
    const shard = DeliverySessionInputs.requireShard(request.session?.shard);
    if (row.id?.index?.index !== shard.index || row.id.index.ofTotal !== shard.ofTotal)
      throw new ConnectError("Inbox row shard differs from session.", Code.InvalidArgument);
    return this.#mutate(this.#slot(shard), signal, call);
  }
}
