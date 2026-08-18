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
import type { AddressInfo } from "node:net";

import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import {
  connectNodeAdapter,
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import { BackendMembershipKernel } from "@spine-event-engine/deployment/internal/backend-membership-kernel";
import { type Ack, type Command } from "@spine-event-engine/proto";
import {
  type Query,
  type QueryResponse,
  CommandService,
  QueryService,
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
  readonly endpoint: string;
  readonly incarnation: string;
  readonly pid: number;
  readonly slot: number;
}

/**
 * Supplies managed READY members and their change notification.
 *
 * @internal
 */
export interface ReadyMemberSource {
  readyMembers(): readonly ReadyCoordinatorMember[];
  onReadyMembersChange(listener: () => void): () => void;
}

/**
 * Configures one private local Node Coordinator listener.
 *
 * @internal
 */
export interface NodeCoordinatorOptions {
  readonly members: ReadyMemberSource;
  readonly host?: string;
  readonly port?: number;
  readonly readMaxBytes?: number;
  readonly writeMaxBytes?: number;
}

/**
 * Hosts generated unary services in front of managed complete replicas.
 *
 * @internal
 */
export class NodeCoordinator {
  readonly #members: ReadyMemberSource;
  readonly #kernel: BackendMembershipKernel<
    ReadyCoordinatorMember,
    CoordinatorRequest,
    unknown,
    never
  >;
  readonly #server: http2.Http2Server;
  readonly #sessions = new Set<http2.ServerHttp2Session>();
  readonly #stopMembers: () => void;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  #close: Promise<void> | undefined;
  #membershipReconciliation = Promise.resolve();

  private constructor(
    options: NodeCoordinatorOptions,
    server: http2.Http2Server,
    address: AddressInfo,
  ) {
    this.#members = options.members;
    this.#kernel = new BackendMembershipKernel({
      create: async (member) => NodeCoordinatorValues.client(member),
      memberKey: (member) => `${member.slot.toString()}/${member.incarnation}`,
      sameMember: (left, right) => left.endpoint === right.endpoint,
      definitionKey: () => undefined,
      childDefinition: (definition) => definition,
      childSize: () => 0,
    });
    this.#server = server;
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
    let coordinator: NodeCoordinator | undefined;
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          router.service(CommandService, {
            post: async (command, context) => {
              if (coordinator === undefined)
                throw new ConnectError("Node Coordinator is starting.", Code.Unavailable);
              return coordinator.#post(command, context);
            },
          });
          router.service(QueryService, {
            read: async (query, context) => {
              if (coordinator === undefined)
                throw new ConnectError("Node Coordinator is starting.", Code.Unavailable);
              return coordinator.#read(query, context);
            },
          });
        },
        readMaxBytes,
        writeMaxBytes,
      }),
    );
    server.on("session", (session) => {
      if (coordinator !== undefined) coordinator.#sessions.add(session);
      session.once("close", () => {
        if (coordinator !== undefined) coordinator.#sessions.delete(session);
      });
    });
    const address = await NodeCoordinatorValues.listen(server, host, port);
    coordinator = new NodeCoordinator(options, server, address);
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
    const request: CoordinatorCommand = { kind: "command", command, context };
    await this.#forward(request);
    const response = request.response;
    if (response === undefined)
      throw new ConnectError("Ready application replica returned no response.", Code.Internal);
    return response;
  }

  async #read(query: Query, context: HandlerContext): Promise<QueryResponse> {
    const request: CoordinatorQuery = { kind: "query", query, context };
    await this.#forward(request);
    const response = request.response;
    if (response === undefined)
      throw new ConnectError("Ready application replica returned no response.", Code.Internal);
    return response;
  }

  async #forward(request: CoordinatorRequest): Promise<void> {
    try {
      await this.#kernel.forward(request);
    } catch (error) {
      if (error instanceof Error && error.message === "backend membership is unavailable.")
        throw new ConnectError("No ready application replica is available.", Code.Unavailable);
      throw error;
    }
    if (request.response === undefined)
      throw new ConnectError("Ready application replica returned no response.", Code.Internal);
  }

  #reconcile(): Promise<void> {
    return this.#kernel.reconcile(this.#members.readyMembers());
  }

  async #closeOnce(): Promise<void> {
    this.#stopMembers();
    const network = NodeCoordinatorValues.closeNetwork(this.#server, this.#sessions);
    await Promise.all([network, this.#kernel.close()]);
  }
}

type CoordinatorCommand = {
  readonly kind: "command";
  readonly command: Command;
  readonly context: HandlerContext;
  response?: Ack;
};
type CoordinatorQuery = {
  readonly kind: "query";
  readonly query: Query;
  readonly context: HandlerContext;
  response?: QueryResponse;
};
type CoordinatorRequest = CoordinatorCommand | CoordinatorQuery;

const NodeCoordinatorValues = Object.freeze({
  async client(member: ReadyCoordinatorMember) {
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
      subscribe: async () => {
        throw new Error("Coordinator subscription forwarding belongs to T-0208.");
      },
      activate: async () => {
        throw new Error("Coordinator subscription forwarding belongs to T-0208.");
      },
      dispose: async () => undefined,
      close: async () => {
        manager.abort();
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
    for (const name of forwarded.keys()) {
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
