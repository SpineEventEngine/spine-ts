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

import { create } from "@bufbuild/protobuf";
import { AnyPacker, TypeUrls } from "@spine-event-engine/core";
import { EventContextSchema, EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import {
  SubscriptionIdSchema,
  SubscriptionSchema,
  TargetSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import { EventStore, InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { eventBusAccess, EventBus } from "../../src/bus/event-bus.js";
import { Stand } from "../../src/stand/stand.js";
import {
  SubscriptionRuntime,
  subscriptionRuntimeAccess,
} from "../../src/stand/subscription-runtime.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";
import { TaskCreatedSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";

describe("SubscriptionRuntime", () => {
  it("validates and clears package-private logger metadata", async () => {
    const logger = { withMetadata: vi.fn(() => ({ warn: vi.fn() })) };
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new InMemorySubscriptionRegistry(),
    );
    expect(() => {
      subscriptionRuntimeAccess.installLogger({} as never, logger as never);
    }).toThrow("Subscription runtime logger requires a SubscriptionRuntime instance.");
    expect(() => {
      subscriptionRuntimeAccess.clearLogger({} as never);
    }).toThrow("Subscription runtime logger requires a SubscriptionRuntime instance.");
    expect(() => {
      subscriptionRuntimeAccess.loggerFor({} as never);
    }).toThrow("Subscription runtime logger requires a SubscriptionRuntime instance.");
    subscriptionRuntimeAccess.installLogger(runtime, logger as never);
    expect(subscriptionRuntimeAccess.loggerFor(runtime)).toBe(logger);
    subscriptionRuntimeAccess.clearLogger(runtime);
    expect(() => {
      subscriptionRuntimeAccess.loggerFor(runtime);
    }).toThrow("Subscription runtime logger is not installed.");
    await runtime.close();
  });
  it("rejects a failed first pass and permits a later successful start", async () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const registry = new InMemorySubscriptionRegistry();
    vi.spyOn(registry, "snapshot").mockRejectedValueOnce(new Error("snapshot failed"));
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    subscriptionRuntimeAccess.installLogger(runtime, logger as never);

    await expect(runtime.start()).rejects.toThrow("snapshot failed");
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    await runtime.close();
  });

  it("shares one pending first pass across concurrent starts", async () => {
    const registry = new GatedSnapshotRegistry();
    const snapshot = vi.spyOn(registry, "snapshot");
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    const first = runtime.start();
    const second = runtime.start();
    try {
      expect(second).toBe(first);
      await registry.snapshotCaptured;
      expect(snapshot).toHaveBeenCalledOnce();
      registry.releaseSnapshot();
      await Promise.all([first, second]);
    } finally {
      registry.releaseSnapshot();
      await runtime.close();
    }
  });

  it("drains the first pass during close without starting periodic reconciliation", async () => {
    vi.useFakeTimers();
    const registry = new GatedSnapshotRegistry();
    const cleanup = vi.spyOn(registry, "cleanup");
    const snapshot = vi.spyOn(registry, "snapshot");
    const close = vi.spyOn(registry, "close");
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    const starting = runtime.start();
    try {
      await registry.snapshotCaptured;
      const closing = runtime.close();
      let settled = false;
      void closing.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(close).not.toHaveBeenCalled();
      await expect(runtime.start()).rejects.toThrow("closing");
      registry.releaseSnapshot();
      await starting;
      await closing;
      expect(close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(snapshot).toHaveBeenCalledOnce();
    } finally {
      registry.releaseSnapshot();
      await runtime.close();
      vi.useRealTimers();
    }
  });

  it("owns one explicit reconciliation lifecycle", () => {
    expect(SubscriptionRuntime).toBeTypeOf("function");
  });

  it("rejects a consumer added after terminal close begins", async () => {
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new InMemorySubscriptionRegistry(),
    );

    runtime.beginClose();

    await expect(runtime.consume("closed", () => undefined)).rejects.toThrow(
      "Subscription runtime is closing.",
    );
    await runtime.close();
  });

  it("shares one consumer set and makes its removal handle idempotent", async () => {
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new InMemorySubscriptionRegistry(),
    );

    const first = await runtime.consume("shared", () => undefined);
    const second = await runtime.consume("shared", () => undefined);

    first.unsubscribe();
    first.unsubscribe();
    second.unsubscribe();
    second.unsubscribe();
    await runtime.close();
  });

  it("keeps a newly activating consumer when an older snapshot observed it pending", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "SubscriptionRace", multitenant: false },
      storageFactory,
    });
    const bus = new EventBus(
      new EventStore({ name: "SubscriptionRace", multitenant: false }, storageFactory),
    );
    eventBusAccess.registerSchemas(bus, [TaskCreatedSchema]);
    const registry = new GatedSnapshotRegistry();
    const id = create(SubscriptionIdSchema, { value: "race-event" });
    await registry.create(
      create(SubscriptionSchema, {
        id,
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "race-topic" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(TaskCreatedSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      }),
    );
    const runtime = new SubscriptionRuntime(stand, stand, bus, bus, registry);
    const delivered = vi.fn();
    try {
      const stale = runtime.reconcile();
      await registry.snapshotCaptured;
      await registry.activate(id);
      const consuming = runtime.consume(id.value, delivered);
      registry.releaseSnapshot();
      await stale;
      const handle = await consuming;
      await bus.post(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "race-delivery" }),
          context: create(EventContextSchema),
          message: AnyPacker.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id: create(TaskIdSchema, { value: "race-task" }),
              title: "Race task",
              taskListId: create(TaskListIdSchema, { value: "race-list" }),
            }),
          ),
        }),
      );
      expect(delivered).toHaveBeenCalledTimes(1);
      handle.unsubscribe();
    } finally {
      registry.releaseSnapshot();
      await runtime.close();
      await bus.close();
      await stand.close();
    }
  });

  it("keeps an active Event observer usable through a failed periodic pass", async () => {
    vi.useFakeTimers();
    const storageFactory = new InMemoryStorageFactory();
    const stand = new Stand({
      context: { name: "MonitorObserver", multitenant: false },
      storageFactory,
    });
    const bus = new EventBus(
      new EventStore({ name: "MonitorObserver", multitenant: false }, storageFactory),
    );
    eventBusAccess.registerSchemas(bus, [TaskCreatedSchema]);
    const registry = new InMemorySubscriptionRegistry();
    const id = create(SubscriptionIdSchema, { value: "monitor-event" });
    await registry.create(
      create(SubscriptionSchema, {
        id,
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "monitor-topic" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(TaskCreatedSchema),
            criterion: { case: "includeAll", value: true },
          }),
        }),
      }),
    );
    await registry.activate(id);
    const runtime = new SubscriptionRuntime(stand, stand, bus, bus, registry);
    const delivered = vi.fn();
    try {
      await runtime.start();
      const consumer = await runtime.consume(id.value, delivered);
      const snapshot = vi.spyOn(registry, "snapshot").mockRejectedValueOnce(new Error("temporary"));
      await vi.advanceTimersByTimeAsync(10_000);
      await bus.post(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "monitor-event-1" }),
          context: create(EventContextSchema),
          message: AnyPacker.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id: create(TaskIdSchema, { value: "monitor-task-1" }),
              title: "First task",
              taskListId: create(TaskListIdSchema, { value: "monitor-list" }),
            }),
          ),
        }),
      );
      expect(delivered).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(snapshot).toHaveBeenCalledTimes(2);
      expect(delivered).toHaveBeenCalledOnce();
      consumer.unsubscribe();
    } finally {
      await runtime.close();
      await bus.close();
      await stand.close();
      vi.useRealTimers();
    }
  });

  it("coalesces timer reconciliation while the current registry cycle is pending", async () => {
    vi.useFakeTimers();
    const registry = new GatedCleanupRegistry();
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    const warn = vi.fn();
    subscriptionRuntimeAccess.installLogger(runtime, {
      withMetadata: vi.fn(() => ({ warn })),
    } as never);

    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(10_000);
      await registry.cleanupStarted;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(registry.cleanupCalls).toBe(2);
      registry.rejectCleanup();
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
      expect(warn).toHaveBeenCalledOnce();
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains a held periodic pass and cancels future timer work on close", async () => {
    vi.useFakeTimers();
    const registry = new GatedCleanupRegistry();
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    try {
      await runtime.start();
      await vi.advanceTimersByTimeAsync(10_000);
      await registry.cleanupStarted;
      const closing = runtime.close();
      let settled = false;
      void closing.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      registry.releaseCleanup();
      await closing;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(registry.cleanupCalls).toBe(2);
    } finally {
      registry.releaseCleanup();
      await runtime.close();
      vi.useRealTimers();
    }
  });

  it("reports registry-close failure after draining local consumers", async () => {
    const registry = new FailingCloseRegistry();
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    await runtime.consume("one", () => undefined);
    await expect(runtime.close()).rejects.toThrow("Subscription runtime close failed.");
    expect(registry.closeCalls).toBe(1);
  });

  it("makes close idempotent after successful shutdown", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    await runtime.close();
    await runtime.close();
    await expect(registry.get(create(SubscriptionIdSchema, { value: "one" }))).rejects.toThrow(
      "closed",
    );
  });

  it("emits no record for a normal runtime close with an installed logger", async () => {
    const withMetadata = vi.fn(() => ({ warn: vi.fn(), error: vi.fn() }));
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new InMemorySubscriptionRegistry(),
    );
    subscriptionRuntimeAccess.installLogger(runtime, { withMetadata } as never);
    await runtime.close();
    expect(withMetadata).not.toHaveBeenCalled();
  });

  it("exposes its registry and warns after a later failed timer reconciliation", async () => {
    vi.useFakeTimers();
    const registry = new InMemorySubscriptionRegistry();
    vi.spyOn(registry, "snapshot").mockRejectedValueOnce(new Error("snapshot failed"));
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    subscriptionRuntimeAccess.installLogger(runtime, logger as never, "MonitorContext");
    expect(runtime.registry()).toBe(registry);
    await expect(runtime.start()).rejects.toThrow("snapshot failed");
    await runtime.start();
    const snapshot = vi.spyOn(registry, "snapshot");
    snapshot.mockRejectedValueOnce(
      Object.assign(new Error("private registry detail"), {
        name: "SnapshotFailure",
        code: "REGISTRY_UNAVAILABLE",
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalledOnce();
    expect(logger.withMetadata).toHaveBeenNthCalledWith(1, {
      contextName: "MonitorContext",
      operation: "subscription.reconcile",
      reasonCode: "failed",
      errorName: "SnapshotFailure",
      errorCode: "REGISTRY_UNAVAILABLE",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshot).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledOnce();
    await runtime.close();
    vi.useRealTimers();
  });

  it("abort-closes a registry without exposing further operations", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    runtime.abortClose();
    await Promise.resolve();
    await expect(runtime.consume("after-abort", () => undefined)).rejects.toThrow("closing");
  });
});

class GatedCleanupRegistry extends InMemorySubscriptionRegistry {
  cleanupCalls = 0;
  #release: (() => void) | undefined;
  #reject: ((error: Error) => void) | undefined;
  #started: (() => void) | undefined;
  readonly cleanupStarted = new Promise<void>((resolve) => {
    this.#started = resolve;
  });

  releaseCleanup(): void {
    this.#release?.();
  }
  rejectCleanup(): void {
    this.#reject?.(new Error("cleanup failed"));
  }

  override async cleanup() {
    this.cleanupCalls++;
    if (this.cleanupCalls !== 2) return await super.cleanup();
    this.#started?.();
    await new Promise<void>((resolve, reject) => {
      this.#release = resolve;
      this.#reject = reject;
    });
    return await super.cleanup();
  }
}

class GatedSnapshotRegistry extends InMemorySubscriptionRegistry {
  #first = true;
  #release: (() => void) | undefined;
  #captured: (() => void) | undefined;
  readonly snapshotCaptured = new Promise<void>((resolve) => {
    this.#captured = resolve;
  });

  releaseSnapshot(): void {
    this.#release?.();
  }

  override async snapshot() {
    const entries = await super.snapshot();
    if (!this.#first) return entries;
    this.#first = false;
    this.#captured?.();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
    return entries;
  }
}

class FailingCloseRegistry extends InMemorySubscriptionRegistry {
  closeCalls = 0;

  override close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.reject(new Error("close failed"));
  }
}
