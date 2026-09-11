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
import { domainMessage, stringTarget } from "./shared-fixtures.js";

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
    ).rejects.toBeInstanceOf(DeliveryPagingError);
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

    client.readPage.mockResolvedValueOnce([first, second]).mockResolvedValueOnce([second, third]);
    await expect(
      inbox.read(ShardIndex.single(), {
        after: {
          messageId: first.id.value,
          whenReceived: first.whenReceived,
          version: first.version,
        },
        limit: 2,
        signal: new AbortController().signal,
        timeoutMs: 25,
      }),
    ).resolves.toEqual([second, third]);
    expect(client.readPage).toHaveBeenNthCalledWith(
      1,
      ShardIndex.single(),
      expect.objectContaining({ pageSize: 2, timeoutMs: 25 }),
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

  it("suppresses a live delivered duplicate for the same typed target", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const delivered = { ...domainMessage("delivered"), status: "DELIVERED" as const };
    const duplicate = { ...domainMessage("duplicate"), signalId: delivered.signalId };

    client.readPage.mockResolvedValueOnce([delivered]);
    await expect(inbox.admit(duplicate)).resolves.toBeUndefined();
    expect(client.writeOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: duplicate.id, status: "DELIVERED" }),
      undefined,
    );

    client.readPage.mockResolvedValueOnce([]);
    await expect(inbox.admit({ ...duplicate, signalId: "different-signal" })).resolves.toEqual(
      expect.objectContaining({ signalId: "different-signal" }),
    );

    client.readPage.mockResolvedValueOnce([delivered]);
    await expect(
      inbox.admit({
        ...duplicate,
        inboxId: { ...duplicate.inboxId, targetId: stringTarget("different-target") },
      }),
    ).resolves.toMatchObject({ id: duplicate.id });
  });

  it("stops after cancellation during a page without another read or retained delivery", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    const controller = new AbortController();
    const reason = new Error("Admission was cancelled by the caller.");
    client.readPage.mockImplementationOnce(() => {
      controller.abort(reason);
      return Promise.resolve([
        { ...domainMessage("first"), signalId: "other-1" },
        { ...domainMessage("second"), signalId: "other-2" },
      ]);
    });

    await expect(inbox.admit(duplicate, { signal: controller.signal })).rejects.toBe(reason);
    expect(client.readPage).toHaveBeenCalledTimes(1);
    expect(client.writeOne).not.toHaveBeenCalled();
  });

  it("stops admission at its deadline after a page without reading another page or retaining delivery", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1);
    client.readPage.mockResolvedValueOnce([
      { ...domainMessage("first"), signalId: "other-1" },
      { ...domainMessage("second"), signalId: "other-2" },
    ]);

    await expect(inbox.admit(duplicate, { timeoutMs: 1 })).rejects.toThrow(
      "Delivery admission deadline expired.",
    );
    expect(client.readPage).toHaveBeenCalledTimes(1);
    expect(client.writeOne).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("does not admit from a short page after its deadline expires during scanning", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    const expired = {
      ...domainMessage("expired"),
      signalId: duplicate.signalId,
      status: "DELIVERED" as const,
      keepUntil: new Date(-1),
    };
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(1);
    client.readPage.mockResolvedValueOnce([expired]);

    await expect(inbox.admit(duplicate, { timeoutMs: 1 })).rejects.toThrow(
      "Delivery admission deadline expired.",
    );
    expect(client.readPage).toHaveBeenCalledTimes(1);
    expect(client.writeOne).not.toHaveBeenCalled();
    now.mockRestore();
  });

  it("passes the remaining admission budget to its delivered read and upsert", async () => {
    const client = new Client();
    const inbox = new RemoteInbox(client as never);
    const duplicate = domainMessage("duplicate");
    const delivered = { ...domainMessage("delivered"), status: "DELIVERED" as const };
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(2)
      .mockReturnValueOnce(3);
    client.readPage.mockResolvedValueOnce([delivered]);

    await expect(inbox.admit(duplicate, { timeoutMs: 5 })).resolves.toBeUndefined();
    expect(client.readPage).toHaveBeenCalledWith(
      ShardIndex.single(),
      expect.objectContaining({ timeoutMs: 5 }),
    );
    expect(client.writeOne).toHaveBeenCalledWith(
      expect.objectContaining({ id: duplicate.id, status: "DELIVERED" }),
      { timeoutMs: 2 },
    );
    now.mockRestore();
  });

  it.each([1, 2, 17, 1_000])(
    "finds a matching retained row at new raw candidate 1,000 with page size %i",
    async (pageSize) => {
      const client = new Client();
      client.pageSize = pageSize;
      const inbox = new RemoteInbox(client as never);
      const duplicate = { ...domainMessage("duplicate"), signalId: "matching-signal" };
      const candidates = retainedCandidates(1_000, duplicate, 1_000);
      serveRawCandidates(client, candidates);

      await expect(inbox.admit(duplicate)).resolves.toBeUndefined();
      expect(client.writeOne).toHaveBeenCalledWith(
        expect.objectContaining({ id: duplicate.id, status: "DELIVERED" }),
        undefined,
      );
      if (pageSize === 1)
        expect(client.readPage).toHaveBeenNthCalledWith(
          2,
          ShardIndex.single(),
          expect.objectContaining({ pageSize: 2 }),
        );
    },
  );

  it.each([1, 2, 17, 1_000])(
    "fails closed after 1,000 new raw misses without reading candidate 1,001 with page size %i",
    async (pageSize) => {
      const client = new Client();
      client.pageSize = pageSize;
      const inbox = new RemoteInbox(client as never);
      const duplicate = { ...domainMessage("duplicate"), signalId: "matching-signal" };
      const candidates = retainedCandidates(1_001, duplicate);
      const returned: string[] = [];
      serveRawCandidates(client, candidates, returned);

      await expect(inbox.admit(duplicate)).rejects.toBeInstanceOf(DeliveryPagingError);
      expect(client.writeOne).not.toHaveBeenCalled();
      expect(returned).not.toContain("candidate-1001");
    },
  );

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

function retainedCandidates(
  count: number,
  duplicate: ReturnType<typeof domainMessage>,
  matchingCandidate?: number,
) {
  return Array.from({ length: count }, (_, index) => ({
    ...domainMessage(`candidate-${String(index + 1)}`),
    ...(index + 1 === matchingCandidate
      ? { signalId: duplicate.signalId, inboxId: duplicate.inboxId }
      : { signalId: `unrelated-${String(index + 1)}` }),
    status: "DELIVERED" as const,
    whenReceived: new Date(10_000 + index),
  }));
}

function serveRawCandidates(
  client: Client,
  candidates: readonly ReturnType<typeof domainMessage>[],
  returned: string[] = [],
): void {
  client.readPage.mockImplementation((_shard, options = {}) => {
    const { pageSize, sinceWhen } = options;
    if (pageSize === undefined) throw new Error("Expected a bounded remote page size.");
    const start =
      sinceWhen === undefined
        ? 0
        : candidates.findIndex(
            (candidate) => candidate.whenReceived.getTime() > sinceWhen.getTime(),
          );
    const page = candidates.slice(start < 0 ? candidates.length : start, start + pageSize);
    returned.push(...page.map((candidate) => candidate.id.value));
    return Promise.resolve(page);
  });
}
