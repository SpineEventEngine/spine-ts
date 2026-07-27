import { create } from "@bufbuild/protobuf";
import type { Transport } from "@connectrpc/connect";
import { TopicSchema } from "@spine-event-engine/proto/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => ({
  iterator: undefined as AsyncIterator<unknown> | undefined,
  cancel: vi.fn(async () => {}),
}));

vi.mock("@connectrpc/connect", () => ({
  createClient: () => ({
    subscribe: async (topic: unknown) => ({ id: { value: "wire" }, topic }),
    activate: () => ({ [Symbol.asyncIterator]: () => connect.iterator }),
    cancel: connect.cancel,
  }),
}));

import { Client } from "../src/index.js";

describe("Client iterator disposal", () => {
  beforeEach(() => {
    connect.iterator = undefined;
    connect.cancel.mockClear();
  });

  it("settles cancellation when iterator return rejects after a non-cooperative next", async () => {
    let returns = 0;
    let closed = 0;
    connect.iterator = {
      next: () => new Promise<IteratorResult<unknown>>(() => {}),
      return: () => {
        returns++;
        return Promise.reject(new Error("iterator return rejected"));
      },
    };
    const client = Client.usingTransport({
      transport: {} as Transport,
      createRequestId: () => "iterator-return",
      close: () => closed++,
    });
    const subscription = await client
      .asGuest()
      .createSubscription(create(TopicSchema), { kind: "event" });
    const updates = subscription.updates[Symbol.asyncIterator]();

    await subscription.activate();
    await expect(subscription.cancel()).resolves.toBeUndefined();

    expect(returns).toBe(1);
    expect(connect.cancel).toHaveBeenCalledTimes(1);
    await expect(updates.next()).resolves.toMatchObject({ done: true });
    await expect(client.close()).resolves.toBeUndefined();
    expect(closed).toBe(1);
  });
});
