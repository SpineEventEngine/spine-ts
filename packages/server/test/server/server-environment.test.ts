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
import { InMemoryStorageFactory, type StorageContext } from "@spine-event-engine/storage";
import { InMemoryTransportFactory } from "@spine-event-engine/transport";
import { spineCoreRegistry } from "@spine-event-engine/core";

import {
  ServerEnvironment,
  type ServerEnvironmentCloseable,
  type ServerEnvironmentDelivery,
  serverEnvironmentAccess,
} from "../../src/server/server-environment.js";
import type { ContextDeliveryDescriptor } from "../../src/context/bounded-context.js";
import { DeliveryBuilder } from "../../src/delivery/delivery-builder.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import type { EnvironmentAttachmentHandle } from "../../src/server/environment-attachment.js";
import type {
  EnvironmentDeliveryRuntime,
  EnvironmentGenerationWorker,
} from "../../src/server/environment-delivery-worker.js";
import { EnvironmentTests, EnvironmentType } from "../../src/server/environment.js";
import { BoundedContext } from "../../src/context/bounded-context.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { Server } from "../../src/server/server.js";
import { emitServerError, emitServerWarning } from "../../src/server/server-log.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";
import type { ILogLayer } from "loglayer";

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

function configured(
  delivery: ServerEnvironmentCloseable & { open?: unknown; [key: string]: unknown },
) {
  ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
  return ServerEnvironment.instance();
}

describe("ServerEnvironment delivery lifecycle", () => {
  it("requires an explicit transport factory in production", () => {
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      transport: { close: () => undefined } as never,
    });

    expect(() => ServerEnvironment.instance()).toThrow(
      "Production ServerEnvironment requires transportFactory.",
    );
  });

  it("requires an application schema registry in production", () => {
    EnvironmentTests.use(EnvironmentType.Production);
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      transport: { close: () => undefined } as never,
      transportFactory: new InMemoryTransportFactory(),
    });

    expect(() => ServerEnvironment.instance()).toThrow(
      "Production ServerEnvironment requires typeRegistry.",
    );
  });

  it("rejects package lifecycle access for an object outside the environment registry", async () => {
    const outside = {} as ServerEnvironment;
    const attachment = {} as EnvironmentAttachmentHandle;

    await expect(
      serverEnvironmentAccess.attach(outside, { ownership: "caller", descriptors: [] }),
    ).rejects.toThrow("Attachment requires a ServerEnvironment instance.");
    expect(() => serverEnvironmentAccess.failedStartPending(outside)).toThrow(
      "Failed-start observation requires a ServerEnvironment instance.",
    );
    expect(() =>
      serverEnvironmentAccess.failedStartRetryPending(outside, new Error("failed")),
    ).toThrow("Failed-start retry observation requires a ServerEnvironment instance.");
    await expect(serverEnvironmentAccess.retryFailedStart(outside)).rejects.toThrow(
      "Rollback retry requires a ServerEnvironment instance.",
    );
    await expect(serverEnvironmentAccess.detach(outside, attachment)).rejects.toThrow(
      "Detach requires a ServerEnvironment instance.",
    );
    await expect(serverEnvironmentAccess.retryDetach(outside, attachment)).rejects.toThrow(
      "Detach retry requires a ServerEnvironment instance.",
    );
    expect(() => serverEnvironmentAccess.detachRetryPending(outside, attachment)).toThrow(
      "Detach-retry observation requires a ServerEnvironment instance.",
    );
    expect(() => serverEnvironmentAccess.endpointSafe(outside, attachment)).toThrow(
      "Endpoint-safety observation requires a ServerEnvironment instance.",
    );
    await expect(serverEnvironmentAccess.stopDelivery(outside)).rejects.toThrow(
      "Delivery stop requires a ServerEnvironment instance.",
    );
    await expect(serverEnvironmentAccess.retryDeliveryStop(outside)).rejects.toThrow(
      "Delivery stop retry requires a ServerEnvironment instance.",
    );
    expect(() => {
      serverEnvironmentAccess.installTestAttachments(
        outside,
        () => ({}) as EnvironmentGenerationWorker,
      );
    }).toThrow("Test attachments require a ServerEnvironment instance.");
  });

  it("passes its exact logger child to an attached delivery runtime", async () => {
    const child = Object.freeze({ name: "environment-child" });
    const logger = { child: vi.fn(() => child) };
    ServerEnvironment.when(EnvironmentType.Local).use({
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    let runtime: EnvironmentDeliveryRuntime | undefined;
    const workerEvents: string[] = [];
    const worker: EnvironmentGenerationWorker = {
      add(candidate) {
        runtime = candidate;
      },
      start(obligation, shards) {
        return Promise.resolve({
          obligation,
          shards: shards.map((shard) => ({
            status: "fulfilled" as const,
            shard,
            obligation,
            run: {
              status: "IDLE" as const,
              runs: 1,
              processed: 0,
              accepted: 0,
              delivered: 0,
              failed: 0,
              failures: Object.freeze([]),
            },
            progress: {
              runs: 1,
              processed: 0,
              accepted: 0,
              delivered: 0,
              failed: 0,
              failures: Object.freeze([]),
            },
          })),
        });
      },
      stop() {
        workerEvents.push("stop");
      },
      awaitSettled() {
        return Promise.resolve();
      },
      retire() {
        return Promise.resolve();
      },
      stopOwners() {
        workerEvents.push("stopOwners");
      },
      awaitOwnersSettled() {
        return Promise.resolve();
      },
      retireOwners() {
        return Promise.resolve();
      },
    };
    serverEnvironmentAccess.installTestAttachments(environment, () => worker);

    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [environmentDescriptor(environment)],
    });

    expect(logger.child).toHaveBeenCalledTimes(1);
    expect(runtime?.logger).toBe(child);
    await serverEnvironmentAccess.detach(environment, attachment);
    expect(workerEvents).toContain("stop");
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
      transport: { close: () => undefined } as never,
      transportFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const production = ServerEnvironment.instance();
    const context = BoundedContext.singleTenant("Tasks")
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
      transport: { close: () => undefined } as never,
      transportFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    const context = BoundedContext.singleTenant(`secret-context-${"x".repeat(257)}`)
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();

    try {
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
      expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
      expect(metadata).toEqual([{ operation: "stand.registry", reasonCode: "volatile" }]);
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
    const context = BoundedContext.singleTenant("Tasks")
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
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory: new InMemoryStorageFactory(),
      transport: { close: () => undefined } as never,
      transportFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const environment = ServerEnvironment.instance();
    const context = BoundedContext.singleTenant("PersistentTasks")
      .withSubscriptionRegistry({ persistent: true, close: () => Promise.resolve() } as never)
      .build();

    try {
      serverEnvironmentAccess.warnVolatileRegistry(environment, context);
      expect(warnings).toEqual([]);
    } finally {
      await context.close();
      await environment.close();
    }
  });

  it("warns before Server.start attaches a production context", async () => {
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
      transport: { close: () => undefined } as never,
      transportFactory: new InMemoryTransportFactory(),
      typeRegistry: spineCoreRegistry,
      ...{ logger: logger as unknown as ILogLayer },
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withSubscriptionRegistry(new InMemorySubscriptionRegistry())
      .build();
    const server = new Server({ contexts: [context], port: 0 });

    const running = await server.start();
    expect(warnings).toEqual(["Stand subscription registry is not persistent."]);
    await running.close();
  });

  it("routes configured ports through the attachment factory without eager delivery", async () => {
    let finiteReads = 0;
    let finitePickups = 0;
    const inbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.resolve({}),
      read: () => {
        finiteReads += 1;
        return Promise.resolve([]);
      },
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const workRegistry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => {
        finitePickups += 1;
        return Promise.resolve(undefined);
      },
      release: () => Promise.resolve(false),
    };
    let ready = false;
    let opens = 0;
    const withInbox = vi.spyOn(DeliveryBuilder.prototype, "withInbox");
    const withWorkRegistry = vi.spyOn(DeliveryBuilder.prototype, "withWorkRegistry");
    const delivery = {
      open: () => {
        opens += 1;
        ready = true;
      },
      close: () => undefined,
      get inbox() {
        if (!ready) throw new Error("Inbox port read before delivery readiness.");
        return inbox;
      },
      get workRegistry() {
        if (!ready) throw new Error("Work-registry port read before delivery readiness.");
        return workRegistry;
      },
    };
    const environment = configured(delivery);
    expect(opens).toBe(0);
    const descriptor = environmentDescriptor(environment);
    let attachment: EnvironmentAttachmentHandle | undefined;

    try {
      attachment = await serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [descriptor],
      });

      expect(opens).toBe(1);
      await Promise.resolve();
      expect(finitePickups).toBeGreaterThan(0);
      expect(finiteReads).toBe(0);
      expect(withInbox).toHaveBeenCalledWith(inbox);
      expect(withWorkRegistry).toHaveBeenCalledWith(workRegistry);
      await serverEnvironmentAccess.detach(environment, attachment);
      attachment = undefined;
    } finally {
      if (attachment !== undefined) await serverEnvironmentAccess.detach(environment, attachment);
      withInbox.mockRestore();
      withWorkRegistry.mockRestore();
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

    let attachment: EnvironmentAttachmentHandle | undefined;
    try {
      attachment = await serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [environmentDescriptor(environment)],
      });
      await waitFor(() => snapshots > 0 && observations > 0);
      await serverEnvironmentAccess.detach(environment, attachment);
      attachment = undefined;
    } finally {
      if (attachment !== undefined) await serverEnvironmentAccess.detach(environment, attachment);
    }

    expect(snapshots).toBeGreaterThan(0);
    expect(observations).toBeGreaterThan(0);
  });

  it.each([
    ["null", null],
    ["empty object", {}],
    ["missing shard snapshot", { observeShardUpdates: () => [], releaseExpired: () => [] }],
    ["missing shard updates", { shardSnapshot: () => [], releaseExpired: () => [] }],
    ["missing expired release", { shardSnapshot: () => [], observeShardUpdates: () => [] }],
  ])("rejects a dynamic %s delivery source after opening delivery", async (_name, source) => {
    let opens = 0;
    const environment = configured({
      open: () => {
        opens += 1;
      },
      close: () => undefined,
      inbox: {
        sessionKind: "EXCLUSIVE" as const,
        receive: () => Promise.resolve({}),
        read: () => Promise.resolve([]),
        readMessage: () => Promise.resolve(undefined),
        begin: () => Promise.resolve(undefined),
      },
      workRegistry: {
        sessionKind: "EXCLUSIVE" as const,
        pickUp: () => Promise.resolve(undefined),
        release: () => Promise.resolve(false),
      },
      source,
    });

    await expect(
      serverEnvironmentAccess.attach(environment, {
        ownership: "caller",
        descriptors: [environmentDescriptor(environment)],
      }),
    ).rejects.toThrow("Environment delivery source is invalid.");
    expect(opens).toBe(1);
  });

  it("does not expose the internal delivery opener on the environment instance", () => {
    const environment = configured({ close: () => undefined });

    expect("openDelivery" in environment).toBe(false);
  });

  it("preserves a close-only delivery with an unrelated non-callable open property", async () => {
    const environment = configured({ close: () => undefined, open: "legacy metadata" });

    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("rejects an incomplete callable delivery instead of reading invalid ports", async () => {
    const environment = configured({
      close: () => undefined,
      open: () => undefined,
    });

    const result: Error | EnvironmentAttachmentHandle = await serverEnvironmentAccess
      .attach(environment, { ownership: "caller", descriptors: [] })
      .then<Error | EnvironmentAttachmentHandle, Error | EnvironmentAttachmentHandle>(
        (attachment) => attachment,
        (error: unknown) => error as Error,
      );
    if (!(result instanceof Error)) await serverEnvironmentAccess.detach(environment, result);

    expect(result).toHaveProperty(
      "message",
      "ServerEnvironmentDelivery requires inbox and workRegistry ports.",
    );
  });

  it("opens configured delivery before the first environment attachment", async () => {
    let release: () => void = () => undefined;
    const environment = configured({
      open: () => new Promise<void>((resolve) => (release = resolve)),
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    });

    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    let attached = false;
    void attaching.then(() => {
      attached = true;
    });
    await Promise.resolve();
    expect(attached).toBe(false);
    release();

    const attachment = await attaching;
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("closes configured delivery while its attachment readiness remains pending", async () => {
    let release: () => void = () => undefined;
    const events: string[] = [];
    const environment = configured({
      open: () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      close: () => events.push("delivery"),
      inbox: {},
      workRegistry: {},
    });
    const attaching = serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await Promise.resolve();

    const closing = environment.close();
    release();

    await expect(attaching).rejects.toThrow("ServerEnvironment is closed.");
    await expect(closing).resolves.toBeUndefined();
    expect(events).toEqual(["delivery"]);
  });

  it("does not create an attachment when configured delivery open rejects", async () => {
    const failure = new Error("delivery unavailable");
    const records: Record<string, unknown>[] = [];
    const child = {
      withMetadata: (facts: Record<string, unknown>) => {
        records.push(facts);
        return { warn: vi.fn(), error: vi.fn() };
      },
    };
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: {
        open: () => Promise.reject(failure),
        close: () => undefined,
        inbox: {},
        workRegistry: {},
      } as unknown as ServerEnvironmentDelivery,
      logger: { child: () => child } as unknown as ILogLayer,
    });
    const environment = ServerEnvironment.instance();

    const result: Error | EnvironmentAttachmentHandle = await serverEnvironmentAccess
      .attach(environment, { ownership: "caller", descriptors: [] })
      .then<Error | EnvironmentAttachmentHandle, Error | EnvironmentAttachmentHandle>(
        (attachment) => attachment,
        (error: unknown) => error as Error,
      );
    if (!(result instanceof Error)) await serverEnvironmentAccess.detach(environment, result);
    expect(result).toBe(failure);
    expect(records).toEqual([]);
  });

  it("coalesces delivery open across concurrent attachment attempts", async () => {
    let opens = 0;
    const environment = configured({
      open: () => {
        opens += 1;
      },
      close: () => undefined,
      inbox: {},
      workRegistry: {},
    });

    const attachments = await Promise.all([
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
      serverEnvironmentAccess.attach(environment, { ownership: "caller", descriptors: [] }),
    ]);
    await Promise.all(
      attachments.map((attachment) => serverEnvironmentAccess.detach(environment, attachment)),
    );
    const later = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, later);

    expect(opens).toBe(1);
  });

  it("keeps existing close-only local delivery configuration compatible", async () => {
    const environment = configured({ close: () => undefined });

    const attachment = await serverEnvironmentAccess.attach(environment, {
      ownership: "caller",
      descriptors: [],
    });
    await serverEnvironmentAccess.detach(environment, attachment);
  });

  it("closes delivery transport tracer and storage in the approved order", async () => {
    const events: string[] = [];
    ServerEnvironment.when(EnvironmentType.Local).use({
      delivery: { close: () => events.push("delivery") },
      transport: { close: () => events.push("transport") } as never,
      tracerFactory: { close: () => events.push("tracer") },
      storageFactory: { close: () => events.push("storage") } as never,
    });

    await ServerEnvironment.instance().close();

    expect(events).toEqual(["delivery", "transport", "tracer", "storage"]);
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

function environmentDescriptor(environment: ServerEnvironment): ContextDeliveryDescriptor {
  const ready = {
    label: "UPDATE_SUBSCRIBER" as const,
    targetTypeUrl: "type.googleapis.com/example.EnvironmentPort",
    shard: ShardIndex.single(),
  };
  return Object.freeze({
    storageFactory: environment.storageFactory,
    startupScopes: () => Promise.resolve([{}]),
    storageContext: () =>
      Object.freeze({ name: "environment-port-integration", multitenant: false }) as StorageContext,
    endpoints: () => [ready],
    replay: () => Promise.resolve(),
    onReady: () => () => undefined,
    transition: (
      _scopes: Parameters<ContextDeliveryDescriptor["transition"]>[0],
      onReady: Parameters<ContextDeliveryDescriptor["transition"]>[1],
    ) => {
      onReady(ready);
      return Promise.resolve();
    },
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for configured finite delivery ports.");
}
