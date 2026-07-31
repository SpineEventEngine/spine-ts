import type * as http from "node:http";

import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import type { RunningServer } from "@spine-event-engine/server";
import {
  createNativeGatewayServices,
  InMemorySubscriptionBindings,
  NativeSubscriptionCreator,
  SubscriptionGateway,
  UnaryGateway,
} from "@spine-event-engine/auth";

import { ChatAuthorizationPolicy, ChatContextResolver } from "./chat-policy.js";
import { ChatApplication } from "./index.js";
import { LocalChatLifecycle } from "./local-lifecycle.js";
import {
  LocalChatCloseTimeout,
  LocalChatGatewayRequests,
  LocalChatHttpListener,
  LocalChatOptions,
  LocalChatSession,
} from "./local-server-seams.js";
import { typeRegistry } from "./model-registry.js";

/**
 * Configures the loopback-only Chat backend and browser gateway.
 */
export interface LocalChatServerOptions {
  // prettier-ignore

  /**
   * Selects the loopback interface for both local listeners.
   */
  readonly host?: string;

  /**
   * Selects the browser gateway TCP port.
   */
  readonly port?: number;

  /**
   * Selects the sole browser origin admitted by local CORS.
   */
  readonly webOrigin?: string;
}

/**
 * A complete local Chat topology with a native backend and browser-facing Connect gateway.
 */
export interface LocalChatServer {
  // prettier-ignore

  /**
   * Identifies the bound browser gateway URL.
   */
  readonly baseUrl: string;

  /**
   * Stops intake and releases all owned local resources.
   * @returns Completes after every cleanup phase has been attempted.
   */
  close(): Promise<void>;
}

/**
 * Starts the local Chat backend and the separate browser Connect gateway.
 *
 * @param options Supplies optional loopback listener configuration.
 * @returns Returns the gateway only after its listener has bound.
 */
export const LocalChatServerTopology: Readonly<{
  start(options?: LocalChatServerOptions): Promise<LocalChatServer>;
}> = Object.freeze({
  async start(options: LocalChatServerOptions = {}): Promise<LocalChatServer> {
    return new LocalChatServerAssembly(options).start();
  },
});

class LocalChatServerAssembly {
  constructor(private readonly options: LocalChatServerOptions) {}

  async start(): Promise<LocalChatServer> {
    const { host, port, webOrigin } = LocalChatOptions.resolve(this.options);
    return LocalChatLifecycle.acquire(async (resources) => {
      const backend = resources.acquire(await new ChatApplication().start({ host, port: 0 }));
      const gateway = this.gatewayFor(backend, webOrigin, resources);
      const address = await LocalChatHttpListener.listen(gateway.server, host, port);
      const listener = resources.acquire({
        close: () => LocalChatHttpListener.close(gateway.server),
      });
      const closer = new LocalChatLifecycle(
        listener,
        gateway.subscriptions,
        backend,
        (work, label) => LocalChatCloseTimeout.within(work, 5_000, label),
      );
      return { baseUrl: `http://${host}:${String(address.port)}`, close: () => closer.close() };
    });
  }

  private gatewayFor(
    backend: RunningServer,
    webOrigin: string,
    resources: Readonly<{
      acquire<Resource extends { close(): Promise<void> }>(resource: Resource): Resource;
    }>,
  ): Readonly<{ server: http.Server; subscriptions: SubscriptionGateway }> {
    return new LocalChatGateway(backend, webOrigin).assemble(resources);
  }
}

class LocalChatGateway {
  constructor(
    private readonly backend: RunningServer,
    private readonly webOrigin: string,
  ) {}

  assemble(
    resources: Readonly<{
      acquire<Resource extends { close(): Promise<void> }>(resource: Resource): Resource;
    }>,
  ): Readonly<{ server: http.Server; subscriptions: SubscriptionGateway }> {
    const creator = new NativeSubscriptionCreator(
      createGrpcTransport({ baseUrl: this.backend.baseUrl }),
    );
    const policy = new ChatAuthorizationPolicy();
    const contexts = new ChatContextResolver();
    const sessions = LocalChatSession.resolver();
    const bindings = new InMemorySubscriptionBindings({
      nextId: () => globalThis.crypto.randomUUID(),
      dispose: creator.dispose.bind(creator),
    });
    const unary = this.unaryFor(creator, policy, contexts, sessions);
    const subscriptions = resources.acquire(
      this.subscriptionsFor(bindings, creator, policy, contexts, sessions),
    );
    const services = createNativeGatewayServices({
      unary,
      subscriptions,
      requests: LocalChatGatewayRequests.context(),
    });
    const handler = connectNodeAdapter({
      routes: (router: ConnectRouter) => {
        LocalChatGatewayRequests.routes(router, services);
      },
    });
    return { server: LocalChatHttpListener.server(handler, this.webOrigin), subscriptions };
  }

  private unaryFor(
    creator: NativeSubscriptionCreator,
    policy: ChatAuthorizationPolicy,
    contexts: ChatContextResolver,
    sessions: ReturnType<typeof LocalChatSession.resolver>,
  ): UnaryGateway {
    return new UnaryGateway({
      registry: typeRegistry,
      maxRequestBytes: 1_048_576,
      sessions,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock: LocalChatSession.clock,
      forward: creator.forward.bind(creator),
    });
  }

  private subscriptionsFor(
    bindings: InMemorySubscriptionBindings,
    creator: NativeSubscriptionCreator,
    policy: ChatAuthorizationPolicy,
    contexts: ChatContextResolver,
    sessions: ReturnType<typeof LocalChatSession.resolver>,
  ): SubscriptionGateway {
    return new SubscriptionGateway({
      bindings,
      sessions,
      authorize: policy.authorize.bind(policy),
      contexts,
      clock: LocalChatSession.clock,
      fingerprint: (principal) => principal.id,
      creator,
    });
  }
}
