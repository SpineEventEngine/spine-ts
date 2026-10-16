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
import { TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";

import { DeliveryPagingError, DeliveryProtocolError } from "../src/client/types.js";
import type { DeliveryClient } from "../src/client/client.js";
import { RemoteInbox, RemoteWorkRegistry } from "../src/remote/adapters.js";
import { domainMessage } from "./shared-fixtures.js";

class Client {
  readonly writeOne = vi.fn<DeliveryClient["writeOne"]>();
  readonly removeOne = vi.fn<DeliveryClient["removeOne"]>();
  readonly findOne = vi.fn<DeliveryClient["findOne"]>();
  readonly readPage = vi.fn<DeliveryClient["readPage"]>();
  readonly pickUp = vi.fn(() =>
    Promise.resolve({ worker: { nodeId: "node", value: "worker" }, whenPicked: new Date(0) }),
  );
  pageSize = 2;
}

describe("RemoteInbox direct behavior", () => {
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

  it("persists only an exact authoritative pending row as delivered", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = domainMessage("pending");

    client.findOne
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...pending, status: "DELIVERED" });
    await expect(inbox.markDelivered(pending)).resolves.toBeUndefined();
    await expect(inbox.markDelivered(pending)).resolves.toMatchObject({ status: "DELIVERED" });
    client.findOne.mockResolvedValueOnce(pending);
    client.writeOne.mockRejectedValueOnce(new Error("lost"));
    await expect(inbox.markDelivered(pending)).rejects.toThrow("lost");
    expect(client.writeOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: pending.id, status: "DELIVERED" }),
      undefined,
    );
  });

  it("returns an exact already delivered acknowledgement idempotently", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = domainMessage("pending");
    const delivered = { ...pending, status: "DELIVERED" as const };

    client.findOne.mockResolvedValueOnce(delivered);
    await expect(inbox.markDelivered(pending)).resolves.toMatchObject({
      id: pending.id,
      status: "DELIVERED",
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

  it("fences changed authoritative rows and returns an immutable delivered acknowledgement", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const pending = domainMessage("pending");
    const { signal: _signal, ...withoutSignal } = pending;
    void _signal;
    for (const current of [
      { ...pending, id: { ...pending.id, value: "other" } },
      { ...pending, signalId: "other" },
      withoutSignal,
    ]) {
      client.findOne.mockResolvedValueOnce(current);
      await expect(inbox.markDelivered(pending)).resolves.toBeUndefined();
    }
    client.findOne.mockResolvedValueOnce(pending);
    const delivered = await inbox.markDelivered(pending, { timeoutMs: 50 });
    expect(delivered).toMatchObject({ id: pending.id, status: "DELIVERED" });
    expect(Object.isFrozen(delivered)).toBe(true);
    expect(client.writeOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: pending.id, status: "DELIVERED" }),
      { timeoutMs: 50 },
    );
  });

  it("removes a pending duplicate by ID without acknowledging it", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");

    await expect(inbox.removeDuplicate(duplicate)).resolves.toBe(true);
    expect(client.removeOne).toHaveBeenCalledWith(duplicate, undefined);
    expect(client.findOne).not.toHaveBeenCalled();
    expect(client.writeOne).not.toHaveBeenCalled();
  });

  it("sends one removal by ID without reading a mutable row", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    await expect(inbox.removeDuplicate(duplicate)).resolves.toBe(true);
    expect(client.removeOne).toHaveBeenCalledOnce();
    expect(client.findOne).not.toHaveBeenCalled();
  });

  it("retains delivered rows until their finite expiration", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const retained = {
      ...domainMessage("retained"),
      status: "DELIVERED" as const,
      keepUntil: new Date(Date.now() + 60_000),
    };
    const expired = { ...retained, keepUntil: new Date(Date.now() - 1) };

    await expect(inbox.removeDelivered(retained)).resolves.toBe(false);
    await expect(inbox.removeDelivered(expired)).resolves.toBe(true);
    expect(client.removeOne).toHaveBeenCalledWith(expired, undefined);

    await expect(inbox.removeDelivered(expired)).resolves.toBe(true);
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
