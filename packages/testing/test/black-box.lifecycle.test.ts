import { describe, expect, it } from "vitest";

import {
  createTestBlackBox,
  openTestBlackBox,
  trackTestHandle,
} from "../src/black-box/black-box.js";

describe("BlackBox lifecycle seams", () => {
  it("aggregates subscription, client, and server cleanup failures", async () => {
    const subscriptionFailure = new Error("subscription");
    const clientFailure = new Error("client");
    const serverFailure = new Error("server");
    const blackBox = createTestBlackBox({
      client: { close: async () => Promise.reject(clientFailure) },
      server: { close: async () => Promise.reject(serverFailure) },
      subscriptions: [{ cancel: async () => Promise.reject(subscriptionFailure) }],
    });

    const failure = await blackBox.close().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      subscriptionFailure,
      clientFailure,
      serverFailure,
    ]);
  });

  it("cleans an acquired server when connection startup fails", async () => {
    const primary = new Error("connect");
    const cleanup = new Error("server cleanup");

    const failure = await openTestBlackBox({
      start: async () => ({ close: async () => Promise.reject(cleanup) }),
      connect: () => {
        throw primary;
      },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([primary, cleanup]);
  });

  it("releases a returned tracked handle and rejects unsupported activation", async () => {
    let cancellations = 0;
    const blackBox = createTestBlackBox({
      client: { close: async () => {} },
      server: { close: async () => {} },
    });
    const tracked = trackTestHandle(blackBox, {
      cancel: async () => {
        cancellations++;
      },
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true as const, value: undefined }),
        return: async () => ({ done: true as const, value: undefined }),
      }),
    });

    const activation = tracked as typeof tracked & { activate(): Promise<void> };
    await expect(activation.activate()).rejects.toThrow("does not support activation");
    await expect(tracked[Symbol.asyncIterator]().return?.()).resolves.toMatchObject({ done: true });
    expect(cancellations).toBe(1);
    await blackBox.close();
    expect(cancellations).toBe(1);
  });
});
