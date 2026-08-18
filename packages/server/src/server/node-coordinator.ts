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

import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
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
} from "@spine-event-engine/deployment/internal/backend-membership-kernel";
import { AckSchema, type Ack, type Command, type Response } from "@spine-event-engine/proto";
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
   *
   * Subscribes one callback after READY membership changes.
   *
   * @param onChange Runs after a new snapshot becomes current.
   * @returns Stops later membership callbacks.
   */
  onReadyMembersChange(onChange: () => void): () => void;
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
  readonly #kernel: BackendMembershipKernel<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  >;
  readonly #server: http2.Http2Server;
  readonly #sessions: Set<http2.ServerHttp2Session>;
  readonly #stopMembers: () => void;

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
  #membershipReconciliation = Promise.resolve();

  private constructor(
    options: NodeCoordinatorOptions,
    server: http2.Http2Server,
    address: AddressInfo,
    sessions: Set<http2.ServerHttp2Session>,
  ) {
    this.#members = options.members;
    this.#kernel = new BackendMembershipKernel(NodeCoordinatorValues.unaryKernelOptions());
    this.#server = server;
    this.#sessions = sessions;
    this.host = typeof address.address === "string" ? address.address : defaultHost;
    this.port = address.port;
    this.baseUrl = `http://${NodeCoordinatorValues.formatHostForUrl(this.host)}:${this.port.toString()}`;
    this.#stopMembers = options.members.onReadyMembersChange(() => {
      this.#membershipReconciliation = this.#membershipReconciliation
        .then(
          () => this.#reconcile(),
          () => this.#reconcile(),
        )
        .catch(() => undefined);
    });
  }

  /**
   * Opens one generated unary-service listener.
   *
   * @param options Supplies private membership and listener configuration.
   * @returns The running private Coordinator.
   */
  static async open(options: NodeCoordinatorOptions): Promise<NodeCoordinator> {
    const host = NodeCoordinatorValues.host(options.host ?? defaultHost);
    const port = NodeCoordinatorValues.port(options.port ?? defaultPort);
    const readMaxBytes = NodeCoordinatorValues.messageLimit(
      options.readMaxBytes ?? defaultMessageMaxBytes,
    );
    const writeMaxBytes = NodeCoordinatorValues.messageLimit(
      options.writeMaxBytes ?? defaultMessageMaxBytes,
    );
    // eslint-disable-next-line prefer-const -- routes capture the Coordinator before the listener exists.
    let coordinator: NodeCoordinator;
    const sessions = new Set<http2.ServerHttp2Session>();
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
    server.on("session", (session) => {
      sessions.add(session);
      session.once("close", () => sessions.delete(session));
    });
    const address = await NodeCoordinatorValues.listen(server, host, port);
    coordinator = new NodeCoordinator(options, server, address, sessions);
    await coordinator.#reconcile();
    return coordinator;
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
    const subscription = create(SubscriptionSchema, {
      id: create(SubscriptionIdSchema, { value: randomUUID() }),
      topic,
    });
    await this.#kernel.subscribe(toBinary(SubscriptionSchema, subscription), context.signal);
    return subscription;
  }

  async *#activate(
    subscription: Subscription,
    context: HandlerContext,
  ): AsyncIterable<SubscriptionUpdate> {
    const definition = toBinary(SubscriptionSchema, subscription);
    const updates = new SubscriptionUpdateQueue();
    const activation = this.#kernel
      .activate(
        definition,
        async (childUpdate) => {
          const update = fromBinary(SubscriptionUpdateSchema, childUpdate);
          update.subscription = clone(SubscriptionSchema, subscription);
          await updates.push(update);
        },
        context.signal,
      )
      .finally(() => updates.close());
    try {
      for await (const update of updates) yield update;
    } finally {
      updates.close();
      await activation;
    }
  }

  async #cancel(subscription: Subscription, context: HandlerContext): Promise<Response> {
    await this.#kernel.cancel(toBinary(SubscriptionSchema, subscription), context.signal);
    return create(SubscriptionService.method.cancel.output);
  }

  async #forward(request: CoordinatorRequest): Promise<void> {
    try {
      await this.#kernel.forward(request);
    } catch (error) {
      if (error instanceof Error && error.message === "backend membership is unavailable.")
        throw new ConnectError("No ready application replica is available.", Code.Unavailable);
      throw error;
    }
  }

  #reconcile(): Promise<void> {
    return this.#kernel.reconcile(this.#members.readyMembers());
  }

  async #closeOnce(): Promise<void> {
    this.#stopMembers();
    await this.#membershipReconciliation;
    const network = NodeCoordinatorValues.closeNetwork(this.#server, this.#sessions);
    await Promise.all([network, this.#kernel.close()]);
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

class SubscriptionUpdateQueue implements AsyncIterable<SubscriptionUpdate> {
  readonly #updates: SubscriptionUpdate[] = [];
  readonly #waiters: ((value: IteratorResult<SubscriptionUpdate>) => void)[] = [];
  readonly #delivered: (() => void)[] = [];
  #closed = false;

  push(update: SubscriptionUpdate): Promise<void> {
    if (this.#closed) return Promise.resolve();
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter({ value: update, done: false });
      return Promise.resolve();
    }
    this.#updates.push(update);
    return new Promise((resolve) => this.#delivered.push(resolve));
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
    for (const delivered of this.#delivered.splice(0)) delivered();
  }

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
  unaryKernelOptions(): BackendMembershipKernelOptions<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    Uint8Array,
    Uint8Array
  > {
    // The Coordinator deliberately uses only the kernel's member lifecycle and
    // one-shot forwarding operations. Subscription fan-out is owned by T-0208.
    return {
      create: (member: ReadyCoordinatorMember) =>
        Promise.resolve(NodeCoordinatorValues.client(member)),
      memberKey: (member: ReadyCoordinatorMember) =>
        `${member.slot.toString()}/${member.incarnation}`,
      sameMember: (left: ReadyCoordinatorMember, right: ReadyCoordinatorMember) =>
        left.endpoint === right.endpoint,
      definitionKey: (definition) => fromBinary(SubscriptionSchema, definition).id?.value,
      childDefinition: (definition, member) => {
        const subscription = clone(SubscriptionSchema, fromBinary(SubscriptionSchema, definition));
        const id = subscription.id;
        if (id !== undefined) id.value = `${id.value}/${member.slot.toString()}`;
        return toBinary(SubscriptionSchema, subscription);
      },
      childSize: (child) => child.byteLength,
    };
  },
  client(
    member: ReadyCoordinatorMember,
  ): BackendMemberClient<CoordinatorRequest, Uint8Array, Uint8Array> {
    const manager = new Http2SessionManager(member.endpoint);
    const transport = createGrpcTransport({ baseUrl: member.endpoint, sessionManager: manager });
    return {
      forward: async (request: CoordinatorRequest) => {
        if (request.kind === "command") {
          const response = await transport.unary(
            CommandService.method.post,
            request.context.signal,
            request.context.timeoutMs(),
            NodeCoordinatorValues.applicationHeaders(request.context.requestHeader),
            request.command,
          );
          NodeCoordinatorValues.responseMetadata(
            response.header,
            response.trailer,
            request.context,
          );
          request.response = response.message;
        } else {
          const response = await transport.unary(
            QueryService.method.read,
            request.context.signal,
            request.context.timeoutMs(),
            NodeCoordinatorValues.applicationHeaders(request.context.requestHeader),
            request.query,
          );
          NodeCoordinatorValues.responseMetadata(
            response.header,
            response.trailer,
            request.context,
          );
          request.response = response.message;
        }
        return new Uint8Array();
      },
      close: () => {
        manager.abort();
        return Promise.resolve();
      },
      subscribe: async (definition, signal) => {
        const subscription = fromBinary(SubscriptionSchema, definition);
        const created = await createClient(SubscriptionService, transport).subscribe(
          subscription.topic ?? create(TopicSchema),
          { signal },
        );
        return toBinary(SubscriptionSchema, created);
      },
      activate: async (child, updates, signal) => {
        for await (const update of createClient(SubscriptionService, transport).activate(
          fromBinary(SubscriptionSchema, child),
          { signal },
        ))
          await updates(toBinary(SubscriptionUpdateSchema, update));
      },
      dispose: async (child, signal) => {
        await createClient(SubscriptionService, transport).cancel(
          fromBinary(SubscriptionSchema, child),
          { signal },
        );
      },
    };
  },
  responseMetadata(headers: Headers, trailers: Headers, context: HandlerContext): void {
    for (const [name, value] of NodeCoordinatorValues.applicationHeaders(headers))
      context.responseHeader.append(name, value);
    for (const [name, value] of NodeCoordinatorValues.applicationHeaders(trailers))
      context.responseTrailer.append(name, value);
  },
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
  host(value: string): string {
    const normalized = value.trim();
    if (normalized.length === 0) throw new Error("Server host must not be blank.");
    return normalized;
  },
  formatHostForUrl(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  },
  port(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > 65_535)
      throw new Error("Managed server port must be a safe integer between 0 and 65535.");
    return value;
  },
  messageLimit(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 0xffff_ffff)
      throw new Error(
        "Managed server message limit must be a safe integer between 1 and 4294967295.",
      );
    return value;
  },
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
  async closeNetwork(
    server: http2.Http2Server,
    sessions: ReadonlySet<http2.ServerHttp2Session>,
  ): Promise<void> {
    const closed = NodeCoordinatorValues.closeServer(server);
    await Promise.all([...sessions].map((session) => NodeCoordinatorValues.closeSession(session)));
    await closed;
  },
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
