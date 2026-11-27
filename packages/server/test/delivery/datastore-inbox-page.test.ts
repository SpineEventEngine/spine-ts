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
