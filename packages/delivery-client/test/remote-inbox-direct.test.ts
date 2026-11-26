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

import { describe, expect, it, vi } from "vitest";
import { ShardIndex } from "@spine-event-engine/server";
import { create } from "@bufbuild/protobuf";
import { DurationSchema, TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { Time } from "@spine-event-engine/core/time";

import { DeliveryPagingError, DeliveryProtocolError } from "../src/client/types.js";
import type { DeliveryClient } from "../src/client/client.js";
import { RemoteInbox, RemoteWorkRegistry } from "../src/remote/adapters.js";
import { DeliveryMessageCodec } from "../src/wire/codec.js";
import { domainMessage } from "./shared-fixtures.js";

class Client {
  readonly writeOne = vi.fn<DeliveryClient["writeOne"]>();
  readonly removeOne = vi.fn<DeliveryClient["removeOne"]>();
  readonly findOne = vi.fn<DeliveryClient["findOne"]>();
  readonly newestPending = vi.fn<DeliveryClient["newestPending"]>();
  readonly readPage = vi.fn<DeliveryClient["readPage"]>();
  readonly acknowledgeGuarded = vi.fn<DeliveryClient["acknowledgeGuarded"]>();
  readonly removeDuplicateGuarded = vi.fn<DeliveryClient["removeDuplicateGuarded"]>();
  readonly removeDeliveredGuarded = vi.fn<DeliveryClient["removeDeliveredGuarded"]>();
  readonly pickUpForDelivery = vi.fn<DeliveryClient["pickUpForDelivery"]>((shard, worker) =>
    Promise.resolve({
      kind: "PICKED" as const,
      session: Object.freeze({
        kind: "EXCLUSIVE" as const,
        shard,
        worker,
        whenPicked: create(TimestampSchema, { seconds: 1n }),
        sessionId: "fixture-session",
        lifetime: create(DurationSchema, { seconds: 60n }),
      }),
    }),
  );
  pageSize = 2;
}

/**
 * Creates matching remote adapters and one managed local session.
 *
 * @param client Supplies the recording client.
 * @returns The Inbox adapter and acquired session.
 */
async function guarded(client: Client) {
  const inbox = new RemoteInbox(client as never);
  const registry = new RemoteWorkRegistry(client as never);
  const session = await registry.pickUp(
    ShardIndex.single(),
    create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" }),
  );
  if (session === undefined) throw new Error("Expected a managed session.");
  return { inbox, session };
}

/**
 * Recreates the detached result of a remote Inbox read.
 *
 * @param message Supplies the authored row.
 * @returns A domain row with its exact wire snapshot retained.
 */
function read(message: ReturnType<typeof domainMessage>) {
  return DeliveryMessageCodec.decode(DeliveryMessageCodec.encode(message), message.shard);
}

describe("RemoteInbox direct behavior", () => {
  it("keeps a definitive no-work pickup distinct from a granted session", async () => {
    const client = new Client();
    const registry = new RemoteWorkRegistry(client as never);
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
    client.pickUpForDelivery.mockResolvedValue({ kind: "NO_WORK" });
    await expect(registry.pickUpForWork(ShardIndex.single(), worker)).resolves.toEqual({
      kind: "NO_WORK",
    });
    await expect(registry.pickUp(ShardIndex.single(), worker)).resolves.toBeUndefined();
    expect(client.pickUpForDelivery).toHaveBeenCalledTimes(2);
  });

  it("returns the server's newest pending row without changing its exact shard identity", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const shard = ShardIndex.single();
    const row = read(domainMessage("newest-pending"));
    client.newestPending.mockResolvedValue(row);
    await expect(inbox.newestPending(shard)).resolves.toBe(row);
    expect(client.newestPending).toHaveBeenCalledExactlyOnceWith(shard, undefined);
  });

  it("refuses an excluded full page with an unsafe tied-time continuation", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const whenReceived = create(TimestampSchema, { seconds: 2n, nanos: 42 });
    const first = { ...domainMessage("tie-a"), status: "DELIVERED" as const, whenReceived };
    const second = { ...domainMessage("tie-b"), status: "DELIVERED" as const, whenReceived };
    client.readPage.mockResolvedValueOnce([first, second]);
    await expect(
      inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
    expect(client.readPage).toHaveBeenCalledOnce();
  });

  it("refuses an exclusive continuation before Protobuf's earliest timestamp", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: "first",
          whenReceived: create(TimestampSchema, { seconds: -62_135_596_800n, nanos: 0 }),
          version: 1n,
        },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
    expect(client.readPage).not.toHaveBeenCalled();
  });

  it("stops a filtered multi-page read when the total deadline expires between pages", async () => {
    let now = 0;
    const previous = Time.setProvider({
      currentTime: () => create(TimestampSchema),
      monotonicTime: () => now,
    });
    try {
      const client = new Client();
      const inbox = new RemoteInbox(client as never);
      const first = { ...domainMessage("early"), status: "DELIVERED" as const };
      const second = {
        ...domainMessage("later"),
        status: "DELIVERED" as const,
        whenReceived: create(TimestampSchema, { seconds: 2n }),
      };
      client.readPage.mockImplementationOnce(() => {
        now = 30_001;
        return Promise.resolve([first, second]);
      });
      await expect(
        inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"], timeoutMs: 30_000 }),
      ).rejects.toThrow("Delivery Inbox read timed out.");
      expect(client.readPage).toHaveBeenCalledOnce();
    } finally {
      Time.setProvider(previous);
    }
  });

  it("receives a pending message without a supplied completion deadline", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = { ...domainMessage("new"), keepUntil: new Date(30_000) };

    const received = await inbox.receive(pending);

    expect(received.message.keepUntil).toBeUndefined();
    expect(client.writeOne.mock.calls[0]?.[0].keepUntil).toBeUndefined();
  });

  it("uses the server completion and exact read snapshot on retry", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const pending = read(domainMessage("completed"));
    const completedWire = DeliveryMessageCodec.encode({
      ...pending,
      status: "DELIVERED",
      keepUntil: new Date(125_000),
    });
    client.acknowledgeGuarded.mockResolvedValue(
      DeliveryMessageCodec.decode(completedWire, pending.shard),
    );

    const first = await inbox.markDelivered(pending, undefined, session);
    const second = await inbox.markDelivered(pending, undefined, session);
    expect(first?.keepUntil).toEqual(new Date(125_000));
    expect(second).toEqual(first);
    expect(client.acknowledgeGuarded).toHaveBeenCalledTimes(2);
    expect(client.acknowledgeGuarded.mock.calls[0]?.[1]).toEqual(pending);
    expect(client.writeOne).not.toHaveBeenCalled();
    expect(client.findOne).not.toHaveBeenCalled();
  });

  it("returns complete tied-time pages without requiring another timestamp page", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const received = create(TimestampSchema, { seconds: 1n, nanos: 123_456_000 });
    const first = { ...domainMessage("first"), whenReceived: received };
    const second = { ...domainMessage("second"), whenReceived: received };
    client.readPage.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([first, second]);

    await expect(inbox.read(ShardIndex.single(), { limit: 2 })).resolves.toEqual([first, second]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
        limit: 1,
      }),
    ).resolves.toEqual([second]);
    expect(client.readPage).toHaveBeenCalledTimes(2);
  });

  it("continues through the JVM timestamp page request", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const first = {
      ...domainMessage("first"),
      whenReceived: create(TimestampSchema, { seconds: 1n, nanos: 123_456_000 }),
    };
    const second = {
      ...domainMessage("second"),
      whenReceived: create(TimestampSchema, { seconds: 1n, nanos: 123_457_000 }),
    };
    client.readPage.mockResolvedValueOnce([first, second]);
    const read = await inbox.read(ShardIndex.single(), {
      after: {
        messageId: first.id.value,
        whenReceived: first.whenReceived,
        version: first.version,
      },
      limit: 1,
    });
    expect(read).toEqual([second]);
    expect(read[0]?.whenReceived.seconds).toBe(1n);
    expect(read[0]?.whenReceived.nanos).toBe(123_457_000);
    expect(client.readPage.mock.calls[0]?.[0]).toEqual(ShardIndex.single());
    expect(client.readPage.mock.calls[0]?.[1]?.sinceWhen).toEqual(
      create(TimestampSchema, {
        seconds: first.whenReceived.seconds,
        nanos: first.whenReceived.nanos - 1,
      }),
    );
  });

  it("writes, reads filtered pages, rejects broken continuations, and delegates exact reads", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const first = domainMessage("first");
    const second = {
      ...domainMessage("second"),
      status: "DELIVERED" as const,
      whenReceived: timestampFromDate(new Date(2_000)),
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
    client.pageSize = 1;
    client.readPage.mockReset().mockResolvedValueOnce([]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
      }),
    ).rejects.toBeInstanceOf(DeliveryPagingError);
    client.pageSize = 2;
    const tied = { ...domainMessage("tied"), whenReceived: timestampFromDate(new Date(2_000)) };
    client.readPage.mockReset().mockResolvedValueOnce([first, tied]);
    await expect(inbox.read(ShardIndex.single())).resolves.toEqual([first, tied]);
    client.findOne.mockResolvedValueOnce(first);
    await expect(inbox.readMessage(first.id)).resolves.toBe(first);
  });

  it("returns a stale-row result without a raw write", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const pending = read(domainMessage("pending"));
    client.acknowledgeGuarded.mockResolvedValue(undefined);

    await expect(inbox.markDelivered(pending, undefined, session)).resolves.toBeUndefined();
    expect(client.acknowledgeGuarded).toHaveBeenCalledOnce();
    expect(client.writeOne).not.toHaveBeenCalled();
  });

  it("accepts an idempotent completed result from the guarded service", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const pending = read(domainMessage("pending"));
    client.acknowledgeGuarded.mockResolvedValue(
      read({
        ...pending,
        status: "DELIVERED",
        keepUntil: new Date(5_000),
      }),
    );

    await expect(inbox.markDelivered(pending, undefined, session)).resolves.toMatchObject({
      status: "DELIVERED",
      keepUntil: new Date(5_000),
    });
    expect(client.writeOne).not.toHaveBeenCalled();
  });

  it("settles an in-flight read when its transport ignores cancellation or the total deadline", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    client.readPage.mockImplementation(() => new Promise(() => undefined));
    const controller = new AbortController();
    const cancelled = inbox.read(ShardIndex.single(), {
      signal: controller.signal,
      timeoutMs: 100,
    });
    controller.abort(new Error("caller cancelled"));
    await expect(cancelled).rejects.toThrow("caller cancelled");

    await expect(inbox.read(ShardIndex.single(), { timeoutMs: 10 })).rejects.toThrow(
      "Delivery Inbox read timed out.",
    );
  }, 500);

  it("rejects invalid or already-cancelled positions before a remote page call", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const anchor = domainMessage("anchor");
    await expect(
      inbox.read(ShardIndex.single(), {
        after: { messageId: " ", whenReceived: anchor.whenReceived, version: anchor.version },
      }),
    ).rejects.toThrow("Delivery page cursor is invalid.");
    const controller = new AbortController();
    controller.abort(new Error("already cancelled"));
    await expect(inbox.read(ShardIndex.single(), { signal: controller.signal })).rejects.toThrow(
      "already cancelled",
    );
    expect(client.readPage).not.toHaveBeenCalled();
  });

  it("stops between full excluded-status pages without requesting the next page", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const controller = new AbortController();
    const excluded = [
      { ...domainMessage("first"), status: "DELIVERED" as const },
      { ...domainMessage("second"), status: "DELIVERED" as const },
    ];
    client.readPage.mockImplementationOnce(() => {
      controller.abort(new Error("between pages"));
      return Promise.resolve(excluded);
    });
    await expect(
      inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER"],
        signal: controller.signal,
      }),
    ).rejects.toThrow("between pages");
    expect(client.readPage).toHaveBeenCalledTimes(1);
  });

  it("passes the exact read row to guarded acknowledgement", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const pending = read(domainMessage("pending"));
    client.acknowledgeGuarded.mockResolvedValue(
      read({
        ...pending,
        status: "DELIVERED",
        keepUntil: new Date(5_000),
      }),
    );

    const delivered = await inbox.markDelivered(pending, { timeoutMs: 50 }, session);
    expect(Object.isFrozen(delivered)).toBe(true);
    expect(client.acknowledgeGuarded).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "fixture-session",
      }),
      pending,
      { timeoutMs: 50 },
    );
    expect(client.findOne).not.toHaveBeenCalled();
  });

  it("removes a pending duplicate only through its guarded RPC", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const duplicate = read(domainMessage("duplicate"));
    client.removeDuplicateGuarded.mockResolvedValue(true);

    await expect(inbox.removeDuplicate(duplicate, undefined, session)).resolves.toBe(true);
    expect(client.removeDuplicateGuarded).toHaveBeenCalledWith(
      expect.anything(),
      duplicate,
      undefined,
    );
    expect(client.removeOne).not.toHaveBeenCalled();
  });

  it("rejects an unbound worker session before dispatch", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = read(domainMessage("duplicate"));
    await expect(inbox.removeDuplicate(duplicate)).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(client.removeDuplicateGuarded).not.toHaveBeenCalled();
    expect(client.removeOne).not.toHaveBeenCalled();
  });

  it("delegates delivered-row eligibility to the guarded server", async () => {
    const client = new Client();
    const { inbox, session } = await guarded(client);
    const retained = read({
      ...domainMessage("retained"),
      status: "DELIVERED",
      keepUntil: new Date(Date.now() + 60_000),
    });
    client.removeDeliveredGuarded.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await expect(inbox.removeDelivered(retained, undefined, session)).resolves.toBe(false);
    await expect(inbox.removeDelivered(retained, undefined, session)).resolves.toBe(true);
    expect(client.removeDeliveredGuarded).toHaveBeenCalledTimes(2);
    expect(client.removeOne).not.toHaveBeenCalled();
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
      { ...valid, lastPicked: create(TimestampSchema, { seconds: 1n, nanos: -1 }) },
      { ...valid, lastPicked: create(TimestampSchema, { seconds: 1n, nanos: 1_000_000_000 }) },
    ]) {
      expect(() => {
        registry.reconcile(observation as never);
      }).toThrow(DeliveryProtocolError);
    }
    expect(() => {
      registry.reconcile({ ...valid, status: "PICKED" });
    }).not.toThrow();
    expect(() => {
      registry.reconcile(valid);
    }).not.toThrow();
  });
});
