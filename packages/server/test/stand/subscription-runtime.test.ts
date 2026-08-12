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
import { SubscriptionIdSchema } from "@spine-event-engine/proto/client";
import { describe, expect, it, vi } from "vitest";

import {
  SubscriptionRuntime,
  subscriptionRuntimeAccess,
} from "../../src/stand/subscription-runtime.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";

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
  it("warns once when detached initial reconciliation fails", async () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      new FailingSnapshotRegistry(),
    );
    subscriptionRuntimeAccess.installLogger(runtime, logger as never);

    runtime.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "subscription.reconcile",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("Subscription reconciliation failed.");
    await runtime.close();
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
      runtime.start();
      await Promise.resolve();
      await Promise.resolve();
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

  it("exposes its registry and ignores a failed timer reconciliation", async () => {
    vi.useFakeTimers();
    const registry = new FailingSnapshotRegistry();
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const runtime = new SubscriptionRuntime(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      registry,
    );
    subscriptionRuntimeAccess.installLogger(runtime, logger as never);
    expect(runtime.registry()).toBe(registry);
    runtime.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(logger.withMetadata).toHaveBeenNthCalledWith(1, {
      operation: "subscription.reconcile",
      reasonCode: "failed",
    });
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

class FailingCloseRegistry extends InMemorySubscriptionRegistry {
  closeCalls = 0;

  override close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.reject(new Error("close failed"));
  }
}

class FailingSnapshotRegistry extends InMemorySubscriptionRegistry {
  override snapshot() {
    return Promise.reject(new Error("snapshot failed"));
  }
}
