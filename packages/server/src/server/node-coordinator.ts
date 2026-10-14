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

import * as http2 from "node:http2";
import { randomUUID } from "node:crypto";
import type { AddressInfo, Socket } from "node:net";

import { clone, create, equals, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type HandlerContext } from "@connectrpc/connect";
import {
  connectNodeAdapter,
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import {
  type BackendMemberClient,
  BackendMembershipKernel,
  type BackendMembershipKernelOptions,
} from "@spine-event-engine/deployment/spi/backend-membership";
import { SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS } from "@spine-event-engine/core/spi/subscription-lifecycle";
import {
  AckSchema,
  ResponseSchema,
  StatusSchema,
  type Ack,
  type Command,
  type Response,
} from "@spine-event-engine/proto";
import {
  type Query,
  type QueryResponse,
  QueryResponseSchema,
  CommandService,
  QueryService,
  type Subscription,
  SubscriptionIdSchema,
  SubscriptionSchema,
  SubscriptionService,
  type SubscriptionUpdate,
  SubscriptionUpdateSchema,
  type Topic,
  TopicSchema,
} from "@spine-event-engine/proto/client";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const gracefulSessionDrainMs = 100;
const subscriptionQueueLimit = 100;

/**
 * Describes one private managed child available for Coordinator forwarding.
 *
 * @internal
 */
export interface ReadyCoordinatorMember {
  // prettier-ignore

  /**
   *
   * Private loopback child endpoint.
   */

  readonly endpoint: string;

  /**
   *
   * Immutable child incarnation.
   */

  readonly incarnation: string;

  /**
   *
   * Operating-system child process identifier.
   */

  readonly pid: number;

  /**
   *
   * Stable managed logical slot.
   */

  readonly slot: number;
}

/**
 * Supplies managed READY members and their change notification.
 *
 * @internal
 */
export interface ReadyMemberSource {
  // prettier-ignore

  /**
   *
   * Returns the current complete READY-member snapshot.
   *
   * @returns The current private member facts.
   */

  readyMembers(): readonly ReadyCoordinatorMember[];

  /**
   * Returns READY and DRAINING children while their relay remains live.
   *
   * @returns The current private relay-member facts.
   */
  relayMembers(): readonly ReadyCoordinatorMember[];

  /**
   *
   * Subscribes one callback after READY membership changes.
   *
   * @param onChange Runs after a new snapshot becomes current.
   * @returns Stops later membership callbacks.
   */
  onReadyMembersChange(onChange: () => void): () => void;

  /**
   * Subscribes one callback to relay-membership changes.
   *
   * @param onChange Runs after a new relay snapshot becomes current.
   * @returns Stops later relay-membership callbacks.
   */
  onRelayMembersChange(onChange: () => void): () => void;

  /**
   * Records the exact child subscription whose activation started during reconciliation.
   *
   * @param member Supplies the member that owns the child subscription.
   * @param subscription Supplies the activating child subscription.
   */
  onChildSubscriptionActivated?(member: ReadyCoordinatorMember, subscription: Subscription): void;

  /**
   * Clears a child-installation wait when the matching native child is cancelled.
   *
   * @param member Supplies the member that owns the child subscription.
   * @param subscription Supplies the cancelled child subscription.
   */
  onChildSubscriptionCancelled?(member: ReadyCoordinatorMember, subscription: Subscription): void;

  /**
   * Completes private child activation before the member becomes unary-ready.
   *
   * @returns Completion after synchronizing relay children are installed.
   */
  onRelaySynchronized?(): Promise<void>;
}

/**
 * Configures one private local Node Coordinator listener.
 *
 * @internal
 */
export interface NodeCoordinatorOptions {
  // prettier-ignore

  /**
   *
   * Supplies private managed READY membership.
   */

  readonly members: ReadyMemberSource;

  /**
   *
   * Selects the public listener host.
   */

  readonly host?: string;

  /**
   *
   * Selects the public listener port.
   */

  readonly port?: number;

  /**
   *
   * Limits inbound unary message bytes.
   */

  readonly readMaxBytes?: number;

  /**
   *
   * Limits outbound unary message bytes.
   */

  readonly writeMaxBytes?: number;
}

/**
 * Hosts generated unary services in front of managed complete replicas.
 *
 * @internal
 */
export class NodeCoordinator {
  // prettier-ignore

  readonly #members: ReadyMemberSource;

  readonly #unaryKernel: BackendMembershipKernel<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  >;

  readonly #subscriptionKernel: BackendMembershipKernel<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  >;

  readonly #server: http2.Http2Server;

  readonly #sessions: Set<http2.ServerHttp2Session>;

  readonly #sockets: Set<Socket>;

  readonly #stopMembers: readonly (() => void)[];

  readonly #cancellations = new Map<string, Promise<void>>();

  readonly #pendingActivations = new Map<string, PendingActivation>();

  /**
   *
   * Bound listener host.
   */

  readonly host: string;

  /**
   *
   * Bound listener port.
   */

  readonly port: number;

  /**
   *
   * Bound Connect/gRPC base URL.
   */

  readonly baseUrl: string;

  #close: Promise<void> | undefined;

  #networkClose: Promise<void> | undefined;

  #draining = false;

  #membershipReconciliation = Promise.resolve();

  /**
   * Creates the native node coordinator around its HTTP/2 listener and member source.
   *
   * @param options The coordinator configuration.
   * @param server The HTTP/2 server.
   * @param address The listening address.
   * @param sessions Tracked HTTP/2 sessions.
   * @param sockets Tracked TCP connections, including those without a session.
   */
  private constructor(
    options: NodeCoordinatorOptions,
    server: http2.Http2Server,
    address: AddressInfo,
    sessions: Set<http2.ServerHttp2Session>,
    sockets: Set<Socket>,
  ) {
    this.#members = options.members;
    this.#unaryKernel = new BackendMembershipKernel(NodeCoordinatorValues.unaryKernelOptions());
    this.#subscriptionKernel = new BackendMembershipKernel(
      NodeCoordinatorValues.unaryKernelOptions(options.members),
    );
    this.#server = server;
    this.#sessions = sessions;
    this.#sockets = sockets;
    this.host = address.address;
    this.port = address.port;
    this.baseUrl = `http://${NodeCoordinatorValues.formatHostForUrl(this.host)}:${this.port.toString()}`;
    const reconcile = () => {
      this.#membershipReconciliation = this.#membershipReconciliation
        .then(
          () => this.#reconcile(),
          () => this.#reconcile(),
        )
        .catch(() => undefined);
    };
    this.#stopMembers = [
      options.members.onReadyMembersChange(reconcile),
      options.members.onRelayMembersChange(reconcile),
    ];
  }

  /**
   * Opens one generated unary-service listener.
   *
   * @param options Supplies private membership and listener configuration.
   * @returns The running private Coordinator.
   */
  static async open(options: NodeCoordinatorOptions): Promise<NodeCoordinator> {
    const { host, port, readMaxBytes, writeMaxBytes } = this.#listenerOptions(options);
    // eslint-disable-next-line prefer-const -- routes capture the Coordinator before the listener exists.
    let coordinator: NodeCoordinator;
    const sessions = new Set<http2.ServerHttp2Session>();
    const sockets = new Set<Socket>();
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(CommandService, {
            post: async (command, context) => {
              return coordinator.#post(command, context);
            },
          });
          router.service(QueryService, {
            read: async (query, context) => {
              return coordinator.#read(query, context);
            },
          });
          router.service(SubscriptionService, {
            subscribe: (topic, context) => coordinator.#subscribe(topic, context),
            activate: (subscription, context) => coordinator.#activate(subscription, context),
            cancel: (subscription, context) => coordinator.#cancel(subscription, context),
          });
        },
        readMaxBytes,
        writeMaxBytes,
      }),
    );
    this.#trackConnections(server, sessions, sockets);
    const address = await NodeCoordinatorValues.listen(server, host, port);
    coordinator = new NodeCoordinator(options, server, address, sessions, sockets);
    await coordinator.#reconcile();
    return coordinator;
  }

  /**
   * Validates private listener and message limits before opening the server.
   *
   * @param options The private Coordinator configuration.
   * @returns Validated listener and message limits.
   */
  static #listenerOptions(options: NodeCoordinatorOptions): {
    host: string;
    port: number;
    readMaxBytes: number;
    writeMaxBytes: number;
  } {
    return {
      host: NodeCoordinatorValues.host(options.host ?? defaultHost),
      port: NodeCoordinatorValues.port(options.port ?? defaultPort),
      readMaxBytes: NodeCoordinatorValues.messageLimit(
        options.readMaxBytes ?? defaultMessageMaxBytes,
      ),
      writeMaxBytes: NodeCoordinatorValues.messageLimit(
        options.writeMaxBytes ?? defaultMessageMaxBytes,
      ),
    };
  }

  /**
   * Tracks sessions and sockets so deadline cleanup can destroy both.
   *
   * @param server The private Coordinator listener.
   * @param sessions Receives active HTTP/2 sessions.
   * @param sockets Receives active TCP sockets.
   */
  static #trackConnections(
    server: http2.Http2Server,
    sessions: Set<http2.ServerHttp2Session>,
    sockets: Set<Socket>,
  ): void {
    server.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
    server.on("connection", (socket: Socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  }

  /**
   * Stops public intake, active sessions, and private child clients.
   *
   * @returns Completion after bounded Coordinator cleanup.
   */
  close(): Promise<void> {
    this.#close ??= this.#closeOnce().catch((error: unknown) => {
      this.#close = undefined;
      throw error;
    });
    return this.#close;
  }

  /**
   * Closes tracked HTTP/2 resources independently of membership reconciliation.
   *
   * @returns Completion after the tracked network handles close.
   */
  forceNetworkClose(): Promise<void> {
    this.#draining = true;
    for (const stop of this.#stopMembers) stop();
    for (const pending of this.#pendingActivations.values()) clearTimeout(pending.timer);
    this.#pendingActivations.clear();
    // Start both kernel abort paths even if membership reconciliation is stalled.
    void Promise.resolve()
      .then(() => this.#unaryKernel.close())
      .catch(() => undefined);
    void Promise.resolve()
      .then(() => this.#subscriptionKernel.close())
      .catch(() => undefined);
    for (const session of this.#sessions) session.destroy();
    for (const socket of this.#sockets) socket.destroy();
    this.#networkClose ??= NodeCoordinatorValues.closeServer(this.#server);
    return this.#networkClose;
  }

  /**
   * Removes unary admission while retaining active subscription relays.
   *
   * @returns Completion after the unary member snapshot becomes empty.
   */
  beginDrain(): Promise<void> {
    this.#draining = true;
    return this.#unaryKernel.reconcile([]);
  }

  /**
   * Cancels backend relays while managed child listeners can still accept Cancel.
   *
   * @returns Completion after private child subscriptions are removed.
   */
  async closeSubscriptions(): Promise<void> {
    await this.#membershipReconciliation;
    await this.#subscriptionKernel.close();
  }

  async #post(command: Command, context: HandlerContext): Promise<Ack> {
    const request: CoordinatorCommand = {
      kind: "command",
      command,
      context,
      response: create(AckSchema),
    };
    await this.#forward(request);
    return request.response;
  }

  async #read(query: Query, context: HandlerContext): Promise<QueryResponse> {
    const request: CoordinatorQuery = {
      kind: "query",
      query,
      context,
      response: create(QueryResponseSchema),
    };
    await this.#forward(request);
    return request.response;
  }

  async #subscribe(topic: Topic, context: HandlerContext): Promise<Subscription> {
    if (this.#draining) throw new ConnectError("Managed application is closing.", Code.Unavailable);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${randomUUID()}` }),
      topic,
    });
    try {
      await this.#subscriptionKernel.subscribe(
        toBinary(SubscriptionSchema, subscription),
        context.signal,
      );
    } catch (error) {
      throw this.#availabilityError(error);
    }
    if (this.#isDraining()) {
      await this.#cancelDefinition(toBinary(SubscriptionSchema, subscription), context.signal);
      throw new ConnectError("Managed application is closing.", Code.Unavailable);
    }
    this.#schedulePendingActivation(subscription);
    return subscription;
  }

  /**
   * Reads current admission state after an asynchronous backend Subscribe.
   *
   * @returns Whether the Coordinator is draining.
   */
  #isDraining(): boolean {
    return this.#draining;
  }

  async *#activate(
    subscription: Subscription,
    context: HandlerContext,
  ): AsyncIterable<SubscriptionUpdate> {
    if (this.#draining) throw new ConnectError("Managed application is closing.", Code.Unavailable);
    const definition = toBinary(SubscriptionSchema, subscription);
    this.#clearPendingActivation(subscription);
    const overflow = new AbortController();
    const abort = () => {
      overflow.abort();
    };
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    const updates = new SubscriptionUpdateQueue(subscriptionQueueLimit, abort);
    const activation = this.#activateChild(definition, subscription, updates, overflow.signal);
    let failure: Error | undefined;
    try {
      for await (const update of updates) yield update;
    } catch (error) {
      failure = NodeCoordinatorValues.error(error);
    } finally {
      context.signal.removeEventListener("abort", abort);
      overflow.abort();
      updates.close();
      await this.#finishActivation(definition, activation, failure);
    }
  }

  /**
   * Relays accepted child updates through the bounded logical stream.
   *
   * @param definition The validated child subscription bytes.
   * @param subscription The logical subscription exposed to callers.
   * @param updates The bounded caller stream queue.
   * @param signal Cancels the active child relay.
   * @returns Completion after the backend activation ends.
   */
  #activateChild(
    definition: Uint8Array,
    subscription: Subscription,
    updates: SubscriptionUpdateQueue,
    signal: AbortSignal,
  ): Promise<void> {
    return this.#subscriptionKernel
      .activate(
        definition,
        async (childUpdate) => {
          const update = fromBinary(SubscriptionUpdateSchema, childUpdate);
          update.subscription = clone(SubscriptionSchema, subscription);
          await updates.push(update);
        },
        signal,
      )
      .finally(() => {
        updates.close();
      });
  }

  async #finishActivation(
    definition: Uint8Array,
    activation: Promise<void>,
    previousFailure: Error | undefined,
  ): Promise<void> {
    const failures: Error[] = previousFailure === undefined ? [] : [previousFailure];
    try {
      await activation;
    } catch (error) {
      failures.push(NodeCoordinatorValues.error(error));
    }
    try {
      await this.#cancelDefinition(definition, new AbortController().signal);
    } catch (error) {
      failures.push(NodeCoordinatorValues.error(error));
    }
    const first = failures[0];
    if (first !== undefined && failures.length === 1) throw first;
    if (failures.length > 1)
      throw new AggregateError(failures, "Coordinator activation cleanup failed.");
  }

  async #cancel(subscription: Subscription, context: HandlerContext): Promise<Response> {
    this.#clearPendingActivation(subscription);
    await this.#cancelDefinition(toBinary(SubscriptionSchema, subscription), context.signal);
    return create(ResponseSchema, {
      status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
    });
  }

  async #forward(request: CoordinatorRequest): Promise<void> {
    if (this.#draining)
      throw new ConnectError("No ready application replica is available.", Code.Unavailable);
    try {
      await this.#unaryKernel.forward(request);
    } catch (error) {
      throw this.#availabilityError(error);
    }
  }

  #availabilityError(error: unknown): unknown {
    return error instanceof Error && error.message === "backend membership is unavailable."
      ? new ConnectError("No ready application replica is available.", Code.Unavailable)
      : error;
  }

  #schedulePendingActivation(subscription: Subscription): void {
    const id = NodeCoordinatorValues.requiredValue(
      subscription.id?.value,
      "Coordinator subscription definition is missing an ID.",
    );
    this.#clearPendingActivation(subscription);
    const pending: PendingActivation = {
      definition: toBinary(SubscriptionSchema, subscription),
      timer: setTimeout(() => {
        void this.#expirePendingActivation(id, pending);
      }, SUBSCRIPTION_ACTIVATION_HANDSHAKE_MS),
    };
    pending.timer.unref();
    this.#pendingActivations.set(id, pending);
  }

  #cancelDefinition(definition: Uint8Array, signal: AbortSignal): Promise<void> {
    const id = NodeCoordinatorValues.requiredValue(
      fromBinary(SubscriptionSchema, definition).id?.value,
      "Coordinator subscription definition is missing an ID.",
    );
    const active = this.#cancellations.get(id);
    if (active !== undefined) return active;
    const cancellation = this.#subscriptionKernel.cancel(definition, signal).finally(() => {
      if (this.#cancellations.get(id) === cancellation) this.#cancellations.delete(id);
    });
    this.#cancellations.set(id, cancellation);
    return cancellation;
  }

  #clearPendingActivation(subscription: Subscription): void {
    const id = subscription.id?.value;
    if (id === undefined) return;
    const pending = this.#pendingActivations.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pendingActivations.delete(id);
  }

  async #expirePendingActivation(id: string, pending: PendingActivation): Promise<void> {
    if (this.#pendingActivations.get(id) !== pending) return;
    try {
      await this.#cancelDefinition(pending.definition, new AbortController().signal);
      if (this.#pendingActivations.get(id) === pending) this.#pendingActivations.delete(id);
    } catch {
      if (this.#pendingActivations.get(id) === pending)
        this.#schedulePendingActivation(fromBinary(SubscriptionSchema, pending.definition));
    }
  }

  #reconcile(): Promise<void> {
    if (this.#members.onRelaySynchronized !== undefined)
      return this.#subscriptionKernel
        .reconcile(this.#members.relayMembers())
        .then(() =>
          Promise.resolve(this.#members.onRelaySynchronized?.()).then(() =>
            this.#unaryKernel.reconcile(this.#members.readyMembers()),
          ),
        );
    return Promise.all([
      this.#unaryKernel.reconcile(this.#members.readyMembers()),
      this.#subscriptionKernel.reconcile(this.#members.relayMembers()),
    ]).then(() => undefined);
  }

  async #closeOnce(): Promise<void> {
    this.#stopMembers.forEach((stop) => {
      stop();
    });
    for (const pending of this.#pendingActivations.values()) clearTimeout(pending.timer);
    this.#pendingActivations.clear();
    await this.#membershipReconciliation;
    const network = (this.#networkClose ??= NodeCoordinatorValues.closeNetwork(
      this.#server,
      this.#sessions,
    ));
    await Promise.all([network, this.#unaryKernel.close(), this.#subscriptionKernel.close()]);
  }
}

interface CoordinatorCommand {
  readonly kind: "command";
  readonly command: Command;
  readonly context: HandlerContext;
  response: Ack;
}
interface CoordinatorQuery {
  readonly kind: "query";
  readonly query: Query;
  readonly context: HandlerContext;
  response: QueryResponse;
}
type CoordinatorRequest = CoordinatorCommand | CoordinatorQuery;

interface PendingActivation {
  readonly definition: Uint8Array;
  readonly timer: NodeJS.Timeout;
}

/**
 * Buffers bounded Coordinator subscription updates for one public stream.
 *
 * @internal
 */
export class SubscriptionUpdateQueue implements AsyncIterable<SubscriptionUpdate> {
  readonly #updates: SubscriptionUpdate[] = [];

  readonly #waiters: ((value: IteratorResult<SubscriptionUpdate>) => void)[] = [];

  readonly #delivered: (() => void)[] = [];

  readonly #limit: number;

  readonly #onOverflow: () => void;

  #closed = false;

  /**
   * Creates one terminal bounded update queue.
   *
   * @param limit Limits retained updates before terminal closure.
   * @param onOverflow Aborts the public relay when the queue reaches its bound.
   */
  constructor(limit: number, onOverflow: () => void = () => undefined) {
    this.#limit = limit;
    this.#onOverflow = onOverflow;
  }

  /**
   * Queues one update or closes terminally when its bound is reached.
   *
   * @param update Supplies the update to deliver.
   * @returns Completion after direct delivery, queue closure, or consumer delivery.
   */
  push(update: SubscriptionUpdate): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: update, done: false });
      return Promise.resolve();
    }
    if (this.#updates.length >= this.#limit) {
      this.#onOverflow();
      this.close();
      return Promise.resolve();
    }
    this.#updates.push(update);
    return new Promise((resolve) => this.#delivered.push(resolve));
  }

  /**
   * Closes the queue and releases all waiting producers and consumers.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#updates.length = 0;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
    for (const delivered of this.#delivered.splice(0)) delivered();
  }

  /**
   * Returns queued updates until the terminal close.
   *
   * @returns The asynchronous update iterator.
   */
  [Symbol.asyncIterator](): AsyncIterator<SubscriptionUpdate> {
    return {
      next: (): Promise<IteratorResult<SubscriptionUpdate>> => {
        const update = this.#updates.shift();
        if (update !== undefined) {
          this.#delivered.shift()?.();
          return Promise.resolve({ value: update, done: false });
        }
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const NodeCoordinatorValues = Object.freeze({
  /**
   * Builds membership options for native unary forwarding.
   *
   * @param members The ready member source when available.
   * @returns The configured membership kernel options.
   */
  unaryKernelOptions(
    members?: ReadyMemberSource,
  ): BackendMembershipKernelOptions<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  > {
    // The Coordinator deliberately uses only the kernel's member lifecycle and
    // one-shot forwarding operations. Subscription fan-out is owned by T-0208.
    return {
      create: (member: ReadyCoordinatorMember) =>
        Promise.resolve(NodeCoordinatorValues.client(member, members)),
      memberKey: (member: ReadyCoordinatorMember) =>
        `${member.slot.toString()}/${member.incarnation}`,
      sameMember: (left: ReadyCoordinatorMember, right: ReadyCoordinatorMember) =>
        left.endpoint === right.endpoint,
      definitionKey: (definition) => fromBinary(SubscriptionSchema, definition).id?.value,
      childDefinition: NodeCoordinatorValues.childDefinition,
      childSize: (child) => child.byteLength,
      ...NodeCoordinatorValues.activationAckOptions(members),
    };
  },

  /**
   * Builds strict child ACK validation for the subscription membership kernel.
   *
   * @param members The subscription-ready member source when configured.
   * @returns Child acknowledgement recognition and logical rewriting callbacks.
   */
  activationAckOptions(
    members: ReadyMemberSource | undefined,
  ): Pick<
    BackendMembershipKernelOptions<
      ReadyCoordinatorMember,
      CoordinatorRequest,
      Uint8Array,
      Uint8Array
    >,
    "isActivationAck" | "logicalActivationAck"
  > {
    if (members === undefined) return {};
    return {
      isActivationAck: (bytes) => {
        const update = fromBinary(SubscriptionUpdateSchema, bytes);
        return update.response?.status?.status.case === "ok" && update.update.case === undefined;
      },
      logicalActivationAck: (definition, childAck) => {
        const update = fromBinary(SubscriptionUpdateSchema, childAck);
        update.subscription = fromBinary(SubscriptionSchema, definition);
        return toBinary(SubscriptionUpdateSchema, update);
      },
    };
  },

  /**
   * Builds the member-specific native subscription definition.
   *
   * @param definition The logical subscription bytes.
   * @param member The selected backend member.
   * @returns The child definition bytes.
   */
  childDefinition(definition: Uint8Array, member: ReadyCoordinatorMember): Uint8Array {
    const subscription = clone(SubscriptionSchema, fromBinary(SubscriptionSchema, definition));
    const id = NodeCoordinatorValues.requiredValue(
      subscription.id,
      "Coordinator subscription definition is missing an ID.",
    );
    id.value = `${id.value}/${member.slot.toString()}-${member.incarnation}`;
    return toBinary(SubscriptionSchema, subscription);
  },

  /**
   * Creates a native transport client for one member.
   *
   * @param member The discovered backend member.
   * @param members The ready member source when available.
   * @returns The member transport client.
   */
  client(
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
  ): BackendMemberClient<CoordinatorRequest, Uint8Array, Uint8Array> {
    const manager = new Http2SessionManager(member.endpoint);
    const transport = createGrpcTransport({ baseUrl: member.endpoint, sessionManager: manager });
    return {
      forward: (request) => NodeCoordinatorValues.forward(transport, request),
      close: () => {
        manager.abort();
        return Promise.resolve();
      },
      subscribe: async (definition, signal) => {
        const subscription = fromBinary(SubscriptionSchema, definition);
        const created = await createClient(SubscriptionService, transport).subscribe(
          NodeCoordinatorValues.requiredValue(
            subscription.topic,
            "Coordinator subscription definition is missing a Topic.",
          ),
          { signal },
        );
        return toBinary(SubscriptionSchema, created);
      },
      activate: (child, updates, signal) =>
        NodeCoordinatorValues.activateChild(transport, member, members, child, updates, signal),
      dispose: async (child, signal) => {
        const subscription = fromBinary(SubscriptionSchema, child);
        members?.onChildSubscriptionCancelled?.(member, subscription);
        await createClient(SubscriptionService, transport).cancel(subscription, { signal });
      },
    };
  },

  /**
   * Sends one native Command or Query to a ready member.
   *
   * @param transport The connected native transport.
   * @param request The request to forward.
   * @returns Empty routing bytes after the response is assigned.
   */
  async forward(
    transport: ReturnType<typeof createGrpcTransport>,
    request: CoordinatorRequest,
  ): Promise<Uint8Array> {
    if (request.kind === "command") {
      const response = await transport.unary(
        CommandService.method.post,
        request.context.signal,
        request.context.timeoutMs(),
        NodeCoordinatorValues.applicationHeaders(request.context.requestHeader),
        request.command,
      );
      NodeCoordinatorValues.responseMetadata(response.header, response.trailer, request.context);
      request.response = response.message;
    } else {
      const response = await transport.unary(
        QueryService.method.read,
        request.context.signal,
        request.context.timeoutMs(),
        NodeCoordinatorValues.applicationHeaders(request.context.requestHeader),
        request.query,
      );
      NodeCoordinatorValues.responseMetadata(response.header, response.trailer, request.context);
      request.response = response.message;
    }
    return new Uint8Array();
  },

  /**
   * Streams validated updates from one native child subscription.
   *
   * @param transport The connected native transport.
   * @param member The backend member.
   * @param members The ready member source when available.
   * @param child The serialized child subscription.
   * @param updates The logical update sink.
   * @param signal Cancels child activation.
   * @returns Completion after the child stream closes.
   */
  async activateChild(
    transport: ReturnType<typeof createGrpcTransport>,
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    child: Uint8Array,
    updates: (update: Uint8Array) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const subscription = fromBinary(SubscriptionSchema, child);
    members?.onChildSubscriptionActivated?.(member, subscription);
    for await (const update of createClient(SubscriptionService, transport).activate(subscription, {
      signal,
    })) {
      const topic = subscription.topic;
      const updateTopic = update.subscription?.topic;
      if (
        update.subscription?.id?.value !== subscription.id?.value ||
        topic === undefined ||
        updateTopic === undefined ||
        !equals(TopicSchema, updateTopic, topic)
      )
        throw new Error("Backend child update does not match its subscription.");
      await updates(toBinary(SubscriptionUpdateSchema, update));
    }
  },

  /**
   * Copies backend response metadata into the public context.
   *
   * @param headers Headers received from the backend.
   * @param trailers Trailers received from the backend.
   * @param context The authenticated or RPC context.
   */
  responseMetadata(headers: Headers, trailers: Headers, context: HandlerContext): void {
    for (const [name, value] of NodeCoordinatorValues.applicationHeaders(headers))
      context.responseHeader.append(name, value);
    for (const [name, value] of NodeCoordinatorValues.applicationHeaders(trailers))
      context.responseTrailer.append(name, value);
  },

  /**
   * Copies application headers for forwarding.
   *
   * @param headers Headers received from the backend.
   * @returns Forwardable application headers.
   */
  applicationHeaders(headers: Headers): Headers {
    const forwarded = new Headers(headers);
    for (const name of [...forwarded.keys()]) {
      if (
        name === "content-type" ||
        name === "te" ||
        name === "user-agent" ||
        name.startsWith("grpc-") ||
        name.startsWith("connect-")
      )
        forwarded.delete(name);
    }
    return forwarded;
  },

  /**
   * Returns a required non-null value or throws.
   *
   * @typeParam Value The required input type.
   * @param value The caller-supplied value.
   * @param message Error text for a missing value.
   * @returns The non-null value.
   */
  requiredValue<Value>(value: Value | undefined, message: string): Value {
    if (value === undefined) throw new Error(message);
    return value;
  },

  /**
   * Converts an unknown error to a Connect error.
   *
   * @param error The original error.
   * @returns The normalized Connect error.
   */
  error(error: unknown): Error {
    return error instanceof Error
      ? error
      : new Error("Coordinator subscription operation failed.", { cause: error });
  },

  /**
   * Validates a configured host.
   *
   * @param value The caller-supplied value.
   * @returns The validated host.
   */
  host(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error("Server host must not be blank.");
    return normalized;
  },

  /**
   * Formats a host for a transport URL.
   *
   * @param host The configured host.
   * @returns The URL-safe host.
   */
  formatHostForUrl(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  },

  /**
   * Validates a configured network port.
   *
   * @param value The caller-supplied value.
   * @returns The validated port.
   */
  port(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535)
      throw new Error("Managed server port must be a safe integer between 0 and 65535.");
    return value;
  },

  /**
   * Validates a message size limit.
   *
   * @param value The caller-supplied value.
   * @returns The validated message limit.
   */
  messageLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff)
      throw new Error(
        "Managed server message limit must be a safe integer between 1 and 4294967295.",
      );
    return value;
  },

  /**
   * Starts the coordinator HTTP/2 listener.
   *
   * @param server The HTTP/2 server.
   * @param host The configured host.
   * @param port The configured port.
   * @returns Completion when the listener starts.
   */
  listen(server: http2.Http2Server, host: string, port: number): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(server.address() as AddressInfo);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  },

  /**
   * Closes the HTTP/2 server.
   *
   * @param server The HTTP/2 server.
   * @returns Completion after server shutdown.
   */
  closeServer(server: http2.Http2Server): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  },

  /**
   * Closes the HTTP/2 server and active sessions.
   *
   * @param server The HTTP/2 server.
   * @param sessions Tracked HTTP/2 sessions.
   * @returns Completion after network shutdown.
   */
  async closeNetwork(
    server: http2.Http2Server,
    sessions: ReadonlySet<http2.ServerHttp2Session>,
  ): Promise<void> {
    const closed = NodeCoordinatorValues.closeServer(server);
    await Promise.all([...sessions].map((session) => NodeCoordinatorValues.closeSession(session)));
    await closed;
  },

  /**
   * Closes an HTTP/2 session.
   *
   * @param session The HTTP/2 session.
   * @returns Completion after session shutdown.
   */
  closeSession(session: http2.ServerHttp2Session): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.destroy();
        resolve();
      }, gracefulSessionDrainMs);
      timer.unref();
      session.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      session.close();
    });
  },
});
