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
    client.pageSize = 1;
    client.readPage.mockReset().mockResolvedValueOnce([first]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
      }),
    ).resolves.toEqual([]);
    client.pageSize = 2;
    client.readPage
      .mockReset()
      .mockResolvedValueOnce([first, { ...first, id: { ...first.id, value: "tied" } }]);
    await expect(inbox.read(ShardIndex.single())).rejects.toBeInstanceOf(DeliveryPagingError);
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

  it("continues a bounded page from an exact cursor and forwards remote read bounds", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const first = domainMessage("first");
    const second = { ...domainMessage("second"), whenReceived: new Date(2_000) };
    const third = { ...domainMessage("third"), whenReceived: new Date(3_000) };

    client.readPage.mockResolvedValueOnce([first, second, third]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
        limit: 2,
        statuses: ["TO_DELIVER"],
        signal: new AbortController().signal,
        timeoutMs: 25,
      }),
    ).resolves.toEqual([second, third]);
    expect(client.readPage).toHaveBeenNthCalledWith(
      1,
      ShardIndex.single(),
      expect.objectContaining({ pageSize: 3, timeoutMs: 25 }),
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

  it("removes an exact pending duplicate without acknowledging it", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    client.findOne.mockResolvedValueOnce(duplicate);

    await expect(
      inbox.removeDuplicate(duplicate, { kind: "EXCLUSIVE", shard: duplicate.shard }),
    ).resolves.toBe(true);
    expect(client.removeOne).toHaveBeenCalledWith(duplicate, undefined);
    expect(client.writeOne).not.toHaveBeenCalled();
  });

  it("does not remove a changed row or a row outside the current shard session", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    client.findOne.mockResolvedValueOnce({ ...duplicate, version: duplicate.version + 1n });

    await expect(
      inbox.removeDuplicate(duplicate, { kind: "EXCLUSIVE", shard: duplicate.shard }),
    ).resolves.toBe(false);
    await expect(
      inbox.removeDuplicate(duplicate, {
        kind: "EXCLUSIVE",
        shard: new ShardIndex(0, duplicate.shard.ofTotal + 1),
      }),
    ).resolves.toBe(false);
    expect(client.removeOne).not.toHaveBeenCalled();
    expect(client.findOne).toHaveBeenCalledTimes(1);
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

    await expect(inbox.removeDelivered(retained, {} as never)).resolves.toBe(false);
    client.findOne.mockResolvedValueOnce(expired);
    await expect(
      inbox.removeDelivered(expired, { kind: "EXCLUSIVE", shard: expired.shard } as never),
    ).resolves.toBe(true);
    expect(client.removeOne).toHaveBeenCalledWith(expired, undefined);

    await expect(
      inbox.removeDelivered(expired, { kind: "LEASED", shard: expired.shard } as never),
    ).resolves.toBe(false);
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
