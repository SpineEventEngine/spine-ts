import * as http2 from "node:http2";

import type {
  PublishTransportHandler,
  PublishTransportOperation,
  RequestTransportHandler,
  RequestTransportOperation,
  SignalTransport,
  TransportSignalKind,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-ts/transport";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Server } from "../../src/index.js";
import { createContextRoutingPlan } from "../../src/runtime/runtime-routing.js";
import { lifecycleFixture } from "./server-lifecycle-fixture.js";

const createHttp2Server = vi.hoisted(() =>
  vi.fn<(server: import("node:http2").Http2Server) => void>(),
);

vi.mock("node:http2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:http2")>();
  return {
    ...actual,
    createServer(...args: Parameters<typeof actual.createServer>) {
      const server = actual.createServer(...args);
      createHttp2Server(server);
      return server;
    },
  };
});

describe("Server context transport lifecycle", () => {
  beforeEach(() => createHttp2Server.mockReset());

  it("opens context transports in context order after recovery and before listening", async () => {
    const events: string[] = [];
    const transport = new LifecycleSignalTransport(events);
    const fixture = await lifecycleFixture({ events, environment: { transport } });
    const secondContext = await fixture.createContext("LifecycleSecond");
    const firstDescriptor = requireFirst(
      createContextRoutingPlan(fixture.context).events.subscriptions,
    ).descriptorKey;
    const secondDescriptor = requireFirst(
      createContextRoutingPlan(secondContext).events.subscriptions,
    ).descriptorKey;
    createHttp2Server.mockImplementationOnce(() => events.push("listener"));
    const starting = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .add(secondContext)
      .start();
    let running: Awaited<typeof starting> | undefined;

    try {
      await fixture.worker.startedWithin();
      expect(events).toEqual(["recovery"]);
      expect(createHttp2Server).not.toHaveBeenCalled();

      fixture.worker.release();
      running = await starting;

      expect(events).toEqual([
        "recovery",
        "recovery",
        `subscribe:${firstDescriptor}`,
        `subscribe:${secondDescriptor}`,
        "listener",
      ]);
      await running.close();
      expect(transport.closeCalls).toBe(0);
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await running?.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await secondContext.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("gates detach and dependencies behind retryable context transport close", async () => {
    const events: string[] = [];
    const closeFailure = new Error("context transport close failed");
    const transport = new LifecycleSignalTransport(events);
    const fixture = await lifecycleFixture({ events, environment: { transport } });
    const descriptor = requireFirst(
      createContextRoutingPlan(fixture.context).events.subscriptions,
    ).descriptorKey;
    transport.failRegistrationClose(descriptor, closeFailure);
    const closeResource = vi.fn(() => events.push("resource"));
    let network: NetworkCloseProbe | undefined;
    createHttp2Server.mockImplementationOnce((server) => {
      network = trackNetworkClose(server, events);
      events.push("listener");
    });
    const starting = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .addResource({ close: closeResource })
      .start();
    let running: Awaited<typeof starting> | undefined;

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      running = await starting;

      const failure = await running.close().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([closeFailure]);
      expect(network?.calls()).toBe(1);
      expect(transport.registrationCloseAttempts).toBe(1);
      expect(fixture.worker.stopCalls).toBe(0);
      expect(closeResource).not.toHaveBeenCalled();
      await expect(fixture.postEvent(fixture.context, "still-open")).resolves.toBeUndefined();

      await running.close();
      await running.close();

      expect(network?.calls()).toBe(1);
      expect(transport.registrationCloseAttempts).toBe(2);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(closeResource).toHaveBeenCalledOnce();
      await expect(fixture.postEvent(fixture.context, "closed")).rejects.toThrow();
      expect(events.indexOf("network")).toBeLessThan(events.indexOf("registration-close:failed"));
      expect(events.indexOf("registration-close:retry")).toBeLessThan(events.indexOf("stop"));
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await running?.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("retains partial-open intake cleanup for cleanup-only start retry", async () => {
    const events: string[] = [];
    const registrationFailure = new Error("second context event registration failed");
    const firstCloseFailure = new Error("partial command close failed first");
    const secondCloseFailure = new Error("partial command close failed second");
    const transport = new LifecycleSignalTransport(events);
    const fixture = await lifecycleFixture({ events, environment: { transport } });
    const mixedContext = fixture.createMixedContext("LifecyclePartialOpen");
    const firstDescriptor = requireFirst(
      createContextRoutingPlan(fixture.context).events.subscriptions,
    ).descriptorKey;
    const commandDescriptor = requireFirst(
      createContextRoutingPlan(mixedContext).commands.subscriptions,
    ).descriptorKey;
    transport.failSubscribeCall(2, registrationFailure);
    transport.failRegistrationClose(commandDescriptor, firstCloseFailure);
    transport.failRegistrationClose(commandDescriptor, secondCloseFailure);
    const closeResource = vi.fn(() => events.push("resource"));
    const server = Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .add(mixedContext)
      .addResource({ close: closeResource });
    const starting = server.start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AggregateError);
      expect((failure as AggregateError).errors).toEqual([
        registrationFailure,
        firstCloseFailure,
        secondCloseFailure,
      ]);
      expect(createHttp2Server).not.toHaveBeenCalled();
      expect(transport.closeAttempts(firstDescriptor)).toBe(1);
      expect(transport.closeAttempts(commandDescriptor)).toBe(2);
      expect(fixture.worker.stopCalls).toBe(0);
      expect(closeResource).not.toHaveBeenCalled();
      await expect(fixture.postEvent(fixture.context, "still-open")).resolves.toBeUndefined();

      const completion = await server.start().catch((error: unknown) => error);

      expectDeferredCleanupCompletion(completion);
      expect(transport.closeAttempts(firstDescriptor)).toBe(1);
      expect(transport.closeAttempts(commandDescriptor)).toBe(3);
      expect(fixture.worker.stopCalls).toBe(1);
      expect(closeResource).toHaveBeenCalledOnce();
      expect(createHttp2Server).not.toHaveBeenCalled();
      await expect(fixture.postEvent(fixture.context, "closed")).rejects.toThrow();

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await mixedContext.close().catch(() => undefined);
      await transport.close();
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("closes context intake before detach after listener open fails", async () => {
    const blocker = await Server.atPort(0).start();
    const events: string[] = [];
    const transport = new LifecycleSignalTransport(events);
    const fixture = await lifecycleFixture({ events, environment: { transport } });
    const descriptor = requireFirst(
      createContextRoutingPlan(fixture.context).events.subscriptions,
    ).descriptorKey;
    const closeResource = vi.fn(() => events.push("resource"));
    const server = Server.atPort(blocker.port, { environment: fixture.environment })
      .add(fixture.context)
      .addResource({ close: closeResource });
    const starting = server.start();

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      const failure = await starting.catch((error: unknown) => error);

      expect(failure).toMatchObject({ code: "EADDRINUSE" });
      expect(transport.closeAttempts(descriptor)).toBe(1);
      expect(events.indexOf("registration-close:succeeded")).toBeLessThan(events.indexOf("stop"));
      expect(events.indexOf("stop")).toBeLessThan(events.indexOf("resource"));
      expect(closeResource).toHaveBeenCalledOnce();
      expect(createHttp2Server).toHaveBeenCalledTimes(2);

      const terminal = await server.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await server.start().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await transport.close();
      await fixture.environment.close().catch(() => undefined);
      await blocker.close();
      fixture.dispose();
    }
  });

  it("rejects duplicate command ownership without disturbing the existing server", async () => {
    const fixture = await lifecycleFixture();
    fixture.worker.release();
    const firstContext = fixture.createMixedContext("CommandOwnerFirst");
    const duplicateContext = fixture.createMixedContext("CommandOwnerDuplicate");
    const duplicateServer = Server.atPort(0, { environment: fixture.environment }).add(
      duplicateContext,
    );
    let first: Awaited<ReturnType<Server["start"]>> | undefined;
    let duplicateRunning: Awaited<ReturnType<Server["start"]>> | undefined;
    let fresh: Awaited<ReturnType<Server["start"]>> | undefined;
    let freshContext: ReturnType<typeof fixture.createMixedContext> | undefined;

    try {
      first = await Server.atPort(0, { environment: fixture.environment })
        .add(firstContext)
        .start();

      const failure = await duplicateServer.start().catch((error: unknown) => error);
      if (!(failure instanceof Error)) {
        duplicateRunning = failure as Awaited<ReturnType<Server["start"]>>;
      }

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(
        "Local transport responder is already registered",
      );
      expect(createHttp2Server).toHaveBeenCalledOnce();
      await expectConnectable(first);
      await expect(fixture.postEvent(firstContext, "existing-open")).resolves.toBeUndefined();
      await expect(fixture.postEvent(duplicateContext, "duplicate-closed")).rejects.toThrow();

      const terminal = await duplicateServer.start().catch((error: unknown) => error);
      expectConsumedFailedStartServer(terminal);

      await first.close();
      first = undefined;
      freshContext = fixture.createMixedContext("CommandOwnerFresh");
      fresh = await Server.atPort(0, { environment: fixture.environment })
        .add(freshContext)
        .start();
      expect(createHttp2Server).toHaveBeenCalledTimes(2);
      await expectConnectable(fresh);
    } finally {
      await fresh?.close().catch(() => undefined);
      await duplicateRunning?.close().catch(() => undefined);
      await first?.close().catch(() => undefined);
      await duplicateServer.start().catch(() => undefined);
      await firstContext.close().catch(() => undefined);
      await duplicateContext.close().catch(() => undefined);
      await freshContext?.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("closes one server registration while preserving its shared-transport sibling", async () => {
    const transport = new LifecycleSignalTransport([]);
    const fixture = await lifecycleFixture({ environment: { transport } });
    fixture.worker.release();
    const firstObserved: string[] = [];
    const siblingObserved: string[] = [];
    const firstContext = fixture.createEventContext("SharedEventsFirst", firstObserved);
    const siblingContext = fixture.createEventContext("SharedEventsSibling", siblingObserved);
    const topic = requireFirst(createContextRoutingPlan(firstContext).events.topics);
    let first: Awaited<ReturnType<Server["start"]>> | undefined;
    let sibling: Awaited<ReturnType<Server["start"]>> | undefined;

    try {
      first = await Server.atPort(0, { environment: fixture.environment })
        .add(firstContext)
        .start();
      sibling = await Server.atPort(0, { environment: fixture.environment })
        .add(siblingContext)
        .start();

      await transport.publish({ topic, envelope: fixture.createEvent("shared") });
      await first.close();
      first = undefined;
      await expectConnectable(sibling);
      await transport.publish({ topic, envelope: fixture.createEvent("sibling") });
      await sibling.close();
      sibling = undefined;

      expect(firstObserved).toEqual(["shared"]);
      expect(siblingObserved).toEqual(["shared", "sibling"]);
      expect(transport.closeCalls).toBe(0);
    } finally {
      await first?.close().catch(() => undefined);
      await sibling?.close().catch(() => undefined);
      await firstContext.close().catch(() => undefined);
      await siblingContext.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await transport.close();
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("drains accepted context transport work before detaching delivery", async () => {
    const transport = new LifecycleSignalTransport([]);
    const fixture = await lifecycleFixture({ environment: { transport } });
    fixture.worker.release();
    const dispatch = Promise.withResolvers<undefined>();
    const started = Promise.withResolvers<undefined>();
    const context = fixture.createEventContext("AcceptedWorkDrain", [], () => {
      started.resolve(undefined);
      return dispatch.promise;
    });
    const topic = requireFirst(createContextRoutingPlan(context).events.topics);
    const running = await Server.atPort(0, { environment: fixture.environment })
      .add(fixture.context)
      .add(context)
      .start();
    let closing: Promise<void> | undefined;

    try {
      await transport.publish({ topic, envelope: fixture.createEvent("held") });
      await started.promise;
      let closed = false;
      closing = running.close().then(() => {
        closed = true;
      });
      await Promise.resolve();

      expect(closed).toBe(false);
      expect(fixture.worker.stopCalls).toBe(0);

      dispatch.resolve(undefined);
      await closing;

      expect(fixture.worker.stopCalls).toBe(1);
    } finally {
      dispatch.resolve(undefined);
      await closing?.catch(() => undefined);
      await running.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await transport.close();
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });

  it("closes owned transport only with the existing environment facility phase", async () => {
    const events: string[] = [];
    const transport = new LifecycleSignalTransport(events);
    const fixture = await lifecycleFixture({
      events,
      environment: { transport, ownsTransport: true },
    });
    const closeResource = vi.fn(() => events.push("resource"));
    const starting = Server.atPort(0, {
      environment: fixture.environment,
      ownsEnvironment: true,
    })
      .add(fixture.context)
      .addResource({ close: closeResource })
      .start();
    let running: Awaited<typeof starting> | undefined;

    try {
      await fixture.worker.startedWithin();
      fixture.worker.release();
      running = await starting;
      await running.close();

      expect(transport.closeCalls).toBe(1);
      expect(events.indexOf("registration-close:succeeded")).toBeLessThan(events.indexOf("stop"));
      expect(events.indexOf("stop")).toBeLessThan(events.indexOf("resource"));
      expect(events.indexOf("resource")).toBeLessThan(events.indexOf("transport-facility"));
    } finally {
      fixture.worker.release();
      await starting.catch(() => undefined);
      await running?.close().catch(() => undefined);
      await fixture.context.close().catch(() => undefined);
      await fixture.environment.close().catch(() => undefined);
      fixture.dispose();
    }
  });
});

function requireFirst<Value>(values: readonly Value[]): Value {
  const first = values[0];
  if (first === undefined) {
    throw new Error("Expected a server context transport route.");
  }
  return first;
}

class LifecycleSignalTransport implements SignalTransport {
  readonly #events: string[];
  readonly #publishHandlers = new Map<string, Set<PublishTransportHandler>>();
  readonly #requestHandlers = new Map<string, RequestTransportHandler>();
  readonly #registrationCloseFailures = new Map<string, Error[]>();
  readonly #registrationCloseAttempts = new Map<string, number>();
  readonly #subscribeFailures = new Map<number, Error>();
  #subscribeCalls = 0;
  registrationCloseAttempts = 0;
  closeCalls = 0;

  constructor(events: string[]) {
    this.#events = events;
  }

  failRegistrationClose(descriptorKey: string, error: Error): void {
    const failures = this.#registrationCloseFailures.get(descriptorKey) ?? [];
    failures.push(error);
    this.#registrationCloseFailures.set(descriptorKey, failures);
  }

  failSubscribeCall(call: number, error: Error): void {
    this.#subscribeFailures.set(call, error);
  }

  closeAttempts(descriptorKey: string): number {
    return this.#registrationCloseAttempts.get(descriptorKey) ?? 0;
  }

  async publish<Envelope, Kind extends TransportSignalKind>(
    operation: PublishTransportOperation<Envelope, Kind>,
  ): Promise<void> {
    const handlers = this.#publishHandlers.get(operation.topic.routing.routingKey);
    if (handlers === undefined) {
      return;
    }
    await Promise.all([...handlers].map(async (handler) => handler(operation)));
  }

  subscribe<Envelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: PublishTransportHandler<Envelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    this.#subscribeCalls += 1;
    this.#events.push(`subscribe:${subscription.descriptorKey}`);
    const registrationFailure = this.#subscribeFailures.get(this.#subscribeCalls);
    if (registrationFailure !== undefined) {
      return Promise.reject(registrationFailure);
    }
    const routingKey = subscription.topic.routing.routingKey;
    const handlers = this.#publishHandlers.get(routingKey) ?? new Set();
    const stored = handler as PublishTransportHandler;
    handlers.add(stored);
    this.#publishHandlers.set(routingKey, handlers);
    return Promise.resolve(
      this.#registrationHandle(subscription, () => {
        handlers.delete(stored);
        if (handlers.size === 0) {
          this.#publishHandlers.delete(routingKey);
        }
      }),
    );
  }

  request<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    operation: RequestTransportOperation<RequestEnvelope, Kind>,
  ): Promise<ResponseEnvelope> {
    void operation;
    return Promise.reject(new Error("Unexpected lifecycle transport request."));
  }

  respond<RequestEnvelope, ResponseEnvelope, Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    handler: RequestTransportHandler<RequestEnvelope, ResponseEnvelope, Kind>,
  ): Promise<TransportSubscriptionHandle<Kind>> {
    const routingKey = subscription.topic.routing.routingKey;
    if (this.#requestHandlers.has(routingKey)) {
      return Promise.reject(new Error(`Lifecycle responder already registered for ${routingKey}.`));
    }
    const stored = handler as RequestTransportHandler;
    this.#requestHandlers.set(routingKey, stored);
    this.#events.push(`respond:${subscription.descriptorKey}`);
    return Promise.resolve(
      this.#registrationHandle(subscription, () => {
        if (this.#requestHandlers.get(routingKey) === stored) {
          this.#requestHandlers.delete(routingKey);
        }
      }),
    );
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.#events.push("transport-facility");
    this.#publishHandlers.clear();
    this.#requestHandlers.clear();
    return Promise.resolve();
  }

  #registrationHandle<Kind extends TransportSignalKind>(
    subscription: TransportSubscription<Kind>,
    remove: () => void,
  ): TransportSubscriptionHandle<Kind> {
    return new LifecycleRegistrationHandle(subscription, () => {
      const descriptorKey = subscription.descriptorKey;
      this.registrationCloseAttempts += 1;
      const attempts = this.closeAttempts(descriptorKey) + 1;
      this.#registrationCloseAttempts.set(descriptorKey, attempts);
      const failures = this.#registrationCloseFailures.get(descriptorKey);
      const failure = failures?.shift();
      this.#events.push(
        failure === undefined
          ? attempts === 1
            ? "registration-close:succeeded"
            : "registration-close:retry"
          : "registration-close:failed",
      );
      if (failure !== undefined) {
        throw failure;
      }
      remove();
    });
  }
}

class LifecycleRegistrationHandle<
  Kind extends TransportSignalKind,
> implements TransportSubscriptionHandle<Kind> {
  readonly subscription: TransportSubscription<Kind>;
  readonly #closeRegistration: () => void;
  #closed = false;

  constructor(subscription: TransportSubscription<Kind>, closeRegistration: () => void) {
    this.subscription = subscription;
    this.#closeRegistration = closeRegistration;
  }

  close(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    try {
      this.#closeRegistration();
      this.#closed = true;
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

interface NetworkCloseProbe {
  calls(): number;
}

function trackNetworkClose(server: http2.Http2Server, events: string[]): NetworkCloseProbe {
  const close = server.close.bind(server);
  let calls = 0;
  Object.defineProperty(server, "close", {
    configurable: true,
    value: (callback?: (error?: Error) => void) => {
      calls += 1;
      events.push("network");
      return close(callback);
    },
  });
  return Object.freeze({ calls: () => calls });
}

function expectDeferredCleanupCompletion(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).message).toBe(
    "Server deferred cleanup completed after an earlier failed start.",
  );
}

function expectConsumedFailedStartServer(error: unknown): void {
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(AggregateError);
  expect((error as Error).message).toBe(
    "Server cannot restart after failed-start cleanup has completed.",
  );
}

async function expectConnectable(server: { readonly baseUrl: string }): Promise<void> {
  const session = http2.connect(server.baseUrl);
  session.on("error", () => undefined);
  await new Promise<void>((resolve) => session.once("remoteSettings", resolve));
  session.close();
  await new Promise<void>((resolve) => session.once("close", resolve));
}
