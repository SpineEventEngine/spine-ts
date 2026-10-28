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

import { afterEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { create, type Message } from "@bufbuild/protobuf";
import { SignalEnvelopes, spineCoreRegistry } from "@spine-event-engine/core";
import { EventContextSchema, type TenantId } from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  StorageFactory,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { InMemoryTransportFactory } from "@spine-event-engine/transport";

import {
  ServerEnvironment,
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
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "../delivery/inbox-message-fixture.js";
import { EnvironmentTests, EnvironmentType } from "../../src/server/environment.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import type { TenantIndex } from "../../src/context/tenant-index.js";
import { tenant } from "../tenant-fixture.js";
import {
  InMemorySubscriptionRegistry,
  StorageSubscriptionRegistry,
} from "../../src/stand/subscription-registry.js";
import { Server } from "../../src/server/server.js";
import { emitServerError, emitServerWarning } from "../../src/server/server-log.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import { ServerStartedSchema } from "../../test-fixtures/generated/server-lifecycle/events_pb.js";
import {
  serverStatusRegistry,
  ServerStatusProjection,
} from "./generated-server-registry-fixture.js";
import type { ILogLayer } from "loglayer";

afterEach(async () => {
  await resetServerEnvironmentForTest();
  vi.restoreAllMocks();
});

function configured(
  delivery: ServerEnvironmentCloseable & { open?: unknown; [key: string]: unknown },
) {
  ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
  return ServerEnvironment.instance();
}

describe("ServerEnvironment delivery lifecycle", () => {
  it("completes shared setup before a direct context becomes available", async () => {
    const storage = new InMemoryStorageFactory();
    const check = vi.spyOn(storage, "checkConnection");
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: storage });
    await ServerEnvironment.instance().completeSetup();
    const context = await BoundedContext.singleTenant("SetupBeforeContext").build();
    try {
      expect(check).toHaveBeenCalledOnce();
    } finally {
      await context.close();
    }
  });

  it("rejects direct context build before explicit environment setup without probing storage", async () => {
    const storage = new InMemoryStorageFactory();
    const check = vi.spyOn(storage, "checkConnection");
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: storage });
    await expect(BoundedContext.singleTenant("MissingSetup").build()).rejects.toThrow(
      "Await ServerEnvironment.completeSetup()",
    );
    expect(check).not.toHaveBeenCalled();
  });

  it("keeps shared Delivery usable after a listener closes its context", async () => {
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const context = await BoundedContext.singleTenant("ListenerContext").build();
    const running = await new Server({ contexts: [context], port: 0 }).start();
    await running.close();
    await expect(environment.delivery.inbox.read(ShardIndex.single())).resolves.toEqual([]);
    await environment.close();
  });

  it("constructs one usable single-tenant Delivery from explicit environment inputs", async () => {
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const publicDelivery: PublicDelivery = environment.delivery;
    expect(publicDelivery).toBe(environment.delivery);
    expect(ServerEnvironment.instance().delivery).toBe(environment.delivery);
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
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
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
    ServerEnvironment.when(EnvironmentType.Local).use({ delivery: remote });
    const environment = ServerEnvironment.instance();
    expect(() => environment.delivery).toThrow("completeSetup");
    await environment.completeSetup();
    expect(environment.delivery.inbox).toBe(inbox);
    const empty = await BoundedContext.singleTenant("NoRemoteRecipientYet").build();
    expect(scans).toBe(0);
    await empty.close();
    await environment.close();
  });

  it("coalesces explicit setup and initializes transport before any channel", async () => {
    const gate = Promise.withResolvers<undefined>();
    const factory = new InMemoryTransportFactory();
    const initialize = vi.spyOn(factory, "initialize").mockImplementation(() => gate.promise);
    const publisher = vi.spyOn(factory, "createPublisher");
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    const environment = ServerEnvironment.instance();

    const first = environment.completeSetup();
    const second = environment.completeSetup();
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
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    const environment = ServerEnvironment.instance();

    const failure = await environment.completeSetup().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toContain(setupError);
    expect((failure as AggregateError).errors).toContain(cleanupError);
    await expect(environment.completeSetup()).rejects.toThrow("closed");
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
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: storage,
      integrationChannelFactory: transport,
      delivery: { close: () => events.push("delivery") },
      tracerFactory: { close: () => events.push("tracer") },
    });
    const environment = ServerEnvironment.instance();

    await expect(environment.completeSetup()).rejects.toBe(failure);
    expect(initialize).not.toHaveBeenCalled();
    expect(events).toEqual(["delivery", "transport", "tracer", "storage"]);
    expect(() => environment.delivery).toThrow("completeSetup");
    await expect(BoundedContext.singleTenant("AfterFailedStorage").build()).rejects.toThrow(
      "closed",
    );
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
    ServerEnvironment.when(EnvironmentType.Local).use({
      storageFactory: storage,
      integrationChannelFactory: transport,
      delivery: remote,
      tracerFactory: { close: () => events.push("tracer") },
    });
    const environment = ServerEnvironment.instance();

    const error = await environment.completeSetup().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([openFailure, cleanupFailure]);
    expect(initialize).toHaveBeenCalledOnce();
    expect(events).toEqual(["open", "delivery", "transport", "tracer", "storage"]);
    expect(() => environment.delivery).toThrow("completeSetup");
  });

  it("does not report readiness when close fences pending transport setup", async () => {
    const gate = Promise.withResolvers<undefined>();
    const factory = new InMemoryTransportFactory();
    const initialize = vi.spyOn(factory, "initialize").mockImplementation(() => gate.promise);
    ServerEnvironment.when(EnvironmentType.Local).use({ integrationChannelFactory: factory });
    const environment = ServerEnvironment.instance();

    const setup = environment.completeSetup();
    await vi.waitFor(() => {
      expect(initialize).toHaveBeenCalledOnce();
    });
    const closing = environment.close();
    await expect(environment.completeSetup()).rejects.toThrow("closed");
    gate.resolve(undefined);
    await expect(setup).rejects.toThrow("closed during Delivery setup");
    await closing;
  });

  it("rejects full reset during an empty context build and while its context remains open", async () => {
    await ServerEnvironment.instance().completeSetup();
    const building = BoundedContext.singleTenant("EmptyPending").build();
    await expect(resetServerEnvironmentForTest()).rejects.toThrow("active Bounded Contexts");
    const context = await building;
    await expect(resetServerEnvironmentForTest()).rejects.toThrow("active Bounded Contexts");
    await context.close();
    await expect(resetServerEnvironmentForTest()).resolves.toBeUndefined();
  });
  it("uses transient membership when a custom storage factory has no catalog", async () => {
    const factory = new CataloglessStorageFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory: factory });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const context = await BoundedContext.singleTenant("CataloglessTasks").build({
      createStorageStructures: false,
      startSubscriptionMonitoring: false,
    });
    expect(context.tenantIndex).toBe(environment.tenantIndex);
    await environment.tenantIndex.keep(tenant("known"));
    await expect(context.tenantIndex.contains(tenant("known"))).resolves.toBe(true);
    await context.close();
  });
  it("shares the configured live index and keeps a context override separate", async () => {
    const company = tenantIndex();
    const billing = tenantIndex();
    ServerEnvironment.when(EnvironmentType.Local).use({ tenantIndex: company });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const orders = await BoundedContext.multitenant("IndexOrders").build();
    const invoices = await BoundedContext.multitenant("IndexInvoices")
      .withTenantIndex(billing)
      .build();
    expect(environment.tenantIndex).toBe(company);
    expect(orders.tenantIndex).toBe(company);
    expect(invoices.tenantIndex).toBe(billing);
    await orders.close();
    await company.keep(tenant("after-orders-close"));
    await expect(company.contains(tenant("after-orders-close"))).resolves.toBe(true);
    await invoices.close();
  });
  it("defaults one process-wide integration channel factory in production", async () => {
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      typeRegistry: spineCoreRegistry,
    });

    const close = vi.spyOn(InMemoryTransportFactory.prototype, "close");
    const environment = ServerEnvironment.instance() as unknown as {
      readonly integrationChannelFactory: InMemoryTransportFactory;
    };

    expect(environment.integrationChannelFactory).toBeInstanceOf(InMemoryTransportFactory);
    expect(ServerEnvironment.instance()).toBe(environment);
    await ServerEnvironment.instance().close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shares the default integration channel across local brokers and closes it once", async () => {
    await ServerEnvironment.instance().completeSetup();
    const createdPublishers = vi.spyOn(InMemoryTransportFactory.prototype, "createPublisher");
    const createdSubscribers = vi.spyOn(InMemoryTransportFactory.prototype, "createSubscriber");
    const close = vi.spyOn(InMemoryTransportFactory.prototype, "close");
    const received: unknown[] = [];
    const consumer = await BoundedContext.singleTenant("DefaultChannelConsumer")
      .addEventDispatcher({
        messageSchemas: () => [ServerStartedSchema],
        externalEventSchemas: () => [ServerStartedSchema],
        dispatch: (event: unknown) => Promise.resolve(received.push(event)).then(() => undefined),
      })
      .build();
    const producer = await BoundedContext.singleTenant("DefaultChannelProducer")
      .addEventDispatcher({
        messageSchemas: () => [ServerStartedSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();
    const environment = ServerEnvironment.instance();

    try {
      await producer.eventBus().post(
        SignalEnvelopes.event({
          context: create(EventContextSchema),
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
      await Promise.all([producer.close(), consumer.close()]);
      await environment.close();
    }

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses and closes a supplied integration channel factory once", async () => {
    const close = vi.fn();
    const factory = { close } as never;
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: factory,
      typeRegistry: spineCoreRegistry,
    });

    const environment = ServerEnvironment.instance() as unknown as {
      readonly integrationChannelFactory: unknown;
    };

    expect(environment.integrationChannelFactory).toBe(factory);
    await ServerEnvironment.instance().close();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("requires an application schema registry in production", () => {
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
    });

    expect(() => ServerEnvironment.instance()).toThrow(
      "Production ServerEnvironment requires typeRegistry.",
    );
  });

  it("rejects core Delivery access for an object outside the environment registry", () => {
    const outside = {} as ServerEnvironment;
    expect(() => serverEnvironmentAccess.coreDelivery(outside)).toThrow(
      "ServerEnvironment.completeSetup() must finish before Delivery use.",
    );
  });

  it("snapshots one caller-owned logger child when the environment resolves", () => {
    const child = Object.freeze({});
    const logger = { child: vi.fn(() => child) };
    ServerEnvironment.when(EnvironmentType.Local).use({
      ...{ logger: logger as unknown as ILogLayer },
    });

    const environment = ServerEnvironment.instance();

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
    ServerEnvironment.when(EnvironmentType.Local).use({
      logger: { child: () => child } as unknown as ILogLayer,
    });

    await ServerEnvironment.instance().completeSetup();

    expect(records).toEqual([
      { message: "Environment storage connection checked.", operation: "server.setup_storage" },
      { message: "Environment transport initialized.", operation: "server.setup_transport" },
      { message: "Environment Delivery initialized.", operation: "server.setup_delivery" },
    ]);
  });

  it("writes default warning and error records as uppercase structured console JSON", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const environment = ServerEnvironment.instance();

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
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const production = ServerEnvironment.instance();
    await production.completeSetup();
    const context = await BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();

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
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const context = await BoundedContext.singleTenant(`secret-context-${"x".repeat(257)}`)
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();

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
    ServerEnvironment.when(EnvironmentType.Local).use({
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const context = await BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();

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
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
    const registry = new StorageSubscriptionRegistry(
      { name: "PersistentTasks", multitenant: false },
      storageFactory,
    );
    const context = await BoundedContext.singleTenant("PersistentTasks")
      .withSubscriptionRegistry(registry)
      .build();

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
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      integrationChannelFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    await ServerEnvironment.instance().completeSetup();
    const context = await BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();
    const server = new Server({ contexts: [context], port: 0 });

    const running = await server.start();
    expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
    await running.close();
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

    await environment.completeSetup();
    expect(snapshots).toBe(0);
    const registry = serverStatusRegistry();
    const context = await BoundedContext.singleTenant("RemoteSourceRecipient")
      .withGeneratedRegistryRoot(registry.root)
      .add(ServerStatusProjection)
      .build();
    try {
      await waitFor(() => snapshots > 0 && observations > 0);
    } finally {
      await context.close();
      await environment.close();
      rmSync(registry.directory, { recursive: true, force: true });
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
    ServerEnvironment.when(EnvironmentType.Local).use({ delivery: remoteFacility });
    const environment = ServerEnvironment.instance();
    await environment.completeSetup();
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

  it("closes delivery tracer and storage in the approved order", async () => {
    const events: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: { close: () => events.push("delivery") },
      tracerFactory: { close: () => events.push("tracer") },
      storageFactory: { close: () => events.push("storage") } as never,
    });

    await ServerEnvironment.instance().close();

    expect(events).toEqual(["delivery", "tracer", "storage"]);
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
    ServerEnvironment.when(EnvironmentType.Local).use({
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
    const environment = ServerEnvironment.instance();

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
