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
import { clone, type Message } from "@bufbuild/protobuf";
import { ActorContextSchema, type ActorContext } from "@spine-event-engine/proto";
import type { AppQueryResponseFor } from "@spine-event-engine/core";
import {
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";

import { connectNodeAdapter } from "@connectrpc/connect-node";

import { BoundedContext, boundedContextAccess } from "../context/bounded-context.js";
import type { StandSubscriptionRegistry } from "../stand/subscription-registry.js";
import {
  SpineServices,
  spineServicesAccess,
  type SpineServicesOptions,
} from "../services/spine-services.js";
import { RegisteredTargets } from "../services/registered-targets.js";
import { AppQueryExecution } from "../services/app-query-execution.js";
import type { AppQueryHandler } from "../handler/app-query-handler.js";
import { ReadSideFilter } from "../stand/read-side-filter.js";
import { ReadSideFilterEngine } from "../stand/read-side-filter-engine.js";
import { TypeRegistry } from "@spine-event-engine/core";
import { registeredProtoModules } from "@spine-event-engine/proto/codegen";
import { ProcessServerCoordinator } from "./process-server-coordinator.js";
import { CloseErrors, RetryableCloseGroup } from "./retryable-close.js";
import { managedApplicationCapture } from "./managed-application-capture.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";
import { Application, applicationAccess } from "./application.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const maximumMessageMaxBytes = 0xffff_ffff;
const gracefulSessionDrainMs = 100;

/**
 * Identifies whether caller-managed or server-managed startup controls the environment lifecycle.
 */
type EnvironmentOwnership = "caller" | "server";

/**
 * Trusted framework input for a direct application query call.
 */
export interface ServerQueryExecutionContext extends TrustedReaderContext {
  /**
   * Effective actor and tenant captured from the current invocation.
   */
  readonly actorContext: ActorContext;

  /**
   * Cancellation of the current invocation, when available.
   */
  readonly signal?: AbortSignal;
}
const runningContexts = new WeakMap<RunningServer, readonly BoundedContext[]>();
const serverHosts = new WeakMap<Server, string>();
const serverApplications = new WeakMap<Server, Application>();

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
 * A server exposes one assembled Application through an HTTP/2 listener.
 * Endpoint cleanup releases listener resources while the Application stays open.
 */
export class Server {
  readonly #host: string;

  readonly #port: number;

  readonly #readMaxBytes: number;

  readonly #writeMaxBytes: number;

  readonly #resources: {
    /**
     * Releases a registered resource during server shutdown.
     */
    close(): unknown;
  }[] = [];

  readonly #listenerLifecycles: ListenerLifecycle[] = [];

  readonly #appQueries: readonly AppQueryHandler<never, Message>[];

  readonly #readFilters: readonly ReadSideFilter<
    import("@spine-event-engine/core").MessageSchema
  >[];

  readonly #services: Omit<SpineServicesOptions, "application">;

  #environment!: ServerEnvironment;

  #application: Application | undefined;

  #starting: Promise<RunningServer> | undefined;

  #startingOwnership: EnvironmentOwnership | undefined;

  #run: Promise<RunningServer> | undefined;

  #active: RunningHttp2Server | undefined;

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
    this.#appQueries = Object.freeze([...(options.appQueries ?? [])]);
    this.#readFilters = Object.freeze([...new Set(options.readSideFilters ?? [])]);
    this.#resources.push(...(options.resources ?? []));
    this.#services = options.services ?? {};
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
   * Sets the assembled Application served by this endpoint.
   *
   * @param application Supplies shared contexts and registered read routes.
   * @returns This server builder.
   */
  setApplication(application: Application): this {
    if (this.#starting !== undefined || this.#active !== undefined)
      throw new Error("Server application cannot change after startup.");
    this.#application = application;
    managedApplicationCapture.record(application);
    serverApplications.set(this, application);
    this.#environment = applicationAccess.environment(application);
    return this;
  }

  /**
   * Executes a generated application request through this Server's active handler table.
   *
   * @typeParam Q Generated request with a declared paired response.
   * @param query Generated application request, captured before any await.
   * @param executionContext Effective actor and verified facts from framework execution.
   * @returns The paired generated application result.
   */
  async query<Q extends Message>(
    query: Q & (AppQueryResponseFor<Q> extends never ? never : unknown),
    executionContext: ServerQueryExecutionContext,
  ): Promise<AppQueryResponseFor<Q>> {
    const detached = structuredClone(query);
    const actor = clone(ActorContextSchema, executionContext.actorContext);
    const reader = snapshotTrustedReader(executionContext);
    const signal = executionContext.signal;
    const running = this.#starting === undefined ? this.#active : await this.#starting;
    if (!(running instanceof RunningHttp2Server))
      throw new Error("Server App Query execution requires a running Server.");
    return running.queryTyped(detached, actor, reader, signal);
  }

  /**
   * Adds a closeable to release after this endpoint's accepted work drains.
   *
   * @param resource Supplies the endpoint resource to close.
   * @returns This server builder.
   */
  addResource(resource: {
    /**
     * Releases this resource during server shutdown.
     */
    close(): unknown;
  }): this {
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
   * Starts an endpoint after the Application has assembled its Bounded Contexts.
   *
   * The Application registers recipients before services and the listener open.
   * Failed listener startup retains endpoint cleanup for a later attempt.
   * Caller-managed startup installs no process signal handlers and leaves the
   * Application available for explicit closure after all endpoints stop.
   * Concurrent callers share one start or cleanup attempt.
   *
   * @returns The running server once its listener accepts requests.
   */
  start(): Promise<RunningServer> {
    return this.#start("caller");
  }

  /**
   * Shares or begins startup under the selected environment lifecycle mode.
   */
  #start(ownership: EnvironmentOwnership): Promise<RunningServer> {
    const application = this.#application;
    if (application === undefined)
      return Promise.reject(new Error("Server requires setApplication() before startup."));
    try {
      applicationAccess.useMode(application, ownership);
    } catch (error) {
      return Promise.reject(this.#startError(error));
    }
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
    const starting = this.#selectStartAttempt();
    return this.#trackStart(starting, ownership);
  }

  /**
   * Shares the current start attempt and clears its marker after it settles.
   *
   * @param starting Selected listener start or cleanup retry.
   * @param ownership Selected process lifecycle mode.
   * @returns The selected start attempt.
   */
  #trackStart(
    starting: Promise<RunningServer>,
    ownership: EnvironmentOwnership,
  ): Promise<RunningServer> {
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
   * Normalizes a thrown startup value for the public rejection.
   *
   * @param error Thrown startup value.
   * @returns An Error describing the failed start.
   */
  #startError(error: unknown): Error {
    return error instanceof Error ? error : new Error("Server startup failed.", { cause: error });
  }

  /**
   * Selects startup or retry of the last incomplete listener cleanup.
   *
   * @returns The selected asynchronous start attempt.
   */
  #selectStartAttempt(): Promise<RunningServer> {
    const lifecycle = this.#failedListenerLifecycle;
    if (lifecycle !== undefined) return this.#retryFailedListenerLifecycle(lifecycle);
    const cleanup = this.#failedStartCleanup;
    return cleanup === undefined
      ? this.#startApplication(this.#requireApplication())
      : this.#retryFailedStartCleanup(cleanup);
  }

  /**
   * Returns the Application selected before listener startup.
   *
   * @returns The selected Application.
   */
  #requireApplication(): Application {
    if (this.#application === undefined)
      throw new Error("Server requires setApplication() before startup.");
    return this.#application;
  }

  /**
   * Starts this endpoint with process-managed `SIGINT` and `SIGTERM` shutdown.
   *
   * Concurrent calls on this server return one managed handle. A managed run
   * cannot mix with caller-managed endpoints for the same Application. The
   * process coordinator closes the Application after its final managed endpoint
   * stops. Incomplete close work remains retryable through endpoint close or
   * a later process signal.
   *
   * @returns The running server after its listener accepts requests.
   */
  run(): Promise<RunningServer> {
    const application = this.#application;
    if (application === undefined)
      return Promise.reject(new Error("Server requires setApplication() before run()."));
    const current = this.#run;
    if (current !== undefined) return current;
    const environment = this.#environment;
    let finish: () => void;
    try {
      finish = applicationAccess.beginManagedStart(application);
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Managed Server start failed.", { cause: error }),
      );
    }
    return this.#beginManagedRun(application, environment, finish);
  }

  /**
   * Tracks process startup and cleanup after managed admission succeeds.
   *
   * @param application Application exposed by the endpoint.
   * @param environment Facilities used for process logging.
   * @param onFinish Releases the pending managed start.
   * @returns The running endpoint after registration.
   */
  #beginManagedRun(
    application: Application,
    environment: ServerEnvironment,
    onFinish: () => void,
  ): Promise<RunningServer> {
    const running = this.#start("server")
      .then((server) => {
        const managed = ProcessServerCoordinator.add(
          server,
          application,
          serverEnvironmentAccess.loggerFor(environment),
          () => {
            if (this.#run === running) {
              this.#run = undefined;
            }
          },
        );
        managedApplicationCapture.replaceEndpoint(server, managed);
        return managed;
      })
      .finally(onFinish)
      .catch((error: unknown) => this.#cleanupFailedManagedStart(error));
    this.#run = running;
    void running.catch(() => {
      if (this.#run === running) {
        this.#run = undefined;
      }
    });
    return running;
  }

  /**
   * Releases a managed Application after failed startup when no endpoint survived.
   *
   * @param error Startup failure to preserve.
   * @returns A rejection after safe cleanup settles.
   */
  async #cleanupFailedManagedStart(error: unknown): Promise<never> {
    const application = this.#requireApplication();
    await applicationAccess.whenManagedStartsIdle(application);
    if (applicationAccess.hasEndpoints(application)) throw error;
    try {
      await application.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Managed Server startup cleanup failed.");
    }
    throw error;
  }

  /**
   * Starts a listener against preassembled Application contexts and routes.
   *
   * @param application Shared runtime to expose.
   * @returns The listening endpoint after Application admission.
   */
  async #startApplication(application: Application): Promise<RunningServer> {
    const finish = applicationAccess.beginStart(application);
    try {
      const running = await this.#openListener(
        application.contexts(),
        applicationAccess.targets(application),
      );
      await this.#startLifecycles(running);
      try {
        applicationAccess.endpointStarted(application);
        running.markRegistered();
      } catch (error) {
        try {
          await running.close();
        } catch (cleanup) {
          this.#failedListenerLifecycle = running;
          throw new AggregateError([error, cleanup], "Application start cleanup failed.");
        }
        throw error;
      }
      this.#active = running;
      managedApplicationCapture.recordEndpoint(running);
      return running;
    } catch (error) {
      this.#retainFailedStart(application);
      throw error;
    } finally {
      finish();
    }
  }

  /**
   * Gives the Application retryable cleanup for a failed listener start.
   *
   * @param application Shared runtime retaining failed network cleanup.
   */
  #retainFailedStart(application: Application): void {
    if (this.#failedListenerLifecycle === undefined && this.#failedStartCleanup === undefined)
      return;
    applicationAccess.retainFailedStart(application, async () => {
      const lifecycle = this.#failedListenerLifecycle;
      if (lifecycle !== undefined) {
        try {
          await this.#retryFailedListenerLifecycle(lifecycle);
        } catch (error) {
          if (this.#failedListenerLifecycle !== undefined) throw error;
        }
      }
      const cleanup = this.#failedStartCleanup;
      if (cleanup !== undefined) {
        try {
          await this.#retryFailedStartCleanup(cleanup);
        } catch (error) {
          if (this.#failedStartCleanup !== undefined) throw error;
        }
      }
    });
  }

  /**
   * Opens the service listener with retryable cleanup for every preparation phase.
   *
   * @param contexts Contexts exposed by the listener.
   * @param routes Routes installed for these contexts.
   * @returns The prepared running listener.
   */
  async #openListener(
    contexts: readonly BoundedContext[],
    routes: RegisteredTargets,
  ): Promise<RunningHttp2Server> {
    const closeables = [...this.#resources];
    const cleanup: FailedStartCleanup = {
      closeGroup: new RetryableCloseGroup(
        closeables,
        "Server start cleanup failed while closing listener resources.",
      ),
    };
    try {
      return await this.#prepareListener(contexts, routes, closeables, cleanup);
    } catch (error) {
      this.#failedStartCleanup = cleanup;
      return this.#cleanupFailedListenerStart(cleanup, error);
    }
  }

  /**
   * Constructs services and the HTTP adapter, then binds the listener.
   *
   * @param contexts Contexts exposed by this Server.
   * @param routes Installed state routes.
   * @param closeables Contexts and resources for eventual shutdown.
   * @param cleanup Retained cleanup state if preparation fails.
   * @returns The prepared running listener.
   */
  async #prepareListener(
    contexts: readonly BoundedContext[],
    routes: RegisteredTargets,
    closeables: readonly unknown[],
    cleanup: FailedStartCleanup,
  ): Promise<RunningHttp2Server> {
    const { queries, services } = this.#createReadServices(routes, cleanup);
    const { httpServer, sessions } = this.#createHttpListener(services);
    cleanup.network = { server: httpServer, sessions };
    const address = await ServerValues.listen(httpServer, this.#host, this.#port);
    const host = typeof address.address === "string" ? address.address : this.#host;
    return this.#createRunningServer({
      server: httpServer,
      sessions,
      environment: this.#environment,
      queries,
      services,
      host,
      port: address.port,
      contexts,
      closeables,
      application: this.#requireApplication(),
    });
  }

  /**
   * Installs Server result policies and query execution into one listener's services.
   *
   * @param routes Validated Entity state routes.
   * @param cleanup Retained failure cleanup state.
   * @returns Listener services and App Query execution lifetime.
   */
  #createReadServices(
    routes: RegisteredTargets,
    cleanup: FailedStartCleanup,
  ): { queries: AppQueryExecution; services: SpineServices } {
    const filters =
      this.#readFilters.length === 0
        ? undefined
        : new ReadSideFilterEngine(
            this.#readFilters,
            TypeRegistry.from(...registeredProtoModules()),
          );
    const queries = new AppQueryExecution(this.#appQueries, routes, filters);
    const services = new SpineServices({
      application: this.#requireApplication(),
      readMaxBytes: this.#readMaxBytes,
      ...this.#services,
    });
    cleanup.services = services;
    spineServicesAccess.installAppQueries(services, queries);
    if (filters !== undefined) spineServicesAccess.installReadFilters(services, filters);
    spineServicesAccess.installLogger(
      services,
      serverEnvironmentAccess.loggerFor(this.#environment),
    );
    return { queries, services };
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

  /**
   * Retries deferred network and resource cleanup from a failed startup, then reports the prior failure.
   */
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

  /**
   * Retries a failed listener lifecycle close and leaves the server terminal.
   */
  async #retryFailedListenerLifecycle(running: RunningHttp2Server): Promise<never> {
    await running.close();
    this.#failedListenerLifecycle = undefined;
    this.#failedStartConsumed = true;
    throw new Error("Server deferred cleanup completed after an earlier failed start.");
  }

  /**
   * Cleans up startup resources after listener lifecycle startup fails.
   */
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

  /**
   * Closes acquired dependencies and releases startup registrations after network cleanup succeeds.
   */
  async #advanceFailedStartCleanup(cleanup: FailedStartCleanup, errors: unknown[]): Promise<void> {
    let closeFailed = false;
    try {
      await cleanup.closeGroup.close();
    } catch (error) {
      closeFailed = true;
      CloseErrors.collect(error, errors);
    }
    if (!closeFailed && this.#failedStartCleanup === cleanup) {
      if (cleanup.services !== undefined) spineServicesAccess.clearLogger(cleanup.services);
      this.#failedStartCleanup = undefined;
      this.#failedStartConsumed = true;
    }
  }

  /**
   * Attempts listener and session shutdown, retaining cleanup state if it fails.
   */
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

  /**
   * Clears the in-progress startup marker after the shared attempt settles.
   */
  #finishStart(starting: Promise<RunningServer>): void {
    if (this.#starting === starting) {
      this.#starting = undefined;
      this.#startingOwnership = undefined;
    }
  }
}

/**
 * Resources and registrations retained to retry cleanup after startup failure.
 */
interface FailedStartCleanup {
  readonly closeGroup: RetryableCloseGroup;
  services?: SpineServices;
  network?: FailedStartNetwork;
}

/**
 * Native listener and sessions that must close before startup resources are released.
 */
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
  /**
   * Reports whether the configured server host resolves to a loopback address.
   */
  isLoopback(server: Server): boolean;

  /**
   * Returns the Application configured for this native server builder.
   */
  application(server: Server): Application | undefined;
}> = Object.freeze({
  /**
   * Reports whether the configured server host resolves to a loopback address.
   */
  isLoopback(server: Server): boolean {
    const host = serverHosts.get(server);
    return host !== undefined && isLoopbackHost(host);
  },

  /**
   * Returns the Application configured for this native server builder.
   */
  application(server: Server): Application | undefined {
    return serverApplications.get(server);
  },
});

/**
 * Recognizes IPv4 and IPv6 loopback host spellings accepted by the server.
 */
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
   * Handler instances selected explicitly for this Server's App Query routes.
   */
  readonly appQueries?: readonly AppQueryHandler<never, Message>[];

  /**
   * Domain policies applied once to this Server's gRPC read results.
   */
  readonly readSideFilters?: readonly ReadSideFilter<
    import("@spine-event-engine/core").MessageSchema
  >[];

  /**
   * Service-level options for Command, Query, and Subscription routes.
   */
  readonly services?: Omit<SpineServicesOptions, "application">;

  /**
   * Extra endpoint closeables released after accepted work drains.
   */
  readonly resources?: readonly {
    /**
     * Releases the resource while shared Bounded Contexts may remain open.
     */
    close(): unknown;
  }[];
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
   * Closes intake, admitted work, and added resources.
   *
   * It stops network intake and sessions, then drains
   * accepted work before closing listener resources. A failed intake close blocks later
   * phases until a retry. Sibling servers remain available. Caller-managed
   * servers leave process-wide facilities available; closing the final
   * run-managed server closes its environment. Concurrent calls share one
   * attempt; later calls retry only unfinished cleanup, preserving stable
   * flattened failure order.
   *
   * @returns A promise that settles after this server's cleanup completes.
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
   * @returns Completion after admitted Delivery work for this server drains.
   */
  drainDelivery(server: RunningServer): Promise<void>;
}

/**
 * Provides framework-only `RunningServer` context facts.
 *
 * @internal
 */
export const runningServerAccess: RunningServerAccess = Object.freeze({
  /**
   * Returns subscription registries for contexts in this running server, when available.
   */
  subscriptionRegistries(server: RunningServer): readonly StandSubscriptionRegistry[] | undefined {
    return runningContexts
      .get(server)
      ?.map((context) => boundedContextAccess.subscriptionRegistry(context));
  },

  /**
   * Waits for admitted Delivery work across this server’s contexts to settle.
   */
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

  readonly #listenerLifecycles: readonly ListenerLifecycle[];

  readonly #startedLifecycles: ListenerLifecycle[] = [];

  readonly #environment: ServerEnvironment;

  readonly #application: Application;

  #registered = false;

  readonly #services: SpineServices;

  readonly #queries: AppQueryExecution;

  readonly host: string;

  readonly port: number;

  readonly baseUrl: string;

  #closed: Promise<void> | undefined;

  #networkClosed = false;

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
    this.#listenerLifecycles = options.listenerLifecycles;
    this.#environment = options.environment;
    this.#application = options.application;
    this.#services = options.services;
    this.#queries = options.queries;
    this.host = options.host;
    this.port = options.port;
    this.baseUrl = `http://${ServerValues.formatHostForUrl(options.host)}:${options.port.toString()}`;
    this.#closeGroup = new RetryableCloseGroup(
      this.#closeables,
      "Server close failed while closing listener resources.",
    );
  }

  /**
   * Dispatches a generated request only while this listener remains active.
   *
   * @typeParam Q Generated application request with a paired response.
   * @param query Captured generated request.
   * @param actor Current effective actor and tenant.
   * @param reader Verified current invocation facts.
   * @param signal Current invocation cancellation, when available.
   * @returns The paired generated application result.
   */
  queryTyped<Q extends Message>(
    query: Q,
    actor: ActorContext,
    reader: TrustedReaderContext,
    signal?: AbortSignal,
  ): Promise<AppQueryResponseFor<Q>> {
    if (this.#closed !== undefined)
      return Promise.reject(new Error("Server App Query execution is closed."));
    return this.#queries.executeTyped(query, actor, reader, signal);
  }

  /**
   * Closes this listener once, preserving a failed close for retry.
   *
   * @returns Completion after resources close.
   */
  close(): Promise<void> {
    this.#queries.beginClose();
    spineServicesAccess.stopAdmissions(this.#services);
    this.#closed ??= this.#closeOnce().catch((error: unknown) => {
      this.#closed = undefined;
      throw error;
    });
    return this.#closed;
  }

  /**
   * Starts listener lifecycles after the native listener accepts connections.
   *
   * @returns Completes after all listener lifecycles start or their rollback settles.
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
   * Marks this listener as counted by its Application after startup.
   */
  markRegistered(): void {
    this.#registered = true;
  }

  /**
   * Waits for the environment's admitted Delivery work.
   *
   * @returns Completion after active shard runs settle.
   */
  drainDelivery(): Promise<void> {
    return serverEnvironmentAccess.whenDeliveryIdle(this.#environment);
  }

  /**
   * Closes network, accepted endpoint work, and registered resources.
   *
   * @returns Completion after all resources close.
   */
  async #closeOnce(): Promise<void> {
    await this.#closeListenerAndNetwork();
    const errors: unknown[] = [];
    try {
      await Promise.all([this.#queries.drain(), spineServicesAccess.drainWork(this.#services)]);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.#closeGroup.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 1)
      throw new AggregateError(
        errors,
        "Server close failed while draining endpoint work and resources.",
      );
    if (errors.length === 1) throw errors[0];
    spineServicesAccess.clearLogger(this.#services);
    if (this.#registered) {
      applicationAccess.endpointClosed(this.#application);
      this.#registered = false;
    }
  }

  /**
   * Closes lifecycle callbacks and network intake before context cleanup.
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
}

/**
 * Listener, context, service, route, and lifecycle dependencies for a running HTTP/2 server.
 */
interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly application: Application;
  readonly contexts: readonly BoundedContext[];
  readonly listenerLifecycles: readonly ListenerLifecycle[];
  readonly environment: ServerEnvironment;
  readonly services: SpineServices;
  readonly queries: AppQueryExecution;
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
   * Collects route registration and immediate cleanup failures for startup reporting.
   *
   * @param startError Route or duplicate registration failure.
   * @param cleanupError Failure while closing prepared resources.
   * @returns Both failures in one AggregateError.
   */
  registrationCleanupError(startError: unknown, cleanupError: unknown): AggregateError {
    const errors: unknown[] = [];
    CloseErrors.collect(startError, errors);
    CloseErrors.collect(cleanupError, errors);
    return new AggregateError(
      errors,
      "Server registration failed and immediate dependency cleanup also failed.",
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
