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

import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { AiRegistry } from "@spine-event-engine/ai";

import {
  BoundedContext,
  BoundedContextBuilder,
  boundedContextAccess,
} from "../context/bounded-context.js";
import type { StandSubscriptionRegistry } from "../stand/subscription-registry.js";
import type { Stand } from "../stand/stand.js";
import {
  SpineServices,
  spineServicesAccess,
  type SpineServicesOptions,
} from "../services/spine-services.js";
import { RegisteredTargets } from "../services/registered-targets.js";
import type {
  EnvironmentAttachmentHandle,
  EnvironmentOwnership,
} from "./environment-attachment.js";
import { ProcessServerCoordinator } from "./process-server-coordinator.js";
import { CloseErrors, RetryableCloseGroup } from "./retryable-close.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const maximumMessageMaxBytes = 0xffff_ffff;
const gracefulSessionDrainMs = 100;
type ServerContext = BoundedContext | BoundedContextBuilder;
const runningContexts = new WeakMap<RunningServer, readonly BoundedContext[]>();
const serverHosts = new WeakMap<Server, string>();
const assemblingStands = new WeakMap<Stand, object>();

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
 * delivery recovery, and opens its generated services before accepting network
 * requests. It also owns the ordered cleanup of contexts and resources added
 * to this assembly.
 */
export class Server {
  readonly #host: string;

  readonly #port: number;

  readonly #readMaxBytes: number;

  readonly #writeMaxBytes: number;

  readonly #contexts: ServerContext[] = [];

  #aiRegistry: AiRegistry | undefined;

  readonly #resources: { close(): unknown }[] = [];

  readonly #listenerLifecycles: ListenerLifecycle[] = [];

  readonly #services: Omit<SpineServicesOptions, "contexts">;

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
    this.#environment = ServerEnvironment.instance();
    serverHosts.set(this, this.#host);
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
   * closes added contexts only after services, sessions, and active work stop.
   *
   * @param context Supplies the context or builder to expose.
   * @returns This server builder.
   */
  add(context: BoundedContext | BoundedContextBuilder): this {
    this.#contexts.push(context);
    return this;
  }

  /**
   * Sets the default AI registry for context builders added to this server.
   * A context builder's own registry takes precedence.
   * @param registry Factory-created deployment registry.
   * @returns This server builder.
   */
  withAi(registry: AiRegistry): this {
    this.#aiRegistry = registry;
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
   * Built contexts attach to delivery in deterministic input order before the
   * generated services and listener open. A failed assembly or listener open
   * leaves no listener and closes acquired resources. Network cleanup is a hard
   * gate before delivery or dependencies close.
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
   * permanently closes its environment. A failed final
   * close stays retryable through `close()` or a later process signal.
   * Caller-managed servers never close their environment.
   *
   * @returns The running server after its listener accepts requests.
   */
  run(): Promise<RunningServer> {
    const current = this.#run;
    if (current !== undefined) return current;
    const environment = this.#environment;
    const running = this.#start("server").then((server) =>
      ProcessServerCoordinator.add(
        server,
        environment,
        serverEnvironmentAccess.loggerFor(environment),
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

  /**
   * Builds contexts, attaches delivery, and opens the listener for one start attempt.
   *
   * @param ownership Whether the environment is managed by this Server.
   * @returns The running listener after lifecycle startup.
   */
  async #startOnce(ownership: EnvironmentOwnership): Promise<RunningServer> {
    const admission: ContextAdmission = { token: {}, contexts: [] };
    const contexts = await this.#prepareContexts(admission);
    const { attachment, routes } = await this.#attachContexts(contexts, ownership, admission);
    const running = await this.#openListener(contexts, attachment, routes);
    await this.#startLifecycles(running);
    return running;
  }

  /**
   * Opens the service listener with retryable cleanup for every preparation phase.
   *
   * @param contexts Contexts exposed by the listener.
   * @param attachment Active environment delivery attachment.
   * @param routes Routes installed for these contexts.
   * @returns The prepared running listener.
   */
  async #openListener(
    contexts: readonly BoundedContext[],
    attachment: EnvironmentAttachmentHandle,
    routes: RegisteredTargets,
  ): Promise<RunningHttp2Server> {
    const closeables = [...contexts, ...this.#resources];
    const cleanup: FailedStartCleanup = {
      closeGroup: new RetryableCloseGroup(
        closeables,
        "Server start cleanup failed while closing owned contexts/resources.",
      ),
      attachment,
      routes,
      failedStartRollback: undefined,
    };
    try {
      return await this.#prepareListener(contexts, attachment, routes, closeables, cleanup);
    } catch (error) {
      this.#failedStartCleanup = cleanup;
      return this.#cleanupFailedListenerStart(cleanup, error);
    }
  }

  /**
   * Constructs services and the HTTP adapter, then binds the listener.
   *
   * @param contexts Contexts exposed by this Server.
   * @param attachment Active delivery attachment.
   * @param routes Installed state routes.
   * @param closeables Contexts and resources for eventual shutdown.
   * @param cleanup Retained cleanup state if preparation fails.
   * @returns The prepared running listener.
   */
  async #prepareListener(
    contexts: readonly BoundedContext[],
    attachment: EnvironmentAttachmentHandle,
    routes: RegisteredTargets,
    closeables: readonly unknown[],
    cleanup: FailedStartCleanup,
  ): Promise<RunningHttp2Server> {
    const services = new SpineServices({ contexts, ...this.#services });
    cleanup.services = services;
    spineServicesAccess.installLogger(
      services,
      serverEnvironmentAccess.loggerFor(this.#environment),
    );
    const { httpServer, sessions } = this.#createHttpListener(services);
    cleanup.network = { server: httpServer, sessions };
    const address = await ServerValues.listen(httpServer, this.#host, this.#port);
    const host = typeof address.address === "string" ? address.address : this.#host;
    return this.#createRunningServer({
      server: httpServer,
      sessions,
      environment: this.#environment,
      attachment,
      routes,
      services,
      host,
      port: address.port,
      contexts,
      closeables,
    });
  }

  /**
   * Prepares an HTTP listener and its tracked sessions for startup.
   *
   * @param services Service routes exposed by the listener.
   * @returns The unbound listener and its session set.
   */
  #createHttpListener(services: SpineServices): {
    httpServer: http2.Http2Server;
    sessions: Set<http2.ServerHttp2Session>;
  } {
    const sessions = new Set<http2.ServerHttp2Session>();
    const httpServer = ServerValues.createHttpServer(
      services,
      sessions,
      this.#readMaxBytes,
      this.#writeMaxBytes,
    );
    return { httpServer, sessions };
  }

  /**
   * Creates the listener handle and associates its context set.
   *
   * @param options Listener resources prepared during startup.
   * @returns The not-yet-started listener handle.
   */
  #createRunningServer(
    options: Omit<RunningHttp2ServerOptions, "listenerLifecycles">,
  ): RunningHttp2Server {
    const running = new RunningHttp2Server({
      ...options,
      listenerLifecycles: this.#listenerLifecycles,
    });
    runningContexts.set(running, options.contexts);
    return running;
  }

  /**
   * Reserves prebuilt contexts before awaiting builders, then assembles each builder.
   *
   * @param admission Attempt-local reservations retained through cleanup.
   * @returns Prepared contexts for this Server.
   */
  async #prepareContexts(admission: ContextAdmission): Promise<readonly BoundedContext[]> {
    const contexts: BoundedContext[] = [];
    let conflict: unknown;
    let conflicted = false;
    for (const entry of this.#contexts) {
      if (boundedContextAccess.isBuilder(entry)) continue;
      try {
        this.#admitContext(entry, admission);
      } catch (error) {
        if (!conflicted) conflict = error;
        conflicted = true;
      }
    }
    try {
      if (conflicted) throw conflict;
      for (const entry of this.#contexts) {
        const context = boundedContextAccess.isBuilder(entry)
          ? await boundedContextAccess.build(
              entry,
              this.#environment.storageFactory,
              this.#aiRegistry,
            )
          : entry;
        if (boundedContextAccess.isBuilder(entry)) this.#admitContext(context, admission);
        contexts.push(context);
      }
      return contexts;
    } catch (error) {
      await this.#cleanupFailedAttachment(admission.contexts, undefined, error, admission);
      throw error;
    }
  }

  /**
   * Reserves one context Stand while this Server assembles its routes.
   *
   * @param context Context to reserve.
   * @param admission Attempt-local reservations and token.
   */
  #admitContext(context: BoundedContext, admission: ContextAdmission): void {
    const stand = context.stand();
    const token = assemblingStands.get(stand);
    if (token !== undefined || RegisteredTargets.forStand(stand) !== undefined) {
      throw new Error("Stand is already associated with another Server or assembly.");
    }
    assemblingStands.set(stand, admission.token);
    admission.contexts.push(context);
  }

  /**
   * Clears only reservations made by the given assembly attempt.
   *
   * @param admission Attempt whose reserved Stands may be released.
   */
  #releaseAdmission(admission: ContextAdmission): void {
    for (const context of admission.contexts) {
      const stand = context.stand();
      if (assemblingStands.get(stand) === admission.token) assemblingStands.delete(stand);
    }
    admission.contexts.length = 0;
  }

  /**
   * Validates state routes before delivery recovery can invoke handlers.
   *
   * @param contexts Built contexts for this Server.
   * @param ownership Environment attachment mode.
   * @param admission Reservations transferred to installed routes before attachment.
   * @returns The environment attachment and its installed routes.
   */
  async #attachContexts(
    contexts: readonly BoundedContext[],
    ownership: EnvironmentOwnership,
    admission: ContextAdmission,
  ): Promise<{ attachment: EnvironmentAttachmentHandle; routes: RegisteredTargets }> {
    const freshContexts = contexts.filter(
      (context) => RegisteredTargets.forStand(context.stand()) === undefined,
    );
    let routes: RegisteredTargets | undefined;
    try {
      routes = new RegisteredTargets(contexts);
      routes.install(contexts);
      this.#releaseAdmission(admission);
      const logger = serverEnvironmentAccess.loggerFor(this.#environment);
      for (const context of contexts) {
        boundedContextAccess.installLogger(context, logger);
        serverEnvironmentAccess.warnVolatileRegistry(this.#environment, context);
      }
      const attachment = await serverEnvironmentAccess.attach(this.#environment, {
        ownership,
        descriptors: contexts.map((context) => boundedContextAccess.delivery(context)),
      });
      return { attachment, routes };
    } catch (error) {
      await this.#cleanupFailedAttachment(freshContexts, routes, error, admission);
      throw error;
    }
  }

  /**
   * Retains retryable cleanup when route validation or attachment fails.
   *
   * @param contexts Fresh contexts to close after failure.
   * @param routes Routes installed by this attempt, if any.
   * @param error Original route or attachment failure.
   * @param admission Reservations retained until context cleanup succeeds.
   */
  async #cleanupFailedAttachment(
    contexts: readonly BoundedContext[],
    routes: RegisteredTargets | undefined,
    error: unknown,
    admission?: ContextAdmission,
  ): Promise<void> {
    const closeGroup = new RetryableCloseGroup(
      [...contexts, ...this.#resources],
      "Server start cleanup failed while closing owned contexts/resources.",
    );
    if (serverEnvironmentAccess.failedStartRetryPending(this.#environment, error)) {
      this.#failedStartCleanup = {
        closeGroup,
        failedStartRollback: { rejection: error },
        routes,
        admission,
      };
      return;
    }
    try {
      await closeGroup.close();
    } catch (cleanupError) {
      this.#failedStartCleanup = { closeGroup, failedStartRollback: undefined, routes, admission };
      throw ServerValues.attachmentCleanupError(error, cleanupError);
    }
    routes?.release();
    if (admission !== undefined) this.#releaseAdmission(admission);
    this.#failedStartConsumed = true;
  }

  /**
   * Starts listener lifecycles and preserves failed close retries.
   *
   * @param running Listener whose lifecycles begin.
   */
  async #startLifecycles(running: RunningHttp2Server): Promise<void> {
    try {
      await running.startLifecycles();
    } catch (error) {
      if (running.hasPendingClose()) this.#failedListenerLifecycle = running;
      else this.#failedStartConsumed = true;
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
    if (!(await this.#advanceFailedStartAttachment(cleanup, errors))) {
      return;
    }
    await this.#retryFailedStartRollback(cleanup, errors);
    let closeFailed = false;
    try {
      await cleanup.closeGroup.close();
    } catch (error) {
      closeFailed = true;
      CloseErrors.collect(error, errors);
    }
    if (!closeFailed && cleanup.attachment === undefined && this.#failedStartCleanup === cleanup) {
      cleanup.routes?.release();
      if (cleanup.admission !== undefined) this.#releaseAdmission(cleanup.admission);
      if (cleanup.services !== undefined) spineServicesAccess.clearLogger(cleanup.services);
      this.#failedStartCleanup = undefined;
      this.#failedStartConsumed = true;
    }
  }

  /**
   * Retries environment rollback before closing contexts from a failed start.
   *
   * @param cleanup Retained failed-start state.
   * @param errors Errors collected across cleanup phases.
   */
  async #retryFailedStartRollback(cleanup: FailedStartCleanup, errors: unknown[]): Promise<void> {
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
  readonly routes?: RegisteredTargets | undefined;
  readonly admission?: ContextAdmission | undefined;
  services?: SpineServices;
  network?: FailedStartNetwork;
  attachment?: EnvironmentAttachmentHandle;
}

interface ContextAdmission {
  readonly token: object;
  readonly contexts: BoundedContext[];
}

interface FailedStartRollbackCapability {
  readonly rejection: unknown;
}

interface FailedStartNetwork {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
}

/**
 * Checks whether browser composition may start a private native listener.
 *
 * @internal
 */
export const serverBuilderAccess: Readonly<{
  isLoopback(server: Server): boolean;
}> = Object.freeze({
  isLoopback(server: Server): boolean {
    const host = serverHosts.get(server);
    return host !== undefined && isLoopbackHost(host);
  },
});

function isLoopbackHost(host: string): boolean {
  if (host === "::1" || host === "::ffff:127.0.0.1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
  return match?.slice(1).every((part) => Number(part) <= 255) === true;
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
   * It stops network intake and sessions, then drains
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

/**
 * Holds listener resources and closes them in recovery-safe phases.
 */
class RunningHttp2Server implements RunningServer {
  readonly #server: http2.Http2Server;

  readonly #sessions: Set<http2.ServerHttp2Session>;

  readonly #closeables: readonly unknown[];

  readonly #contexts: readonly BoundedContext[];

  readonly #listenerLifecycles: readonly ListenerLifecycle[];

  readonly #startedLifecycles: ListenerLifecycle[] = [];

  readonly #environment: ServerEnvironment;

  readonly #attachment: EnvironmentAttachmentHandle;

  readonly #routes: RegisteredTargets;

  readonly #services: SpineServices;

  readonly host: string;

  readonly port: number;

  readonly baseUrl: string;

  #closed: Promise<void> | undefined;

  #networkClosed = false;

  #attachmentDetached = false;

  readonly #closeGroup: RetryableCloseGroup;

  /**
   * Captures the running listener's network, environment, and cleanup resources.
   *
   * @param options Resources prepared by Server startup.
   */
  constructor(options: RunningHttp2ServerOptions) {
    this.#server = options.server;
    this.#sessions = options.sessions;
    this.#closeables = options.closeables;
    this.#contexts = options.contexts;
    this.#listenerLifecycles = options.listenerLifecycles;
    this.#environment = options.environment;
    this.#attachment = options.attachment;
    this.#routes = options.routes;
    this.#services = options.services;
    this.host = options.host;
    this.port = options.port;
    this.baseUrl = `http://${ServerValues.formatHostForUrl(options.host)}:${options.port.toString()}`;
    this.#closeGroup = new RetryableCloseGroup(
      this.#closeables,
      "Server close failed while closing owned contexts/resources.",
    );
  }

  /**
   * Closes this listener once, preserving a failed close for retry.
   *
   * @returns Completion after resources close.
   */
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
      for (const lifecycle of this.#listenerLifecycles) {
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

  /**
   * Checks whether a failed lifecycle start still needs close retry.
   *
   * @returns `true` when no close completion is retained.
   */
  hasPendingClose(): boolean {
    return this.#closed === undefined;
  }

  /**
   * Completes the server's Delivery detachment while network sessions remain available.
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

  /**
   * Closes network, delivery, accepted context work, and registered resources.
   *
   * @returns Completion after all resources close.
   */
  async #closeOnce(): Promise<void> {
    await this.#closeListenerAndNetwork();
    const { detachErrors, detachRejected } = await this.#detachDelivery();
    await this.#drainContexts();
    try {
      await this.#closeGroup.close();
      this.#routes.release();
    } catch (error) {
      if (!detachRejected) throw error;
      CloseErrors.collect(error, detachErrors);
      throw new AggregateError(
        detachErrors,
        "Server close failed while detaching delivery and closing owned contexts/resources.",
      );
    }
    if (detachRejected) ServerValues.throwRunningDetachErrors(detachErrors);
    spineServicesAccess.clearLogger(this.#services);
  }

  /**
   * Closes lifecycle attachments and network intake before delivery detachment.
   *
   * @returns Completion after the listener and sessions close.
   */
  async #closeListenerAndNetwork(): Promise<void> {
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
  }

  /**
   * Completes Delivery detachment while retaining errors for safe endpoint cleanup.
   *
   * @returns Detachment errors and whether detachment itself was rejected.
   */
  async #detachDelivery(): Promise<{ detachErrors: unknown[]; detachRejected: boolean }> {
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
    return { detachErrors, detachRejected };
  }

  /**
   * Waits for every context's accepted work before any Stand closes.
   *
   * @returns Completion after all context work drains.
   */
  async #drainContexts(): Promise<void> {
    for (const context of this.#contexts) boundedContextAccess.beginClose(context);
    const drained = await Promise.allSettled(
      this.#contexts.map((context) => boundedContextAccess.drainWork(context)),
    );
    const drainErrors = drained.flatMap((result) =>
      result.status === "rejected" ? [result.reason as unknown] : [],
    );
    if (drainErrors.length > 0) {
      throw new AggregateError(drainErrors, "Server close failed while draining contexts.");
    }
  }
}

interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly contexts: readonly BoundedContext[];
  readonly listenerLifecycles: readonly ListenerLifecycle[];
  readonly environment: ServerEnvironment;
  readonly attachment: EnvironmentAttachmentHandle;
  readonly routes: RegisteredTargets;
  readonly services: SpineServices;
  readonly host: string;
  readonly port: number;
}

/**
 * Groups private server assembly, network, and shutdown operations.
 *
 * @internal
 */
const ServerValues = Object.freeze({
  /**
   * Creates the HTTP/2 listener with Connect routes and session tracking.
   *
   * @param services Public service adapters.
   * @param sessions Set collecting active HTTP/2 sessions.
   * @param readMaxBytes Maximum request size.
   * @param writeMaxBytes Maximum response size.
   * @returns An unbound HTTP/2 server.
   */
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

  /**
   * Binds a listener and resolves its actual address.
   *
   * @param server HTTP/2 server to bind.
   * @param host Network host.
   * @param port Requested port, including zero for an ephemeral port.
   * @returns Bound listener address.
   */
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

  /**
   * Collects attachment and immediate cleanup failures for startup reporting.
   *
   * @param startError Attachment or duplicate registration failure.
   * @param cleanupError Failure while closing prepared resources.
   * @returns Both failures in one AggregateError.
   */
  attachmentCleanupError(startError: unknown, cleanupError: unknown): AggregateError {
    const errors: unknown[] = [];
    CloseErrors.collect(startError, errors);
    CloseErrors.collect(cleanupError, errors);
    return new AggregateError(
      errors,
      "Server attachment failed and immediate dependency cleanup also failed.",
    );
  },

  /**
   * Throws one deferred cleanup failure or groups several.
   *
   * @param errors Deferred cleanup failures.
   * @returns Never; this method throws.
   */
  throwCleanupErrors(errors: readonly unknown[]): never {
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(errors, "Server deferred failed-start cleanup failed.");
  },

  /**
   * Throws a listener-start failure with any rollback failures.
   *
   * @param startError Original listener failure.
   * @param cleanupErrors Failures while closing startup resources.
   * @returns Never; this method throws.
   */
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

  /**
   * Throws one delivery-detachment error or groups several.
   *
   * @param errors Delivery-detachment failures.
   * @returns Never; this method throws.
   */
  throwRunningDetachErrors(errors: readonly unknown[]): never {
    if (errors.length === 1) {
      throw errors[0];
    }
    throw new AggregateError(errors, "Server close failed while detaching delivery.");
  },

  /**
   * Closes the HTTP/2 server and all tracked sessions.
   *
   * @param server Listener being closed.
   * @param sessions Sessions admitted by the listener.
   * @returns Completion after the network releases its resources.
   */
  async closeNetwork(
    server: http2.Http2Server,
    sessions: Set<http2.ServerHttp2Session>,
  ): Promise<void> {
    const closed = ServerValues.closeHttpServer(server);
    await ServerValues.closeSessions(sessions);
    await closed;
    await ServerValues.nextTurn();
  },

  /**
   * Closes the listener, including a listener that never started.
   *
   * @param server Listener being closed.
   * @returns Completion after the listener closes.
   */
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

  /**
   * Closes all active HTTP/2 sessions.
   *
   * @param sessions Active sessions to close.
   * @returns Completion after every session closes.
   */
  async closeSessions(sessions: Set<http2.ServerHttp2Session>): Promise<void> {
    await Promise.all([...sessions].map((session) => ServerValues.closeSession(session)));
  },

  /**
   * Closes one session gracefully or destroys it after a bounded wait.
   *
   * @param session Active HTTP/2 session.
   * @returns Completion after close or forced destruction.
   */
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

  /**
   * Waits one event-loop turn for pending close callbacks.
   *
   * @returns Completion on the next turn.
   */
  nextTurn(): Promise<void> {
    return new Promise((resolve) => {
      setImmediate(resolve);
    });
  },

  /**
   * Wraps an IPv6 host for URL authority syntax.
   *
   * @param host Bound network host.
   * @returns Host formatted for the base URL.
   */
  formatHostForUrl(host: string): string {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  },

  /**
   * Normalizes a non-blank host for listener binding.
   *
   * @param host Configured host, if supplied.
   * @returns Normalized host or the loopback default.
   */
  normalizeHost(host: string | undefined): string {
    const normalized = host?.trim() ?? defaultHost;
    if (normalized.length === 0) {
      throw new Error("Server host must not be blank.");
    }
    return normalized;
  },

  /**
   * Validates a configured HTTP message-size limit.
   *
   * @param value Requested byte limit.
   * @param name Option name used in diagnostics.
   * @returns Accepted byte limit.
   */
  normalizeMessageMaxBytes(value: number, name: "readMaxBytes" | "writeMaxBytes"): number {
    if (!Number.isInteger(value) || value < 1 || value > maximumMessageMaxBytes) {
      throw new Error(`Server ${name} must be an integer from 1 through 4294967295.`);
    }
    return value;
  },
});
