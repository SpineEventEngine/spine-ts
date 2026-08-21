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
  type SubscriptionBindings,
  UnaryGateway,
} from "@spine-event-engine/auth";
import type { ConnectRouter } from "@connectrpc/connect";
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
import { Server } from "../server/server.js";
import type { BrowserAuthRoute, BrowserServerOptions } from "./options.js";
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

interface UncheckedBrowserAdmission {
  readonly sessions?: SessionResolver;
  readonly publicAccess?: true;
  readonly bindings?: SubscriptionBindings;
  readonly contexts?: ContextResolver;
  readonly clock?: Clock;
}
type BrowserHostOptions = BrowserServerOptions & {
  readonly host: string;
  readonly port: number;
  readonly readMaxBytes: number;
  readonly writeMaxBytes: number;
  readonly production: boolean;
  readonly dynamicManagerFactory?: (node: ApplicationNode) => Http2SessionManager;
};

/**
 * Runs the private native endpoint behind one admitted browser listener.
 *
 * Hosts browser-facing Spine gateway routes independently from native server assembly.
 */
export const BrowserServer: Readonly<{
  open(
    native: RunningServer | string | readonly string[] | undefined,
    options: BrowserServerOptions,
  ): Promise<RunningServer>;
  run(options: BrowserServerOptions): Promise<RunningServer>;
  run(native: Server, options: BrowserServerOptions): Promise<RunningServer>;
  requests(options: BrowserServerOptions): {
    credential(context: { readonly requestHeader: Headers }):
      | {
          readonly kind: "bearer" | "cookie";
          readonly value: string;
        }
      | undefined;
    transport(context: { readonly requestHeader: Headers }): ReturnType<typeof TransportFacts.from>;
  };
  origins(origins: readonly string[]): ReadonlySet<string>;
  backendUrl(value: string): string;
  backendUrls(values: readonly string[]): readonly string[];
  dynamicTransportOptions(node: ApplicationNode): {
    readonly baseUrl: string;
    readonly nodeOptions?: { readonly servername: string };
  };
  requireDurableBindings(options: BrowserServerOptions, production: boolean): void;
  authRoutes(
    routes: readonly BrowserAuthRoute[] | undefined,
  ): ReadonlyMap<string, BrowserAuthRoute>;
  dispatchAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: BrowserAuthRoute,
    active: Set<AbortController>,
    writeMaxBytes: number,
  ): Promise<void>;
  listen(server: http.Server, host: string, port: number): Promise<AddressInfo>;
  closeListener(server: http.Server): Promise<void>;
}> = Object.freeze({
  async open(
    native: RunningServer | string | readonly string[] | undefined,
    input: BrowserServerOptions,
  ): Promise<RunningServer> {
    const options: BrowserHostOptions = {
      ...input,
      host: input.host ?? "127.0.0.1",
      port: input.port ?? 0,
      readMaxBytes: input.readMaxBytes ?? 4_194_304,
      writeMaxBytes: input.writeMaxBytes ?? 4_194_304,
      production: Environment.instance().type === EnvironmentType.Production,
    };
    BrowserServer.requireDurableBindings(options, options.production);
    const origins = BrowserServer.origins(options.origins);
    const authRoutes = BrowserServer.authRoutes(options.authRoutes);
    const activeAuth = new Set<AbortController>();
    const maxActiveAuthRequests = options.maxActiveAuthRequests ?? 64;
    if (!Number.isSafeInteger(maxActiveAuthRequests) || maxActiveAuthRequests < 1)
      throw new Error("Browser maxActiveAuthRequests must be a positive safe integer.");
    let draining = false;
    const running = BrowserServerValues.running(native);
    const backendBaseUrls =
      native === undefined
        ? []
        : Array.isArray(native)
          ? BrowserServer.backendUrls(native)
          : [
              typeof native === "string"
                ? native
                : BrowserServerValues.requiredRunning(running).baseUrl,
            ];
    const fixedNodes = backendBaseUrls.map(
      (endpoint, index) => new ApplicationNode({ id: `fixed/${index.toString()}`, endpoint }),
    );
    let dynamic: DynamicUnaryForwarder | undefined;
    let stopDiscovery: (() => Promise<void>) | undefined;
    const forwarder = (dynamic = new DynamicUnaryForwarder({
      create: async (node) => {
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
    }));
    const creator = new DynamicSubscriptionCreator(dynamic);
    const bindings =
      options.bindings ??
      new InMemorySubscriptionBindings({
        nextId: () => globalThis.crypto.randomUUID(),
        dispose: (definition, signal) => creator.cancel({ wire: definition }, signal),
      });
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
      forward: forwarder.forward.bind(forwarder),
    });
    const subscriptions = new SubscriptionGateway({
      bindings,
      ...admission,
      authorize: options.authorize,
      contexts: options.contexts,
      clock: options.clock,
      creator,
    });
    try {
      if (options.discovery !== undefined)
        stopDiscovery = await BrowserServerValues.watch(options.discovery, dynamic);
      else await dynamic.reconcile(fixedNodes);
      if (isDurableSubscriptionBindings(bindings))
        attachDurableSubscriptionCleanup(bindings, (definition, signal) =>
          creator.cancel({ wire: definition }, signal),
        );
      const durableBindings = bindings as SubscriptionBindings;
      if (durableBindings.recoverActive !== undefined) {
        const now = options.clock.now();
        const nowMs =
          Number(now.seconds.toString()) * 1_000 +
          Math.floor(Number(now.nanos.toString()) / 1_000_000);
        if (Number.isSafeInteger(nowMs))
          await durableBindings.recoverActive({
            nowMs,
            onDefinition: async (
              definition: import("@spine-event-engine/auth").PublicSubscriptionWire,
              whenExpires: number,
            ) => {
              await creator.rehydrate(definition);
              subscriptions.scheduleExpiry(whenExpires);
            },
          });
      }
    } catch (error) {
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
    }
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
      if (draining) {
        response.statusCode = 503;
        response.end();
        return;
      }
      const path = request.url ?? "";
      const auth = authRoutes.get(path);
      if (auth !== undefined && request.method === auth.method) {
        if (activeAuth.size >= maxActiveAuthRequests) {
          response.statusCode = 503;
          response.end();
          return;
        }
        void BrowserServer.dispatchAuth(request, response, auth, activeAuth, options.writeMaxBytes);
        return;
      }
      if (auth !== undefined) {
        const origin = request.headers.origin;
        if (request.method === "OPTIONS" && origin !== undefined && auth.origins.includes(origin)) {
          response.setHeader("access-control-allow-origin", origin);
          response.setHeader("access-control-allow-methods", `${auth.method},OPTIONS`);
          response.statusCode = 204;
        } else response.statusCode = request.method === "OPTIONS" ? 403 : 405;
        response.end();
        return;
      }
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
      const cleanup = await Promise.allSettled([
        subscriptions.close(),
        stopDiscovery?.(),
        dynamic.close(),
        BrowserServer.closeListener(server),
      ]);
      const failures = cleanup.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (failures.length > 0)
        throw new AggregateError([error, ...failures], "Server browser startup rollback failed.");
      throw error;
    }
    return new RunningBrowserServer(
      server,
      running,
      subscriptions,
      address,
      activeAuth,
      () => {
        draining = true;
      },
      stopDiscovery,
      dynamic,
    );
  },
  async run(
    nativeOrOptions: Server | BrowserServerOptions,
    suppliedOptions?: BrowserServerOptions,
  ): Promise<RunningServer> {
    const native = nativeOrOptions instanceof Server ? await nativeOrOptions.start() : undefined;
    const options = suppliedOptions ?? (nativeOrOptions as BrowserServerOptions);
    const running = await BrowserServer.open(native, options);
    return ProcessServerCoordinator.add(
      running,
      native === undefined ? undefined : ServerEnvironment.instance(),
      undefined,
      () => undefined,
    );
  },
  requests(options: BrowserServerOptions) {
    return {
      credential: (context: { readonly requestHeader: Headers }) => {
        const headers = Object.fromEntries(context.requestHeader.entries());
        const extracted = options.cookies?.extract(headers);
        if (extracted !== undefined) {
          return extracted.kind === "rejected" ? { kind: "bearer" as const, value: "" } : extracted;
        }
        const authorization = context.requestHeader.get("authorization") ?? "";
        return /^Bearer [^\s]+$/.test(authorization)
          ? { kind: "bearer" as const, value: authorization.slice("Bearer ".length) }
          : undefined;
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
  backendUrls(values: readonly string[]): readonly string[] {
    if (values.length < 1)
      throw new Error("Server browser backends must contain at least one origin.");
    const urls = values.map((value) => BrowserServer.backendUrl(value));
    if (new Set(urls).size !== urls.length)
      throw new Error("Server browser backends must be unique canonical HTTP(S) origins.");
    return urls;
  },
  dynamicTransportOptions(node: ApplicationNode) {
    return {
      baseUrl: node.endpoint,
      ...(node.tlsServerName === undefined
        ? {}
        : { nodeOptions: { servername: node.tlsServerName } }),
    };
  },
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
  async dispatchAuth(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    route: BrowserAuthRoute,
    active: Set<AbortController>,
    writeMaxBytes: number,
  ): Promise<void> {
    const origin = request.headers.origin;
    if (
      (origin === undefined && route.allowMissingOrigin !== true) ||
      (origin !== undefined && !route.origins.includes(origin))
    ) {
      response.statusCode = 403;
      response.end();
      return;
    }
    const length = request.headers["content-length"];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > route.maxRequestBytes)) {
      response.statusCode = 413;
      response.end();
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => {
      controller.abort();
      request.resume();
    }, route.timeoutMs);
    const abort = () => {
      controller.abort();
    };
    request.once("aborted", abort);
    response.once("close", abort);
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject;
    });
    let responseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const onAbort = () => {
      rejectAbort(new Error("browser auth request aborted"));
      void responseReader?.cancel().catch(() => undefined);
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const requestChunks: Uint8Array[] = [];
      let size = 0;
      const requestBody = request[Symbol.asyncIterator]();
      for (;;) {
        const next = await Promise.race([requestBody.next(), aborted]);
        if (next.done) break;
        const bytes = Buffer.from(next.value as Uint8Array);
        size += bytes.byteLength;
        if (size > route.maxRequestBytes) {
          response.statusCode = 413;
          response.end();
          return;
        }
        requestChunks.push(bytes);
      }
      const url = new URL(
        request.url ?? route.path,
        `http://${request.headers.host ?? "localhost"}`,
      );
      const input = new Request(url, {
        method: route.method,
        headers: request.headers as HeadersInit,
        ...(size === 0 ? {} : { body: Buffer.concat(requestChunks) }),
        signal: controller.signal,
      });
      const result = await Promise.race([route.onRequest(input, controller.signal), aborted]);
      if (controller.signal.aborted) {
        if (!response.writableEnded) {
          response.statusCode = 504;
          response.end();
        }
        return;
      }
      responseReader = result.body?.getReader();
      const responseChunks: Uint8Array[] = [];
      let responseBytes = 0;
      if (responseReader !== undefined) {
        for (;;) {
          const next = await Promise.race([responseReader.read(), aborted]);
          if (next.done) break;
          responseBytes += next.value.byteLength;
          if (responseBytes > writeMaxBytes) {
            await responseReader.cancel().catch(() => undefined);
            response.statusCode = 413;
            response.end();
            return;
          }
          responseChunks.push(next.value);
        }
      }
      response.statusCode = result.status;
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.end(Buffer.concat(responseChunks));
    } catch {
      if (!response.writableEnded) {
        if (controller.signal.aborted) {
          response.shouldKeepAlive = false;
          response.setHeader("connection", "close");
        }
        response.statusCode = controller.signal.aborted ? 504 : 500;
        response.end();
      }
    } finally {
      clearTimeout(timer);
      request.off("aborted", abort);
      response.off("close", abort);
      controller.signal.removeEventListener("abort", onAbort);
      active.delete(controller);
    }
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

const BrowserServerValues = Object.freeze({
  async watch(
    source: NodeDiscovery,
    forwarder: DynamicUnaryForwarder,
  ): Promise<() => Promise<void>> {
    return await source.watch((nodes) => {
      void forwarder.reconcile(nodes);
    });
  },
  requiredRunning(value: RunningServer | undefined): RunningServer {
    if (value === undefined) throw new Error("Browser server local backend is absent.");
    return value;
  },
  firstCreator(values: readonly NativeSubscriptionCreator[]): NativeSubscriptionCreator {
    const creator = values[0];
    if (creator === undefined) throw new Error("Browser server backend is absent.");
    return creator;
  },
  running(
    native: RunningServer | string | readonly string[] | undefined,
  ): RunningServer | undefined {
    return native === undefined || typeof native === "string" || Array.isArray(native)
      ? undefined
      : (native as RunningServer);
  },
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

  close(): Promise<void> {
    this.#closed ??= this.#closeOnce().catch((error: unknown) => {
      this.#closed = undefined;
      throw error;
    });
    return this.#closed;
  }

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
