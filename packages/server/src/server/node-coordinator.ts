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
import type { AddressInfo } from "node:net";

import { clone, create, equals, fromBinary, toBinary } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  type ConnectRouter,
  type HandlerContext,
} from "@connectrpc/connect";
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
import { Validate } from "@spine-event-engine/core";
import {
  ReaderForwarding,
  type ReaderProofIssuer,
  type ReaderProofVerifier,
} from "@spine-event-engine/core/spi/reader-forwarding";
import {
  ReaderIdentities,
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";
import {
  AckSchema,
  ResponseSchema,
  StatusSchema,
  type Ack,
  type Command,
  type Response,
} from "@spine-event-engine/proto";
import {
  type AppQuery,
  type AppQueryResponse,
  AppQueryResponseSchema,
  AppQuerySchema,
  type Query,
  type QueryResponse,
  QueryResponseSchema,
  QuerySchema,
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
import { ReadRequestStatus } from "../services/read-request-status.js";
import {
  TrustedReaderIngress,
  type DirectReaderAuthenticator,
  type ReaderAdmissionResult,
} from "../services/trusted-reader-ingress.js";
import { NativeOperation } from "../services/native-operation.js";
import { ServerEnvironment } from "./server-environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const gracefulSessionDrainMs = 100;

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
 * Returns managed READY members and their change notification.
 *
 * @internal
 */
export interface ReadyMemberSource {
  // prettier-ignore

  /**
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
   * Returns private managed READY membership.
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

  /**
   * Configured native reader admission at the managed listener.
   */
  readonly readerAdmission?: Readonly<{
    forwarded?: ReaderProofVerifier<HandlerContext>;
    direct?: DirectReaderAuthenticator<HandlerContext>;
  }>;

  /**
   * Configured proof issuer for each Coordinator-to-child request.
   */
  readonly forwardingProof?: ReaderProofIssuer;
}

/**
 * Hosts generated unary services in front of managed complete replicas.
 *
 * @internal
 */
export class NodeCoordinator {
  // prettier-ignore

  readonly #members: ReadyMemberSource;

  readonly #readerAdmission: NodeCoordinatorOptions["readerAdmission"];

  readonly #forwardingProof: ReaderProofIssuer | undefined;

  readonly #readers = new Map<string, TrustedReaderContext>();

  readonly #children = new Map<string, Set<string>>();

  readonly #logicalForChild = new Map<string, string>();

  readonly #readMaxBytes: number;

  readonly #subscriptionQueueCapacity: number;

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

  readonly #admissionShutdown = new AbortController();

  #membershipReconciliation = Promise.resolve();

  /**
   * Creates the native node coordinator around its HTTP/2 listener and member source.
   *
   * @param options The coordinator configuration.
   * @param server The HTTP/2 server.
   * @param address The listening address.
   * @param sessions Tracked HTTP/2 sessions.
   * @param subscriptionQueueCapacity Resolved bound for each managed subscriber.
   */
  private constructor(
    options: NodeCoordinatorOptions,
    server: http2.Http2Server,
    address: AddressInfo,
    sessions: Set<http2.ServerHttp2Session>,
    subscriptionQueueCapacity: number,
  ) {
    this.#members = options.members;
    this.#readerAdmission = options.readerAdmission;
    this.#forwardingProof = options.forwardingProof;
    this.#readMaxBytes = options.readMaxBytes ?? defaultMessageMaxBytes;
    this.#subscriptionQueueCapacity = subscriptionQueueCapacity;
    this.#unaryKernel = new BackendMembershipKernel(
      NodeCoordinatorValues.unaryKernelOptions(
        undefined,
        this.#forwardingProof,
        this.#readMaxBytes,
        (bytes) => this.#readerFor(bytes),
      ),
    );
    this.#subscriptionKernel = this.#makeSubscriptionKernel(options.members);
    this.#server = server;
    this.#sessions = sessions;
    this.host = address.address;
    this.port = address.port;
    this.baseUrl = `http://${NodeCoordinatorValues.formatHostForUrl(this.host)}:${this.port.toString()}`;
    const reconcile = () => {
      this.#scheduleReconciliation();
    };
    this.#stopMembers = [
      options.members.onReadyMembersChange(reconcile),
      options.members.onRelayMembersChange(reconcile),
    ];
  }

  /**
   * Builds the subscription kernel with reader provenance for each child.
   *
   * @param members The available backend member source.
   * @returns The native subscription kernel.
   */
  #makeSubscriptionKernel(members: ReadyMemberSource) {
    return new BackendMembershipKernel(
      NodeCoordinatorValues.unaryKernelOptions(
        members,
        this.#forwardingProof,
        this.#readMaxBytes,
        (bytes) => this.#readerFor(bytes),
        (definition, child) => {
          this.#rememberChild(definition, child);
        },
      ),
    );
  }

  /**
   * Serializes membership refresh after readiness or relay changes.
   */
  #scheduleReconciliation(): void {
    this.#membershipReconciliation = this.#membershipReconciliation
      .then(
        () => this.#reconcile(),
        () => this.#reconcile(),
      )
      .catch(() => undefined);
  }

  /**
   * Opens one generated unary-service listener.
   *
   * @param options Supplies private membership and listener configuration.
   * @returns The running private Coordinator.
   */
  static async open(options: NodeCoordinatorOptions): Promise<NodeCoordinator> {
    const subscriptionQueueCapacity = ServerEnvironment.instance().subscriptionQueueCapacity;
    const { host, port, readMaxBytes, writeMaxBytes } = this.#listenerOptions(options);
    // eslint-disable-next-line prefer-const -- routes capture the Coordinator before the listener exists.
    let coordinator: NodeCoordinator;
    const sessions = new Set<http2.ServerHttp2Session>();
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          this.#routes(router, () => coordinator);
        },
        readMaxBytes,
        writeMaxBytes,
      }),
    );
    this.#trackSessions(server, sessions);
    const address = await NodeCoordinatorValues.listen(server, host, port);
    coordinator = new NodeCoordinator(
      options,
      server,
      address,
      sessions,
      subscriptionQueueCapacity,
    );
    await coordinator.#reconcile();
    return coordinator;
  }

  /**
   * Registers native service routes after the listener receives its Coordinator instance.
   *
   * @param router Connect router for the private listener.
   * @param current Returns the initialized Coordinator at request time.
   */
  static #routes(router: ConnectRouter, current: () => NodeCoordinator): void {
    router.service(CommandService, {
      post: (command, context) => current().#post(command, context),
    });
    router.service(QueryService, {
      read: (query, context) => current().#read(query, context),
      execute: (query, context) => current().#execute(query, context),
    });
    router.service(SubscriptionService, {
      subscribe: (topic, context) => current().#subscribe(topic, context),
      activate: (subscription, context) => current().#activate(subscription, context),
      cancel: (subscription, context) => current().#cancel(subscription, context),
    });
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
   * Tracks HTTP/2 sessions for normal listener cleanup.
   *
   * @param server The private Coordinator listener.
   * @param sessions Receives active HTTP/2 sessions.
   */
  static #trackSessions(server: http2.Http2Server, sessions: Set<http2.ServerHttp2Session>): void {
    server.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
  }

  /**
   * Stops public intake, active sessions, and private child clients.
   *
   * @returns Completion after bounded Coordinator cleanup.
   */
  close(): Promise<void> {
    this.#admissionShutdown.abort();
    this.#close ??= this.#closeOnce().catch((error: unknown) => {
      this.#close = undefined;
      throw error;
    });
    return this.#close;
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

  /**
   * Admits a command reader and forwards the command to a managed child.
   *
   * @param command Command envelope from the native client.
   * @param context The trusted context for this operation.
   * @returns Child acknowledgment after forwarding.
   */
  async #post(command: Command, context: HandlerContext): Promise<Ack> {
    return this.#runAdmitted(
      "spine.client.CommandService",
      "Post",
      toBinary(CommandService.method.post.input, command),
      context,
      async (reader, signal) => {
        const request: CoordinatorCommand = {
          kind: "command",
          command,
          context,
          reader,
          signal,
          response: create(AckSchema),
        };
        await this.#forward(request);
        return request.response;
      },
    );
  }

  /**
   * Admits a read reader and forwards the query to a managed child.
   *
   * @param query Query envelope from the native client.
   * @param context The trusted context for this operation.
   * @returns Child read response after forwarding.
   */
  async #read(query: Query, context: HandlerContext): Promise<QueryResponse> {
    return this.#runAdmitted(
      "spine.client.QueryService",
      "Read",
      toBinary(QuerySchema, query),
      context,
      async (reader, signal) => {
        ReadRequestStatus.check("query", () => Validate.check(QuerySchema, query));
        const request: CoordinatorQuery = {
          kind: "query",
          query,
          context,
          reader,
          signal,
          response: create(QueryResponseSchema),
        };
        await this.#forward(request);
        return request.response;
      },
    );
  }

  /**
   * Admits an App Query and forwards it to a ready application replica.
   *
   * @param query App Query envelope.
   * @param context Native RPC context.
   * @returns The application replica's response.
   */
  async #execute(query: AppQuery, context: HandlerContext): Promise<AppQueryResponse> {
    return this.#runAdmitted(
      "spine.client.QueryService",
      "Execute",
      toBinary(QueryService.method.execute.input, query),
      context,
      async (reader, signal) => {
        ReadRequestStatus.check("query", () => Validate.check(AppQuerySchema, query));
        const request: CoordinatorAppQuery = {
          kind: "app-query",
          query,
          context,
          reader,
          signal,
          response: create(AppQueryResponseSchema),
        };
        await this.#forward(request);
        return request.response;
      },
    );
  }

  /**
   * Verifies forwarded or direct reader facts at the managed ingress.
   *
   * @param service Canonical RPC service.
   * @param method Canonical RPC method.
   * @param request Canonical request bytes.
   * @param context Native transport context.
   * @param signal Host-managed operation lifetime.
   * @returns Captured reader admission and invalidation.
   */
  #admit(
    service: string,
    method: string,
    request: Uint8Array,
    context: HandlerContext,
    signal: AbortSignal,
  ): Promise<ReaderAdmissionResult> {
    return TrustedReaderIngress.admit({
      service,
      method,
      request,
      headers: context.requestHeader,
      peer: context,
      signal,
      maxBytes: this.#readMaxBytes,
      ...this.#readerAdmission,
    });
  }

  /**
   * Holds one unary operation through admission and child work.
   *
   * @typeParam T Native response type.
   * @param service Canonical RPC service.
   * @param method Canonical RPC method.
   * @param bytes Canonical request bytes.
   * @param context Original peer metadata.
   * @param work Verified action using the effective signal.
   * @returns Result while admission remains valid.
   */
  async #runAdmitted<T>(
    service: string,
    method: string,
    bytes: Uint8Array,
    context: HandlerContext,
    work: (reader: TrustedReaderContext, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const operation = new NativeOperation(context.signal, this.#admissionShutdown.signal);
    try {
      const admission = await this.#admit(service, method, bytes, context, operation.signal);
      operation.link(admission.invalidated);
      operation.check();
      const result = await work(admission.reader, operation.signal);
      operation.check();
      return result;
    } finally {
      operation.close();
    }
  }

  /**
   * Validates and retains a reader-bound subscription definition.
   *
   * @param topic Framework subscription Topic.
   * @param context The trusted context for this operation.
   * @returns The new subscription definition.
   */
  async #subscribe(topic: Topic, context: HandlerContext): Promise<Subscription> {
    const operation = new NativeOperation(context.signal, this.#admissionShutdown.signal);
    try {
      const admission = await this.#admit(
        "spine.client.SubscriptionService",
        "Subscribe",
        toBinary(TopicSchema, topic),
        context,
        operation.signal,
      );
      operation.link(admission.invalidated);
      operation.check();
      const subscription = await this.#subscribeReader(topic, admission.reader, operation.signal);
      try {
        operation.check();
      } catch (error) {
        return await this.#compensateSubscribe(subscription, error);
      }
      return subscription;
    } finally {
      operation.close();
    }
  }

  /**
   * Removes a committed definition after a failed final admission check.
   *
   * @param subscription Created logical definition.
   * @param error Final admission failure.
   * @returns Rejected completion after conditional cleanup.
   */
  async #compensateSubscribe(subscription: Subscription, error: unknown): Promise<never> {
    this.#clearPendingActivation(subscription);
    try {
      await this.#cancelDefinition(
        toBinary(SubscriptionSchema, subscription),
        new AbortController().signal,
      );
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Coordinator Subscribe cleanup failed.");
    }
    throw error;
  }

  /**
   * Creates a reader-bound definition under its native operation lifetime.
   *
   * @param topic Framework subscription Topic.
   * @param reader Detached authenticated facts.
   * @param signal Effective cancellation.
   * @returns Created logical definition.
   */
  async #subscribeReader(
    topic: Topic,
    reader: TrustedReaderContext,
    signal: AbortSignal,
  ): Promise<Subscription> {
    ReadRequestStatus.check("topic", () => Validate.check(TopicSchema, topic));
    if (this.#draining) throw new ConnectError("Managed application is closing.", Code.Unavailable);
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: `s-${randomUUID()}` }),
      topic,
    });
    const id = subscription.id?.value;
    if (id === undefined) throw new Error("Created subscription has no ID.");
    const definition = toBinary(SubscriptionSchema, subscription);
    this.#readers.set(id, reader);
    try {
      await this.#createDefinition(definition, signal);
    } catch (error) {
      if (!(error instanceof AggregateError)) this.#forgetReader(id);
      if (signal.aborted && !(error instanceof AggregateError))
        throw new ConnectError("Reader operation cancelled.", Code.Canceled);
      throw this.#availabilityError(error);
    }
    if (this.#isDraining() || signal.aborted) {
      await this.#cancelDefinition(definition, new AbortController().signal);
      throw new ConnectError("Managed application is closing.", Code.Unavailable);
    }
    this.#schedulePendingActivation(subscription);
    return subscription;
  }

  /**
   * Cancels a pending child creation when the requesting reader loses authority.
   *
   * @param definition Logical subscription definition.
   * @param signal Reader operation lifetime.
   * @returns Completion after creation or conditional cancellation settles.
   */
  async #createDefinition(definition: Uint8Array, signal: AbortSignal): Promise<void> {
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      cancellation = this.#cancelDefinition(definition, new AbortController().signal);
      void cancellation.catch(() => undefined);
    };
    signal.addEventListener("abort", abort, { once: true });
    let failed = false;
    let primary: unknown;
    try {
      await this.#subscriptionKernel.subscribe(definition, signal);
    } catch (error) {
      failed = true;
      primary = error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
    if (signal.aborted && cancellation === undefined) abort();
    try {
      await cancellation;
    } catch (cleanup) {
      throw new AggregateError(
        failed ? [primary, cleanup] : [cleanup],
        "Subscription cancellation failed.",
      );
    }
    if (failed) throw primary;
    if (signal.aborted) throw new ConnectError("Reader operation cancelled.", Code.Canceled);
  }

  /**
   * Reads current admission state after an asynchronous backend Subscribe.
   *
   * @returns Whether the Coordinator is draining.
   */
  #isDraining(): boolean {
    return this.#draining;
  }

  /**
   * Verifies membership and activates a retained subscription.
   *
   * @param subscription The subscription definition being processed.
   * @param context The trusted context for this operation.
   * @returns The update stream after admission.
   */
  async *#activate(
    subscription: Subscription,
    context: HandlerContext,
  ): AsyncIterable<SubscriptionUpdate> {
    const operation = new NativeOperation(context.signal, this.#admissionShutdown.signal);
    try {
      await this.#admitActivation(subscription, context, operation);
      operation.check();
      yield* this.#relayActivation(subscription, operation);
    } finally {
      operation.close();
    }
  }

  /**
   * Relays one admitted definition through ACK and complete child iteration.
   *
   * @param subscription Retained logical definition.
   * @param operation Host-managed activation lifetime.
   * @returns ACK and surviving updates.
   */
  async *#relayActivation(
    subscription: Subscription,
    operation: NativeOperation,
  ): AsyncIterable<SubscriptionUpdate> {
    if (this.#draining) throw new ConnectError("Managed application is closing.", Code.Unavailable);
    const definition = toBinary(SubscriptionSchema, subscription);
    this.#clearPendingActivation(subscription);
    const overflow = new AbortController();
    const abort = () => {
      overflow.abort();
    };
    operation.signal.addEventListener("abort", abort, { once: true });
    if (operation.signal.aborted) abort();
    const updates = new SubscriptionUpdateQueue(this.#subscriptionQueueCapacity, abort);
    const ack = Promise.withResolvers<SubscriptionUpdate | undefined>();
    const activation = this.#activateChild(definition, subscription, updates, ack, overflow.signal);
    let failure: Error | undefined;
    try {
      const ready = await ack.promise;
      operation.check();
      if (ready !== undefined) yield ready;
      for await (const update of updates) {
        operation.check();
        yield update;
      }
    } catch (error) {
      failure = NodeCoordinatorValues.error(error);
    } finally {
      operation.signal.removeEventListener("abort", abort);
      overflow.abort();
      updates.close();
      await this.#finishActivation(definition, activation, failure);
    }
  }

  /**
   * Admits and validates a reader-bound activation before changing pending state.
   *
   * @param subscription The subscription definition being processed.
   * @param context The trusted context for this operation.
   * @returns Completion after the operation settles.
   */
  async #admitActivation(
    subscription: Subscription,
    context: HandlerContext,
    operation: NativeOperation,
  ): Promise<void> {
    const admission = await this.#admit(
      "spine.client.SubscriptionService",
      "Activate",
      toBinary(SubscriptionSchema, subscription),
      context,
      operation.signal,
    );
    operation.link(admission.invalidated);
    operation.check();
    ReadRequestStatus.check("subscription", () => Validate.check(SubscriptionSchema, subscription));
    ReadRequestStatus.checkLifecycleCriterion(subscription);
    this.#requireReader(subscription, admission.reader);
  }

  /**
   * Relays accepted child updates through the bounded logical stream.
   *
   * @param definition The validated child subscription bytes.
   * @param subscription The logical subscription exposed to callers.
   * @param updates The bounded caller stream queue.
   * @param ack The separate activation acknowledgment gate.
   * @param signal Cancels the active child relay.
   * @returns Completion after the backend activation ends.
   */
  #activateChild(
    definition: Uint8Array,
    subscription: Subscription,
    updates: SubscriptionUpdateQueue,
    ack: PromiseWithResolvers<SubscriptionUpdate | undefined>,
    signal: AbortSignal,
  ): Promise<void> {
    return this.#subscriptionKernel
      .activate(
        definition,
        async (childUpdate) => {
          if (signal.aborted) return;
          const update = fromBinary(SubscriptionUpdateSchema, childUpdate);
          update.subscription = clone(SubscriptionSchema, subscription);
          if (update.response?.status?.status.case === "ok" && update.update.case === undefined) {
            ack.resolve(update);
            return;
          }
          await updates.push(update);
        },
        signal,
      )
      .finally(() => {
        ack.resolve(undefined);
        updates.close();
      });
  }

  /**
   * Finishes one activated stream and clears pending state.
   *
   * @param definition The serialized subscription definition.
   * @param activation Activation task and its stream state.
   * @param previousFailure Earlier lifecycle failure.
   * @returns Completion after the operation settles.
   */
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

  /**
   * Verifies reader membership and removes a retained subscription.
   *
   * @param subscription The subscription definition being processed.
   * @param context The trusted context for this operation.
   * @returns The cancellation acknowledgment.
   */
  async #cancel(subscription: Subscription, context: HandlerContext): Promise<Response> {
    return this.#runAdmitted(
      "spine.client.SubscriptionService",
      "Cancel",
      toBinary(SubscriptionSchema, subscription),
      context,
      (reader, signal) => this.#cancelReader(subscription, reader, signal),
    );
  }

  /**
   * Checks reader binding before removing an existing definition.
   *
   * @param subscription Logical definition.
   * @param reader Detached authenticated facts.
   * @param signal Effective cancellation.
   * @returns Cancellation acknowledgment.
   */
  async #cancelReader(
    subscription: Subscription,
    reader: TrustedReaderContext,
    signal: AbortSignal,
  ): Promise<Response> {
    ReadRequestStatus.check("subscription", () => Validate.check(SubscriptionSchema, subscription));
    ReadRequestStatus.checkLifecycleCriterion(subscription);
    const id = subscription.id?.value;
    if (id !== undefined && this.#readers.has(id)) this.#requireReader(subscription, reader);
    else
      return create(ResponseSchema, {
        status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
      });
    this.#clearPendingActivation(subscription);
    await this.#cancelDefinition(toBinary(SubscriptionSchema, subscription), signal);
    return create(ResponseSchema, {
      status: create(StatusSchema, { status: { case: "ok", value: create(EmptySchema) } }),
    });
  }

  /**
   * Forwards a verified request to the selected managed child.
   *
   * @param request The request being processed.
   * @returns Completion after the operation settles.
   */
  async #forward(request: CoordinatorRequest): Promise<void> {
    if (this.#draining)
      throw new ConnectError("No ready application replica is available.", Code.Unavailable);
    if (request.signal.aborted)
      throw new ConnectError("Reader operation cancelled.", Code.Canceled);
    try {
      await this.#unaryKernel.forward(request);
    } catch (error) {
      throw this.#availabilityError(error);
    }
  }

  /**
   * Maps child transport failure to the public availability status.
   *
   * @param error The failure being classified or propagated.
   * @returns The public transport error.
   */
  #availabilityError(error: unknown): unknown {
    return error instanceof Error && error.message === "backend membership is unavailable."
      ? new ConnectError("No ready application replica is available.", Code.Unavailable)
      : error;
  }

  /**
   * Starts the activation handshake expiry for a new subscription.
   *
   * @param subscription The subscription definition being processed.
   */
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

  /**
   * Forwards cancellation of a native subscription definition.
   *
   * @param definition The serialized subscription definition.
   * @param signal The cancellation signal for this operation.
   * @returns Completion after the operation settles.
   */
  #cancelDefinition(definition: Uint8Array, signal: AbortSignal): Promise<void> {
    const id = NodeCoordinatorValues.requiredValue(
      fromBinary(SubscriptionSchema, definition).id?.value,
      "Coordinator subscription definition is missing an ID.",
    );
    const active = this.#cancellations.get(id);
    if (active !== undefined) return active;
    const cancellation = this.#subscriptionKernel
      .cancel(definition, signal)
      .then(() => {
        this.#forgetReader(id);
      })
      .finally(() => {
        if (this.#cancellations.get(id) === cancellation) this.#cancellations.delete(id);
      });
    this.#cancellations.set(id, cancellation);
    return cancellation;
  }

  /**
   * Verifies and refreshes the reader before subscription effects.
   *
   * @param subscription The subscription definition being processed.
   * @param reader The verified reader facts for this operation.
   */
  #requireReader(subscription: Subscription, reader: TrustedReaderContext): void {
    const id = subscription.id?.value;
    const previous = id === undefined ? undefined : this.#readers.get(id);
    if (id === undefined || previous === undefined) throw ReadRequestStatus.unknownSubscription();
    if (!ReaderIdentities.matches(ReaderIdentities.from(previous), ReaderIdentities.from(reader)))
      throw new ConnectError("Subscription reader is not authorized.", Code.PermissionDenied);
    this.#readers.set(id, reader);
    for (const child of this.#children.get(id) ?? []) this.#readers.set(child, reader);
  }

  /**
   * Associates one native child with the admitted logical reader.
   *
   * @param definition The serialized subscription definition.
   * @param child The native child subscription definition.
   */
  #rememberChild(definition: Uint8Array, child: Uint8Array): void {
    const id = fromBinary(SubscriptionSchema, definition).id?.value;
    const childId = fromBinary(SubscriptionSchema, child).id?.value;
    if (id === undefined || childId === undefined) return;
    const logicalId = this.#logicalForChild.get(id) ?? (this.#readers.has(id) ? id : undefined);
    if (logicalId === undefined) return;
    const children = this.#children.get(logicalId) ?? new Set<string>();
    children.add(childId);
    this.#children.set(logicalId, children);
    this.#logicalForChild.set(childId, logicalId);
    const reader = this.#readers.get(id);
    if (reader !== undefined) this.#readers.set(childId, reader);
  }

  /**
   * Returns current detached facts for a logical or child subscription.
   *
   * @param bytes The serialized message bytes.
   * @returns The verified reader for this subscription.
   */
  #readerFor(bytes: Uint8Array): TrustedReaderContext | undefined {
    const id = fromBinary(SubscriptionSchema, bytes).id?.value;
    const reader = id === undefined ? undefined : this.#readers.get(id);
    return reader === undefined ? undefined : snapshotTrustedReader(reader);
  }

  /**
   * Removes a finished logical definition and its current child mappings.
   *
   * @param id The stable identifier for this record.
   */
  #forgetReader(id: string): void {
    this.#readers.delete(id);
    for (const child of this.#children.get(id) ?? []) {
      this.#readers.delete(child);
      this.#logicalForChild.delete(child);
    }
    this.#children.delete(id);
  }

  /**
   * Removes a pending activation timer and its tracking entry.
   *
   * @param subscription The subscription definition being processed.
   */
  #clearPendingActivation(subscription: Subscription): void {
    const id = subscription.id?.value;
    if (id === undefined) return;
    const pending = this.#pendingActivations.get(id);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    this.#pendingActivations.delete(id);
  }

  /**
   * Expires an unactivated subscription after its handshake window.
   *
   * @param id The stable identifier for this record.
   * @param pending Pending activation or retry state.
   * @returns Completion after the operation settles.
   */
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

  /**
   * Reconciles managed child subscriptions after topology changes.
   *
   * @returns Completion after the operation settles.
   */
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

  /**
   * Runs shutdown once while concurrent callers await the same completion.
   *
   * @returns Completion after the operation settles.
   */
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

/**
 * Command request, caller context, and acknowledgment queued for coordination.
 */
interface CoordinatorCommand {
  readonly kind: "command";
  readonly command: Command;
  readonly context: HandlerContext;
  readonly signal: AbortSignal;
  readonly reader: TrustedReaderContext;
  response: Ack;
}

/**
 * Entity query request, reader context, and response queued for coordination.
 */
interface CoordinatorQuery {
  readonly kind: "query";
  readonly query: Query;
  readonly context: HandlerContext;
  readonly signal: AbortSignal;
  readonly reader: TrustedReaderContext;
  response: QueryResponse;
}

/**
 * Application Query request and response carried across the Coordinator queue.
 */
interface CoordinatorAppQuery {
  readonly kind: "app-query";
  readonly query: AppQuery;
  readonly context: HandlerContext;
  readonly signal: AbortSignal;
  readonly reader: TrustedReaderContext;
  response: AppQueryResponse;
}

/**
 * Command or read request admitted to the Coordinator queue.
 */
type CoordinatorRequest = CoordinatorCommand | CoordinatorQuery | CoordinatorAppQuery;

/**
 * Serialized subscription definition awaiting activation before its deadline.
 */
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
  #active: { update: SubscriptionUpdate; delivered: boolean; resolve: () => void } | undefined;

  readonly #updates: { update: SubscriptionUpdate; delivered: boolean; resolve: () => void }[] = [];

  readonly #waiters: ((value: IteratorResult<SubscriptionUpdate>) => void)[] = [];

  readonly #limit: number;

  readonly #onOverflow: () => void;

  #closed = false;

  /**
   * Creates one terminal bounded update queue.
   *
   * @param limit Maximum waiting updates beyond one active update.
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
    if (this.#active !== undefined && this.#updates.length >= this.#limit) {
      this.#onOverflow();
      this.close();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const entry = { update, delivered: false, resolve };
      if (this.#active === undefined) {
        this.#active = entry;
        const waiter = this.#waiters.shift();
        if (waiter !== undefined) waiter(this.#deliver(entry));
      } else this.#updates.push(entry);
    });
  }

  /**
   * Closes the queue and releases all waiting producers and consumers.
   */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#active?.resolve();
    this.#active = undefined;
    for (const update of this.#updates.splice(0)) update.resolve();
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  /**
   * Resolves one waiting consumer with the next queued subscription update.
   */
  #deliver(entry: {
    update: SubscriptionUpdate;
    delivered: boolean;
    resolve: () => void;
  }): IteratorResult<SubscriptionUpdate> {
    entry.delivered = true;
    entry.resolve();
    return { value: entry.update, done: false };
  }

  /**
   * Returns queued updates until the terminal close.
   *
   * @returns The asynchronous update iterator.
   */
  [Symbol.asyncIterator](): AsyncIterator<SubscriptionUpdate> {
    return {
      next: (): Promise<IteratorResult<SubscriptionUpdate>> => {
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        if (this.#active?.delivered) this.#active = this.#updates.shift();
        if (this.#active !== undefined) return Promise.resolve(this.#deliver(this.#active));
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
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @param readerFor Reader lookup for a retained subscription.
   * @param onRememberChild Records a native child ID for its logical subscription.
   */
  unaryKernelOptions(
    members?: ReadyMemberSource,
    issuer?: ReaderProofIssuer,
    maxBytes = defaultMessageMaxBytes,
    readerFor?: (definition: Uint8Array) => TrustedReaderContext | undefined,
    onRememberChild?: (definition: Uint8Array, child: Uint8Array) => void,
  ): BackendMembershipKernelOptions<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  > {
    return {
      create: (member: ReadyCoordinatorMember) =>
        Promise.resolve(
          NodeCoordinatorValues.client(
            member,
            members,
            issuer,
            maxBytes,
            readerFor,
            onRememberChild,
          ),
        ),
      memberKey: (member: ReadyCoordinatorMember) =>
        `${member.slot.toString()}/${member.incarnation}`,
      sameMember: (left: ReadyCoordinatorMember, right: ReadyCoordinatorMember) =>
        left.endpoint === right.endpoint,
      definitionKey: (definition) => fromBinary(SubscriptionSchema, definition).id?.value,
      childDefinition: (definition, member) =>
        NodeCoordinatorValues.rememberChildDefinition(definition, member, onRememberChild),
      childSize: (child) => child.byteLength,
      ...NodeCoordinatorValues.activationAckOptions(members),
    };
  },

  /**
   * Builds and records a child definition before member subscription.
   *
   * @param definition The serialized subscription definition.
   * @param member The selected backend member.
   * @param onRememberChild Records a native child ID for its logical subscription.
   * @returns The retained managed-child definition.
   */
  rememberChildDefinition(
    definition: Uint8Array,
    member: ReadyCoordinatorMember,
    onRememberChild?: (definition: Uint8Array, child: Uint8Array) => void,
  ): Uint8Array {
    const child = NodeCoordinatorValues.childDefinition(definition, member);
    onRememberChild?.(definition, child);
    return child;
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
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @param readerFor Reader lookup for a retained subscription.
   * @param onRememberChild Records a native child ID for its logical subscription.
   */
  client(
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    issuer?: ReaderProofIssuer,
    maxBytes = defaultMessageMaxBytes,
    readerFor?: (definition: Uint8Array) => TrustedReaderContext | undefined,
    onRememberChild?: (definition: Uint8Array, child: Uint8Array) => void,
  ): BackendMemberClient<CoordinatorRequest, Uint8Array, Uint8Array> {
    const manager = new Http2SessionManager(member.endpoint);
    const transport = createGrpcTransport({ baseUrl: member.endpoint, sessionManager: manager });
    return {
      forward: (request) => NodeCoordinatorValues.forward(transport, request, issuer, maxBytes),
      close: () => NodeCoordinatorValues.closeManager(manager),
      subscribe: (definition, signal) =>
        NodeCoordinatorValues.subscribeChild(
          transport,
          definition,
          signal,
          readerFor?.(definition),
          issuer,
          maxBytes,
          onRememberChild,
        ),
      ...NodeCoordinatorValues.childOperations(
        transport,
        member,
        members,
        issuer,
        maxBytes,
        readerFor,
      ),
    };
  },

  /**
   * Closes the transport manager for a departed native member.
   *
   * @param manager Native session manager.
   * @returns Completion after the operation settles.
   */
  closeManager(manager: Http2SessionManager): Promise<void> {
    manager.abort();
    return Promise.resolve();
  },

  /**
   * Returns streaming and cancellation operations for a native member.
   *
   * @param transport The connected native transport.
   * @param member The selected backend member.
   * @param members The available backend member source.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @param readerFor Reader lookup for a retained subscription.
   * @returns The managed-child operations.
   */
  childOperations(
    transport: ReturnType<typeof createGrpcTransport>,
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
    readerFor?: (definition: Uint8Array) => TrustedReaderContext | undefined,
  ) {
    return {
      activate: NodeCoordinatorValues.activation(
        transport,
        member,
        members,
        issuer,
        maxBytes,
        readerFor,
      ),
      dispose: (child: Uint8Array, signal: AbortSignal) =>
        NodeCoordinatorValues.cancelChild(
          transport,
          member,
          members,
          child,
          signal,
          readerFor?.(child),
          issuer,
          maxBytes,
        ),
    };
  },

  /**
   * Captures native member context for one child stream.
   *
   * @param transport The connected native transport.
   * @param member The selected backend member.
   * @param members The available backend member source.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @param readerFor Reader lookup for a retained subscription.
   * @returns The activation stream completion.
   */
  activation(
    transport: ReturnType<typeof createGrpcTransport>,
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
    readerFor?: (definition: Uint8Array) => TrustedReaderContext | undefined,
  ) {
    return (
      child: Uint8Array,
      updates: (update: Uint8Array) => Promise<void>,
      signal: AbortSignal,
    ) =>
      NodeCoordinatorValues.activateChild(
        transport,
        member,
        members,
        child,
        updates,
        signal,
        readerFor?.(child),
        issuer,
        maxBytes,
      );
  },

  /**
   * Creates one native child and records any backend-assigned ID.
   *
   * @param transport The connected native transport.
   * @param definition The serialized subscription definition.
   * @param signal The cancellation signal for this operation.
   * @param reader The verified reader facts for this operation.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @param onRememberChild Records a native child ID for its logical subscription.
   * @returns The managed-child subscription.
   */
  async subscribeChild(
    transport: ReturnType<typeof createGrpcTransport>,
    definition: Uint8Array,
    signal: AbortSignal,
    reader: TrustedReaderContext | undefined,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
    onRememberChild?: (definition: Uint8Array, child: Uint8Array) => void,
  ): Promise<Uint8Array> {
    const subscription = fromBinary(SubscriptionSchema, definition);
    const topic = NodeCoordinatorValues.requiredValue(
      subscription.topic,
      "Coordinator subscription definition is missing a Topic.",
    );
    const headers = await NodeCoordinatorValues.readerHeaders(
      "Subscribe",
      toBinary(TopicSchema, topic),
      reader,
      issuer,
      maxBytes,
    );
    if (signal.aborted) throw new ConnectError("Reader operation cancelled.", Code.Canceled);
    const created = await createClient(SubscriptionService, transport).subscribe(topic, {
      signal,
      ...(headers === undefined ? {} : { headers }),
    });
    const bytes = toBinary(SubscriptionSchema, created);
    onRememberChild?.(definition, bytes);
    return bytes;
  },

  /**
   * Cancels one native child with the same verified reader as its creation.
   *
   * @param transport The connected native transport.
   * @param member The selected backend member.
   * @param members The available backend member source.
   * @param child The native child subscription definition.
   * @param signal The cancellation signal for this operation.
   * @param reader The verified reader facts for this operation.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @returns Completion after the operation settles.
   */
  async cancelChild(
    transport: ReturnType<typeof createGrpcTransport>,
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    child: Uint8Array,
    signal: AbortSignal,
    reader: TrustedReaderContext | undefined,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
  ): Promise<void> {
    const subscription = fromBinary(SubscriptionSchema, child);
    const headers = await NodeCoordinatorValues.readerHeaders(
      "Cancel",
      child,
      reader,
      issuer,
      maxBytes,
    );
    if (signal.aborted) throw new ConnectError("Reader operation cancelled.", Code.Canceled);
    members?.onChildSubscriptionCancelled?.(member, subscription);
    await createClient(SubscriptionService, transport).cancel(subscription, {
      signal,
      ...(headers === undefined ? {} : { headers }),
    });
  },

  /**
   * Sends one native Command, entity read, or App Query to a ready member.
   *
   * @param transport The connected native transport.
   * @param request The request to forward.
   * @returns Empty routing bytes after the response is assigned.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   */
  async forward(
    transport: ReturnType<typeof createGrpcTransport>,
    request: CoordinatorRequest,
    issuer?: ReaderProofIssuer,
    maxBytes = defaultMessageMaxBytes,
  ): Promise<Uint8Array> {
    const headers = await NodeCoordinatorValues.forwardHeaders(request, issuer, maxBytes);
    if (request.signal.aborted)
      throw new ConnectError("Reader operation cancelled.", Code.Canceled);
    if (request.kind === "command") {
      await NodeCoordinatorValues.forwardCommand(transport, request, headers);
    } else if (request.kind === "query") {
      const response = await transport.unary(
        QueryService.method.read,
        request.signal,
        request.context.timeoutMs(),
        headers,
        request.query,
      );
      NodeCoordinatorValues.responseMetadata(response.header, response.trailer, request.context);
      request.response = response.message;
    } else {
      const response = await transport.unary(
        QueryService.method.execute,
        request.signal,
        request.context.timeoutMs(),
        headers,
        request.query,
      );
      NodeCoordinatorValues.responseMetadata(response.header, response.trailer, request.context);
      request.response = response.message;
    }
    return new Uint8Array();
  },

  /**
   * Invokes the Command branch and retains its native response metadata.
   *
   * @param transport The selected native child transport.
   * @param request The admitted Command and response slot.
   * @param headers Operation-bound verified-reader metadata.
   * @returns Completion after assigning the native response.
   */
  async forwardCommand(
    transport: ReturnType<typeof createGrpcTransport>,
    request: CoordinatorCommand,
    headers: Headers,
  ): Promise<void> {
    const response = await transport.unary(
      CommandService.method.post,
      request.signal,
      request.context.timeoutMs(),
      headers,
      request.command,
    );
    NodeCoordinatorValues.responseMetadata(response.header, response.trailer, request.context);
    request.response = response.message;
  },

  /**
   * Encodes verified reader facts into one exact native unary operation.
   *
   * @param request The request being processed.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @returns The operation-bound forwarding headers.
   */
  async forwardHeaders(
    request: CoordinatorRequest,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
  ): Promise<Headers> {
    const service =
      request.kind === "command" ? "spine.client.CommandService" : "spine.client.QueryService";
    const method =
      request.kind === "command" ? "Post" : request.kind === "query" ? "Read" : "Execute";
    const value =
      request.kind === "command"
        ? toBinary(CommandService.method.post.input, request.command)
        : request.kind === "query"
          ? toBinary(QuerySchema, request.query)
          : toBinary(AppQuerySchema, request.query);
    const headers = NodeCoordinatorValues.applicationHeaders(request.context.requestHeader);
    if (
      issuer === undefined &&
      (request.reader.principal !== undefined || request.reader.authorityFacts !== undefined)
    )
      throw new ConnectError("Managed reader forwarding is unavailable.", Code.Internal);
    if (issuer !== undefined)
      for (const [name, entry] of Object.entries(
        await ReaderForwarding.seal(service, method, value, request.reader, issuer, maxBytes),
      ))
        headers.set(name, entry);
    return headers;
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
   * @param reader The verified reader facts for this operation.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   */
  async activateChild(
    transport: ReturnType<typeof createGrpcTransport>,
    member: ReadyCoordinatorMember,
    members: ReadyMemberSource | undefined,
    child: Uint8Array,
    updates: (update: Uint8Array) => Promise<void>,
    signal: AbortSignal,
    reader?: TrustedReaderContext,
    issuer?: ReaderProofIssuer,
    maxBytes = defaultMessageMaxBytes,
  ): Promise<void> {
    const subscription = fromBinary(SubscriptionSchema, child);
    const headers = await NodeCoordinatorValues.readerHeaders(
      "Activate",
      child,
      reader,
      issuer,
      maxBytes,
    );
    if (signal.aborted) throw new ConnectError("Reader operation cancelled.", Code.Canceled);
    members?.onChildSubscriptionActivated?.(member, subscription);
    for await (const update of createClient(SubscriptionService, transport).activate(subscription, {
      signal,
      ...(headers === undefined ? {} : { headers }),
    })) {
      NodeCoordinatorValues.checkChildUpdate(subscription, update);
      await updates(toBinary(SubscriptionUpdateSchema, update));
    }
  },

  /**
   * Rejects a native update for a different child ID or Topic.
   *
   * @param subscription The subscription definition being processed.
   * @param update Native subscription update.
   */
  checkChildUpdate(subscription: Subscription, update: SubscriptionUpdate): void {
    const topic = subscription.topic;
    const updateTopic = update.subscription?.topic;
    if (
      update.subscription?.id?.value !== subscription.id?.value ||
      topic === undefined ||
      updateTopic === undefined ||
      !equals(TopicSchema, updateTopic, topic)
    )
      throw new Error("Backend child update does not match its subscription.");
  },

  /**
   * Encodes one verified reader against the exact child subscription RPC.
   *
   * @param method The canonical RPC method name.
   * @param value Canonical child subscription RPC bytes.
   * @param reader The verified reader facts for this operation.
   * @param issuer The configured forwarding proof producer.
   * @param maxBytes The existing native message-size bound.
   * @returns The canonical reader assertion headers.
   */
  async readerHeaders(
    method: string,
    value: Uint8Array,
    reader: TrustedReaderContext | undefined,
    issuer: ReaderProofIssuer | undefined,
    maxBytes: number,
  ): Promise<Headers | undefined> {
    if (reader === undefined) return undefined;
    if (issuer === undefined) {
      if (reader.principal !== undefined || reader.authorityFacts !== undefined)
        throw new ConnectError("Managed reader forwarding is unavailable.", Code.Internal);
      return undefined;
    }
    return new Headers(
      await ReaderForwarding.seal(
        "spine.client.SubscriptionService",
        method,
        value,
        reader,
        issuer,
        maxBytes,
      ),
    );
  },

  /**
   * Snapshots backend response metadata into the public context.
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
   * Snapshots application headers for forwarding.
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
        name.startsWith("connect-") ||
        name === "spine-internal-reader" ||
        name === "spine-internal-reader-proof"
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
