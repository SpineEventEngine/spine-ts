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

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/require-await */

import * as http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AddressInfo } from "node:net";

import {
  createNativeGatewayServices,
  DynamicSubscriptionCreator,
  DynamicUnaryForwarder,
  InMemorySubscriptionBindings,
  NativeSubscriptionCreator,
  SubscriptionGateway,
  TransportFacts,
  type Clock,
  type ContextResolver,
  type SessionResolver,
  type RequestCredential,
  type SubscriptionBindings,
  UnaryGateway,
} from "@spine-event-engine/auth";
import {
  Code,
  ConnectError,
  cors as connectCors,
  createContextKey,
  type ConnectRouter,
  type ContextValues,
  type Interceptor,
} from "@connectrpc/connect";
import {
  connectNodeAdapter,
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";
import { AuthenticationService } from "@spine-event-engine/proto/auth";
import { ApplicationNode, type NodeDiscovery } from "@spine-event-engine/deployment";
import {
  CommandService,
  QueryService,
  SubscriptionService,
} from "@spine-event-engine/proto/client";

import type { RunningServer } from "../server/server.js";
import { Server, serverBuilderAccess } from "../server/server.js";
import type {
  BrowserAuthRoute,
  BrowserCredentialReader,
  BrowserServerOptions,
  StandaloneBrowserServerOptions,
} from "./options.js";
import { BrowserAdmissionPolicy } from "./browser-admission.js";
import {
  attachDurableSubscriptionCleanup,
  isDurableSubscriptionBindings,
} from "./durable-subscription-bindings.js";
import reservedSpineRpcPaths from "../server/reserved-spine-rpc-paths.json" with { type: "json" };
import { Environment, EnvironmentType } from "../server/environment.js";
import { ProcessServerCoordinator } from "../server/process-server-coordinator.js";
import { ServerEnvironment } from "../server/server-environment.js";

const gracefulBrowserDrainMs = 100;
const reservedPathSet = new Set(reservedSpineRpcPaths);

/**
 * Raw credential facts carried to the Connect interceptor for one request.
 */
interface BrowserCredentialContext {
  readonly facts?: Parameters<BrowserCredentialReader["read"]>[0];
}
const credentialContext = new AsyncLocalStorage<BrowserCredentialContext>();
const admittedCredential = createContextKey<RequestCredential | undefined>(undefined, {
  description: "Browser credential admitted for one Connect request",
});
const emptyAdmission = Object.freeze({
  csrfHeaderNames: Object.freeze([]),
  credentialCookieNames: Object.freeze([]),
  stateCookieNames: Object.freeze([]),
});
const bearerCredentials: BrowserCredentialReader = Object.freeze({
  admission: emptyAdmission,
  read: async ({ headers }: Parameters<BrowserCredentialReader["read"]>[0]) => {
    const supplied = headers.authorization;
    if (supplied === undefined) return undefined;
    if (typeof supplied !== "string") return { kind: "rejected" as const };
    const match = /^Bearer ([\x21-\x7e]+)$/.exec(supplied);
    return match === null
      ? { kind: "rejected" as const }
      : { kind: "bearer" as const, value: match[1] ?? "" };
  },
});

/**
 * Browser admission inputs before session and access requirements are normalized.
 */
interface UncheckedBrowserAdmission {
  readonly sessions?: SessionResolver;
  readonly publicAccess?: true;
  readonly bindings?: SubscriptionBindings;
  readonly contexts?: ContextResolver;
  readonly clock?: Clock;
}

/**
 * Holds fully normalized options while a browser listener is being assembled.
 *
 * @internal
 */
type BrowserHostOptions = BrowserServerOptions & {
  readonly host: string;
  readonly port: number;
  readonly readMaxBytes: number;
  readonly writeMaxBytes: number;
  readonly production: boolean;
  readonly credentialReader: BrowserCredentialReader;
  readonly admissionPolicy: BrowserAdmissionPolicy;
  readonly authRouteMap: ReadonlyMap<string, BrowserAuthRoute>;
  readonly dynamicManagerFactory?: (node: ApplicationNode) => Http2SessionManager;
};

/**
 * Captured reader, route and raw admission policy from one startup preflight.
 */
interface BrowserAdmissionSnapshot {
  readonly credentialReader: BrowserCredentialReader;
  readonly admissionPolicy: BrowserAdmissionPolicy;
  readonly authRouteMap: ReadonlyMap<string, BrowserAuthRoute>;
  readonly authRoutes: readonly BrowserAuthRoute[];
}

/**
 * Accepts options used only through the browser-server white-box seam.
 *
 * @internal
 */
type BrowserServerTestOptions = BrowserServerOptions & Partial<BrowserHostOptions>;

/**
 * Carries fixed browser listener policy into its per-request router.
 */
interface BrowserRouteContext {
  readonly options: BrowserHostOptions;
  readonly origins: ReadonlySet<string>;
  readonly authRoutes: ReadonlyMap<string, BrowserAuthRoute>;
  readonly activeAuth: Set<AbortController>;
  readonly maxActiveAuthRequests: number;
  readonly draining: () => boolean;
  readonly handler: (request: http.IncomingMessage, response: http.ServerResponse) => void;
}

/**
 * Returns assembled gateway services to the browser listener.
 */
interface BrowserListenerInput extends Omit<BrowserRouteContext, "handler"> {
  readonly unary: UnaryGateway;
  readonly subscriptions: SubscriptionGateway;
  readonly requests: ReturnType<typeof browserServerImplementation.requests>;
}

/**
 * Carries the started gateway graph into listener publication and rollback.
 */
interface BrowserStartedInput {
  readonly options: BrowserHostOptions;
  readonly running: RunningServer | undefined;
  readonly subscriptions: SubscriptionGateway;
  readonly stopDiscovery: (() => Promise<void>) | undefined;
  readonly dynamic: DynamicUnaryForwarder;
  readonly activeAuth: Set<AbortController>;
  readonly server: http.Server;
  readonly onDrain: () => void;
}

/**
 * Runs the private native endpoint behind one admitted browser listener.
 *
 * Hosts browser-facing Spine gateway routes independently from native server assembly.
 */
export const browserServerImplementation: Readonly<{
  /**
   * Starts a browser listener against the supplied native backend.
   *
   * @param native The native backend to expose through this browser host.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The listening browser endpoint with coordinated native-backend cleanup.
   */
  open(native: RunningServer, options: BrowserServerOptions): Promise<RunningServer>;

  /**
   * Starts a browser listener against the supplied native backend.
   *
   * @param native The native backend to expose through this browser host.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The listening browser endpoint with coordinated native-backend cleanup.
   */
  open(
    native: string | readonly string[] | undefined,
    options: StandaloneBrowserServerOptions,
  ): Promise<RunningServer>;

  /**
   * Starts the browser host and registers it for process-level shutdown.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns The running host registered with the process coordinator.
   */
  run(options: StandaloneBrowserServerOptions): Promise<RunningServer>;

  /**
   * Starts the browser host and registers it for process-level shutdown.
   *
   * @param native The native backend to expose through this browser host.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The running host registered with the process coordinator.
   */
  run(native: Server, options: BrowserServerOptions): Promise<RunningServer>;

  /**
   * Builds credential extraction and transport-fact adapters for browser requests.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns Adapters that the gateway uses to admit each incoming request.
   */
  requests(options: BrowserServerOptions): {
    /**
     * Reads the credential admitted into this Connect call's context values.
     *
     * @param context Connect context values carrying the reader's result.
     * @returns The admitted credential, or undefined when the reader found none.
     */
    credential(context: { readonly requestHeader: Headers; readonly values?: ContextValues }):
      | {
          readonly kind: "bearer" | "cookie";
          readonly value: string;
        }
      | undefined;

    /**
     * Captures browser request headers and origin for admission policy.
     *
     * @param context Incoming request headers; these do not establish authenticated identity.
     * @returns Transport facts containing the browser origin and request headers.
     */
    transport(context: { readonly requestHeader: Headers }): ReturnType<typeof TransportFacts.from>;
  };

  /**
   * Validates a nonempty set of unique canonical HTTP(S) origins.
   *
   * @param origins Canonical browser origins permitted to access the listener.
   * @returns The validated origins for exact admission checks.
   */
  origins(origins: readonly string[]): ReadonlySet<string>;

  /**
   * Rejects backend URLs containing paths, credentials, queries, or fragments.
   *
   * @param value The backend origin to validate.
   * @returns The original canonical backend origin.
   */
  backendUrl(value: string): string;

  /**
   * Validates a nonempty list of distinct native backend origins.
   *
   * @param values Native backend origins in routing order.
   * @returns The validated backend origins in their configured order.
   */
  backendUrls(values: readonly string[]): readonly string[];

  /**
   * Selects the node endpoint and its configured TLS server name.
   *
   * @param node The application node whose native transport is being configured.
   * @returns Transport settings preserving the node's TLS server-name override.
   */
  dynamicTransportOptions(node: ApplicationNode): {
    readonly baseUrl: string;
    readonly nodeOptions?: { readonly servername: string };
  };

  /**
   * Checks admission ports and production subscription-persistence requirements.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param production Whether production persistence requirements must be enforced.
   */
  requireDurableBindings(options: BrowserServerOptions, production: boolean): void;

  /**
   * Validates authentication routes and rejects duplicate or reserved RPC paths.
   *
   * @param routes Optional HTTP authentication endpoints to validate and index.
   * @returns Validated routes indexed by their exact HTTP path.
   */
  authRoutes(
    routes: readonly BrowserAuthRoute[] | undefined,
  ): ReadonlyMap<string, BrowserAuthRoute>;

  /**
   * Executes an authentication route within its configured origin, size, and time bounds.
   *
   * @param request The incoming HTTP request.
   * @param response The HTTP response to complete with the route outcome.
   * @param route The matched authentication endpoint and its admission constraints.
   * @param active Controllers tracked so shutdown can abort active authentication requests.
   * @param writeMaxBytes The existing transport bound for the authentication response body.
   * @returns Completion after the HTTP response and request cleanup settle.
   */
  dispatchAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: BrowserAuthRoute,
    active: Set<AbortController>,
    writeMaxBytes: number,
  ): Promise<void>;

  /**
   * Binds the HTTP listener and propagates startup errors.
   *
   * @param server The HTTP listener being started or stopped.
   * @param host The interface address on which to bind the listener.
   * @param port The requested listener port; zero requests an ephemeral port.
   * @returns The actual bound address, including an allocated ephemeral port.
   */
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo>;

  /**
   * Stops accepting connections and drains the HTTP listener.
   *
   * @param server The HTTP listener being started or stopped.
   * @returns Completion after the listener closes; rejects on a close error.
   */
  closeListener(server: http.Server): Promise<void>;

  /**
   * Applies listener defaults and checks browser admission configuration before startup.
   *
   * @param mode Whether a native server is started locally or supplied as a separate backend.
   * @param options Browser listener, admission, and backend configuration.
   * @returns Normalized listener options after all preflight checks pass.
   */
  preflight(mode: "combined" | "standalone", options: BrowserServerOptions): BrowserHostOptions;
}> = Object.freeze({
  /**
   * Starts a browser listener against the supplied native backend.
   *
   * @param native The native backend to expose through this browser host.
   * @param input Browser configuration to validate before opening the listener.
   * @returns The listening browser endpoint with coordinated native-backend cleanup.
   */
  async open(
    native: RunningServer | string | readonly string[] | undefined,
    input: BrowserServerOptions,
  ): Promise<RunningServer> {
    const running = BrowserServerValues.running(native);
    if (running !== undefined && !BrowserServerValues.isLoopback(running.host))
      throw new Error("Combined browser server requires a loopback native listener.");
    let options: BrowserHostOptions;
    try {
      options = BrowserServer.preflight(native === undefined ? "standalone" : "combined", input);
    } catch (error) {
      await BrowserServerValues.rollback(
        error,
        running === undefined ? [] : [() => running.close()],
      );
      throw error;
    }
    return BrowserServerValues.openWithOptions(native, running, options);
  },

  /**
   * Starts the browser host and registers it for process-level shutdown.
   *
   * @param nativeOrOptions The local Server to start, or options for a standalone browser gateway.
   * @param suppliedOptions Browser configuration when a local Server is supplied separately.
   * @returns The running host registered with the process coordinator.
   */
  async run(
    nativeOrOptions: Server | BrowserServerOptions,
    suppliedOptions?: BrowserServerOptions,
  ): Promise<RunningServer> {
    const options = suppliedOptions ?? (nativeOrOptions as BrowserServerOptions);
    const combined = nativeOrOptions instanceof Server;
    if (combined) {
      if (!serverBuilderAccess.isLoopback(nativeOrOptions))
        throw new Error("Combined browser server requires a loopback native listener.");
    }
    const prepared = BrowserServer.preflight(combined ? "combined" : "standalone", options);
    const native = combined ? await nativeOrOptions.start() : undefined;
    const running = await BrowserServerValues.openWithOptions(native, native, prepared);
    return ProcessServerCoordinator.add(
      running,
      native === undefined ? undefined : ServerEnvironment.instance(),
      undefined,
      () => undefined,
    );
  },

  /**
   * Applies listener defaults and checks browser admission configuration before startup.
   *
   * @param mode Whether a native server is started locally or supplied as a separate backend.
   * @param input Browser configuration to validate before opening the listener.
   * @returns Normalized listener options after all preflight checks pass.
   */
  preflight(mode, input): BrowserHostOptions {
    const admission = BrowserServerValues.snapshotAdmission(input);
    const production = Environment.instance().type === EnvironmentType.Production;
    BrowserServer.requireDurableBindings(input, production);
    const options: BrowserHostOptions = {
      ...input,
      origins: Object.freeze([...input.origins]),
      ...admission,
      host: input.host ?? "127.0.0.1",
      port: input.port ?? 0,
      readMaxBytes: input.readMaxBytes ?? 4_194_304,
      writeMaxBytes: input.writeMaxBytes ?? 4_194_304,
      production,
    };
    if (!options.host.trim()) throw new Error("Browser server host must not be blank.");
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535)
      throw new Error("Browser server port must be an integer from 0 through 65535.");
    if (!Number.isInteger(options.readMaxBytes) || options.readMaxBytes < 1)
      throw new Error("Browser server readMaxBytes must be a positive integer.");
    if (!Number.isInteger(options.writeMaxBytes) || options.writeMaxBytes < 1)
      throw new Error("Browser server writeMaxBytes must be a positive integer.");
    if (mode === "standalone" && options.backend === undefined && options.discovery === undefined)
      throw new Error("Standalone browser server requires a backend or discovery.");
    BrowserServer.origins(options.origins);
    const capacity = options.maxActiveAuthRequests ?? 64;
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Browser maxActiveAuthRequests must be a positive safe integer.");
    return options;
  },

  /**
   * Builds credential extraction and transport-fact adapters for browser requests.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns Adapters that the gateway uses to admit each incoming request.
   */
  requests(options: BrowserServerOptions) {
    void options;
    return {
      credential: (context: { readonly requestHeader: Headers; readonly values?: ContextValues }) =>
        context.values?.get(admittedCredential),
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

  /**
   * Validates a nonempty set of unique canonical HTTP(S) origins.
   *
   * @param values Browser origins to validate and deduplicate.
   * @returns The validated origins for exact admission checks.
   */
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

  /**
   * Rejects backend URLs containing paths, credentials, queries, or fragments.
   *
   * @param value The backend origin to validate.
   * @returns The original canonical backend origin.
   */
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

  /**
   * Validates a nonempty list of distinct native backend origins.
   *
   * @param values Native backend origins in routing order.
   * @returns The validated backend origins in their configured order.
   */
  backendUrls(values: readonly string[]): readonly string[] {
    if (values.length < 1)
      throw new Error("Server browser backends must contain at least one origin.");
    const urls = values.map((value) => BrowserServer.backendUrl(value));
    if (new Set(urls).size !== urls.length)
      throw new Error("Server browser backends must be unique canonical HTTP(S) origins.");
    return urls;
  },

  /**
   * Selects the node endpoint and its configured TLS server name.
   *
   * @param node The application node whose native transport is being configured.
   * @returns Transport settings preserving the node's TLS server-name override.
   */
  dynamicTransportOptions(node: ApplicationNode) {
    return {
      baseUrl: node.endpoint,
      ...(node.tlsServerName === undefined
        ? {}
        : { nodeOptions: { servername: node.tlsServerName } }),
    };
  },

  /**
   * Checks admission ports and production subscription-persistence requirements.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param production Whether production persistence requirements must be enforced.
   */
  requireDurableBindings(options: BrowserServerOptions, production: boolean): void {
    const supplied = options as unknown as UncheckedBrowserAdmission;
    const standalone = options.backend !== undefined || options.discovery !== undefined;
    if (options.backend !== undefined) {
      BrowserServer.backendUrls(BrowserServerValues.backendUrlsFor(options.backend));
    }
    if (standalone) {
      if ((supplied.sessions === undefined) === (options.publicAccess !== true))
        throw new Error(
          "Standalone browser server requires exactly one of sessions or publicAccess.",
        );
      if (supplied.sessions !== undefined && typeof supplied.sessions.resolve !== "function")
        throw new Error("Standalone browser server requires sessions with a resolver.");
      if (typeof options.authorize !== "function")
        throw new Error("Standalone browser server requires authorization.");
      if (
        supplied.contexts === undefined ||
        typeof supplied.contexts.resolve !== "function" ||
        typeof supplied.contexts.resolveContext !== "function"
      )
        throw new Error("Standalone browser server requires context resolution.");
      if (supplied.clock === undefined || typeof supplied.clock.now !== "function")
        throw new Error("Standalone browser server requires a clock.");
      if (options.bindings === undefined && options.publicAccess !== true)
        throw new Error("Standalone browser server requires explicit subscription bindings.");
    }
    if (supplied.publicAccess === true && supplied.bindings !== undefined)
      throw new Error("Public browser access owns process-local subscription bindings.");
    if (standalone && production && options.registry === undefined)
      throw new Error("Production standalone browser server requires a type registry.");
    const bindings = options.bindings;
    if (production && options.publicAccess !== true && !isDurableSubscriptionBindings(bindings))
      throw new Error("Production browser server requires durable subscription bindings.");
    if (
      standalone &&
      options.publicAccess !== true &&
      production &&
      (bindings === undefined ||
        !("namespace" in bindings) ||
        typeof bindings.namespace !== "string" ||
        !bindings.namespace.trim())
    )
      throw new Error(
        "Production standalone browser server requires named durable subscription bindings.",
      );
  },

  /**
   * Validates authentication routes and rejects duplicate or reserved RPC paths.
   *
   * @param routes Optional HTTP authentication endpoints to validate and index.
   * @returns Validated routes indexed by their exact HTTP path.
   */
  authRoutes(
    routes: readonly BrowserAuthRoute[] | undefined,
  ): ReadonlyMap<string, BrowserAuthRoute> {
    const result = new Map<string, BrowserAuthRoute>();
    for (const route of routes ?? []) {
      const method = (route as { readonly method: string }).method;
      if (method !== "GET" && method !== "POST")
        throw new Error("Browser auth routes must use GET or POST.");
      if (reservedPathSet.has(route.path))
        throw new Error("Browser auth routes must not use reserved Spine RPC paths.");
      if (!/^\/(?!\/)(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(route.path))
        throw new Error("Browser auth routes must use exact canonical non-root paths.");
      if (
        !Number.isSafeInteger(route.maxRequestBytes) ||
        route.maxRequestBytes <= 0 ||
        route.maxRequestBytes > 4_194_304
      )
        throw new Error(
          "Browser auth route maxRequestBytes must be a positive safe transport bound.",
        );
      if (
        !Number.isSafeInteger(route.timeoutMs) ||
        route.timeoutMs < 1 ||
        route.timeoutMs > 2_147_483_647
      )
        throw new Error(
          "Browser auth route timeoutMs must be a safe positive millisecond duration.",
        );
      BrowserServer.origins(route.origins);
      if (result.has(route.path))
        throw new Error("Browser auth routes must use one method per canonical path.");
      result.set(route.path, route);
    }
    return result;
  },

  /**
   * Executes an authentication route within its configured origin, size, and time bounds.
   *
   * @param request The incoming HTTP request.
   * @param response The HTTP response to complete with the route outcome.
   * @param route The matched authentication endpoint and its admission constraints.
   * @param active Controllers tracked so shutdown can abort active authentication requests.
   * @param writeMaxBytes The existing transport bound for the authentication response body.
   * @returns Completion after the HTTP response and request cleanup settle.
   */
  async dispatchAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: BrowserAuthRoute,
    active: Set<AbortController>,
    writeMaxBytes: number,
  ): Promise<void> {
    if (!AuthRouteScope.admit(request, response, route)) return;
    const scope = new AuthRouteScope(request, response, route.timeoutMs, active);
    try {
      const body = await scope.body(route.maxRequestBytes);
      if (body === undefined) return;
      const url = new URL(
        request.url ?? route.path,
        `http://${request.headers.host ?? "localhost"}`,
      );
      const input = new Request(url, {
        method: route.method,
        headers: request.headers as HeadersInit,
        ...(body.byteLength === 0 ? {} : { body: new Uint8Array(body) }),
        signal: scope.signal,
      });
      const result = await scope.wait(Promise.resolve(route.onRequest(input, scope.signal)));
      await scope.send(result, writeMaxBytes);
    } catch {
      scope.fail();
    } finally {
      scope.close();
    }
  },

  /**
   * Binds the HTTP listener and propagates startup errors.
   *
   * @param server The HTTP listener being started or stopped.
   * @param host The interface address on which to bind the listener.
   * @param port The requested listener port; zero requests an ephemeral port.
   * @returns The actual bound address, including an allocated ephemeral port.
   */
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

  /**
   * Stops accepting connections and drains the HTTP listener.
   *
   * @param server The HTTP listener being started or stopped.
   * @returns Completion after the listener closes; rejects on a close error.
   */
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

/**
 * Exposes white-box browser-host operations to source-level behavior tests.
 *
 * @internal
 */
type BrowserServerTestAccess = Omit<
  typeof browserServerImplementation,
  "open" | "run" | "requests" | "requireDurableBindings" | "preflight"
> & {
  /**
   * Starts a browser listener against the supplied native backend.
   *
   * @param native The native backend to expose through this browser host.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The listening browser endpoint with coordinated native-backend cleanup.
   */
  open(
    native: RunningServer | string | readonly string[] | undefined,
    options: BrowserServerTestOptions,
  ): Promise<RunningServer>;

  /**
   * Starts the browser host and registers it for process-level shutdown.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns The running host registered with the process coordinator.
   */
  run(options: BrowserServerTestOptions): Promise<RunningServer>;

  /**
   * Starts the browser host and registers it for process-level shutdown.
   *
   * @param native The native backend to expose through this browser host.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The running host registered with the process coordinator.
   */
  run(native: Server, options: BrowserServerTestOptions): Promise<RunningServer>;

  /**
   * Builds credential extraction and transport-fact adapters for browser requests.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns Adapters that the gateway uses to admit each incoming request.
   */
  requests(options: BrowserServerTestOptions): {
    /**
     * Reads the credential admitted into this Connect call's context values.
     *
     * @param context Connect context values carrying the reader's result.
     * @returns The admitted credential, or undefined when the reader found none.
     */
    credential(context: {
      readonly requestHeader: Headers;
      readonly values?: ContextValues;
    }): { readonly kind: "bearer" | "cookie"; readonly value: string } | undefined;

    /**
     * Captures browser request headers and origin for admission policy.
     *
     * @param context Incoming request headers; these do not establish authenticated identity.
     * @returns Transport facts containing the browser origin and request headers.
     */
    transport(context: { readonly requestHeader: Headers }): ReturnType<typeof TransportFacts.from>;
  };

  /**
   * Checks admission ports and production subscription-persistence requirements.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param production Whether production persistence requirements must be enforced.
   */
  requireDurableBindings(options: BrowserServerTestOptions, production: boolean): void;

  /**
   * Applies listener defaults and checks browser admission configuration before startup.
   *
   * @param mode Whether a native server is started locally or supplied as a separate backend.
   * @param options Browser listener, admission, and backend configuration.
   * @returns Normalized listener options after all preflight checks pass.
   */
  preflight(mode: "combined" | "standalone", options: BrowserServerTestOptions): BrowserHostOptions;
};

/**
 * Provides the internal white-box browser-host seam for source-level behavior tests.
 *
 * @internal
 */
export const browserServerTestAccess: BrowserServerTestAccess = Object.freeze({
  ...browserServerImplementation,
});

const BrowserServer = browserServerImplementation;

/**
 * Tracks one bounded authentication request through body and response streaming.
 */
class AuthRouteScope {
  /**
   * Checks route origin and declared body length before allocating request state.
   * @param request Incoming HTTP request.
   * @param response Response for rejected input.
   * @param route Selected authentication route.
   * @returns Whether the request may enter the route callback.
   */
  static admit(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: BrowserAuthRoute,
  ): boolean {
    const origin = request.headers.origin;
    if (
      (origin === undefined && route.allowMissingOrigin !== true) ||
      (origin !== undefined && !route.origins.includes(origin))
    ) {
      response.statusCode = 403;
      response.end();
      return false;
    }
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > route.maxRequestBytes)) {
      response.statusCode = 413;
      response.end();
      return false;
    }
    return true;
  }

  readonly #controller = new AbortController();

  readonly #aborted: Promise<never>;

  readonly #timer: ReturnType<typeof setTimeout>;

  #responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  readonly #abort = () => {
    this.#controller.abort();
  };

  readonly #onAbort: () => void;

  /**
   * Starts the route deadline and disconnect fences.
   * @param request Incoming HTTP request.
   * @param response Response to complete or abort.
   * @param timeoutMs Configured route deadline in milliseconds.
   * @param active Controllers drained when the host closes.
   */
  constructor(
    readonly request: http.IncomingMessage,
    readonly response: http.ServerResponse,
    timeoutMs: number,
    readonly active: Set<AbortController>,
  ) {
    let rejectAbort!: (reason: unknown) => void;
    this.#aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    this.#onAbort = () => {
      rejectAbort(new Error("browser auth request aborted"));
      void this.#responseReader?.cancel().catch(() => undefined);
    };
    active.add(this.#controller);
    this.#timer = setTimeout(() => {
      this.#controller.abort();
      request.resume();
    }, timeoutMs);
    request.once("aborted", this.#abort);
    response.once("close", this.#abort);
    this.#controller.signal.addEventListener("abort", this.#onAbort, { once: true });
  }

  /**
   * Exposes the signal passed to the configured route callback.
   * @returns Signal that aborts on deadline, disconnect or host drain.
   */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Awaits one route step while allowing deadline and disconnect to stop it.
   * @typeParam T Result returned by the pending route step.
   * @param pending Body, callback, or response-read step.
   * @returns The step's result when the request remains active.
   */
  async wait<T>(pending: Promise<T>): Promise<T> {
    const result = await Promise.race([pending, this.#aborted]);
    if (this.signal.aborted) throw new Error("browser auth request aborted");
    return result;
  }

  /**
   * Reads the bounded route body before constructing a WHATWG request.
   * @param limit Configured maximum request bytes.
   * @returns Complete body, or undefined after a 413 response.
   */
  async body(limit: number): Promise<Buffer | undefined> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const body = this.request[Symbol.asyncIterator]();
    for (;;) {
      const next = await this.wait(body.next());
      if (next.done) return Buffer.concat(chunks);
      const bytes = Buffer.from(next.value as Uint8Array);
      size += bytes.byteLength;
      if (size > limit) {
        this.response.statusCode = 413;
        this.response.end();
        return undefined;
      }
      chunks.push(bytes);
    }
  }

  /**
   * Streams a bounded route response and preserves separate Set-Cookie fields.
   * @param result Configured route callback result.
   * @param limit Existing response-size transport bound.
   * @returns Completion after the response is sent or rejected for size.
   */
  async send(result: Response, limit: number): Promise<void> {
    this.#requireActive();
    this.#responseReader = result.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (this.#responseReader !== undefined) {
      for (;;) {
        const next = await this.wait(this.#responseReader.read());
        if (next.done) break;
        size += next.value.byteLength;
        if (size > limit) {
          await this.#responseReader.cancel().catch(() => undefined);
          this.response.statusCode = 413;
          this.response.end();
          return;
        }
        chunks.push(next.value);
      }
    }
    this.#requireActive();
    this.response.statusCode = result.status;
    this.#forwardHeaders(result.headers);
    this.response.end(Buffer.concat(chunks));
  }

  /**
   * Copies callback headers while retaining host CORS and separate cookie values.
   * @param headers Callback response headers.
   */
  #forwardHeaders(headers: Headers): void {
    headers.forEach((value, key) => {
      if (key === "vary") {
        const values = value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
        this.response.setHeader("vary", [...new Set(["Origin", ...values])].join(", "));
      } else if (key !== "set-cookie" && !key.startsWith("access-control-"))
        this.response.setHeader(key, value);
    });
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) this.response.setHeader("set-cookie", cookies);
  }

  /**
   * Rejects output after a deadline or disconnect aborts the route.
   */
  #requireActive(): void {
    if (this.signal.aborted) throw new Error("browser auth request aborted");
  }

  /**
   * Completes a failed route without exposing partial callback output.
   */
  fail(): void {
    if (this.response.writableEnded) return;
    if (this.signal.aborted) {
      this.response.shouldKeepAlive = false;
      this.response.setHeader("connection", "close");
    }
    this.response.statusCode = this.signal.aborted ? 504 : 500;
    this.response.end();
  }

  /**
   * Removes the deadline and active-request membership.
   */
  close(): void {
    clearTimeout(this.#timer);
    this.request.off("aborted", this.#abort);
    this.response.off("close", this.#abort);
    this.signal.removeEventListener("abort", this.#onAbort);
    this.active.delete(this.#controller);
  }
}

const BrowserServerValues = Object.freeze({
  /**
   * Gets one unambiguous original Origin field for credentialed CORS.
   * @param request Incoming Node request before header normalization.
   * @returns The sole raw Origin value, when present exactly once.
   */
  rawOrigin(request: http.IncomingMessage): string | undefined {
    let origin: string | undefined;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      if (request.rawHeaders[index]?.toLowerCase() !== "origin") continue;
      if (origin !== undefined) return undefined;
      origin = request.rawHeaders[index + 1];
    }
    return origin;
  },

  /**
   * Applies the host's exact-origin credentialed CORS policy to every admitted response.
   * @param response Node response receiving policy headers.
   * @param origin Validated exact origin from the raw request.
   * @param csrfNames Frozen active reader or route CSRF header names.
   * @param method Configured route method or RPC POST method.
   * @param rpc Whether gRPC status headers must be exposed.
   */
  cors(
    response: http.ServerResponse,
    origin: string,
    csrfNames: readonly string[],
    method: "GET" | "POST",
    rpc: boolean,
  ): void {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("access-control-allow-credentials", "true");
    response.setHeader("access-control-allow-methods", `${method},OPTIONS`);
    response.setHeader(
      "access-control-allow-headers",
      [
        ...new Set(
          ["authorization", "x-csrf-token", ...connectCors.allowedHeaders, ...csrfNames].map(
            (name) => name.toLowerCase(),
          ),
        ),
      ].join(","),
    );
    if (rpc)
      response.setHeader(
        "access-control-expose-headers",
        connectCors.exposedHeaders.map((name) => name.toLowerCase()).join(","),
      );
    response.setHeader("access-control-max-age", "600");
    response.setHeader("vary", "Origin");
  },

  /**
   * Reads request-local raw facts inside Connect's deadline and disconnect signal.
   * @param reader Configured browser credential reader.
   * @returns Connect interceptor that transfers only the admitted credential to the Gateway.
   */
  credentialInterceptor(reader: BrowserCredentialReader): Interceptor {
    return (next) => async (request) => {
      const facts = credentialContext.getStore()?.facts;
      if (facts === undefined)
        throw new ConnectError("Browser credential facts are absent.", Code.Internal);
      const credential = await BrowserServerValues.readCredential(reader, facts, request.signal);
      request.contextValues.set(admittedCredential, credential);
      return next(request);
    };
  },

  /**
   * Reads a credential under Connect cancellation and classifies terminal outcomes.
   * @param reader Configured browser credential reader.
   * @param facts Immutable raw headers, method, and request-local URL.
   * @param signal Connect request signal including its protocol deadline.
   * @returns Credential or absence before application handling.
   */
  async readCredential(
    reader: BrowserCredentialReader,
    facts: Parameters<BrowserCredentialReader["read"]>[0],
    signal: AbortSignal,
  ): Promise<RequestCredential | undefined> {
    const result = await BrowserServerValues.awaitReader(reader, facts, signal);
    if (signal.aborted) throw BrowserServerValues.abortReason(signal);
    if (result?.kind === "rejected")
      throw new ConnectError("Browser credential rejected.", Code.Unauthenticated);
    return result;
  },

  /**
   * Awaits a reader until Connect aborts or reaches its deadline.
   * @param reader Configured browser credential reader.
   * @param facts Immutable raw request facts.
   * @param signal Connect request signal.
   * @returns Reader result before terminal classification.
   */
  async awaitReader(
    reader: BrowserCredentialReader,
    facts: Parameters<BrowserCredentialReader["read"]>[0],
    signal: AbortSignal,
  ): ReturnType<BrowserCredentialReader["read"]> {
    if (signal.aborted) throw BrowserServerValues.abortReason(signal);
    const cancelled = new Error("browser request cancelled");
    let onAbort!: () => void;
    const cancellation = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        reject(cancelled);
      };
    });
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw cancelled;
          return reader.read(facts);
        }),
        cancellation,
      ]);
    } catch (error) {
      if (error === cancelled) throw BrowserServerValues.abortReason(signal);
      throw new ConnectError(
        "Browser credential reader unavailable.",
        Code.Unavailable,
        undefined,
        undefined,
        error,
      );
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  },

  /**
   * Returns Connect's deadline reason or a classified request cancellation.
   * @param signal Aborted Connect request signal.
   * @returns Deadline or cancellation error for the current call.
   */
  abortReason(signal: AbortSignal): ConnectError {
    return signal.reason instanceof ConnectError
      ? signal.reason
      : new ConnectError("Browser request cancelled.", Code.Canceled);
  },

  /**
   * Validates and copies reader and route declarations before any startup await.
   * @param input Untrusted browser configuration at the startup boundary.
   * @returns One frozen route and admission snapshot.
   */
  snapshotAdmission(input: BrowserServerOptions): BrowserAdmissionSnapshot {
    if (input.credentials !== undefined && input.cookies !== undefined)
      throw new Error("Browser credentials and legacy cookies cannot both be configured.");
    const reader = input.credentials ?? input.cookies ?? bearerCredentials;
    const routes = BrowserServer.authRoutes(input.authRoutes);
    const policy = BrowserAdmissionPolicy.create(reader.admission, routes);
    const copied = new Map<string, BrowserAuthRoute>();
    for (const [path, route] of routes) {
      const admission = policy.routes.get(path);
      if (admission === undefined) throw new Error("Browser route admission snapshot is absent.");
      copied.set(
        path,
        Object.freeze({
          ...route,
          origins: Object.freeze([...route.origins]),
          admission,
        }),
      );
    }
    return {
      credentialReader: reader,
      admissionPolicy: policy,
      authRouteMap: copied,
      authRoutes: Object.freeze([...copied.values()]),
    };
  },

  /**
   * Builds the admitted browser listener from normalized options.
   *
   * @param native The native backend to expose through this browser host.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The listening host after membership and durable recovery are ready.
   */
  async openWithOptions(
    native: RunningServer | string | readonly string[] | undefined,
    running: RunningServer | undefined,
    options: BrowserHostOptions,
  ): Promise<RunningServer> {
    const activeAuth = new Set<AbortController>();
    let draining = false;
    const { dynamic, requests, unary, subscriptions, stopDiscovery } =
      await BrowserServerValues.readyGraph(native, running, options);
    const server = BrowserServerValues.admittedListener(
      options,
      activeAuth,
      () => draining,
      unary,
      subscriptions,
      requests,
    );
    return BrowserServerValues.finishBrowser({
      options,
      running,
      subscriptions,
      stopDiscovery,
      dynamic,
      activeAuth,
      server,
      onDrain: () => {
        draining = true;
      },
    });
  },

  /**
   * Starts discovery and durable recovery after assembling the gateway graph.
   *
   * @param native The native backend to expose through this browser host.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param options Browser listener, admission, and backend configuration.
   * @returns Gateway collaborators and the discovery cleanup callback, when discovery is configured.
   */
  async readyGraph(
    native: RunningServer | string | readonly string[] | undefined,
    running: RunningServer | undefined,
    options: BrowserHostOptions,
  ) {
    const graph = BrowserServerValues.prepareBrowser(native, running, options);
    const stopDiscovery = await BrowserServerValues.startMembership(
      options,
      running,
      graph.fixedNodes,
      graph.dynamic,
      graph.creator,
      graph.bindings,
      graph.subscriptions,
    );
    return { ...graph, stopDiscovery };
  },

  /**
   * Applies configured browser origin and auth-route policy to the listener.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param activeAuth Controllers tracked for cancellation during browser-host shutdown.
   * @param draining Reports whether shutdown has stopped admission of new requests.
   * @param unary The gateway that admits and forwards unary Spine requests.
   * @param subscriptions The gateway managing admitted browser subscriptions.
   * @param requests Adapters for extracting credentials and transport facts from HTTP headers.
   * @returns An HTTP server configured with admission routes but not yet listening.
   */
  admittedListener(
    options: BrowserHostOptions,
    activeAuth: Set<AbortController>,
    draining: () => boolean,
    unary: UnaryGateway,
    subscriptions: SubscriptionGateway,
    requests: ReturnType<typeof browserServerImplementation.requests>,
  ): http.Server {
    const maxActiveAuthRequests = options.maxActiveAuthRequests ?? 64;
    if (!Number.isSafeInteger(maxActiveAuthRequests) || maxActiveAuthRequests < 1)
      throw new Error("Browser maxActiveAuthRequests must be a positive safe integer.");
    return BrowserServerValues.createListener({
      options,
      origins: BrowserServer.origins(options.origins),
      authRoutes: options.authRouteMap,
      activeAuth,
      maxActiveAuthRequests,
      draining,
      unary,
      subscriptions,
      requests,
    });
  },

  /**
   * Builds one native backend and the admission collaborators before discovery.
   *
   * @param native The native backend to expose through this browser host.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param options Browser listener, admission, and backend configuration.
   * @returns The backend, binding, and admission collaborators needed for startup.
   */
  prepareBrowser(
    native: RunningServer | string | readonly string[] | undefined,
    running: RunningServer | undefined,
    options: BrowserHostOptions,
  ) {
    const fixedNodes = BrowserServerValues.fixedNodes(native, running, options);
    const dynamic = BrowserServerValues.dynamic(options);
    const creator = new DynamicSubscriptionCreator(dynamic);
    const bindings = BrowserServerValues.bindings(options, creator);
    const { requests, unary, subscriptions } = BrowserServerValues.admission(
      options,
      dynamic,
      creator,
      bindings,
    );
    return { fixedNodes, dynamic, creator, bindings, requests, unary, subscriptions };
  },

  /**
   * Returns durable bindings or constructs the local in-memory admission port.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param creator The native subscription adapter used for creation, recovery, and cancellation.
   * @returns The supplied binding store or a new process-local store with native cancellation.
   */
  bindings(options: BrowserHostOptions, creator: DynamicSubscriptionCreator): SubscriptionBindings {
    return (
      options.bindings ??
      new InMemorySubscriptionBindings({
        nextId: () => globalThis.crypto.randomUUID(),
        dispose: (definition, signal) => creator.cancel({ wire: definition }, signal),
      })
    );
  },

  /**
   * Publishes one assembled listener after startup rollback is established.
   *
   * @param input Started browser resources and their coordinated shutdown callbacks.
   * @returns The published browser endpoint with coordinated resource cleanup.
   */
  async finishBrowser(input: BrowserStartedInput): Promise<RunningServer> {
    const address = await BrowserServerValues.listenStarted(input);
    return new RunningBrowserServer(
      input.server,
      input.running,
      input.subscriptions,
      address,
      input.activeAuth,
      input.onDrain,
      input.stopDiscovery,
      input.dynamic,
    );
  },

  /**
   * Rolls back all started browser resources when listener bind fails.
   *
   * @param input Started browser resources and their coordinated shutdown callbacks.
   * @returns The bound listener address; startup failures trigger resource cleanup.
   */
  async listenStarted(input: BrowserStartedInput): Promise<AddressInfo> {
    try {
      return await BrowserServer.listen(input.server, input.options.host, input.options.port);
    } catch (error) {
      const cleanup = await Promise.allSettled([
        input.subscriptions.close(),
        input.stopDiscovery?.(),
        input.dynamic.close(),
        BrowserServer.closeListener(input.server),
        input.running?.close(),
      ]);
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError([error, ...failures], "Server browser startup rollback failed.");
      throw error;
    }
  },

  /**
   * Resolves fixed native backends without changing dynamic discovery behavior.
   *
   * @param native The native backend to expose through this browser host.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param options Browser listener, admission, and backend configuration.
   * @returns Configured fixed endpoints represented as application nodes.
   */
  fixedNodes(
    native: RunningServer | string | readonly string[] | undefined,
    running: RunningServer | undefined,
    options: BrowserHostOptions,
  ): readonly ApplicationNode[] {
    const urls =
      native === undefined
        ? options.backend === undefined
          ? []
          : BrowserServer.backendUrls(BrowserServerValues.backendUrlsFor(options.backend))
        : Array.isArray(native)
          ? BrowserServer.backendUrls(native)
          : [
              typeof native === "string"
                ? native
                : BrowserServerValues.requiredRunning(running).baseUrl,
            ];
    return urls.map(
      (endpoint, index) => new ApplicationNode({ id: `fixed/${index.toString()}`, endpoint }),
    );
  },

  /**
   * Creates the dynamically reconciled native transport adapter.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @returns A forwarder that creates native clients as node membership changes.
   */
  dynamic(options: BrowserHostOptions): DynamicUnaryForwarder {
    return new DynamicUnaryForwarder({
      create: (node) => BrowserServerValues.nativeClient(node, options),
    });
  },

  /**
   * Opens a native client with the configured reader proof producer.
   *
   * @param node The application node whose native transport is being configured.
   * @param options Browser listener, admission, and backend configuration.
   * @returns Native RPC operations and a callback that aborts their HTTP/2 session manager.
   */
  async nativeClient(node: ApplicationNode, options: BrowserHostOptions) {
    const manager =
      options.dynamicManagerFactory?.(node) ??
      new Http2SessionManager(
        node.endpoint,
        undefined,
        node.tlsServerName === undefined ? undefined : { servername: node.tlsServerName },
      );
    const client = new NativeSubscriptionCreator(
      createGrpcTransport({
        ...BrowserServer.dynamicTransportOptions(node),
        sessionManager: manager,
      }),
      options.forwardingProof === undefined
        ? undefined
        : {
            issuer: options.forwardingProof,
            maxBytes: options.readMaxBytes,
          },
    );
    return {
      forward: client.forward.bind(client),
      subscribe: client.subscribe.bind(client),
      activate: client.activate.bind(client),
      cancel: client.cancel.bind(client),
      dispose: client.dispose.bind(client),
      close: async () => {
        manager.abort();
      },
    };
  },

  /**
   * Creates unary and subscription admission around one reader-aware backend.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param dynamic The native forwarder following current application-node membership.
   * @param creator The native subscription adapter used for creation, recovery, and cancellation.
   * @param bindings The store retaining browser-to-native subscription bindings.
   * @returns Request adapters and gateways sharing the configured admission policy.
   */
  admission(
    options: BrowserHostOptions,
    dynamic: DynamicUnaryForwarder,
    creator: DynamicSubscriptionCreator,
    bindings: SubscriptionBindings,
  ) {
    const requests = BrowserServer.requests(options);
    const admission =
      options.publicAccess === true
        ? ({ publicAccess: true } as const)
        : ({ sessions: options.sessions } as const);
    const unary = new UnaryGateway({
      ...(options.registry === undefined ? {} : { registry: options.registry }),
      maxRequestBytes: 1_048_576,
      ...admission,
      authorize: options.authorize,
      contexts: options.contexts,
      clock: options.clock,
      forward: dynamic.forward.bind(dynamic),
    });
    const subscriptions = new SubscriptionGateway({
      bindings,
      ...admission,
      authorize: options.authorize,
      contexts: options.contexts,
      clock: options.clock,
      creator,
    });
    return { requests, unary, subscriptions };
  },

  /**
   * Starts discovery and rehydrates only durable subscriptions with reader identity.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param fixedNodes Backend nodes used when no discovery source is configured.
   * @param dynamic The native forwarder following current application-node membership.
   * @param creator The native subscription adapter used for creation, recovery, and cancellation.
   * @param bindings The store retaining browser-to-native subscription bindings.
   * @param subscriptions The gateway managing admitted browser subscriptions.
   * @returns The discovery stop callback, or no callback for fixed membership.
   */
  async startMembership(
    options: BrowserHostOptions,
    running: RunningServer | undefined,
    fixedNodes: readonly ApplicationNode[],
    dynamic: DynamicUnaryForwarder,
    creator: DynamicSubscriptionCreator,
    bindings: SubscriptionBindings,
    subscriptions: SubscriptionGateway,
  ): Promise<(() => Promise<void>) | undefined> {
    let stopDiscovery: (() => Promise<void>) | undefined;
    try {
      if (options.discovery !== undefined)
        stopDiscovery = await BrowserServerValues.watch(options.discovery, dynamic);
      else await dynamic.reconcile(fixedNodes);
      if (isDurableSubscriptionBindings(bindings))
        attachDurableSubscriptionCleanup(bindings, (definition, signal) =>
          creator.cancel({ wire: definition }, signal),
        );
      await BrowserServerValues.recoverBindings(options, bindings, creator, subscriptions);
      return stopDiscovery;
    } catch (error) {
      return BrowserServerValues.rollbackMembership(
        error,
        running,
        subscriptions,
        stopDiscovery,
        dynamic,
      );
    }
  },

  /**
   * Closes discovery, admission and native listeners after recovery failure.
   *
   * @param error The startup failure to preserve while cleanup is attempted.
   * @param running The local native listener to include in coordinated cleanup, when present.
   * @param subscriptions The gateway managing admitted browser subscriptions.
   * @param stopDiscovery The callback that stops discovery updates, when discovery is configured.
   * @param dynamic The native forwarder following current application-node membership.
   * @returns No value; the startup failure is rethrown with any cleanup failures.
   */
  async rollbackMembership(
    error: unknown,
    running: RunningServer | undefined,
    subscriptions: SubscriptionGateway,
    stopDiscovery: (() => Promise<void>) | undefined,
    dynamic: DynamicUnaryForwarder,
  ): Promise<never> {
    const failures = [error];
    for (const cleanup of [
      () => subscriptions.close(),
      () => stopDiscovery?.(),
      () => dynamic.close(),
      () => running?.close(),
    ])
      try {
        await cleanup();
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "Browser subscription recovery startup rollback failed.");
  },

  /**
   * Restores live reader-bound definitions after membership is ready.
   *
   * @param options Browser listener, admission, and backend configuration.
   * @param bindings The store retaining browser-to-native subscription bindings.
   * @param creator The native subscription adapter used for creation, recovery, and cancellation.
   * @param subscriptions The gateway managing admitted browser subscriptions.
   * @returns Completion after retained definitions are rehydrated and expiry is scheduled.
   */
  async recoverBindings(
    options: BrowserHostOptions,
    bindings: SubscriptionBindings,
    creator: DynamicSubscriptionCreator,
    subscriptions: SubscriptionGateway,
  ): Promise<void> {
    if (bindings.recoverActive === undefined) return;
    const now = options.clock.now();
    const nowMs =
      Number(now.seconds.toString()) * 1_000 + Math.floor(Number(now.nanos.toString()) / 1_000_000);
    if (!Number.isSafeInteger(nowMs)) return;
    await bindings.recoverActive({
      nowMs,
      onDefinition: async (definition, whenExpires) => {
        await creator.rehydrate(definition);
        subscriptions.scheduleExpiry(whenExpires);
      },
    });
  },

  /**
   * Binds admitted gateway services to one HTTP listener.
   *
   * @param input Gateway services and HTTP routing policy for this listener.
   * @returns The unbound HTTP server serving the admitted Spine routes.
   */
  createListener(input: BrowserListenerInput): http.Server {
    const services = createNativeGatewayServices({
      unary: input.unary,
      subscriptions: input.subscriptions,
      requests: input.requests,
    });
    const handler = connectNodeAdapter({
      interceptors: [BrowserServerValues.credentialInterceptor(input.options.credentialReader)],
      routes: (router: ConnectRouter) => {
        router.service(AuthenticationService, services.authentication);
        router.service(CommandService, services.command);
        router.service(QueryService, services.query);
        router.service(SubscriptionService, services.subscription);
      },
      readMaxBytes: input.options.readMaxBytes,
      writeMaxBytes: input.options.writeMaxBytes,
    });
    const context: BrowserRouteContext = { ...input, handler };
    return http.createServer((request, response) => {
      void BrowserServerValues.routeRequest(request, response, context).catch(() => {
        if (!response.writableEnded) {
          response.statusCode = 500;
          response.end();
        }
      });
    });
  },

  /**
   * Applies drain, authentication and RPC routing to one HTTP request.
   *
   * @param request The incoming HTTP request.
   * @param response The HTTP response to complete with the route outcome.
   * @param context Listener admission policy, active requests, and the RPC routing callback.
   * @returns Completion after admission or dispatch to the selected route.
   */
  async routeRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    context: BrowserRouteContext,
  ): Promise<void> {
    if (context.draining()) {
      response.statusCode = 503;
      response.end();
      return;
    }
    const url = BrowserServerValues.requestUrl(request);
    if (url === undefined) {
      response.statusCode = 400;
      response.end();
      return;
    }
    const auth = context.authRoutes.get(url.pathname);
    const active = auth?.admission ?? context.options.admissionPolicy.reader;
    BrowserServerValues.requestCors(request, response, context, auth, active.csrfHeaderNames);
    const inspected = context.options.admissionPolicy.inspect(request, active);
    if (inspected.kind === "rejected") {
      response.statusCode = 400;
      response.end();
      return;
    }
    if (auth !== undefined) {
      BrowserServerValues.authRequest(request, response, auth, context);
      return;
    }
    BrowserServerValues.readRpc(request, response, context, inspected.headers, url);
  },

  /**
   * Applies CORS only for one allowed raw Origin and the selected route or reader.
   * @param request Incoming request before normalization.
   * @param response Response receiving host policy.
   * @param context Listener origins and active reader.
   * @param auth Selected authentication route, if any.
   * @param csrfNames Frozen CSRF names from the active declaration.
   */
  requestCors(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    context: BrowserRouteContext,
    auth: BrowserAuthRoute | undefined,
    csrfNames: readonly string[],
  ): void {
    const origin = BrowserServerValues.rawOrigin(request);
    if (
      origin === undefined ||
      (auth === undefined ? !context.origins.has(origin) : !auth.origins.includes(origin))
    )
      return;
    BrowserServerValues.cors(
      response,
      origin,
      csrfNames,
      auth?.method ?? "POST",
      auth === undefined,
    );
  },

  /**
   * Parses one request target before route selection and reader invocation.
   * @param request Incoming HTTP request.
   * @returns Request-local URL, or undefined for an invalid target.
   */
  requestUrl(request: http.IncomingMessage): URL | undefined {
    try {
      return new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    } catch {
      return undefined;
    }
  },

  /**
   * Dispatches immutable raw facts to Connect for deadline-bound credential admission.
   * @param request Incoming HTTP request.
   * @param response Response for terminal rejection or forwarding.
   * @param context Frozen host policy and gateway handler.
   * @param headers Immutable duplicate-preserving raw fields.
   * @param url Selected request URL before the reader receives its copy.
   */
  readRpc(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    context: BrowserRouteContext,
    headers: Readonly<Record<string, string | readonly string[] | undefined>>,
    url: URL,
  ): void {
    if (!context.origins.has(request.headers.origin ?? "")) {
      response.statusCode = 403;
      response.end();
      return;
    }
    credentialContext.run(
      {
        facts: {
          headers,
          method: request.method ?? "GET",
          url: new URL(url),
        },
      },
      () => {
        BrowserServerValues.rpcRequest(request, response, context);
      },
    );
  },

  /**
   * Handles the configured browser authentication route and its preflight.
   *
   * @param request The incoming HTTP request.
   * @param response The HTTP response to complete with the route outcome.
   * @param auth The authentication route matched by the request path.
   * @param context Listener admission policy, active requests, and the RPC routing callback.
   */
  authRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    auth: BrowserAuthRoute,
    context: BrowserRouteContext,
  ): void {
    if (request.method === auth.method) {
      if (context.activeAuth.size >= context.maxActiveAuthRequests) {
        response.statusCode = 503;
        response.end();
        return;
      }
      void BrowserServer.dispatchAuth(
        request,
        response,
        auth,
        context.activeAuth,
        context.options.writeMaxBytes,
      );
      return;
    }
    const origin = request.headers.origin;
    if (request.method === "OPTIONS" && origin !== undefined && auth.origins.includes(origin)) {
      response.statusCode = 204;
    } else response.statusCode = request.method === "OPTIONS" ? 403 : 405;
    response.end();
  },

  /**
   * Checks browser origin admission before a Connect or gRPC request.
   *
   * @param request The incoming HTTP request.
   * @param response The HTTP response to complete with the route outcome.
   * @param context Listener admission policy, active requests, and the RPC routing callback.
   */
  rpcRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    context: BrowserRouteContext,
  ): void {
    const origin = request.headers.origin;
    if (origin === undefined || !context.origins.has(origin)) {
      response.statusCode = 403;
      response.end();
      return;
    }
    BrowserServerValues.cors(
      response,
      origin,
      context.options.admissionPolicy.reader.csrfHeaderNames,
      "POST",
      true,
    );
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    context.handler(request, response);
  },

  /**
   * Subscribes the native forwarder to application-node discovery changes.
   *
   * @param source The source of application-node membership changes.
   * @param forwarder The native forwarder to reconcile when membership changes.
   * @returns The callback that stops watching node discovery.
   */
  async watch(
    source: NodeDiscovery,
    forwarder: DynamicUnaryForwarder,
  ): Promise<() => Promise<void>> {
    return await source.watch((nodes) => {
      void forwarder.reconcile(nodes);
    });
  },

  /**
   * Returns the local native listener or rejects an absent backend.
   *
   * @param value The possibly absent local native listener.
   * @returns The supplied listener, or throws when it is absent.
   */
  requiredRunning(value: RunningServer | undefined): RunningServer {
    if (value === undefined) throw new Error("Browser server local backend is absent.");
    return value;
  },

  /**
   * Checks IPv4 loopback addresses and the supported IPv6 loopback forms.
   *
   * @param host The address to test for local loopback membership.
   * @returns Whether the address denotes a supported loopback interface.
   */
  isLoopback(host: string): boolean {
    if (host === "::1" || host === "::ffff:127.0.0.1") return true;
    const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host);
    return match?.slice(1).every((part) => Number(part) <= 255) === true;
  },

  /**
   * Calls every supplied startup cleanup and preserves any cleanup failures.
   *
   * @param error The startup failure to preserve while cleanup is attempted.
   * @param cleanups Startup cleanup callbacks to attempt in the supplied order.
   * @returns No value; the original failure or an aggregate of startup and cleanup failures is thrown.
   */
  async rollback(error: unknown, cleanups: readonly (() => Promise<void>)[]): Promise<never> {
    const failures = [error];
    for (const cleanup of cleanups)
      try {
        await cleanup();
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    if (failures.length === 1) throw error;
    throw new AggregateError(failures, "Browser server startup rollback failed.");
  },

  /**
   * Returns the first native subscription client or rejects an empty configuration.
   *
   * @param values Native subscription clients in configured order.
   * @returns The first configured client, or throws when none exists.
   */
  firstCreator(values: readonly NativeSubscriptionCreator[]): NativeSubscriptionCreator {
    const creator = values[0];
    if (creator === undefined) throw new Error("Browser server backend is absent.");
    return creator;
  },

  /**
   * Returns an already running native listener from the backend configuration.
   *
   * @param native The native backend to expose through this browser host.
   * @returns The supplied running listener, or undefined for URL-based or absent backends.
   */
  running(
    native: RunningServer | string | readonly string[] | undefined,
  ): RunningServer | undefined {
    return native === undefined || typeof native === "string" || Array.isArray(native)
      ? undefined
      : (native as RunningServer);
  },

  /**
   * Reads exactly one of the singular or plural backend URL options.
   *
   * @param backend The singular or plural backend URL configuration to inspect.
   * @returns The configured backend origins without applying URL validation.
   */
  backendUrlsFor(backend: NonNullable<BrowserServerOptions["backend"]>): readonly string[] {
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
});

/**
 * Closes the browser listener, discovery, admission and native backend together.
 */
class RunningBrowserServer implements RunningServer {
  readonly #server: http.Server;

  readonly #subscriptions: SubscriptionGateway;

  readonly #native: RunningServer | undefined;

  readonly #activeAuth: Set<AbortController>;

  readonly #onDrain: () => void;

  readonly #stopDiscovery: (() => Promise<void>) | undefined;

  readonly #dynamic: DynamicUnaryForwarder | undefined;

  readonly host: string;

  readonly port: number;

  readonly baseUrl: string;

  #closed: Promise<void> | undefined;

  #listenerClose: Promise<void> | undefined;

  #listenerClosed = false;

  #subscriptionsClosed = false;

  #discoveryStopped = false;

  #dynamicClosed = false;

  #nativeClosed = false;

  /**
   * Stores the running browser resources and exposes their bound address.
   *
   * @param server The HTTP listener being started or stopped.
   * @param native The native backend to expose through this browser host.
   * @param subscriptions The gateway managing admitted browser subscriptions.
   * @param address The actual address returned when the browser listener bound successfully.
   * @param activeAuth Controllers tracked for cancellation during browser-host shutdown.
   * @param onDrain Stops admission of new browser requests before resources are closed.
   * @param stopDiscovery The callback that stops discovery updates, when discovery is configured.
   * @param dynamic The native forwarder following current application-node membership.
   */
  constructor(
    server: http.Server,
    native: RunningServer | undefined,
    subscriptions: SubscriptionGateway,
    address: AddressInfo,
    activeAuth: Set<AbortController>,
    onDrain: () => void,
    stopDiscovery: (() => Promise<void>) | undefined,
    dynamic: DynamicUnaryForwarder | undefined,
  ) {
    this.#server = server;
    this.#native = native;
    this.#subscriptions = subscriptions;
    this.#activeAuth = activeAuth;
    this.#onDrain = onDrain;
    this.#stopDiscovery = stopDiscovery;
    this.#dynamic = dynamic;
    this.host = typeof address.address === "string" ? address.address : "127.0.0.1";
    this.port = address.port;
    const host =
      this.host.includes(":") && !this.host.startsWith("[") ? `[${this.host}]` : this.host;
    this.baseUrl = `http://${host}:${this.port.toString()}`;
  }

  /**
   * Returns a shared promise for concurrent shutdown attempts and permits retry after a failed attempt.
   *
   * @returns The shared shutdown attempt, which rejects if any cleanup phase fails.
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce().catch((error: unknown) => {
      this.#closed = undefined;
      throw error;
    });
    return this.#closed;
  }

  /**
   * Stops admission and attempts each unfinished shutdown phase.
   *
   * @returns Completion after all unfinished phases are attempted; rejects with collected failures.
   */
  async #closeOnce(): Promise<void> {
    this.#onDrain();
    for (const controller of this.#activeAuth) controller.abort();
    const listener = this.#listenerClosed ? undefined : this.#closeListenerPhase();
    const failures: unknown[] = [];
    await this.#phase(
      this.#subscriptionsClosed ? undefined : this.#subscriptions.close(),
      () => {
        this.#subscriptionsClosed = true;
      },
      failures,
    );
    await this.#phase(
      this.#discoveryStopped ? undefined : this.#stopDiscovery?.(),
      () => {
        this.#discoveryStopped = true;
      },
      failures,
    );
    await this.#phase(
      this.#dynamicClosed ? undefined : this.#dynamic?.close(),
      () => {
        this.#dynamicClosed = true;
      },
      failures,
    );
    await this.#phase(
      listener,
      () => {
        this.#listenerClosed = true;
      },
      failures,
    );
    await this.#phase(
      this.#native === undefined || this.#nativeClosed ? undefined : this.#native.close(),
      () => {
        this.#nativeClosed = true;
      },
      failures,
    );
    if (failures.length > 0) {
      const reason = failures[0];
      const primary = reason instanceof Error ? reason : new Error(String(reason));
      if (failures.length > 1)
        Object.defineProperty(primary, "cleanupErrors", { value: failures.slice(1) });
      throw primary;
    }
  }

  /**
   * Marks successful shutdown work and collects failures without stopping later phases.
   *
   * @param operation An unfinished shutdown operation, or undefined when there is nothing to await.
   * @param onSuccess Records completion so a later shutdown retry skips this phase.
   * @param failures The shared collection receiving failures from shutdown phases.
   * @returns Completion after success is recorded or the failure is collected.
   */
  async #phase(
    operation: Promise<void> | undefined,
    onSuccess: () => void,
    failures: unknown[],
  ): Promise<void> {
    if (operation === undefined) return;
    try {
      await operation;
      onSuccess();
    } catch (error) {
      failures.push(error);
    }
  }

  /**
   * Returns the in-flight listener shutdown and resets it after settlement.
   *
   * @returns The current listener-close attempt or a newly started attempt.
   */
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
