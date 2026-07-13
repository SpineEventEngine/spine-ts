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
import type { EnvironmentAttachmentHandle } from "./environment-attachment.js";
import { collectCloseError, RetryableCloseGroup } from "./retryable-close.js";
import { ServerEnvironment, serverEnvironmentAccess } from "./server-environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const gracefulSessionDrainMs = 100;
type ServerContext = BoundedContext | BoundedContextBuilder;

/** Small JVM-familiar owner for real local Spine Connect/gRPC-compatible services. */
export class Server {
  readonly #host: string;
  readonly #port: number;
  readonly #contexts: ServerContext[] = [];
  readonly #resources: { close(): unknown }[] = [];
  readonly #services: Omit<SpineServicesOptions, "contexts">;
  readonly #environment: ServerEnvironment;
  readonly #ownsEnvironment: boolean;
  #starting: Promise<RunningServer> | undefined;
  #failedStartCleanup: FailedStartCleanup | undefined;
  #failedStartConsumed = false;

  /** Create a server builder. Prefer {@link Server.atPort} for the common case. */
  constructor(options: ServerOptions = {}) {
    this.#host = normalizeHost(options.host);
    this.#port = options.port ?? defaultPort;
    this.#contexts.push(...(options.contexts ?? []));
    this.#resources.push(...(options.resources ?? []));
    this.#services = options.services ?? {};
    this.#environment = options.environment ?? ServerEnvironment.local();
    this.#ownsEnvironment =
      options.environment === undefined ? true : (options.ownsEnvironment ?? false);
  }

  /** Create a server builder for the passed port on local-only `127.0.0.1`. */
  static atPort(port: number, options: Omit<ServerOptions, "port"> = {}): Server {
    return new Server({ ...options, port });
  }

  /**
   * Add one bounded context or builder to expose through the Spine services.
   *
   * Builders added here are assembled during {@link start} before listener
   * open. They use {@link ServerEnvironment.storageFactory} unless
   * `withStorageFactory(...)` already selected a more specific local factory.
   *
   * The server owns added contexts for this assembly. When the returned
   * {@link RunningServer} closes, it closes every added context after network
   * intake and active HTTP/2 sessions have stopped.
   */
  add(context: BoundedContext | BoundedContextBuilder): this {
    this.#contexts.push(context);
    return this;
  }

  /** Add one explicitly owned framework closeable. */
  addResource(resource: { close(): unknown }): this {
    this.#resources.push(resource);
    return this;
  }

  /** Start the HTTP/2 listener and return its running lifecycle handle. */
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
        ownership: this.#ownsEnvironment ? "server" : "caller",
        descriptors: contexts.map((context) => boundedContextAccess.delivery(context)),
      });
    } catch (error) {
      const closeGroup = new RetryableCloseGroup(
        [...contexts, ...this.#resources, ...(this.#ownsEnvironment ? [this.#environment] : [])],
        "Server start cleanup failed while closing owned contexts/resources.",
      );
      if (serverEnvironmentAccess.failedStartPending(this.#environment)) {
        this.#failedStartCleanup = { closeGroup, detachAttempted: false };
      } else {
        try {
          await closeGroup.close();
        } catch (cleanupError) {
          this.#failedStartCleanup = { closeGroup, detachAttempted: false };
          throw attachmentCleanupError(error, cleanupError);
        }
        this.#failedStartConsumed = true;
      }
      throw error;
    }
    const services = new SpineServices({
      contexts,
      ...this.#services,
    });
    const sessions = new Set<http2.ServerHttp2Session>();
    const httpServer = createHttpServer(services, sessions);
    const closeables = [
      ...contexts,
      ...this.#resources,
      ...(this.#ownsEnvironment ? [this.#environment] : []),
    ];
    const address = await listen(httpServer, this.#host, this.#port).catch(
      async (error: unknown) => {
        const cleanup: FailedStartCleanup = {
          closeGroup: new RetryableCloseGroup(
            closeables,
            "Server start cleanup failed while closing owned contexts/resources.",
          ),
          network: { server: httpServer, sessions },
          attachment,
          detachAttempted: false,
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

    if (!(await this.#advanceFailedStartAttachment(cleanup, errors))) {
      throwCleanupErrors(errors);
    }

    if (
      cleanup.attachment === undefined &&
      serverEnvironmentAccess.failedStartPending(this.#environment)
    ) {
      try {
        await serverEnvironmentAccess.retryFailedStart(this.#environment);
      } catch (error) {
        if (serverEnvironmentAccess.failedStartPending(this.#environment)) {
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

    if (!closeFailed && this.#failedStartCleanup === cleanup) {
      this.#failedStartCleanup = undefined;
      this.#failedStartConsumed = true;
    }
    if (errors.length > 0) {
      throwCleanupErrors(errors);
    }
    throw new Error("Server deferred cleanup completed after an earlier failed start.");
  }

  async #cleanupFailedListenerStart(
    cleanup: FailedStartCleanup,
    startError: unknown,
  ): Promise<never> {
    const errors: unknown[] = [];

    if (!(await this.#closeFailedStartNetwork(cleanup, errors))) {
      throwListenerStartError(startError, errors);
    }
    if (!(await this.#advanceFailedStartAttachment(cleanup, errors))) {
      throwListenerStartError(startError, errors);
    }

    let closeFailed = false;
    try {
      await cleanup.closeGroup.close();
    } catch (error) {
      closeFailed = true;
      collectCloseError(error, errors);
    }
    if (!closeFailed && this.#failedStartCleanup === cleanup) {
      this.#failedStartCleanup = undefined;
      this.#failedStartConsumed = true;
    }
    throwListenerStartError(startError, errors);
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

  async #advanceFailedStartAttachment(
    cleanup: FailedStartCleanup,
    errors: unknown[],
  ): Promise<boolean> {
    const attachment = cleanup.attachment;
    if (attachment === undefined) {
      return true;
    }
    try {
      if (cleanup.detachAttempted) {
        await serverEnvironmentAccess.retryDetach(this.#environment, attachment);
      } else {
        cleanup.detachAttempted = true;
        await serverEnvironmentAccess.detach(this.#environment, attachment);
      }
      delete cleanup.attachment;
      return true;
    } catch (error) {
      collectCloseError(error, errors);
    }
    try {
      if (serverEnvironmentAccess.endpointSafe(this.#environment, attachment)) {
        delete cleanup.attachment;
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
  network?: FailedStartNetwork;
  attachment?: EnvironmentAttachmentHandle;
  detachAttempted: boolean;
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
   * Built bounded contexts or builders owned by this server assembly.
   *
   * Builders in this list are assembled during {@link Server.start} before
   * listener open. They use {@link ServerEnvironment.storageFactory} unless
   * `withStorageFactory(...)` already selected a more specific local factory.
   */
  readonly contexts?: readonly (BoundedContext | BoundedContextBuilder)[];
  /** Service-level options for Command, Query, and Subscription routes. */
  readonly services?: Omit<SpineServicesOptions, "contexts">;
  /** Extra framework-owned closeables to close after network intake stops. */
  readonly resources?: readonly { close(): unknown }[];
  /**
   * Server runtime environment. Supplied environments are caller-owned unless
   * `ownsEnvironment` is explicitly true. When omitted, the server creates and
   * owns a local/test environment with in-memory defaults.
   */
  readonly environment?: ServerEnvironment;
  /** Whether this server closes the environment after contexts and resources. */
  readonly ownsEnvironment?: boolean;
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
   * Stop intake, close sessions, then close owned contexts/resources/environment.
   *
   * Repeated calls after a successful close are idempotent. Failed closes may
   * be retried, and retries skip owned close hooks that already succeeded.
   * Each attempt rejects with an `AggregateError` when any remaining owned
   * close hook fails.
   */
  close(): Promise<void>;
}

class RunningHttp2Server implements RunningServer {
  readonly #server: http2.Http2Server;
  readonly #sessions: Set<http2.ServerHttp2Session>;
  readonly #closeables: readonly unknown[];
  readonly #environment: ServerEnvironment;
  readonly #attachment: EnvironmentAttachmentHandle;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  #closed: Promise<void> | undefined;
  #networkClosed = false;
  readonly #closeGroup: RetryableCloseGroup;

  constructor(options: RunningHttp2ServerOptions) {
    this.#server = options.server;
    this.#sessions = options.sessions;
    this.#closeables = options.closeables;
    this.#environment = options.environment;
    this.#attachment = options.attachment;
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
    await serverEnvironmentAccess.detach(this.#environment, this.#attachment);
    await this.#closeGroup.close();
  }
}

interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly environment: ServerEnvironment;
  readonly attachment: EnvironmentAttachmentHandle;
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
): http2.Http2Server {
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        services.register(router);
      },
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
