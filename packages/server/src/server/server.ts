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

import type {
  AuthorizationPolicy,
  Clock,
  ContextResolver,
  OpaqueSessionCookies,
  SessionResolver,
  SubscriptionBindings,
} from "@spine-event-engine/auth";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { TypeRegistryLookup } from "@spine-event-engine/core";
import type { StorageFactory } from "@spine-event-engine/storage";
import type { NodeDiscovery } from "@spine-event-engine/deployment";

import {
  BoundedContext,
  BoundedContextBuilder,
  boundedContextAccess,
} from "../context/bounded-context.js";
import type { StandSubscriptionRegistry } from "../stand/subscription-registry.js";
import {
  SpineServices,
  spineServicesAccess,
  type SpineServicesOptions,
} from "../services/spine-services.js";
import { ContextTransportGroup } from "./context-transport-group.js";
import { BrowserServer } from "./browser-server.js";
import type {
  EnvironmentAttachmentHandle,
  EnvironmentOwnership,
} from "./environment-attachment.js";
import { ProcessServerCoordinator } from "./process-server-coordinator.js";
import { CloseErrors, RetryableCloseGroup } from "./retryable-close.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";
import { EnvironmentType } from "./environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const maximumMessageMaxBytes = 0xffff_ffff;
const gracefulSessionDrainMs = 100;
type ServerContext = BoundedContext | BoundedContextBuilder;
const runningContexts = new WeakMap<RunningServer, readonly BoundedContext[]>();

/**
 * Performs work coupled to listener readiness and network shutdown.
 */
export interface ListenerLifecycle {
  // prettier-ignore

  /**
   * Starts after the native listener accepts connections.
   *
   * @returns A value or promise that settles after readiness work.
   */
  start(): unknown;

  /**
   * Completes before the native listener stops accepting connections.
   *
   * @returns A value or promise that settles after shutdown work.
   */
  close(): unknown;
}

/**
 * Configures and starts local Spine Connect/gRPC-compatible services.
 *
 * A server assembles its bounded contexts, completes finite environment
 * delivery recovery, and opens their transport intake before accepting network
 * requests. It also owns the ordered cleanup of contexts and resources added
 * to this assembly.
 */
export class Server {
  readonly #host: string;
  readonly #port: number;
  readonly #readMaxBytes: number;
  readonly #writeMaxBytes: number;
  readonly #contexts: ServerContext[] = [];
  readonly #resources: { close(): unknown }[] = [];
  readonly #listenerLifecycles: ListenerLifecycle[] = [];
  readonly #services: Omit<SpineServicesOptions, "contexts">;
  readonly #browser: BrowserServerOptions | undefined;
  readonly #environment: ServerEnvironment;
  #starting: Promise<RunningServer> | undefined;
  #startingOwnership: EnvironmentOwnership | undefined;
  #run: Promise<RunningServer> | undefined;
  #failedStartCleanup: FailedStartCleanup | undefined;
  #failedListenerLifecycle: RunningHttp2Server | undefined;
  #failedStartConsumed = false;

  /**
   * Creates a server builder.
   *
   * @param options Configures local network, contexts, resources, and services.
   */
  constructor(options: ServerOptions = {}) {
    this.#host = ServerValues.normalizeHost(options.host);
    this.#port = options.port ?? defaultPort;
    this.#readMaxBytes = ServerValues.normalizeMessageMaxBytes(
      options.readMaxBytes ?? defaultMessageMaxBytes,
      "readMaxBytes",
    );
    this.#writeMaxBytes = ServerValues.normalizeMessageMaxBytes(
      options.writeMaxBytes ?? defaultMessageMaxBytes,
      "writeMaxBytes",
    );
    this.#contexts.push(...(options.contexts ?? []));
    this.#resources.push(...(options.resources ?? []));
    this.#services = options.services ?? {};
    this.#browser = options.browser;
    this.#environment = ServerEnvironment.instance();
  }

  /**
   * Creates a local-only server builder for one port.
   *
   * @param port Selects the listener port, or zero for an ephemeral port.
   * @param options Supplies all server options except the port.
   * @returns A configured server builder.
   */
  static atPort(port: number, options: Omit<ServerOptions, "port"> = {}): Server {
    return new Server({ ...options, port });
  }

  /**
   * Adds one bounded context or builder to the assembly.
   *
   * Builders assemble during {@link start} before recovery and listener open.
   * They use {@link ServerEnvironment.storageFactory} unless a more specific
   * `withStorageFactory(...)` factory is selected. The running server owns and
   * closes added contexts only after intake, sessions, and active work stop.
   *
   * @param context Supplies the context or builder to expose.
   * @returns This server builder.
   */
  add(context: BoundedContext | BoundedContextBuilder): this {
    this.#contexts.push(context);
    return this;
  }

  /**
   * Adds a framework closeable owned by this server assembly.
   *
   * @param resource Supplies the resource to close after contexts.
   * @returns This server builder.
   */
  addResource(resource: { close(): unknown }): this {
    this.#resources.push(resource);
    return this;
  }

  /**
   * Adds work that starts after listener readiness and closes before network intake stops.
   *
   * Failed starts roll back admitted lifecycles in reverse admission order. A
   * failed close remains retryable and prevents network shutdown until it settles.
   *
   * @param lifecycle Supplies listener-coupled lifecycle work, such as GCE registration.
   * @returns This server builder.
   */
  addListenerLifecycle(lifecycle: ListenerLifecycle): this {
    this.#listenerLifecycles.push(lifecycle);
    return this;
  }

  /**
   * Starts the server after completing assembly and delivery recovery.
   *
   * Built contexts open their transport registrations in deterministic input
   * order before the listener opens. A failed assembly, registration, or
   * listener open leaves no listener and closes acquired resources. Network
   * and transport cleanup are hard gates before delivery or dependencies close.
   * It shares only a caller-managed active environment generation, rejects
   * while run-managed ownership is active, installs no signal handlers, and
   * never closes the environment.
   * A later call after incomplete cleanup retries only that cleanup and leaves
   * this server terminal. A fresh server may reuse the singleton environment.
   * Concurrent callers share one start or cleanup attempt.
   *
   * @returns The running server once its listener accepts requests.
   */
  start(): Promise<RunningServer> {
    return this.#start("caller");
  }

  #start(ownership: EnvironmentOwnership): Promise<RunningServer> {
    const current = this.#starting;
    if (current !== undefined) {
      if (this.#startingOwnership !== ownership) {
        return Promise.reject(
          new Error("Server cannot mix caller-managed and run-managed startup attempts."),
        );
      }
      return current;
    }
    if (this.#failedStartConsumed) {
      return Promise.reject(
        new Error("Server cannot restart after failed-start cleanup has completed."),
      );
    }
    const cleanup = this.#failedStartCleanup;
    const lifecycle = this.#failedListenerLifecycle;
    const starting =
      lifecycle !== undefined
        ? this.#retryFailedListenerLifecycle(lifecycle)
        : cleanup === undefined
          ? this.#startOnce(ownership)
          : this.#retryFailedStartCleanup(cleanup);
    this.#starting = starting;
    this.#startingOwnership = ownership;
    void starting.then(
      () => {
        this.#finishStart(starting);
      },
      () => {
        this.#finishStart(starting);
      },
    );
    return starting;
  }

  /**
   * Starts this server with process-owned `SIGINT` and `SIGTERM` shutdown.
   *
   * This is the normal application entry point. Embedded applications should
   * use {@link start} and keep ownership of process signals themselves.
   * Concurrent calls on one builder return one managed handle. Run-managed
   * siblings share an active generation but reject while caller-managed
   * ownership is active. The final local environment-owning run retirement
   * permanently closes its environment; a standalone browser Gateway remains
   * signal-managed but never owns or closes that environment. A failed final
   * close stays retryable through `close()` or a later process signal.
   * Caller-managed servers never close their environment.
   *
   * @returns The running server after its listener accepts requests.
   */
  run(): Promise<RunningServer> {
    const current = this.#run;
    if (current !== undefined) return current;
    const environment = ServerValues.isStandaloneBrowser(this.#browser)
      ? undefined
      : this.#environment;
    const running = this.#start("server").then((server) =>
      ProcessServerCoordinator.add(
        server,
        environment,
        environment === undefined ? undefined : serverEnvironmentAccess.loggerFor(environment),
        () => {
          if (this.#run === running) {
            this.#run = undefined;
          }
        },
      ),
    );
    this.#run = running;
    void running.catch(() => {
      if (this.#run === running) {
        this.#run = undefined;
      }
    });
    return running;
  }

  async #startOnce(ownership: EnvironmentOwnership): Promise<RunningServer> {
    const browser = this.#browser;
    const standalone = ServerValues.isStandaloneBrowser(browser);
    if (browser?.backend !== undefined)
      BrowserServer.backendUrls(ServerValues.browserBackendUrls(browser.backend));
    if (
      standalone &&
      (this.#contexts.length > 0 ||
        this.#resources.length > 0 ||
        Object.keys(this.#services).length > 0 ||
        this.#listenerLifecycles.length > 0)
    )
      throw new Error(
        "Standalone browser server cannot own local contexts, services, or resources.",
      );
    if (browser !== undefined)
      BrowserServer.requireDurableBindings(
        browser,
        this.#environment.environment.type === EnvironmentType.Production,
      );
    if (standalone && browser !== undefined)
      return BrowserServer.open(
        browser.backend === undefined
          ? undefined
          : BrowserServer.backendUrls(ServerValues.browserBackendUrls(browser.backend)),
        {
          ...browser,
          host: browser.host ?? this.#host,
          port: browser.port ?? this.#port,
          readMaxBytes: this.#readMaxBytes,
          writeMaxBytes: this.#writeMaxBytes,
          production: this.#environment.environment.type === EnvironmentType.Production,
        },
      );
    const contexts = await ServerValues.buildContexts(
      this.#contexts,
      this.#environment.storageFactory,
    );
    const logger = serverEnvironmentAccess.loggerFor(this.#environment);
    for (const context of contexts) {
      boundedContextAccess.installLogger(context, logger);
      serverEnvironmentAccess.warnVolatileRegistry(this.#environment, context);
    }
    let attachment: EnvironmentAttachmentHandle;
    try {
      attachment = await serverEnvironmentAccess.attach(this.#environment, {
        ownership,
        descriptors: contexts.map((context) => boundedContextAccess.delivery(context)),
      });
    } catch (error) {
      const closeGroup = new RetryableCloseGroup(
        [...contexts, ...this.#resources],
        "Server start cleanup failed while closing owned contexts/resources.",
      );
      if (serverEnvironmentAccess.failedStartRetryPending(this.#environment, error)) {
        this.#failedStartCleanup = {
          closeGroup,
          failedStartRollback: { rejection: error },
        };
      } else {
        try {
          await closeGroup.close();
        } catch (cleanupError) {
          this.#failedStartCleanup = { closeGroup, failedStartRollback: undefined };
          throw ServerValues.attachmentCleanupError(error, cleanupError);
        }
        this.#failedStartConsumed = true;
      }
      throw error;
    }
    const closeables = [...contexts, ...this.#resources];
    const contextTransports = new ContextTransportGroup(this.#environment.transport);
    try {
      await contextTransports.open(contexts);
    } catch (error) {
      const cleanup: FailedStartCleanup = {
        closeGroup: new RetryableCloseGroup(
          closeables,
          "Server start cleanup failed while closing owned contexts/resources.",
        ),
        contextTransports,
        attachment,
        failedStartRollback: undefined,
      };
      this.#failedStartCleanup = cleanup;
      return this.#cleanupFailedContextStart(cleanup, error);
    }
    const services = new SpineServices({
      contexts,
      ...this.#services,
    });
    spineServicesAccess.installLogger(services, logger);
    const sessions = new Set<http2.ServerHttp2Session>();
    const httpServer = ServerValues.createHttpServer(
      services,
      sessions,
      this.#readMaxBytes,
      this.#writeMaxBytes,
    );
    const listener =
      this.#browser === undefined
        ? { host: this.#host, port: this.#port }
        : { host: defaultHost, port: defaultPort };
    const address = await ServerValues.listen(httpServer, listener.host, listener.port).catch(
      async (error: unknown) => {
        const cleanup: FailedStartCleanup = {
          closeGroup: new RetryableCloseGroup(
            closeables,
            "Server start cleanup failed while closing owned contexts/resources.",
          ),
          network: { server: httpServer, sessions },
          contextTransports,
          attachment,
          failedStartRollback: undefined,
        };
        this.#failedStartCleanup = cleanup;
        return this.#cleanupFailedListenerStart(cleanup, error);
      },
    );
    const host = typeof address.address === "string" ? address.address : this.#host;

    const running = new RunningHttp2Server({
      server: httpServer,
      sessions,
      environment: this.#environment,
      attachment,
      contextTransports,
      services,
      host,
      port: address.port,
      closeables,
      listenerLifecycles: this.#listenerLifecycles,
    });
    runningContexts.set(running, contexts);
    try {
      await running.startLifecycles();
    } catch (error) {
      if (running.hasPendingClose()) this.#failedListenerLifecycle = running;
      else this.#failedStartConsumed = true;
      throw error;
    }
    if (browser === undefined) return running;
    try {
      return await BrowserServer.open(running, {
        ...browser,
        host: browser.host ?? this.#host,
        port: browser.port ?? this.#port,
        readMaxBytes: this.#readMaxBytes,
        writeMaxBytes: this.#writeMaxBytes,
        production: this.#environment.environment.type === EnvironmentType.Production,
      });
    } catch (error) {
      try {
        await running.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          "Server browser startup failed and rollback failed.",
        );
      }
      throw error;
    }
  }

  async #retryFailedStartCleanup(cleanup: FailedStartCleanup): Promise<never> {
    const errors: unknown[] = [];

    if (!(await this.#closeFailedStartNetwork(cleanup, errors))) {
      ServerValues.throwCleanupErrors(errors);
    }
    await this.#advanceFailedStartCleanup(cleanup, errors);
    if (errors.length > 0) {
      ServerValues.throwCleanupErrors(errors);
    }
    throw new Error("Server deferred cleanup completed after an earlier failed start.");
  }

  async #retryFailedListenerLifecycle(running: RunningHttp2Server): Promise<never> {
    await running.close();
    this.#failedListenerLifecycle = undefined;
    this.#failedStartConsumed = true;
    throw new Error("Server deferred cleanup completed after an earlier failed start.");
  }

  async #cleanupFailedContextStart(
    cleanup: FailedStartCleanup,
    startError: unknown,
  ): Promise<never> {
    const errors: unknown[] = [];

    await this.#advanceFailedStartCleanup(cleanup, errors);
    return ServerValues.throwContextStartError(startError, errors);
  }

  async #cleanupFailedListenerStart(
    cleanup: FailedStartCleanup,
    startError: unknown,
  ): Promise<never> {
    const errors: unknown[] = [];

    if (!(await this.#closeFailedStartNetwork(cleanup, errors))) {
      return ServerValues.throwListenerStartError(startError, errors);
    }
    await this.#advanceFailedStartCleanup(cleanup, errors);
    return ServerValues.throwListenerStartError(startError, errors);
  }

  async #advanceFailedStartCleanup(cleanup: FailedStartCleanup, errors: unknown[]): Promise<void> {
    if (!(await this.#closeFailedStartContextTransports(cleanup, errors))) {
      return;
    }
    if (!(await this.#advanceFailedStartAttachment(cleanup, errors))) {
      return;
    }

    const failedStartRollback = cleanup.failedStartRollback;
    if (
      failedStartRollback !== undefined &&
      serverEnvironmentAccess.failedStartRetryPending(
        this.#environment,
        failedStartRollback.rejection,
      )
    ) {
      try {
        await serverEnvironmentAccess.retryFailedStart(this.#environment);
      } catch (error) {
        if (
          serverEnvironmentAccess.failedStartRetryPending(
            this.#environment,
            failedStartRollback.rejection,
          )
        ) {
          throw error;
        }
        CloseErrors.collect(error, errors);
      }
    }

    let closeFailed = false;
    try {
      await cleanup.closeGroup.close();
    } catch (error) {
      closeFailed = true;
      CloseErrors.collect(error, errors);
    }
    if (
      !closeFailed &&
      cleanup.contextTransports === undefined &&
      cleanup.attachment === undefined &&
      this.#failedStartCleanup === cleanup
    ) {
      this.#failedStartCleanup = undefined;
      this.#failedStartConsumed = true;
    }
  }

  async #closeFailedStartNetwork(cleanup: FailedStartCleanup, errors: unknown[]): Promise<boolean> {
    const network = cleanup.network;
    if (network === undefined) {
      return true;
    }
    try {
      await ServerValues.closeNetwork(network.server, network.sessions);
      delete cleanup.network;
      return true;
    } catch (error) {
      CloseErrors.collect(error, errors);
      return false;
    }
  }

  async #closeFailedStartContextTransports(
    cleanup: FailedStartCleanup,
    errors: unknown[],
  ): Promise<boolean> {
    const contextTransports = cleanup.contextTransports;
    if (contextTransports === undefined) {
      return true;
    }
    try {
      await contextTransports.close();
      delete cleanup.contextTransports;
      return true;
    } catch (error) {
      CloseErrors.collect(error, errors);
      return false;
    }
  }

  async #advanceFailedStartAttachment(
    cleanup: FailedStartCleanup,
    errors: unknown[],
  ): Promise<boolean> {
    const attachment = cleanup.attachment;
    if (attachment === undefined) {
      return true;
    }
    try {
      if (serverEnvironmentAccess.detachRetryPending(this.#environment, attachment)) {
        await serverEnvironmentAccess.retryDetach(this.#environment, attachment);
      } else {
        await serverEnvironmentAccess.detach(this.#environment, attachment);
      }
      delete cleanup.attachment;
      return true;
    } catch (error) {
      CloseErrors.collect(error, errors);
    }
    try {
      if (serverEnvironmentAccess.endpointSafe(this.#environment, attachment)) {
        return true;
      }
    } catch (error) {
      CloseErrors.collect(error, errors);
    }
    return false;
  }

  #finishStart(starting: Promise<RunningServer>): void {
    if (this.#starting === starting) {
      this.#starting = undefined;
      this.#startingOwnership = undefined;
    }
  }
}

interface FailedStartCleanup {
  readonly closeGroup: RetryableCloseGroup;
  readonly failedStartRollback: FailedStartRollbackCapability | undefined;
  network?: FailedStartNetwork;
  contextTransports?: ContextTransportGroup;
  attachment?: EnvironmentAttachmentHandle;
}

interface FailedStartRollbackCapability {
  readonly rejection: unknown;
}

interface FailedStartNetwork {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
}

/**
 * Options for building a local Spine HTTP/2 service host.
 */
export interface ServerOptions {
  // prettier-ignore

  /**
   * Listener host. Defaults to local-only `127.0.0.1`.
   *
   * Use a broader host such as `0.0.0.0` only when callers should reach this
   * process from outside the local machine.
   */
  readonly host?: string;

  /**
   * Listener port. Defaults to `0`, asking the OS for a free port.
   */
  readonly port?: number;

  /**
   * Maximum uncompressed bytes accepted for one RPC request message.
   * Defaults to 4,194,304 bytes. Must be an integer from 1 through
   * 4,294,967,295.
   */
  readonly readMaxBytes?: number;

  /**
   * Maximum uncompressed bytes emitted for one RPC or auth-callback response.
   * Defaults to 4,194,304 bytes. Must be an integer from 1 through
   * 4,294,967,295. An auth callback exceeding this bound receives 413.
   */
  readonly writeMaxBytes?: number;

  /**
   * Built bounded contexts or builders owned by this server assembly.
   *
   * Builders in this list are assembled during {@link Server.start} before
   * listener open. They use {@link ServerEnvironment.storageFactory} unless
   * `withStorageFactory(...)` already selected a more specific local factory.
   */
  readonly contexts?: readonly (BoundedContext | BoundedContextBuilder)[];

  /**
   * Service-level options for Command, Query, and Subscription routes.
   */
  readonly services?: Omit<SpineServicesOptions, "contexts">;

  /**
   * Extra framework-owned closeables to close after contexts become safe to close.
   */
  readonly resources?: readonly { close(): unknown }[];

  /**
   * Authenticated browser listener configuration. When present, the native
   * HTTP/2 listener remains private on loopback and this public listener
   * becomes the returned server URL.
   */
  readonly browser?: BrowserServerOptions;
}

/**
 * Configures the authenticated browser-facing Connect and gRPC-Web listener.
 */
type BrowserBackend =
  | { readonly baseUrl: string; readonly baseUrls?: never }
  | { readonly baseUrl?: never; readonly baseUrls: readonly string[] };

/**
 * Configures the authenticated browser-facing Connect and gRPC-Web listener.
 */
export interface BrowserServerOptions {
  // prettier-ignore

  /**
   * Public browser listener host. Defaults to the server host.
   */
  readonly host?: string;

  /**
   * Public browser listener port. Defaults to the server port.
   */
  readonly port?: number;

  /**
   * Selects one separately hosted Spine backend or a non-empty fixed node set.
   *
   * Each URL must be one canonical HTTP(S) origin without credentials, query,
   * fragment, or a path beyond `/`. `baseUrl` and `baseUrls` are exclusive;
   * fan-in is best effort, so clients re-query authoritative state after a
   * duplicate update or generic loss notice.
   */
  readonly backend?: BrowserBackend;

  /**
   * Supplies changing complete membership for unary routing and native streams.
   * Supplying discovery makes this a standalone Gateway, so the server does
   * not assemble or own local contexts, services, resources, or listener
   * lifecycles. When both backend and discovery are supplied, discovery is the
   * active membership source and fixed backend values are not reconciled.
   */
  readonly discovery?: NodeDiscovery;

  /**
   * Application-owned, exact authentication endpoints exposed beside the fixed
   * Spine RPC paths. These endpoints are not a general-purpose router.
   */
  readonly authRoutes?: readonly BrowserAuthRoute[];

  /**
   * Limits concurrently admitted application authentication requests across
   * this listener. Defaults to 64 and must be a positive safe integer. Excess
   * requests receive 503 before handler invocation; capacity recovers when an
   * admitted request settles.
   */
  readonly maxActiveAuthRequests?: number;

  /**
   * Exact browser origins permitted to make RPC calls.
   */
  readonly origins: readonly string[];

  /**
   * Decodes application request content for authorization and actor resolution.
   */
  readonly registry?: TypeRegistryLookup;

  /**
   * Resolves bearer or opaque-cookie sessions selected by the application.
   */
  readonly sessions: SessionResolver;

  /**
   * Applies application authorization after authentication.
   */
  readonly authorize: AuthorizationPolicy["authorize"];

  /**
   * Replaces browser-supplied actor and tenant context with trusted values.
   */
  readonly contexts: ContextResolver;

  /**
   * Supplies trusted timestamps for gateway decisions.
   */
  readonly clock: Clock;

  /**
   * Supplies the registry that owns opaque browser-subscription bindings.
   *
   * Production requires bindings that declare durable registry capability.
   * Local development may omit it and use an explicit in-memory registry.
   */
  readonly bindings?: SubscriptionBindings;

  /**
   * Enables strict opaque-cookie extraction alongside bearer credentials.
   */
  readonly cookies?: OpaqueSessionCookies;
}

/**
 * Configures one bounded application authentication request.
 */
export interface BrowserAuthRoute {
  // prettier-ignore

  /**
   * Selects the accepted HTTP method.
   */
  readonly method: "GET" | "POST";

  /**
   * Selects the exact canonical request path.
   */
  readonly path: string;

  /**
   * Lists exact browser origins allowed for this route.
   */
  readonly origins: readonly string[];

  /**
   * Allows an OAuth callback without an Origin header.
   */
  readonly allowMissingOrigin?: boolean;

  /**
   * Limits accepted request-body bytes.
   */
  readonly maxRequestBytes: number;

  /**
   * Limits request processing time in milliseconds.
   */
  readonly timeoutMs: number;

  /**
   * Handles one admitted authentication request.
   *
   * @param request Supplies the bounded Fetch request.
   * @param signal Signals timeout, disconnect, or gateway close.
   * @returns Returns the application response.
   */
  readonly onRequest: (request: Request, signal: AbortSignal) => Response | Promise<Response>;
}

/**
 * Running local Spine service host.
 */
export interface RunningServer {
  // prettier-ignore

  /**
   * Host accepted by the listener.
   */
  readonly host: string;

  /**
   * Bound listener port.
   */
  readonly port: number;

  /**
   * Base URL for Connect gRPC-compatible clients.
   */
  readonly baseUrl: string;

  /**
   * Closes intake, delivery, contexts, and owned resources.
   *
   * It stops network intake and sessions, closes context transport and drains
   * accepted work before detaching delivery. A failed intake close blocks later
   * phases until a retry. Sibling servers remain available. Caller-managed
   * servers leave process-wide facilities available; closing the final
   * run-managed server closes its environment. Concurrent calls share one
   * attempt; later calls retry only unfinished cleanup, preserving stable
   * flattened failure order.
   *
   * @returns A promise that settles after server-owned cleanup completes.
   */
  close(): Promise<void>;
}

/**
 * Exposes framework-only facts about a local running server.
 *
 * @internal
 */
export interface RunningServerAccess {
  // prettier-ignore

  /**
   * Returns registry persistence facts for a framework-owned running server.
   *
   * @param server Supplies the local running server.
   * @returns The context registry facts, or undefined for an opaque server.
   */
  subscriptionRegistries(
    server: RunningServer,
  ): readonly StandSubscriptionRegistry[] | undefined;

  /**
   * Returns completion after draining Delivery before managed network close.
   *
   * @param server Supplies the local running server.
   * @returns Completion after its Delivery attachment drains.
   */
  drainDelivery(server: RunningServer): Promise<void>;
}

/**
 * Provides framework-only `RunningServer` context facts.
 *
 * @internal
 */
export const runningServerAccess: RunningServerAccess = Object.freeze({
  subscriptionRegistries(server: RunningServer): readonly StandSubscriptionRegistry[] | undefined {
    return runningContexts
      .get(server)
      ?.map((context) => boundedContextAccess.subscriptionRegistry(context));
  },
  drainDelivery(server: RunningServer): Promise<void> {
    return server instanceof RunningHttp2Server ? server.drainDelivery() : Promise.resolve();
  },
});

class RunningHttp2Server implements RunningServer {
  readonly #server: http2.Http2Server;
  readonly #sessions: Set<http2.ServerHttp2Session>;
  readonly #closeables: readonly unknown[];
  readonly #listenerLifecycles: readonly { close(): unknown }[];
  readonly #startedLifecycles: { close(): unknown }[] = [];
  readonly #environment: ServerEnvironment;
  readonly #attachment: EnvironmentAttachmentHandle;
  readonly #contextTransports: ContextTransportGroup;
  readonly #services: SpineServices;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  #closed: Promise<void> | undefined;
  #networkClosed = false;
  #attachmentDetached = false;
  readonly #closeGroup: RetryableCloseGroup;

  constructor(options: RunningHttp2ServerOptions) {
    this.#server = options.server;
    this.#sessions = options.sessions;
    this.#closeables = options.closeables;
    this.#listenerLifecycles = options.listenerLifecycles;
    this.#environment = options.environment;
    this.#attachment = options.attachment;
    this.#contextTransports = options.contextTransports;
    this.#services = options.services;
    this.host = options.host;
    this.port = options.port;
    this.baseUrl = `http://${ServerValues.formatHostForUrl(options.host)}:${options.port.toString()}`;
    this.#closeGroup = new RetryableCloseGroup(
      this.#closeables,
      "Server close failed while closing owned contexts/resources.",
    );
  }

  close(): Promise<void> {
    this.#closed ??= this.#closeOnce().catch((error: unknown) => {
      this.#closed = undefined;
      throw error;
    });
    return this.#closed;
  }

  /**
   * Starts listener-ready attachments after the native listener accepts connections.
   *
   * @returns Completes after all attachments start or their admitted rollback settles.
   */
  async startLifecycles(): Promise<void> {
    try {
      for (const lifecycle of this.#listenerLifecycles as readonly {
        start(): unknown;
        close(): unknown;
      }[]) {
        await lifecycle.start();
        this.#startedLifecycles.push(lifecycle);
      }
    } catch (error) {
      try {
        await this.close();
      } catch (rollback) {
        throw new AggregateError(
          [error, rollback],
          "Server listener lifecycle start and rollback failed.",
        );
      }
      throw error;
    }
  }

  hasPendingClose(): boolean {
    return this.#closed === undefined;
  }

  /**
   * Drains the server-owned Delivery attachment while network sessions remain available.
   *
   * @returns Completion after the attachment drains.
   */
  async drainDelivery(): Promise<void> {
    if (this.#attachmentDetached) return;
    if (serverEnvironmentAccess.detachRetryPending(this.#environment, this.#attachment)) {
      await serverEnvironmentAccess.retryDetach(this.#environment, this.#attachment);
    } else {
      await serverEnvironmentAccess.detach(this.#environment, this.#attachment);
    }
    this.#attachmentDetached = true;
  }

  async #closeOnce(): Promise<void> {
    while (this.#startedLifecycles.length > 0) {
      const lifecycle = this.#startedLifecycles.at(-1);
      if (lifecycle === undefined) break;
      await lifecycle.close();
      this.#startedLifecycles.pop();
    }
    if (!this.#networkClosed) {
      await ServerValues.closeNetwork(this.#server, this.#sessions);
      this.#networkClosed = true;
    }
    await this.#contextTransports.close();
    const detachErrors: unknown[] = [];
    let detachRejected = false;
    if (!this.#attachmentDetached) {
      try {
        if (serverEnvironmentAccess.detachRetryPending(this.#environment, this.#attachment)) {
          await serverEnvironmentAccess.retryDetach(this.#environment, this.#attachment);
        } else {
          await serverEnvironmentAccess.detach(this.#environment, this.#attachment);
        }
        this.#attachmentDetached = true;
      } catch (error) {
        detachRejected = true;
        CloseErrors.collect(error, detachErrors);
      }
      if (detachRejected) {
        let endpointSafe = false;
        try {
          endpointSafe = serverEnvironmentAccess.endpointSafe(this.#environment, this.#attachment);
        } catch (error) {
          CloseErrors.collect(error, detachErrors);
        }
        if (!endpointSafe) {
          ServerValues.throwRunningDetachErrors(detachErrors);
        }
      }
    }
    try {
      await this.#closeGroup.close();
    } catch (error) {
      if (!detachRejected) {
        throw error;
      }
      CloseErrors.collect(error, detachErrors);
      throw new AggregateError(
        detachErrors,
        "Server close failed while detaching delivery and closing owned contexts/resources.",
      );
    }
    if (detachRejected) {
      ServerValues.throwRunningDetachErrors(detachErrors);
    }
    spineServicesAccess.clearLogger(this.#services);
  }
}

interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly listenerLifecycles: readonly { start(): unknown; close(): unknown }[];
  readonly environment: ServerEnvironment;
  readonly attachment: EnvironmentAttachmentHandle;
  readonly contextTransports: ContextTransportGroup;
  readonly services: SpineServices;
  readonly host: string;
  readonly port: number;
}

/**
 *
 * @internal Groups private server assembly, network, and shutdown operations.
 */
const ServerValues = Object.freeze({
  async buildContexts(
    entries: readonly ServerContext[],
    defaultStorageFactory: StorageFactory,
  ): Promise<readonly BoundedContext[]> {
    const contexts: BoundedContext[] = [];

    try {
      for (const entry of entries) {
        contexts.push(
          boundedContextAccess.isBuilder(entry)
            ? await boundedContextAccess.build(entry, defaultStorageFactory)
            : entry,
        );
      }
      return contexts;
    } catch (error) {
      await ServerValues.cleanupBuiltContexts(contexts, error);
      throw error;
    }
  },

  createHttpServer(
    services: SpineServices,
    sessions: Set<http2.ServerHttp2Session>,
    readMaxBytes: number,
    writeMaxBytes: number,
  ): http2.Http2Server {
    const server = http2.createServer(
      connectNodeAdapter({
        routes: (router) => {
          services.register(router);
        },
        readMaxBytes,
        writeMaxBytes,
      }),
    );
    server.on("session", (session) => {
      sessions.add(session);
      session.on("close", () => sessions.delete(session));
    });
    return server;
  },

  listen(server: http2.Http2Server, host: string, port: number): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off("error", onError);
        server.off("listening", onListening);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve(server.address() as AddressInfo);
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, host);
    });
  },

  async cleanupBuiltContexts(
    contexts: readonly BoundedContext[],
    startError: unknown,
  ): Promise<void> {
    try {
      await new RetryableCloseGroup(
        contexts,
        "Server start cleanup failed while closing owned contexts/resources.",
      ).close();
    } catch (error) {
      throw new AggregateError(
        [startError, ...ServerValues.toCleanupErrors(error)],
        "Server start failed while building bounded contexts.",
      );
    }
  },

  toCleanupErrors(error: unknown): readonly unknown[] {
    if (error instanceof AggregateError) {
      return error.errors;
    }
    return [error];
  },

  attachmentCleanupError(startError: unknown, cleanupError: unknown): AggregateError {
    const errors: unknown[] = [];
    CloseErrors.collect(startError, errors);
    CloseErrors.collect(cleanupError, errors);
    return new AggregateError(
      errors,
      "Server attachment failed and immediate dependency cleanup also failed.",
    );
  },

  throwCleanupErrors(errors: readonly unknown[]): never {
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(errors, "Server deferred failed-start cleanup failed.");
  },

  throwListenerStartError(startError: unknown, cleanupErrors: readonly unknown[]): never {
    if (cleanupErrors.length === 0) {
      throw startError;
    }
    const errors: unknown[] = [];
    CloseErrors.collect(startError, errors);
    for (const error of cleanupErrors) {
      CloseErrors.collect(error, errors);
    }
    throw new AggregateError(
      errors,
      "Server start failed while opening listener and cleanup also failed.",
    );
  },

  throwContextStartError(startError: unknown, cleanupErrors: readonly unknown[]): never {
    if (cleanupErrors.length === 0) {
      throw startError;
    }
    const errors: unknown[] = [];
    CloseErrors.collect(startError, errors);
    for (const error of cleanupErrors) {
      CloseErrors.collect(error, errors);
    }
    throw new AggregateError(
      errors,
      "Server start failed while opening context transport and cleanup also failed.",
    );
  },

  throwRunningDetachErrors(errors: readonly unknown[]): never {
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(errors, "Server close failed while detaching delivery.");
  },

  async closeNetwork(
    server: http2.Http2Server,
    sessions: Set<http2.ServerHttp2Session>,
  ): Promise<void> {
    const closed = ServerValues.closeHttpServer(server);
    await ServerValues.closeSessions(sessions);
    await closed;
    await ServerValues.nextTurn();
  },

  closeHttpServer(server: http2.Http2Server): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  },

  async closeSessions(sessions: Set<http2.ServerHttp2Session>): Promise<void> {
    await Promise.all([...sessions].map((session) => ServerValues.closeSession(session)));
  },

  closeSession(session: http2.ServerHttp2Session): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        session.destroy();
        resolve();
      }, gracefulSessionDrainMs);
      const finishGracefulClose = () => {
        clearTimeout(timer);
        resolve();
      };
      timer.unref();
      session.once("close", finishGracefulClose);
      session.close();
    });
  },

  nextTurn(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  },

  formatHostForUrl(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  },

  normalizeHost(host: string | undefined): string {
    const normalized = host?.trim() ?? defaultHost;
    if (normalized.length === 0) {
      throw new Error("Server host must not be blank.");
    }
    return normalized;
  },

  browserBackendUrls(backend: NonNullable<BrowserServerOptions["backend"]>): readonly string[] {
    const source = backend as { readonly baseUrl?: unknown; readonly baseUrls?: unknown };
    if (typeof source.baseUrl === "string" && source.baseUrls === undefined)
      return [source.baseUrl];
    if (source.baseUrl === undefined && Array.isArray(source.baseUrls)) {
      const values: readonly unknown[] = source.baseUrls;
      if (values.some((value) => typeof value !== "string"))
        throw new Error("Server browser backend URLs must be strings.");
      return values as readonly string[];
    }
    throw new Error("Server browser backend must configure exactly one of baseUrl or baseUrls.");
  },

  isStandaloneBrowser(browser: BrowserServerOptions | undefined): boolean {
    return browser?.backend !== undefined || browser?.discovery !== undefined;
  },

  normalizeMessageMaxBytes(value: number, name: "readMaxBytes" | "writeMaxBytes"): number {
    if (!Number.isInteger(value) || value < 1 || value > maximumMessageMaxBytes) {
      throw new Error(`Server ${name} must be an integer from 1 through 4294967295.`);
    }
    return value;
  },
});
