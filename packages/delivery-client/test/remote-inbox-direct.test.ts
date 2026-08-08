import { describe, expect, it, vi } from "vitest";
import { ShardIndex } from "@spine-event-engine/server";

import { DeliveryPagingError, DeliveryProtocolError } from "../src/client/types.js";
import { RemoteInbox, RemoteWorkRegistry } from "../src/remote/adapters.js";
import { domainMessage } from "./shared-fixtures.js";

class Client {
  readonly writeOne = vi.fn(async () => undefined);
  readonly removeOne = vi.fn(async () => undefined);
  readonly findOne = vi.fn(async () => undefined);
  readonly readPage = vi.fn(async () => []);
  pageSize = 2;
}

describe("RemoteInbox direct behavior", () => {
  it("writes, reads filtered pages, rejects broken continuations, and delegates exact reads", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const first = domainMessage("first");
    const second = {
      ...domainMessage("second"),
      status: "DELIVERED" as const,
      whenReceived: new Date(2_000),
    };

    await expect(inbox.receive(first)).resolves.toMatchObject({ outcome: "WRITTEN" });
    expect(client.writeOne).toHaveBeenCalledTimes(1);
    client.readPage.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second]);
    await expect(inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] })).resolves.toEqual([
      second,
    ]);
    await expect(inbox.read(ShardIndex.single(), { offset: 2 })).rejects.toBeInstanceOf(
      DeliveryPagingError,
    );
    client.readPage
      .mockReset()
      .mockResolvedValueOnce([first, { ...first, id: { ...first.id, value: "tied" } }]);
    await expect(inbox.read(ShardIndex.single())).rejects.toBeInstanceOf(DeliveryPagingError);
    client.findOne.mockResolvedValueOnce(first);
    await expect(inbox.readMessage(first.id)).resolves.toBe(first);
  });

  it("admits only an exact pending row and keeps failed completion active", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = domainMessage("pending");
    const session = Object.freeze({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });

    await expect(
      inbox.begin(pending, { kind: "LEASED", shard: ShardIndex.single() }),
    ).resolves.toBeUndefined();
    client.findOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...pending, status: "DELIVERED" });
    await expect(inbox.begin(pending, session)).resolves.toBeUndefined();
    await expect(inbox.begin(pending, session)).resolves.toBeUndefined();
    client.findOne.mockResolvedValueOnce(pending);
    const work = await inbox.begin(pending, session);
    if (work === undefined) throw new Error("Expected exact remote work.");
    client.removeOne.mockRejectedValueOnce(new Error("lost"));
    await expect(work.complete()).rejects.toThrow("lost");
    expect(work.message).toMatchObject({ id: pending.id });
    await expect(work.abandon()).resolves.toBeUndefined();
    await expect(
      work.synchronize({ kind: "LEASED", shard: ShardIndex.single() }),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
  });

  it("continues a bounded page from an exact cursor and forwards remote read bounds", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const first = domainMessage("first");
    const second = { ...domainMessage("second"), whenReceived: new Date(2_000) };
    const third = { ...domainMessage("third"), whenReceived: new Date(3_000) };

    client.readPage.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second, third]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
        limit: 2,
        signal: first.signal,
        timeoutMs: 25,
      }),
    ).resolves.toEqual([second, third]);
    expect(client.readPage).toHaveBeenNthCalledWith(
      1,
      ShardIndex.single(),
      expect.objectContaining({ pageSize: 2, signal: first.signal, timeoutMs: 25 }),
    );

    client.readPage.mockResolvedValueOnce([second]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: { messageId: "absent", whenReceived: second.whenReceived, version: second.version },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: second.id.value,
          whenReceived: new Date(-62_135_596_800_000),
          version: 0n,
        },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
  });

  it("fences changed authoritative rows and makes successful completion terminal", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = domainMessage("pending");
    const session = Object.freeze({ kind: "EXCLUSIVE" as const, shard: ShardIndex.single() });

    for (const current of [
      { ...pending, id: { ...pending.id, value: "other" } },
      { ...pending, signalId: "other" },
      { ...pending, signal: undefined },
    ]) {
      client.findOne.mockResolvedValueOnce(current);
      await expect(inbox.begin(pending, session)).resolves.toBeUndefined();
    }
    client.findOne.mockResolvedValueOnce(pending);
    const work = await inbox.begin(pending, session);
    if (work === undefined) throw new Error("Expected exact remote work.");
    await expect(work.complete({ timeoutMs: 50 })).resolves.toBe(true);
    await expect(work.complete()).resolves.toBe(false);
    expect(() => work.message).toThrow(DeliveryProtocolError);
    await expect(work.synchronize(session)).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(client.removeOne).toHaveBeenCalledWith(pending, { timeoutMs: 50 });
  });

  it("rejects malformed shard observations before they can change remote ownership", () => {
    const registry = new RemoteWorkRegistry(new Client() as never);
    const valid = { shard: ShardIndex.single(), status: "NOT_PICKED" as const, messages: 0 };

    for (const observation of [
      { ...valid, shard: {} },
      { ...valid, messages: -1 },
      { ...valid, messages: 1.5 },
      { ...valid, lastPicked: {} },
      { ...valid, lastPicked: new Date(Number.NaN) },
    ]) {
      expect(() => registry.reconcile(observation as never)).toThrow(DeliveryProtocolError);
    }
    expect(() => registry.reconcile({ ...valid, status: "PICKED" })).not.toThrow();
    expect(() => registry.reconcile(valid)).not.toThrow();
  });
});
