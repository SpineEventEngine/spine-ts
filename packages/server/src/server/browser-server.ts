import * as http from "node:http";
import type { AddressInfo } from "node:net";

import {
  createNativeGatewayServices,
  InMemorySubscriptionBindings,
  NativeSubscriptionCreator,
  SubscriptionGateway,
  TransportFacts,
  UnaryGateway,
} from "@spine-event-engine/auth";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { AuthenticationService } from "@spine-event-engine/proto/auth";
import {
  CommandService,
  QueryService,
  SubscriptionService,
} from "@spine-event-engine/proto/client";

import type { BrowserServerOptions, RunningServer } from "./server.js";
import { isDurableSubscriptionBindings } from "./durable-subscription-bindings.js";

const gracefulBrowserDrainMs = 100;

interface BrowserHostOptions extends Omit<BrowserServerOptions, "host" | "port"> {
  readonly host: string;
  readonly port: number;
  readonly readMaxBytes: number;
  readonly writeMaxBytes: number;
  readonly production: boolean;
}

/**
 * Runs the private native endpoint behind one authenticated browser listener.
 *
 * @internal
 */
export const BrowserServer: Readonly<{
  open(native: RunningServer | string, options: BrowserHostOptions): Promise<RunningServer>;
  requests(options: BrowserServerOptions): {
    credential(context: { readonly requestHeader: Headers }): {
      readonly kind: "bearer" | "cookie";
      readonly value: string;
    };
    transport(context: { readonly requestHeader: Headers }): ReturnType<typeof TransportFacts.from>;
  };
  origins(origins: readonly string[]): ReadonlySet<string>;
  backendUrl(value: string): string;
  requireDurableBindings(options: BrowserServerOptions, production: boolean): void;
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo>;
  closeListener(server: http.Server): Promise<void>;
}> = Object.freeze({
  async open(native: RunningServer | string, options: BrowserHostOptions): Promise<RunningServer> {
    BrowserServer.requireDurableBindings(options, options.production);
    const origins = BrowserServer.origins(options.origins);
    const backendBaseUrl = typeof native === "string" ? native : native.baseUrl;
    const creator = new NativeSubscriptionCreator(createGrpcTransport({ baseUrl: backendBaseUrl }));
    const bindings =
      options.bindings ??
      new InMemorySubscriptionBindings({
        nextId: () => globalThis.crypto.randomUUID(),
        dispose: creator.dispose.bind(creator),
      });
    const requests = BrowserServer.requests(options);
    const unary = new UnaryGateway({
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      maxRequestBytes: 1_048_576,
      sessions: options.sessions,
      authorize: options.authorize,
      contexts: options.contexts,
      clock: options.clock,
      forward: creator.forward.bind(creator),
    });
    const subscriptions = new SubscriptionGateway({
      bindings,
      sessions: options.sessions,
      authorize: options.authorize,
      contexts: options.contexts,
      clock: options.clock,
      fingerprint: options.fingerprint,
      creator,
    });
    const services = createNativeGatewayServices({ unary, subscriptions, requests });
    const handler = connectNodeAdapter({
      routes: (router: ConnectRouter) => {
        router.service(AuthenticationService, services.authentication);
        router.service(CommandService, services.command);
        router.service(QueryService, services.query);
        router.service(SubscriptionService, services.subscription);
      },
      readMaxBytes: options.readMaxBytes,
      writeMaxBytes: options.writeMaxBytes,
    });
    const server = http.createServer((request, response) => {
      const origin = request.headers.origin;
      if (origin === undefined || !origins.has(origin)) {
        response.statusCode = 403;
        response.end();
        return;
      }
      response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-credentials", "true");
      response.setHeader("access-control-expose-headers", "grpc-status,grpc-message");
      response.setHeader("vary", "Origin");
      if (request.method === "OPTIONS") {
        response.setHeader("access-control-allow-methods", "POST,OPTIONS");
        response.setHeader(
          "access-control-allow-headers",
          "authorization,content-type,connect-protocol-version,x-csrf-token",
        );
        response.setHeader("access-control-max-age", "600");
        response.statusCode = 204;
        response.end();
        return;
      }
      handler(request, response);
    });
    let address: AddressInfo;
    try {
      address = await BrowserServer.listen(server, options.host, options.port);
    } catch (error) {
      try {
        await subscriptions.close();
      } catch (closeError) {
        throw new AggregateError([error, closeError], "Server browser startup rollback failed.");
      }
      throw error;
    }
    return new RunningBrowserServer(server, typeof native === "string" ? undefined : native, subscriptions, address);
  },
  requests(options: BrowserServerOptions) {
    return {
      credential: (context: { readonly requestHeader: Headers }) => {
        const headers = Object.fromEntries(context.requestHeader.entries());
        const extracted = options.cookies?.extract(headers);
        if (extracted !== undefined) {
          return extracted.kind === "rejected" ? { kind: "bearer" as const, value: "" } : extracted;
        }
        const bearer = /^Bearer ([^\s]+)$/.exec(context.requestHeader.get("authorization") ?? "");
        return { kind: "bearer" as const, value: bearer?.[1] ?? "" };
      },
      transport: (context: { readonly requestHeader: Headers }) => {
        const origin = context.requestHeader.get("origin");
        return TransportFacts.from({
          service: "browser",
          method: "gateway",
          ...(origin === null ? {} : { origin }),
          headers: Object.fromEntries(context.requestHeader.entries()),
        });
      },
    };
  },
  origins(values: readonly string[]): ReadonlySet<string> {
    const origins = new Set(
      values.map((value) => {
        let origin: URL;
        try {
          origin = new URL(value);
        } catch {
          throw new Error("Server browser origins must be canonical HTTP(S) origins.");
        }
        if (
          (origin.protocol !== "http:" && origin.protocol !== "https:") ||
          origin.origin !== value ||
          origin.pathname !== "/" ||
          origin.search ||
          origin.hash
        ) {
          throw new Error("Server browser origins must be canonical HTTP(S) origins.");
        }
        return value;
      }),
    );
    if (origins.size === 0 || origins.size !== values.length)
      throw new Error("Server browser origins must be unique and non-empty.");
    return origins;
  },
  backendUrl(value: string): string {
    let backend: URL;
    try {
      backend = new URL(value);
    } catch {
      throw new Error("Server browser backend must be a canonical HTTP(S) origin.");
    }
    if (
      (backend.protocol !== "http:" && backend.protocol !== "https:") ||
      backend.origin !== value ||
      backend.pathname !== "/" ||
      backend.search ||
      backend.hash ||
      backend.username ||
      backend.password
    ) {
      throw new Error("Server browser backend must be a canonical HTTP(S) origin.");
    }
    return value;
  },
  requireDurableBindings(options: BrowserServerOptions, production: boolean): void {
    if (options.backend !== undefined) {
      BrowserServer.backendUrl(options.backend.baseUrl);
      if (options.sessions === undefined || typeof options.sessions.resolve !== "function")
        throw new Error("Standalone browser server requires sessions.");
      if (typeof options.authorize !== "function")
        throw new Error("Standalone browser server requires authorization.");
      if (
        options.contexts === undefined ||
        typeof options.contexts.resolve !== "function" ||
        typeof options.contexts.resolveContext !== "function"
      )
        throw new Error("Standalone browser server requires context resolution.");
      if (options.clock === undefined || typeof options.clock.now !== "function")
        throw new Error("Standalone browser server requires a clock.");
      if (typeof options.fingerprint !== "function")
        throw new Error("Standalone browser server requires a fingerprint function.");
      if (options.bindings === undefined)
        throw new Error("Standalone browser server requires explicit subscription bindings.");
    }
    if (options.backend !== undefined && production && options.registry === undefined)
      throw new Error("Production standalone browser server requires a type registry.");
    const bindings = options.bindings;
    if (production && !isDurableSubscriptionBindings(bindings))
      throw new Error("Production browser server requires durable subscription bindings.");
    if (
      options.backend !== undefined &&
      production &&
      (bindings === undefined ||
        !("namespace" in bindings) ||
        typeof bindings.namespace !== "string" ||
        !bindings.namespace.trim())
    )
      throw new Error("Production standalone browser server requires named durable subscription bindings.");
  },
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        reject(error);
      };
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        resolve(server.address() as AddressInfo);
      });
    });
  },
  closeListener(server: http.Server): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        server.closeAllConnections();
      }, gracefulBrowserDrainMs);
      timer.unref();
      server.close((error) => {
        clearTimeout(timer);
        if (error === undefined) resolve();
        else reject(error);
      });
    });
  },
});

class RunningBrowserServer implements RunningServer {
  readonly #server: http.Server;
  readonly #subscriptions: SubscriptionGateway;
  readonly #native: RunningServer | undefined;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  #closed: Promise<void> | undefined;
  #listenerClose: Promise<void> | undefined;
  #listenerClosed = false;
  #subscriptionsClosed = false;
  #nativeClosed = false;

  constructor(
    server: http.Server,
    native: RunningServer | undefined,
    subscriptions: SubscriptionGateway,
    address: AddressInfo,
  ) {
    this.#server = server;
    this.#native = native;
    this.#subscriptions = subscriptions;
    this.host = typeof address.address === "string" ? address.address : "127.0.0.1";
    this.port = address.port;
    const host =
      this.host.includes(":") && !this.host.startsWith("[") ? `[${this.host}]` : this.host;
    this.baseUrl = `http://${host}:${this.port.toString()}`;
  }

  close(): Promise<void> {
    this.#closed ??= this.#closeOnce().catch((error: unknown) => {
      this.#closed = undefined;
      throw error;
    });
    return this.#closed;
  }

  async #closeOnce(): Promise<void> {
    const listener = this.#listenerClosed ? undefined : this.#closeListenerPhase();
    if (!this.#subscriptionsClosed) {
      await this.#subscriptions.close();
      this.#subscriptionsClosed = true;
    }
    if (listener !== undefined) {
      await listener;
      this.#listenerClosed = true;
    }
    if (this.#native !== undefined && !this.#nativeClosed) {
      await this.#native.close();
      this.#nativeClosed = true;
    }
  }

  #closeListenerPhase(): Promise<void> {
    const current = this.#listenerClose;
    if (current !== undefined) return current;
    const closing = BrowserServer.closeListener(this.#server);
    this.#listenerClose = closing;
    void closing.then(
      () => {
        this.#listenerClosed = true;
        this.#listenerClose = undefined;
      },
      () => {
        this.#listenerClose = undefined;
      },
    );
    return closing;
  }
}
