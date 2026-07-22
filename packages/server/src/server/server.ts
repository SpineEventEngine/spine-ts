import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { StorageFactory } from "@spine-ts/storage";

import {
  BoundedContext,
  BoundedContextBuilder,
  boundedContextAccess,
} from "../context/bounded-context.js";
import { SpineServices, type SpineServicesOptions } from "../services/spine-services.js";
import { ContextTransportGroup } from "./context-transport-group.js";
import type { EnvironmentAttachmentHandle } from "./environment-attachment.js";
import { collectCloseError, RetryableCloseGroup } from "./retryable-close.js";
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

  /** Create a server builder. Prefer {@link Server.atPort} for the common case. */
  constructor(options: ServerOptions = {}) {
    this.#host = normalizeHost(options.host);
    this.#port = options.port ?? defaultPort;
    this.#readMaxBytes = normalizeMessageMaxBytes(
      options.readMaxBytes ?? defaultMessageMaxBytes,
      "readMaxBytes",
    );
    this.#writeMaxBytes = normalizeMessageMaxBytes(
      options.writeMaxBytes ?? defaultMessageMaxBytes,
      "writeMaxBytes",
    );
    this.#contexts.push(...(options.contexts ?? []));
    this.#resources.push(...(options.resources ?? []));
    this.#services = options.services ?? {};
    this.#environment = ServerEnvironment.instance();
  }

  /** Create a server builder for the passed port on local-only `127.0.0.1`. */
  static atPort(port: number, options: Omit<ServerOptions, "port"> = {}): Server {
    return new Server({ ...options, port });
  }

  /**
   * Add one bounded context or builder to expose through the Spine services.
   *
   * Builders added here are assembled during {@link start} before startup
   * recovery and listener open. They use
   * {@link ServerEnvironment.storageFactory} unless
   * `withStorageFactory(...)` already selected a more specific local factory.
   *
   * The server owns added contexts for this assembly. When the returned
   * {@link RunningServer} closes, it closes every added context after network
   * intake and active HTTP/2 sessions stop and active work can no longer use
   * the context.
   */
  add(context: BoundedContext | BoundedContextBuilder): this {
    this.#contexts.push(context);
    return this;
  }

  /** Add a framework closeable owned by this server assembly. */
  addResource(resource: { close(): unknown }): this {
    this.#resources.push(resource);
    return this;
  }

  /**
   * Assemble contexts, complete finite startup recovery, and open the listener.
   *
   * After recovery succeeds, the built contexts open their transport
   * registrations sequentially in deterministic input order. Every context
   * must register successfully before the HTTP server is created or its
   * listener is opened; a registration failure opens no listener.
   *
   * Context assembly failure opens no listener and closes contexts assembled
   * by that attempt. If environment startup, context transport registration, or
   * listener open fails, the server first closes acquired network resources and
   * context transport intake, waits until active work can no longer use its
   * dependencies, then closes contexts and explicit resources. Process-wide
   * facilities remain open until explicit {@link ServerEnvironment.close}
   * shutdown. Network and context transport cleanup are hard gates: a
   * cleanup-only `start()` retry must complete them before delivery detaches or
   * dependencies close. An initial rejection
   * combines the original startup failure first with reached cleanup failures
   * in stable phase order.
   *
   * If that cleanup cannot yet complete safely, a later call on this same
   * instance is cleanup-only: it does not assemble contexts or open a listener.
   * The retry reports only current cleanup failures, without repeating the
   * original startup failure or failures already reported. After cleanup
   * completes, the attempt rejects instead of returning a {@link RunningServer},
   * and this `Server` instance remains terminal.
   *
   * A newly assembled `Server` with fresh contexts may reuse the singleton
   * environment after cleanup. Concurrent calls share the same in-flight start
   * or cleanup attempt.
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
    const contexts = await buildContexts(this.#contexts, this.#environment.storageFactory);
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
          throw attachmentCleanupError(error, cleanupError);
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
    const httpServer = createHttpServer(
      services,
      sessions,
      this.#readMaxBytes,
      this.#writeMaxBytes,
    );
    const address = await listen(httpServer, this.#host, this.#port).catch(
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
      throwCleanupErrors(errors);
    }
    await this.#advanceFailedStartCleanup(cleanup, errors);
    if (errors.length > 0) {
      throwCleanupErrors(errors);
    }
    throw new Error("Server deferred cleanup completed after an earlier failed start.");
  }

  async #cleanupFailedContextStart(
    cleanup: FailedStartCleanup,
    startError: unknown,
  ): Promise<never> {
    const errors: unknown[] = [];

    await this.#advanceFailedStartCleanup(cleanup, errors);
    throwContextStartError(startError, errors);
  }

  async #cleanupFailedListenerStart(
    cleanup: FailedStartCleanup,
    startError: unknown,
  ): Promise<never> {
    const errors: unknown[] = [];

    if (!(await this.#closeFailedStartNetwork(cleanup, errors))) {
      throwListenerStartError(startError, errors);
    }
    await this.#advanceFailedStartCleanup(cleanup, errors);
    throwListenerStartError(startError, errors);
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
        collectCloseError(error, errors);
      }
    }

    let closeFailed = false;
    try {
      await cleanup.closeGroup.close();
    } catch (error) {
      closeFailed = true;
      collectCloseError(error, errors);
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
      await closeNetwork(network.server, network.sessions);
      delete cleanup.network;
      return true;
    } catch (error) {
      collectCloseError(error, errors);
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
      collectCloseError(error, errors);
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
      collectCloseError(error, errors);
    }
    try {
      if (serverEnvironmentAccess.endpointSafe(this.#environment, attachment)) {
        return true;
      }
    } catch (error) {
      collectCloseError(error, errors);
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
   * Stop network intake and sessions, close context transport registrations and
   * drain accepted work, then detach delivery before closing contexts and
   * explicit resources. Process-wide facilities remain open until explicit
   * {@link ServerEnvironment.close} shutdown.
   *
   * A failure while closing the network or context transport intake prevents
   * detach and dependency cleanup until a later retry completes that phase.
   * Closing one server does not interrupt sibling servers. The singleton
   * environment and its facilities remain open until explicit process
   * shutdown.
   *
   * Concurrent calls share one in-flight close. Repeated calls after a
   * successful close are idempotent. After a failed close, a later call retries
   * only unfinished cleanup. Failures may be arbitrary values. When multiple
   * failures are combined, their observable phase order is stable and nested
   * aggregates are flattened; an aggregate with no nested failures still
   * remains a failure.
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
    this.baseUrl = `http://${formatHostForUrl(options.host)}:${options.port.toString()}`;
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
      await closeNetwork(this.#server, this.#sessions);
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
        collectCloseError(error, detachErrors);
      }
      if (detachRejected) {
        let endpointSafe = false;
        try {
          endpointSafe = serverEnvironmentAccess.endpointSafe(this.#environment, this.#attachment);
        } catch (error) {
          collectCloseError(error, detachErrors);
        }
        if (!endpointSafe) {
          throwRunningDetachErrors(detachErrors);
        }
      }
    }
    try {
      await this.#closeGroup.close();
    } catch (error) {
      if (!detachRejected) {
        throw error;
      }
      collectCloseError(error, detachErrors);
      throw new AggregateError(
        detachErrors,
        "Server close failed while detaching delivery and closing owned contexts/resources.",
      );
    }
    if (detachRejected) {
      throwRunningDetachErrors(detachErrors);
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

async function buildContexts(
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
    await cleanupBuiltContexts(contexts, error);
    throw error;
  }
}

function createHttpServer(
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
}

function listen(server: http2.Http2Server, host: string, port: number): Promise<AddressInfo> {
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
}

async function cleanupBuiltContexts(
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
      [startError, ...toCleanupErrors(error)],
      "Server start failed while building bounded contexts.",
    );
  }
}

function toCleanupErrors(error: unknown): readonly unknown[] {
  if (error instanceof AggregateError) {
    return error.errors;
  }
  return [error];
}

function attachmentCleanupError(startError: unknown, cleanupError: unknown): AggregateError {
  const errors: unknown[] = [];
  collectCloseError(startError, errors);
  collectCloseError(cleanupError, errors);
  return new AggregateError(
    errors,
    "Server attachment failed and immediate dependency cleanup also failed.",
  );
}

function throwCleanupErrors(errors: readonly unknown[]): never {
  if (errors.length === 1) {
    throw errors[0];
  }
  throw new AggregateError(errors, "Server deferred failed-start cleanup failed.");
}

function throwListenerStartError(startError: unknown, cleanupErrors: readonly unknown[]): never {
  if (cleanupErrors.length === 0) {
    throw startError;
  }
  const errors: unknown[] = [];
  collectCloseError(startError, errors);
  for (const error of cleanupErrors) {
    collectCloseError(error, errors);
  }
  throw new AggregateError(
    errors,
    "Server start failed while opening listener and cleanup also failed.",
  );
}

function throwContextStartError(startError: unknown, cleanupErrors: readonly unknown[]): never {
  if (cleanupErrors.length === 0) {
    throw startError;
  }
  const errors: unknown[] = [];
  collectCloseError(startError, errors);
  for (const error of cleanupErrors) {
    collectCloseError(error, errors);
  }
  throw new AggregateError(
    errors,
    "Server start failed while opening context transport and cleanup also failed.",
  );
}

function throwRunningDetachErrors(errors: readonly unknown[]): never {
  if (errors.length === 1) {
    throw errors[0];
  }
  throw new AggregateError(errors, "Server close failed while detaching delivery.");
}

async function closeNetwork(
  server: http2.Http2Server,
  sessions: Set<http2.ServerHttp2Session>,
): Promise<void> {
  const closed = closeHttpServer(server);
  await closeSessions(sessions);
  await closed;
  await nextTurn();
}

function closeHttpServer(server: http2.Http2Server): Promise<void> {
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
}

async function closeSessions(sessions: Set<http2.ServerHttp2Session>): Promise<void> {
  await Promise.all([...sessions].map(closeSession));
}

function closeSession(session: http2.ServerHttp2Session): Promise<void> {
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
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function normalizeHost(host: string | undefined): string {
  const normalized = host?.trim() ?? defaultHost;
  if (normalized.length === 0) {
    throw new Error("Server host must not be blank.");
  }
  return normalized;
}

function normalizeMessageMaxBytes(value: number, name: "readMaxBytes" | "writeMaxBytes"): number {
  if (!Number.isInteger(value) || value < 1 || value > maximumMessageMaxBytes) {
    throw new Error(`Server ${name} must be an integer from 1 through 4294967295.`);
  }
  return value;
}
