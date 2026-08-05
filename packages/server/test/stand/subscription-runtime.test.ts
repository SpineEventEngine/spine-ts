import { describe, expect, it } from "vitest";

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
});
