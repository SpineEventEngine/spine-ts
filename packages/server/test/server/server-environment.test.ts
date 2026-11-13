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

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { create, type Message } from "@bufbuild/protobuf";
import { Identifiers, SignalEnvelopes, spineCoreRegistry } from "@spine-event-engine/core";
import {
  EventContextSchema,
  TenantSchema,
  VersionSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  StorageFactory,
  StorageGroup,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
} from "@spine-event-engine/storage";
import { InMemoryTransportFactory } from "@spine-event-engine/transport";

import {
  ServerEnvironment,
  type ServerEnvironmentSettings,
  type ServerEnvironmentCloseable,
  type ServerEnvironmentDelivery,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import {
  DeliveryBuilder,
  type Delivery as PublicDelivery,
} from "../../src/delivery/delivery-builder.js";
import { Delivery as CoreDelivery } from "../../src/delivery/delivery.js";
import { DeliverySupervisor } from "../../src/delivery/delivery-supervisor.js";
import { IntegrationBroker } from "../../src/integration/integration-broker.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import { EnvironmentTests, EnvironmentType } from "../../src/server/environment.js";
import { BoundedContext, type BoundedContextBuilder } from "../../src/context/bounded-context.js";
import { Application, type ApplicationBuildOptions } from "../../src/server/application.js";
import { SINGLE_TENANT, type TenantIndex } from "../../src/context/tenant-index.js";
import { tenant } from "../tenant-fixture.js";
import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
} from "../../src/stand/subscription-registry.js";
import { Server } from "../../src/server/server.js";
import { emitServerError, emitServerWarning } from "../../src/server/server-log.js";
import { ServerStartedSchema } from "../../test-fixtures/generated/server-lifecycle/events_pb.js";
import {
  serverStatusRegistry,
  ServerStatusProjection,
} from "./generated-server-registry-fixture.js";
import type { ILogLayer } from "loglayer";

afterEach(() => {
  vi.restoreAllMocks();
  EnvironmentTests.reset();
});

function environmentWith(
  type: EnvironmentType,
  settings: ServerEnvironmentSettings,
): ServerEnvironment {
  return ServerEnvironment.newBuilder()
    .under(type, (configuration) => {
      configuration.use(settings);
    })
    .build();
}

async function buildApplication(
  builders: readonly BoundedContextBuilder[],
  environment: ServerEnvironment,
  options: ApplicationBuildOptions = {},
  index?: TenantIndex,
): Promise<Application> {
  const applicationBuilder = Application.newBuilder().setServerEnvironment(environment);
  for (const builder of builders) applicationBuilder.add(builder);
  if (index !== undefined) applicationBuilder.setTenantIndex(index);
  const application = await applicationBuilder.build(options);
  onTestFinished(() => application.close());
  return application;
}

async function buildContext(
  builder: BoundedContextBuilder,
  environment: ServerEnvironment,
  options: ApplicationBuildOptions = {},
  index?: TenantIndex,
): Promise<BoundedContext> {
  const application = await buildApplication([builder], environment, options, index);
  const [context] = application.contexts();
  if (context === undefined) throw new Error("Expected a Bounded Context.");
  return context;
}

function configured(
  delivery: ServerEnvironmentCloseable & { open?: unknown; [key: string]: unknown },
) {
  const environment = environmentWith(EnvironmentType.Local, { delivery });
  return environment;
}

describe("ServerEnvironment delivery lifecycle", () => {
  it.each([false, true])(
    "selects single-tenant mode without consulting a provider catalog (index: %s)",
    async (withIndex) => {
      const storage = new InMemoryStorageFactory();
      const catalog = vi.spyOn(storage, "tenantCatalog");
      const records = vi.spyOn(storage, "createRecordStorage");
      const environment = environmentWith(EnvironmentType.Local, { storageFactory: storage });
      const directory = withIndex ? tenantIndex() : undefined;
      const context = await buildContext(
        BoundedContext.singleTenant("NoDirectory"),
        environment,
        { createStorageStructures: false, startSubscriptionMonitoring: false },
        directory,
      );
      expect(context.tenantIndex).toBe(SINGLE_TENANT);
      expect(catalog).not.toHaveBeenCalled();
      expect(records.mock.calls.some(([, spec]) => spec.recordType === TenantSchema)).toBe(false);
      await context.close();
    },
  );

  it("creates a default Application tenant index for multitenant business storage", async () => {
    const storage = new InMemoryStorageFactory();
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: storage });
    const context = await buildContext(
      BoundedContext.multiTenant("RequiresDirectory"),
      environment,
    );
    expect(context.tenantIndex).not.toBe(SINGLE_TENANT);
    if (context.tenantIndex === SINGLE_TENANT)
      throw new Error("Expected an Application tenant index.");
    await expect(context.tenantIndex.all()).resolves.toEqual([]);
    await context.close();
  });

  it("uses an explicit Application tenant index for a multitenant Bounded Context", async () => {
    const storage = new InMemoryStorageFactory();
    const records = vi.spyOn(storage, "createRecordStorage");
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: storage });
    const directory = tenantIndex();
    const context = await buildContext(
      BoundedContext.multiTenant("LocalDirectoryOnly"),
      environment,
      {},
      directory,
    );
    expect(context.tenantIndex).toBe(directory);
    expect(records.mock.calls.some(([, spec]) => spec.recordType === TenantSchema)).toBe(false);
    await context.close();
  });

  it("exposes the marker for a single-tenant Bounded Context in an indexed Application", async () => {
    const directory = tenantIndex();
    const lookup = vi.spyOn(directory, "contains");
    const environment = environmentWith(EnvironmentType.Local, {});
    const context = await buildContext(
      BoundedContext.singleTenant("MixedSingle"),
      environment,
      { createStorageStructures: false, startSubscriptionMonitoring: false },
      directory,
    );
    expect(context.tenantIndex).toBe(SINGLE_TENANT);
    expect(lookup).not.toHaveBeenCalled();
    await context.close();
  });

  it("resolves the default subscription waiting capacity", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    expect(environment.subscriptionQueueCapacity).toBe(100);
    await environment.close();
  });

  it("keeps configured subscription capacity local to one environment", async () => {
    const environment = environmentWith(EnvironmentType.Local, { subscriptionQueueCapacity: 0 });
    expect(environment.subscriptionQueueCapacity).toBe(0);
    const fresh = environmentWith(EnvironmentType.Local, {});
    expect(fresh.subscriptionQueueCapacity).toBe(100);
    await environment.close();
    await fresh.close();
  });

  it.each([-1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, "2"])(
    "rejects invalid subscription capacity %s before constructing facilities",
    async (capacity) => {
      expect(() =>
        environmentWith(EnvironmentType.Local, {
          subscriptionQueueCapacity: capacity as number,
        }),
      ).toThrow(RangeError);
      const environment = environmentWith(EnvironmentType.Local, { subscriptionQueueCapacity: 0 });
      expect(environment.subscriptionQueueCapacity).toBe(0);
      await environment.close();
    },
  );

  it("accepts an inline remote Delivery facility", async () => {
    const ports = new CoreDelivery({
      context: { name: "InlineRemote", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const environment = environmentWith(EnvironmentType.Local, {
      delivery: {
        open: () => undefined,
        close: () => ports.close(),
        inbox: ports.inbox,
        workRegistry: ports.shards,
      },
    });

    await serverEnvironmentAccess.setup(environment);
    expect(environment.delivery.inbox).toBe(ports.inbox);
    await environment.close();
  });

  it("logs one escaping local background Delivery failure", async () => {
    const logged = Promise.withResolvers<string>();
    const errors: string[] = [];
    const child = {
      withMetadata: () => ({
        info: () => undefined,
        warn: () => undefined,
        error: (message: string) => {
          errors.push(message);
          logged.resolve(message);
        },
      }),
    };
    const ports = new CoreDelivery({
      context: { name: "BackgroundFailure", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = new Proxy(ports.inbox, {
      get(target, property) {
        if (property === "read") return () => Promise.reject(new Error("background read failed"));
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    const environment = environmentWith(EnvironmentType.Local, {
      logger: { child: () => child } as unknown as ILogLayer,
      delivery: {
        open: () => undefined,
        close: () => ports.close(),
        inbox,
        workRegistry: ports.shards,
      },
    });

    await serverEnvironmentAccess.setup(environment);
    const delivery = serverEnvironmentAccess.coreDelivery(environment);
    delivery.wake(ShardIndex.single());
    await expect(logged.promise).resolves.toBe("Background Delivery failed.");
    expect(errors).toEqual(["Background Delivery failed."]);
    await environment.close().catch(() => undefined);
  });

  it("completes shared setup before a direct context becomes available", async () => {
    const storage = new InMemoryStorageFactory();
    const check = vi.spyOn(storage, "checkConnection");
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: storage });
    await serverEnvironmentAccess.setup(environment);
    const context = await buildContext(
      BoundedContext.singleTenant("SetupBeforeContext"),
      environment,
    );
    try {
      expect(check).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("checks storage while Application assembly prepares its environment", async () => {
    const storage = new InMemoryStorageFactory();
    const check = vi.spyOn(storage, "checkConnection");
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: storage });
    await buildContext(BoundedContext.singleTenant("MissingSetup"), environment);
    expect(check).toHaveBeenCalledOnce();
  });

  it("keeps shared Delivery usable after a listener closes its endpoint", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    const application = await buildApplication(
      [BoundedContext.singleTenant("ListenerContext")],
      environment,
    );
    const running = await Server.atPort(0).setApplication(application).start();
    await running.close();
    await expect(environment.delivery.inbox.read(ShardIndex.single())).resolves.toEqual([]);
    await application.close();
  });

  it("constructs one usable single-tenant Delivery from explicit environment inputs", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    await serverEnvironmentAccess.setup(environment);
    const publicDelivery: PublicDelivery = environment.delivery;
    expect(publicDelivery).toBe(environment.delivery);
    expect(environment.delivery).toBe(environment.delivery);
    expect(environment.delivery.context).toEqual({
      name: "__System_Delivery__",
      multitenant: false,
    });
    expect(environment.delivery.storageFactory).toBe(environment.storageFactory);
    await environment.delivery.inbox.read(ShardIndex.single());
    await environment.close();
  });

  it("waits for an admitted public Delivery run before closing shared storage", async () => {
    const factory = new InMemoryStorageFactory();
    const closeFactory = vi.spyOn(factory, "close");
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: factory });

    await serverEnvironmentAccess.setup(environment);
    await environment.delivery.inbox.receive(createMessage("public-run", "event-public-run", 1n));
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const running = environment.delivery.run({
      onMessage: async () => {
        entered.resolve(undefined);
        await release.promise;
      },
    });
    await entered.promise;
    const closing = environment.close();
    try {
      await expect(
        environment.delivery.run({
          onMessage: () => {
            throw new Error("Closed Delivery admitted a new callback.");
          },
        }),
      ).resolves.toMatchObject({ status: "STOPPED" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeFactory).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await Promise.allSettled([running, closing]);
    }
    expect(closeFactory).toHaveBeenCalledOnce();
  });

  it("opens configured remote ports before constructing its single Delivery", async () => {
    let ready = false;
    const ports = new DeliveryBuilder()
      .withStorageFactory(new InMemoryStorageFactory())
      .withNode("remote-fixture")
      .build();
    const inbox = ports.inbox;
    const workRegistry = {
      sessionKind: inbox.sessionKind,
      pickUp: () => Promise.resolve(undefined),
      release: () => Promise.resolve(true),
    };
    let scans = 0;
    const source = {
      shardSnapshot: () => {
        scans += 1;
        return Promise.resolve([]);
      },
      observeShardUpdates: () => {
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
      },
      releaseExpired: () => {
        scans += 1;
        return Promise.resolve([]);
      },
    };
    const remote = {
      open: () => {
        ready = true;
      },
      close: () => undefined,
      get inbox() {
        if (!ready) throw new Error("Inbox accessed before open.");
        return inbox;
      },
      get workRegistry() {
        if (!ready) throw new Error("Registry accessed before open.");
        return workRegistry;
      },
      source,
    };
    const environment = environmentWith(EnvironmentType.Local, { delivery: remote });

    expect(() => environment.delivery).toThrow(
      "Build the Application before using environment Delivery.",
    );
    await serverEnvironmentAccess.setup(environment);
    expect(environment.delivery.inbox).toBe(inbox);
    const empty = await buildContext(
      BoundedContext.singleTenant("NoRemoteRecipientYet"),
      environment,
    );
    expect(scans).toBe(0);
    await empty.close();
    await environment.close();
  });

  it("coalesces explicit setup and initializes transport before any channel", async () => {
    const gate = Promise.withResolvers<undefined>();
    const factory = new InMemoryTransportFactory();
    const initialize = vi.spyOn(factory, "initialize").mockImplementation(() => gate.promise);
    const publisher = vi.spyOn(factory, "createPublisher");
    const environment = environmentWith(EnvironmentType.Local, {
      integrationChannelFactory: factory,
    });

    const first = serverEnvironmentAccess.setup(environment);
    const second = serverEnvironmentAccess.setup(environment);
    expect(first).toBe(second);
    await Promise.resolve();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(publisher).not.toHaveBeenCalled();
    gate.resolve(undefined);
    await first;
    await environment.close();
  });

  it("preserves transport setup and cleanup failures and prevents later startup", async () => {
    const factory = new InMemoryTransportFactory();
    const setupError = new Error("transport setup failed");
    const cleanupError = new Error("transport cleanup failed");
    vi.spyOn(factory, "initialize").mockRejectedValue(setupError);
    vi.spyOn(factory, "close").mockRejectedValueOnce(cleanupError).mockResolvedValue(undefined);
    const environment = environmentWith(EnvironmentType.Local, {
      integrationChannelFactory: factory,
    });

    const failure = await serverEnvironmentAccess
      .setup(environment)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toContain(setupError);
    expect((failure as AggregateError).errors).toContain(cleanupError);
    await expect(serverEnvironmentAccess.setup(environment)).rejects.toThrow("closed");
    await environment.close();
  });

  it("stops setup at a failed storage check and closes every configured facility", async () => {
    const events: string[] = [];
    const failure = new Error("storage unavailable");
    const storage = new InMemoryStorageFactory();
    const closeStorage = storage.close.bind(storage);
    vi.spyOn(storage, "checkConnection").mockRejectedValue(failure);
    vi.spyOn(storage, "close").mockImplementation(() => {
      events.push("storage");
      return closeStorage();
    });
    const transport = new InMemoryTransportFactory();
    const closeTransport = transport.close.bind(transport);
    const initialize = vi.spyOn(transport, "initialize");
    vi.spyOn(transport, "close").mockImplementation(() => {
      events.push("transport");
      return closeTransport();
    });
    const environment = environmentWith(EnvironmentType.Local, {
      storageFactory: storage,
      integrationChannelFactory: transport,
      delivery: { close: () => events.push("delivery") },
    });

    await expect(serverEnvironmentAccess.setup(environment)).rejects.toBe(failure);
    expect(initialize).not.toHaveBeenCalled();
    expect(events).toEqual(["delivery", "transport", "storage"]);
    expect(() => environment.delivery).toThrow(
      "Build the Application before using environment Delivery.",
    );
    await expect(
      buildContext(BoundedContext.singleTenant("AfterFailedStorage"), environment),
    ).rejects.toThrow("closed");
  });

  it("closes initialized facilities when a remote Delivery port fails to open", async () => {
    const events: string[] = [];
    const openFailure = new Error("remote Delivery unavailable");
    const cleanupFailure = new Error("remote Delivery cleanup failed");
    let cleanupAttempts = 0;
    const storage = new InMemoryStorageFactory();
    const closeStorage = storage.close.bind(storage);
    vi.spyOn(storage, "close").mockImplementation(() => {
      events.push("storage");
      return closeStorage();
    });
    const transport = new InMemoryTransportFactory();
    const closeTransport = transport.close.bind(transport);
    const initialize = vi.spyOn(transport, "initialize");
    vi.spyOn(transport, "close").mockImplementation(() => {
      events.push("transport");
      return closeTransport();
    });
    const remote = {
      open: () => {
        events.push("open");
        return Promise.reject(openFailure);
      },
      close: () => {
        events.push("delivery");
        cleanupAttempts++;
        return cleanupAttempts === 1 ? Promise.reject(cleanupFailure) : Promise.resolve();
      },
      inbox: {} as ServerEnvironmentDelivery["inbox"],
      workRegistry: {} as ServerEnvironmentDelivery["workRegistry"],
    };
    const environment = environmentWith(EnvironmentType.Local, {
      storageFactory: storage,
      integrationChannelFactory: transport,
      delivery: remote,
    });

    const error = await serverEnvironmentAccess.setup(environment).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([openFailure, cleanupFailure]);
    expect(initialize).toHaveBeenCalledOnce();
    expect(events).toEqual(["open", "delivery", "transport", "storage"]);
    expect(() => environment.delivery).toThrow(
      "Build the Application before using environment Delivery.",
    );
  });

  it("does not report readiness when close fences pending transport setup", async () => {
    const gate = Promise.withResolvers<undefined>();
    const factory = new InMemoryTransportFactory();
    const initialize = vi.spyOn(factory, "initialize").mockImplementation(() => gate.promise);
    const environment = environmentWith(EnvironmentType.Local, {
      integrationChannelFactory: factory,
    });

    const setup = serverEnvironmentAccess.setup(environment);
    await vi.waitFor(() => {
      expect(initialize).toHaveBeenCalledOnce();
    });
    const closing = environment.close();
    await expect(serverEnvironmentAccess.setup(environment)).rejects.toThrow("closed");
    gate.resolve(undefined);
    await expect(setup).rejects.toThrow("closed during Delivery setup");
    await closing;
  });

  it("waits for a successful remote Delivery open before closing its facilities", async () => {
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const storage = new InMemoryStorageFactory();
    const transport = new InMemoryTransportFactory();
    const closeStorage = vi.spyOn(storage, "close");
    const closeTransport = vi.spyOn(transport, "close");
    const ports = new DeliveryBuilder()
      .withStorageFactory(storage)
      .withNode("remote-close")
      .build();
    const remote = {
      open: vi.fn(async () => {
        entered.resolve(undefined);
        await release.promise;
      }),
      close: vi.fn(() => Promise.resolve()),
      inbox: ports.inbox,
      workRegistry: {
        sessionKind: ports.inbox.sessionKind,
        pickUp: () => Promise.resolve(undefined),
        release: () => Promise.resolve(true),
      },
    };
    const environment = environmentWith(EnvironmentType.Local, {
      storageFactory: storage,
      integrationChannelFactory: transport,
      delivery: remote,
    });

    const setup = serverEnvironmentAccess.setup(environment);
    await entered.promise;
    const closing = environment.close();
    let closed = false;
    void closing.then(
      () => {
        closed = true;
      },
      () => {
        closed = true;
      },
    );
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(() => environment.delivery).toThrow(
        "Build the Application before using environment Delivery.",
      );
      expect(closed).toBe(false);
      expect(remote.close).not.toHaveBeenCalled();
      expect(closeTransport).not.toHaveBeenCalled();
      expect(closeStorage).not.toHaveBeenCalled();
    } finally {
      release.resolve(undefined);
      await Promise.allSettled([setup, closing]);
    }
    await expect(setup).rejects.toThrow("closed during Delivery setup");
    await expect(closing).resolves.toBeUndefined();
    expect(remote.close).toHaveBeenCalledOnce();
    expect(closeTransport).toHaveBeenCalledOnce();
    expect(closeStorage).toHaveBeenCalledOnce();
    expect(() => environment.delivery).toThrow(
      "Build the Application before using environment Delivery.",
    );
    await expect(
      buildContext(BoundedContext.singleTenant("AfterRemoteClose"), environment),
    ).rejects.toThrow("closed");
  });

  it("rejects environment close during Application build and while its Bounded Context is active", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    const entered = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const open: unknown = Reflect.get(IntegrationBroker.prototype, "open");
    if (typeof open !== "function") throw new Error("Expected IntegrationBroker open.");
    const spy = vi.spyOn(IntegrationBroker.prototype, "open").mockImplementation(async function (
      this: IntegrationBroker,
    ) {
      entered.resolve(undefined);
      await release.promise;
      await Reflect.apply(open, this, []);
    });
    const building = buildApplication([BoundedContext.singleTenant("EmptyPending")], environment);
    try {
      await entered.promise;
      await expect(environment.close()).rejects.toThrow("active Bounded Contexts");
      release.resolve(undefined);
      const application = await building;
      await expect(environment.close()).rejects.toThrow("active Bounded Contexts");
      await application.close();
      await expect(environment.close()).resolves.toBeUndefined();
    } finally {
      release.resolve(undefined);
      spy.mockRestore();
    }
  });

  it("uses the marker when a custom storage factory has no catalog", async () => {
    const factory = new CataloglessStorageFactory();
    const environment = environmentWith(EnvironmentType.Local, { storageFactory: factory });

    await serverEnvironmentAccess.setup(environment);
    const context = await buildContext(
      BoundedContext.singleTenant("CataloglessTasks"),
      environment,
      {
        createStorageStructures: false,
        startSubscriptionMonitoring: false,
      },
    );
    expect(context.tenantIndex).toBe(SINGLE_TENANT);
    await context.close();
  });
  it("shares one Application tenant index across multitenant Bounded Contexts", async () => {
    const company = tenantIndex();
    const environment = environmentWith(EnvironmentType.Local, {});
    const application = await buildApplication(
      [BoundedContext.multiTenant("IndexOrders"), BoundedContext.multiTenant("IndexInvoices")],
      environment,
      {},
      company,
    );
    const [orders, invoices] = application.contexts();
    if (orders === undefined || invoices === undefined)
      throw new Error("Expected two Bounded Contexts.");
    expect(application.tenantIndex()).toBe(company);
    expect(orders.tenantIndex).toBe(company);
    expect(invoices.tenantIndex).toBe(company);
    await orders.close();
    await company.keep(tenant("after-orders-close"));
    await expect(company.contains(tenant("after-orders-close"))).resolves.toBe(true);
    await invoices.close();
  });

  it("creates an independent default integration channel factory for each production environment", async () => {
    EnvironmentTests.use(EnvironmentType.Production);
    const first = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      typeRegistry: spineCoreRegistry,
    });
    const second = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      typeRegistry: spineCoreRegistry,
    });
    const close = vi.spyOn(InMemoryTransportFactory.prototype, "close");
    expect(first.integrationChannelFactory).toBeInstanceOf(InMemoryTransportFactory);
    expect(second.integrationChannelFactory).toBeInstanceOf(InMemoryTransportFactory);
    expect(first.integrationChannelFactory).not.toBe(second.integrationChannelFactory);
    await first.close();
    await second.close();
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("shares the default integration channel across local brokers and closes it once", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    const createdPublishers = vi.spyOn(InMemoryTransportFactory.prototype, "createPublisher");
    const createdSubscribers = vi.spyOn(InMemoryTransportFactory.prototype, "createSubscriber");
    const close = vi.spyOn(InMemoryTransportFactory.prototype, "close");
    const received: unknown[] = [];
    const application = await buildApplication(
      [
        BoundedContext.singleTenant("DefaultChannelConsumer").addEventDispatcher({
          messageSchemas: () => [ServerStartedSchema],
          externalEventSchemas: () => [ServerStartedSchema],
          dispatch: (event: unknown) => Promise.resolve(received.push(event)).then(() => undefined),
        }),
        BoundedContext.singleTenant("DefaultChannelProducer").addEventDispatcher({
          messageSchemas: () => [ServerStartedSchema],
          dispatch: () => Promise.resolve(),
        }),
      ],
      environment,
    );
    const [consumer, producer] = application.contexts();
    if (consumer === undefined || producer === undefined)
      throw new Error("Expected two Bounded Contexts.");
    try {
      await producer.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema, {
            producerId: Identifiers.pack("string", "server-producer"),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: ServerStartedSchema,
          message: create(ServerStartedSchema, { id: "default-channel-event", name: "Producer" }),
        }),
      );

      expect(received).toHaveLength(1);
      expect([...createdPublishers.mock.instances, ...createdSubscribers.mock.instances]).toEqual(
        expect.arrayContaining([environment.integrationChannelFactory]),
      );
      expect(
        [...createdPublishers.mock.instances, ...createdSubscribers.mock.instances].every(
          (factory) => factory === environment.integrationChannelFactory,
        ),
      ).toBe(true);
    } finally {
      await application.close();
    }

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses and closes a supplied integration channel factory once", async () => {
    const close = vi.fn();
    const factory = { close } as never;
    EnvironmentTests.use(EnvironmentType.Production);
    const environment = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: factory,
      typeRegistry: spineCoreRegistry,
    });

    expect(environment.integrationChannelFactory).toBe(factory);
    await environment.close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("requires an application schema registry in production", () => {
    EnvironmentTests.use(EnvironmentType.Production);
    expect(() =>
      environmentWith(EnvironmentType.Production, {
        storageFactory: new InMemoryStorageFactory(),
        integrationChannelFactory: new InMemoryTransportFactory(),
      }),
    ).toThrow("Production ServerEnvironment requires typeRegistry.");
  });

  it("rejects core Delivery access for an object outside the environment registry", () => {
    const outside = {} as ServerEnvironment;
    expect(() => serverEnvironmentAccess.coreDelivery(outside)).toThrow(
      "Build the Application before using environment Delivery.",
    );
  });

  it("snapshots one caller-owned logger child when the environment resolves", () => {
    const child = Object.freeze({});
    const logger = { child: vi.fn(() => child) };
    const environment = environmentWith(EnvironmentType.Local, {
      ...{ logger: logger as unknown as ILogLayer },
    });

    expect(logger.child).toHaveBeenCalledTimes(1);
    expect(logger.child).toHaveBeenCalledWith();
    expect("logger" in environment).toBe(false);
  });

  it("reports completed setup phases in order", async () => {
    const records: { message: string; operation: unknown }[] = [];
    const child = {
      withMetadata: (facts: Record<string, unknown>) => ({
        info: (message: string) => records.push({ message, operation: facts.operation }),
      }),
    };
    const environment = environmentWith(EnvironmentType.Local, {
      logger: { child: () => child } as unknown as ILogLayer,
    });

    await serverEnvironmentAccess.setup(environment);

    expect(records).toEqual([
      { message: "Environment storage connection checked.", operation: "server.setup_storage" },
      { message: "Environment transport initialized.", operation: "server.setup_transport" },
      { message: "Environment Delivery initialized.", operation: "server.setup_delivery" },
    ]);
  });

  it("writes default warning and error records as uppercase structured console JSON", async () => {
    const environment = environmentWith(EnvironmentType.Local, {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitServerWarning(serverEnvironmentAccess.loggerFor(environment), "Warning message", {
      contextName: "Tasks",
      operation: "stand.registry",
      reasonCode: "volatile",
    });
    emitServerError(serverEnvironmentAccess.loggerFor(environment), "Error message", {
      operation: "delivery.stop",
      reasonCode: "failed",
    });
    await Promise.resolve();

    const warningRecord = JSON.parse(String(warning.mock.calls[0]?.[0])) as Record<string, unknown>;
    const errorRecord = JSON.parse(String(error.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(warningRecord).toMatchObject({
      severity: "WARN",
      message: "Warning message",
      contextName: "Tasks",
      operation: "stand.registry",
      reasonCode: "volatile",
    });
    expect(errorRecord).toMatchObject({
      severity: "ERROR",
      message: "Error message",
      operation: "delivery.stop",
      reasonCode: "failed",
    });
    expect(warningRecord.timestamp).toEqual(expect.any(String));
    await environment.close();
  });

  it("warns once for a volatile registry in production and never in local", async () => {
    const warnings: string[] = [];
    const logger = {
      child: vi.fn(),
      withMetadata: () => ({ warn: (message: string) => warnings.push(message) }),
      warn: (message: string) => warnings.push(message),
    };
    logger.child.mockReturnValue(logger);
    EnvironmentTests.use(EnvironmentType.Production);
    const environment = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const production = environment;
    await serverEnvironmentAccess.setup(production);
    const context = await buildContext(
      BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(
        new InMemorySubscriptionRegistry(),
      ),
      environment,
    );

    try {
      serverEnvironmentAccess.warnVolatileRegistry(production, context);
      serverEnvironmentAccess.warnVolatileRegistry(production, context);
      expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
    } finally {
      await context.close();
      await production.close();
    }
  });

  it("keeps volatile-registry context names bounded and out of the fixed message", async () => {
    const warnings: string[] = [];
    const metadata: Record<string, unknown>[] = [];
    const logger = {
      child: vi.fn(),
      withMetadata: (facts: Record<string, unknown>) => {
        metadata.push(facts);
        return { warn: (message: string) => warnings.push(message) };
      },
    };
    logger.child.mockReturnValue(logger);
    EnvironmentTests.use(EnvironmentType.Production);
    const environment = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });

    await serverEnvironmentAccess.setup(environment);
    const context = await buildContext(
      BoundedContext.singleTenant(`secret-context-${"x".repeat(257)}`).withSubscriptionRegistry(
        new InMemorySubscriptionRegistry(),
      ),
      environment,
    );

    try {
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
      expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
      expect(metadata.filter((facts) => facts.operation === "stand.registry")).toEqual([
        { operation: "stand.registry", reasonCode: "volatile" },
      ]);
    } finally {
      await context.close();
      await environment.close();
    }
  });

  it("does not warn for a volatile registry in a local environment", async () => {
    const warnings: string[] = [];
    const logger = {
      child: vi.fn(),
      withMetadata: () => ({ warn: (message: string) => warnings.push(message) }),
      warn: (message: string) => warnings.push(message),
    };
    logger.child.mockReturnValue(logger);
    const environment = environmentWith(EnvironmentType.Local, {
      ...{ logger: logger as unknown as ILogLayer },
    });

    await serverEnvironmentAccess.setup(environment);
    const context = await buildContext(
      BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(
        new InMemorySubscriptionRegistry(),
      ),
      environment,
    );

    try {
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
      expect(warnings).toEqual([]);
    } finally {
      await context.close();
      await environment.close();
    }
  });

  it("does not warn for a persistent registry in a production environment", async () => {
    const warnings: string[] = [];
    const logger = {
      child: vi.fn(),
      withMetadata: () => ({ warn: (message: string) => warnings.push(message) }),
      warn: (message: string) => warnings.push(message),
    };
    logger.child.mockReturnValue(logger);
    EnvironmentTests.use(EnvironmentType.Production);
    const storageFactory = new InMemoryStorageFactory();
    const environment = environmentWith(EnvironmentType.Production, {
      storageFactory,
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });

    await serverEnvironmentAccess.setup(environment);
    const registry = new StorageSubscriptionRegistry(
      { name: "PersistentTasks", multitenant: false },
      storageFactory,
      new StorageGroup("subscriptions_PersistentTasks"),
    );
    const context = await buildContext(
      BoundedContext.singleTenant("PersistentTasks").withSubscriptionRegistry(registry),
      environment,
    );

    try {
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
      expect(warnings).toEqual([]);
    } finally {
      await context.close();
      await environment.close();
    }
  });

  it("warns before Server.start exposes a production context", async () => {
    const warnings: string[] = [];
    const logger = {
      child: vi.fn(),
      withMetadata: () => ({ warn: (message: string) => warnings.push(message) }),
      warn: (message: string) => warnings.push(message),
    };
    logger.child.mockReturnValue(logger);
    EnvironmentTests.use(EnvironmentType.Production);
    const environment = environmentWith(EnvironmentType.Production, {
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    await serverEnvironmentAccess.setup(environment);
    const application = await buildApplication(
      [
        BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(
          new InMemorySubscriptionRegistry(),
        ),
      ],
      environment,
    );
    const server = Server.atPort(0).setApplication(application);
    const running = await server.start();
    try {
      expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
    } finally {
      await running.close();
      await application.close();
    }
  });

  it("uses the configured remote Admin source for supervisor recovery and observation", async () => {
    let snapshots = 0;
    let observations = 0;
    const inbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.resolve({}),
      read: () => Promise.resolve([]),
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const workRegistry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => Promise.resolve(undefined),
      release: () => Promise.resolve(false),
    };
    const environment = configured({
      open: () => undefined,
      close: () => undefined,
      inbox,
      workRegistry,
      source: {
        shardSnapshot: () => {
          snapshots += 1;
          return Promise.resolve([]);
        },
        observeShardUpdates: () => {
          observations += 1;
          return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
        },
        releaseExpired: () => Promise.resolve([]),
      },
    });

    await serverEnvironmentAccess.setup(environment);
    expect(snapshots).toBe(0);
    serverStatusRegistry();
    const context = await buildContext(
      BoundedContext.singleTenant("RemoteSourceRecipient")

        .add(ServerStatusProjection),
      environment,
    );
    try {
      await waitFor(() => snapshots > 0 && observations > 0);
    } finally {
      await context.close();
      await environment.close();
    }

    expect(snapshots).toBeGreaterThan(0);
    expect(observations).toBeGreaterThan(0);
  });

  it("reports a post-reception notification failure without reversing the pending row", async () => {
    const portsFactory = new InMemoryStorageFactory();
    const ports = new CoreDelivery({
      context: { name: "NotificationFixture", multitenant: false },
      storageFactory: portsFactory,
    });
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(DeliverySupervisor.prototype, "notify").mockImplementation(() => {
      throw new Error("notification failed after reception");
    });
    const remoteFacility: ServerEnvironmentDelivery = {
      open: () => undefined,
      close: () => ports.close(),
      inbox: ports.inbox,
      workRegistry: ports.shards,
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => ({
          [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
        }),
        releaseExpired: () => Promise.resolve([]),
      },
    };
    const environment = environmentWith(EnvironmentType.Local, { delivery: remoteFacility });

    await serverEnvironmentAccess.setup(environment);
    await ports.inbox.receive(createMessage("notify-failed", "signal", 1n));

    expect(() => {
      serverEnvironmentAccess.notifyDelivery(environment, ShardIndex.single());
    }).not.toThrow();
    await expect(
      environment.delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toMatchObject([{ signalId: "signal" }]);
    expect(warnings).toHaveBeenCalledOnce();
    await environment.close();
  });

  it("closes delivery and storage in the approved order", async () => {
    const events: string[] = [];
    const environment = environmentWith(EnvironmentType.Local, {
      delivery: { close: () => events.push("delivery") },
      storageFactory: { close: () => events.push("storage") } as never,
    });

    await environment.close();

    expect(events).toEqual(["delivery", "storage"]);
  });

  it("retries only unfinished environment close phases after partial failure", async () => {
    const events: string[] = [];
    let fail = true;
    const records: Record<string, unknown>[] = [];
    const child = {
      withMetadata: (facts: Record<string, unknown>) => {
        records.push(facts);
        return { warn: vi.fn(), error: vi.fn() };
      },
    };
    const environment = environmentWith(EnvironmentType.Local, {
      delivery: {
        close: () => {
          events.push("delivery");
          if (fail) {
            fail = false;
            throw new Error("delivery close failed");
          }
        },
      },
      logger: { child: () => child } as unknown as ILogLayer,
    });

    await expect(environment.close()).rejects.toThrow("ServerEnvironment close failed.");
    await expect(environment.close()).resolves.toBeUndefined();

    expect(events).toEqual(["delivery", "delivery"]);
    expect(records).toEqual([]);
  });
});

function tenantIndex(): TenantIndex {
  const entries = new Map<string, TenantId>();
  return {
    contains: (id) => Promise.resolve(entries.has(JSON.stringify(id))),
    keep: (id) => {
      entries.set(JSON.stringify(id), id);
      return Promise.resolve();
    },
    all: () => Promise.resolve([...entries.values()]),
    close: () => Promise.resolve(),
    page: (request) =>
      Promise.resolve({ ids: [...entries.values()].slice(0, request.count), hasMore: false }),
  };
}

/**
 * Delegates storage while omitting the provider tenant catalog capability.
 */
class CataloglessStorageFactory extends StorageFactory {
  readonly #delegate = new InMemoryStorageFactory();

  /**
   * @returns Completion after validating the local delegate.
   */
  override checkConnection(): Promise<void> {
    return this.#delegate.checkConnection();
  }

  /**
   * Creates a delegated record handle without a tenant catalog.
   *
   * @returns A delegated record handle without a tenant catalog.
   */
  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return this.#delegate.createRecordStorage(context, spec, group);
  }

  /**
   * Closes delegated storage.
   *
   * @returns Completion after delegated storage closes.
   */
  override close(): Promise<void> {
    return this.#delegate.close();
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for configured finite delivery ports.");
}
