import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { StorageFactory } from "@spine-event-engine/storage";

import {
  BoundedContext,
  BoundedContextBuilder,
  boundedContextAccess,
} from "../context/bounded-context.js";
import { SpineServices, type SpineServicesOptions } from "../services/spine-services.js";
import { ContextTransportGroup } from "./context-transport-group.js";
import type { EnvironmentAttachmentHandle } from "./environment-attachment.js";
import { CloseErrors, RetryableCloseGroup } from "./retryable-close.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const defaultMessageMaxBytes = 4_194_304;
const maximumMessageMaxBytes = 0xffff_ffff;
const gracefulSessionDrainMs = 100;
type ServerContext = BoundedContext | BoundedContextBuilder;

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
  readonly #services: Omit<SpineServicesOptions, "contexts">;
  readonly #environment: ServerEnvironment;
  #starting: Promise<RunningServer> | undefined;
  #failedStartCleanup: FailedStartCleanup | undefined;
  #failedStartConsumed = false;

  /**
   * Creates a server builder.
   *
   * @param options - Configures local network, contexts, resources, and services.
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
  }

  /**
   * Creates a local-only server builder for one port.
   *
   * @param port - Selects the listener port, or zero for an ephemeral port.
   * @param options - Supplies all server options except the port.
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
   * @param context - Supplies the context or builder to expose.
   * @returns This server builder.
   */
  add(context: BoundedContext | BoundedContextBuilder): this {
    this.#contexts.push(context);
    return this;
  }

  /**
   * Adds a framework closeable owned by this server assembly.
   *
   * @param resource - Supplies the resource to close after contexts.
   * @returns This server builder.
   */
  addResource(resource: { close(): unknown }): this {
    this.#resources.push(resource);
    return this;
  }

  /**
   * Starts the server after completing assembly and delivery recovery.
   *
   * Built contexts open their transport registrations in deterministic input
   * order before the listener opens. A failed assembly, registration, or
   * listener open leaves no listener and closes acquired resources. Network
   * and transport cleanup are hard gates before delivery or dependencies close.
   * A later call after incomplete cleanup retries only that cleanup and leaves
   * this server terminal. A fresh server may reuse the singleton environment.
   * Concurrent callers share one start or cleanup attempt.
   *
   * @returns The running server once its listener accepts requests.
   */
  start(): Promise<RunningServer> {
    const current = this.#starting;
    if (current !== undefined) {
      return current;
    }
    if (this.#failedStartConsumed) {
      return Promise.reject(
        new Error("Server cannot restart after failed-start cleanup has completed."),
      );
    }
    const cleanup = this.#failedStartCleanup;
    const starting =
      cleanup === undefined ? this.#startOnce() : this.#retryFailedStartCleanup(cleanup);
    this.#starting = starting;
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

  async #startOnce(): Promise<RunningServer> {
    const contexts = await ServerValues.buildContexts(
      this.#contexts,
      this.#environment.storageFactory,
    );
    let attachment: EnvironmentAttachmentHandle;
    try {
      attachment = await serverEnvironmentAccess.attach(this.#environment, {
        ownership: "caller",
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
    const sessions = new Set<http2.ServerHttp2Session>();
    const httpServer = ServerValues.createHttpServer(
      services,
      sessions,
      this.#readMaxBytes,
      this.#writeMaxBytes,
    );
    const address = await ServerValues.listen(httpServer, this.#host, this.#port).catch(
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

    return new RunningHttp2Server({
      server: httpServer,
      sessions,
      environment: this.#environment,
      attachment,
      contextTransports,
      host,
      port: address.port,
      closeables,
    });
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

/** Options for building a local Spine HTTP/2 service host. */
export interface ServerOptions {
  /**
   * Listener host. Defaults to local-only `127.0.0.1`.
   *
   * Use a broader host such as `0.0.0.0` only when callers should reach this
   * process from outside the local machine.
   */
  readonly host?: string;
  /** Listener port. Defaults to `0`, asking the OS for a free port. */
  readonly port?: number;
  /**
   * Maximum uncompressed bytes accepted for one RPC request message.
   * Defaults to 4,194,304 bytes. Must be an integer from 1 through
   * 4,294,967,295.
   */
  readonly readMaxBytes?: number;
  /**
   * Maximum uncompressed bytes emitted for one RPC response message.
   * Defaults to 4,194,304 bytes. Must be an integer from 1 through
   * 4,294,967,295.
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
  /** Service-level options for Command, Query, and Subscription routes. */
  readonly services?: Omit<SpineServicesOptions, "contexts">;
  /** Extra framework-owned closeables to close after contexts become safe to close. */
  readonly resources?: readonly { close(): unknown }[];
}

/** Running local Spine service host. */
export interface RunningServer {
  /** Host accepted by the listener. */
  readonly host: string;
  /** Bound listener port. */
  readonly port: number;
  /** Base URL for Connect gRPC-compatible clients. */
  readonly baseUrl: string;
  /**
   * Closes intake, delivery, contexts, and owned resources.
   *
   * It stops network intake and sessions, closes context transport and drains
   * accepted work before detaching delivery. A failed intake close blocks later
   * phases until a retry. Sibling servers and process-wide facilities remain
   * available. Concurrent calls share one attempt; later calls retry only
   * unfinished cleanup, preserving stable flattened failure order.
   */
  close(): Promise<void>;
}

class RunningHttp2Server implements RunningServer {
  readonly #server: http2.Http2Server;
  readonly #sessions: Set<http2.ServerHttp2Session>;
  readonly #closeables: readonly unknown[];
  readonly #environment: ServerEnvironment;
  readonly #attachment: EnvironmentAttachmentHandle;
  readonly #contextTransports: ContextTransportGroup;
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
    this.#environment = options.environment;
    this.#attachment = options.attachment;
    this.#contextTransports = options.contextTransports;
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

  async #closeOnce(): Promise<void> {
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
  }
}

interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly environment: ServerEnvironment;
  readonly attachment: EnvironmentAttachmentHandle;
  readonly contextTransports: ContextTransportGroup;
  readonly host: string;
  readonly port: number;
}

/** @internal Groups private server assembly, network, and shutdown operations. */
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

  normalizeMessageMaxBytes(value: number, name: "readMaxBytes" | "writeMaxBytes"): number {
    if (!Number.isInteger(value) || value < 1 || value > maximumMessageMaxBytes) {
      throw new Error(`Server ${name} must be an integer from 1 through 4294967295.`);
    }
    return value;
  },
});
