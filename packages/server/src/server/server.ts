import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";

import type { BoundedContext } from "../context/bounded-context.js";
import { SpineServices, type SpineServicesOptions } from "../services/spine-services.js";
import { collectCloseError, RetryableCloseGroup } from "./retryable-close.js";
import { ServerEnvironment } from "./server-environment.js";

const defaultHost = "127.0.0.1";
const defaultPort = 0;
const gracefulSessionDrainMs = 100;

/** Small JVM-familiar owner for real local Spine Connect/gRPC-compatible services. */
export class Server {
  readonly #host: string;
  readonly #port: number;
  readonly #contexts: BoundedContext[] = [];
  readonly #resources: { close(): unknown }[] = [];
  readonly #services: Omit<SpineServicesOptions, "contexts">;
  readonly #environment: ServerEnvironment;
  readonly #ownsEnvironment: boolean;

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
   * Add one built bounded context to expose through the Spine services.
   *
   * The server owns added contexts for this assembly. When the returned
   * {@link RunningServer} closes, it closes every added context after network
   * intake and active HTTP/2 sessions have stopped.
   */
  add(context: BoundedContext): this {
    this.#contexts.push(context);
    return this;
  }

  /** Add one explicitly owned framework closeable. */
  addResource(resource: { close(): unknown }): this {
    this.#resources.push(resource);
    return this;
  }

  /** Start the HTTP/2 listener and return its running lifecycle handle. */
  async start(): Promise<RunningServer> {
    const services = new SpineServices({
      contexts: this.#contexts,
      ...this.#services,
    });
    const sessions = new Set<http2.ServerHttp2Session>();
    const httpServer = createHttpServer(services, sessions);
    const closeables = [
      ...this.#contexts,
      ...this.#resources,
      ...(this.#ownsEnvironment ? [this.#environment] : []),
    ];
    const address = await listenOrCleanup(httpServer, sessions, closeables, this.#host, this.#port);
    const host = typeof address.address === "string" ? address.address : this.#host;

    return new RunningHttp2Server({
      server: httpServer,
      sessions,
      host,
      port: address.port,
      closeables,
    });
  }
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
  /** Built bounded contexts owned by this server assembly. */
  readonly contexts?: readonly BoundedContext[];
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
    await this.#closeGroup.close();
  }
}

interface RunningHttp2ServerOptions {
  readonly server: http2.Http2Server;
  readonly sessions: Set<http2.ServerHttp2Session>;
  readonly closeables: readonly unknown[];
  readonly host: string;
  readonly port: number;
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

async function listenOrCleanup(
  server: http2.Http2Server,
  sessions: Set<http2.ServerHttp2Session>,
  closeables: readonly unknown[],
  host: string,
  port: number,
): Promise<AddressInfo> {
  try {
    return await listen(server, host, port);
  } catch (error) {
    await cleanupFailedStart(server, sessions, closeables, error);
    throw error;
  }
}

async function cleanupFailedStart(
  server: http2.Http2Server,
  sessions: Set<http2.ServerHttp2Session>,
  closeables: readonly unknown[],
  startError: unknown,
): Promise<void> {
  const errors: unknown[] = [];

  try {
    await closeNetwork(server, sessions);
  } catch (error) {
    collectCloseError(error, errors);
  }

  try {
    await new RetryableCloseGroup(
      closeables,
      "Server start cleanup failed while closing owned contexts/resources.",
    ).close();
  } catch (error) {
    collectCloseError(error, errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(
      [startError, ...errors],
      "Server start failed while opening listener and cleanup also failed.",
    );
  }
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
