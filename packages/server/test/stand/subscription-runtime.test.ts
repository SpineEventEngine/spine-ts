import { describe, expect, it, vi } from "vitest";

import { SubscriptionRuntime } from "../../src/stand/subscription-runtime.js";
import { InMemorySubscriptionRegistry } from "../../src/stand/subscription-registry.js";

describe("SubscriptionRuntime", () => {
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

    try {
      runtime.start();
      await registry.cleanupStarted;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(registry.cleanupCalls).toBe(1);
      registry.releaseCleanup();
      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });
});

class GatedCleanupRegistry extends InMemorySubscriptionRegistry {
  cleanupCalls = 0;
  #release: (() => void) | undefined;
  #started: (() => void) | undefined;
  readonly cleanupStarted = new Promise<void>((resolve) => {
    this.#started = resolve;
  });

  releaseCleanup(): void {
    this.#release?.();
  }

  override async cleanup(): Promise<void> {
    this.cleanupCalls++;
    this.#started?.();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
  }
}
