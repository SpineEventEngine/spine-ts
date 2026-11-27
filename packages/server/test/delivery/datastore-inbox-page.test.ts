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

import { randomUUID } from "node:crypto";
import { Datastore, DatastoreClient } from "@google-cloud/datastore";
import { InboxMessageStatus } from "@spine-event-engine/proto/delivery";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { afterEach, expect, it, vi } from "vitest";

import { InboxRecords, inboxRecordSpec } from "../../src/delivery/inbox-records.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "./inbox-message-fixture.js";

afterEach(() => vi.restoreAllMocks());

it("continues a partial native reply and uses its revisions when a handler finishes", async () => {
  const client = new Datastore({ projectId: "inbox-page-contract" });
  const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
  const save = vi.spyOn(client, "save").mockResolvedValue([] as never);
  const query = vi.spyOn(DatastoreClient.prototype, "runQuery");
  const commit = vi.spyOn(DatastoreClient.prototype, "commit");
  const lookup = vi.spyOn(DatastoreClient.prototype, "lookup");
  const inbox = new InboxStorage({
    context: { name: "InboxPage", multitenant: false },
    storageFactory: factory,
    now: () => new Date(100_000),
  });
  try {
    const first = createMessage(randomUUID(), randomUUID(), 1n);
    const second = createMessage(randomUUID(), randomUUID(), 2n);
    for (const message of [first, second]) await inbox.write(message);
    const results = save.mock.calls.map(([input], index) => {
      const saved = input as { key: { name: string }; data: { bytes: Uint8Array } };
      return {
        version: String(index + 1),
        entity: {
          key: { path: [{ name: saved.key.name }] },
          properties: {
            status: { integerValue: InboxMessageStatus.TO_DELIVER },
            bytes: { blobValue: saved.data.bytes },
          },
        },
      };
    });
    const cursor = Buffer.from([0x80, 0x20]);
    query
      .mockResolvedValueOnce([
        { batch: { entityResults: [results[0]], moreResults: "NOT_FINISHED", endCursor: cursor } },
      ] as never)
      .mockResolvedValueOnce([
        { batch: { entityResults: [results[1]], moreResults: "NO_MORE_RESULTS" } },
      ] as never);
    const page = await inbox.read(ShardIndex.single(), { limit: 2 });
    expect(page.map(({ id }) => id.value)).toEqual([first.id.value, second.id.value]);
    expect(query.mock.calls[1]?.[0]).toMatchObject({
      query: { startCursor: cursor, limit: { value: 1 } },
    });
    const [pending, duplicate] = page;
    if (!pending || !duplicate) throw new Error("Expected both pending messages.");
    // A dropped connection gives the worker no completion result.
    commit.mockRejectedValueOnce(Object.assign(new Error("Datastore unavailable"), { code: 14 }));
    await expect(inbox.markDelivered(pending)).rejects.toThrow(
      "Datastore provider operation failed",
    );
    expect(lookup).not.toHaveBeenCalled();

    const conflict = Object.assign(new Error("Version changed"), { code: 9 });
    // A rejected write at an unchanged version must reach the worker as a failure.
    commit.mockRejectedValueOnce(conflict);
    lookup.mockResolvedValueOnce([{ found: [results[0]] }] as never);
    await expect(inbox.markDelivered(pending)).rejects.toThrow(
      "Datastore provider operation failed",
    );
    expect(commit.mock.lastCall?.[0]).toMatchObject({ mutations: [{ baseVersion: "1" }] });

    commit.mockResolvedValueOnce([{ mutationResults: [{}] }] as never);
    const delivered = await inbox.markDelivered(pending);
    expect(delivered?.keepUntil).toEqual(new Date(105_000));
    expect(lookup).toHaveBeenCalledOnce();
    expect(commit.mock.lastCall?.[0]).toMatchObject({
      mutations: [{ baseVersion: "1", propertyMask: { paths: ["status", "when_keep_until"] } }],
    });

    const completed = {
      version: "3",
      entity: {
        properties: {
          status: { integerValue: InboxMessageStatus.DELIVERED },
          when_keep_until: { timestampValue: { seconds: "105", nanos: 0 } },
        },
      },
    };
    commit.mockRejectedValueOnce(conflict);
    lookup.mockResolvedValueOnce([{ found: [completed] }] as never);
    expect((await inbox.markDelivered(pending))?.keepUntil).toEqual(delivered?.keepUntil);
    commit.mockResolvedValueOnce([{ mutationResults: [{ conflictDetected: true }] }] as never);
    lookup.mockResolvedValueOnce([{ found: [completed] }] as never);
    expect(await inbox.removeDuplicate(pending)).toBe(false);

    commit
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce([{ mutationResults: [{}] }] as never);
    lookup.mockResolvedValueOnce([{ found: [{ ...results[1], version: "4" }] }] as never);
    expect(await inbox.removeDuplicate(duplicate)).toBe(true);
    expect(commit.mock.lastCall?.[0]).toMatchObject({
      mutations: [{ baseVersion: "4", delete: results[1]?.entity.key }],
    });

    // A message removed since the page was read has no acknowledgement deadline.
    commit.mockRejectedValueOnce(Object.assign(new Error("Missing entity"), { code: 5 }));
    lookup
      .mockResolvedValueOnce([{ deferred: [results[1]?.entity.key] }] as never)
      .mockResolvedValueOnce([{ missing: [{ entity: { key: results[1]?.entity.key } }] }] as never);
    expect(await inbox.markDelivered(duplicate)).toBeUndefined();
  } finally {
    await inbox.close();
    await factory.close();
  }
});

it("reads the current completion deadline when an ordered query spans native replies", async () => {
  const client = new Datastore({
    projectId: "inbox-page-contract",
    databaseId: "orders",
    namespace: "orders",
  });
  const factory = DatastoreStorageFactory.newBuilder().setClient(client).build();
  const save = vi.spyOn(client, "save").mockResolvedValue([] as never);
  const query = vi.spyOn(DatastoreClient.prototype, "runQuery");
  const inbox = new InboxStorage({
    context: { name: "Orders", multitenant: false },
    storageFactory: factory,
  });
  try {
    const first = createMessage(randomUUID(), randomUUID(), 1n);
    const second = createMessage(randomUUID(), randomUUID(), 2n);
    await inbox.write(second);
    const saved = save.mock.calls[0]?.[0] as { key: { name: string }; data: { bytes: Uint8Array } };
    const stored = {
      key: { path: [{ name: saved.key.name }] },
      properties: {
        bytes: { blobValue: Buffer.from(saved.data.bytes).toString("base64") },
        status: { integerValue: InboxMessageStatus.DELIVERED },
        when_keep_until: { timestampValue: { seconds: "123" } },
      },
    };
    query
      .mockImplementationOnce((request) => {
        expect(request).toMatchObject({
          databaseId: "orders",
          partitionId: { namespaceId: "orders" },
          query: { offset: 1, limit: { value: 1 } },
        });
        return Promise.resolve([
          { batch: { moreResults: "NOT_FINISHED", endCursor: "gA==", skippedResults: 1 } },
        ]) as never;
      })
      .mockResolvedValueOnce([
        { batch: { moreResults: "NOT_FINISHED", endCursor: "gQ==" } },
      ] as never)
      .mockResolvedValueOnce([
        {
          batch: {
            moreResults: "NO_MORE_RESULTS",
            entityResults: [{ entity: stored, version: "2" }],
          },
        },
      ] as never);
    const page = await inbox.read(ShardIndex.single(), {
      limit: 1,
      offset: 1,
      statuses: ["DELIVERED"],
      after: {
        messageId: first.id.value,
        whenReceived: first.whenReceived,
        version: first.version,
      },
    });
    expect(page).toMatchObject([
      { id: second.id, status: "DELIVERED", keepUntil: new Date(123_000) },
    ]);
    expect(query.mock.lastCall?.[0]).toMatchObject({
      query: { offset: 0, startCursor: "gQ==", limit: { value: 1 } },
    });

    const lookups = vi.spyOn(DatastoreClient.prototype, "lookup");
    lookups.mockResolvedValueOnce([{ found: [{ entity: stored, version: "2" }] }] as never);
    expect((await inbox.markDelivered(second))?.keepUntil).toEqual(new Date(123_000));
    await expect(inbox.read(ShardIndex.single(), { statuses: [] })).resolves.toEqual([]);
    expect(query).toHaveBeenCalledTimes(3);
    const completed = page[0];
    if (!completed) throw new Error("Expected the delivered inbox message.");
    expect(await inbox.removeDuplicate(completed)).toBe(false);

    // Once only retained completions remain, the work query returns no message.
    query.mockResolvedValueOnce([{ batch: { moreResults: "NO_MORE_RESULTS" } }] as never);
    expect(await inbox.newestPending(ShardIndex.single())).toBeUndefined();
    expect(query.mock.lastCall?.[0]).toMatchObject({
      query: {
        limit: { value: 1 },
        order: [
          { property: { name: "when_received_seconds" }, direction: "DESCENDING" },
          { property: { name: "when_received_nanos" }, direction: "DESCENDING" },
          { property: { name: "version" }, direction: "DESCENDING" },
          { property: { name: "message_id" }, direction: "DESCENDING" },
          { property: { name: "__key__" }, direction: "ASCENDING" },
        ],
      },
    });

    const record = InboxRecords.write(second);
    if (!record.id) throw new Error("Expected an inbox message ID.");
    const records = factory.createRecordStorage(
      { name: "Orders", multitenant: false },
      inboxRecordSpec,
    );
    const properties = {
      ...saved.data,
      status: InboxMessageStatus.DELIVERED,
      when_keep_until: new Date(123_000),
    };
    const tx = {
      run: vi.fn(),
      get: vi.fn().mockResolvedValue([properties]),
      rollback: vi.fn(),
      commit: vi.fn(),
      delete: vi.fn(),
    };
    vi.spyOn(client, "transaction").mockReturnValue(tx as never);
    vi.spyOn(client, "get").mockResolvedValue([properties] as never);
    try {
      const current = await records.read(record.id);
      expect(current?.status).toBe(InboxMessageStatus.DELIVERED);
      expect(await records.compareAndSet(record.id, record, undefined)).toBe(false);
      expect(tx.delete).not.toHaveBeenCalled();
      expect(await records.compareAndSet(record.id, current, undefined)).toBe(true);
      expect(tx.delete).toHaveBeenCalledOnce();
    } finally {
      records.close();
    }
  } finally {
    await inbox.close();
    await factory.close();
  }
});
