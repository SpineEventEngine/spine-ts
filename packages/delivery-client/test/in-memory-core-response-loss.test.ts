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

import { createRouterTransport, ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it, vi } from "vitest";
import {
  InboxService,
  ShardService,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import { InboxMessageStatus } from "@spine-event-engine/proto/delivery";
import { Time } from "@spine-event-engine/core/time";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import {
  ShardIndex,
  type DeliveryWorkSession,
  type InboxMessage,
} from "@spine-event-engine/server";
import { deliveryPortAccess } from "@spine-event-engine/server/spi/delivery";
import { DeliveryClient, DeliveryOutcomeUnknownError } from "../src/client/client.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { DeliveryMessageCodec } from "../src/wire/codec.js";
import { domainMessage } from "./shared-fixtures.js";

const session = { kind: "EXCLUSIVE", shard: ShardIndex.single() } as DeliveryWorkSession;

type PageOperation = (
  messages: readonly InboxMessage[],
  session: DeliveryWorkSession,
  options: undefined,
  process: (isRecent: (message: InboxMessage) => boolean) => Promise<boolean>,
  onWritesStored: (deadlineNs: (message: InboxMessage) => bigint | undefined) => void,
) => Promise<boolean>;

function pageOperation(inbox: RemoteInbox): PageOperation {
  return (inbox as RemoteInbox & { [deliveryPortAccess]: PageOperation })[deliveryPortAccess];
}

describe("remote page persistence", () => {
  it("writes changed rows and then removes duplicates in one batch per page", async () => {
    const core = InMemoryDelivery.create();
    const writes = vi.fn(core.inbox.writeMany);
    const removals = vi.fn(core.inbox.removeMany);
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, { ...core.inbox, writeMany: writes, removeMany: removals });
        router.service(ShardService, core.shards);
      }),
    );
    const inbox = new RemoteInbox(client);
    const delivered = domainMessage("page-delivered");
    const duplicate = domainMessage("page-duplicate");
    await client.writeMany([delivered, duplicate]);
    writes.mockClear();
    await pageOperation(inbox)(
      [delivered, duplicate],
      session,
      undefined,
      async () => {
        await inbox.markDelivered(delivered, undefined, session);
        await inbox.removeDuplicate(duplicate, undefined, session);
        return true;
      },
      vi.fn(),
    );
    expect(writes).toHaveBeenCalledTimes(1);
    expect(removals).toHaveBeenCalledTimes(1);
    expect((await client.findOne(delivered.id))?.status).toBe("DELIVERED");
    expect(await client.findOne(duplicate.id)).toBeUndefined();
    client.close();
    core.close();
  });

  it("leaves removals untouched when the page write fails", async () => {
    const core = InMemoryDelivery.create();
    const removals = vi.fn(core.inbox.removeMany);
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, {
          ...core.inbox,
          writeMany: () => {
            throw new ConnectError("store failed", Code.Unavailable);
          },
          removeMany: removals,
        });
        router.service(ShardService, core.shards);
      }),
    );
    const inbox = new RemoteInbox(client);
    const delivered = domainMessage("failed-delivered");
    const duplicate = domainMessage("failed-duplicate");
    await client.writeOne(delivered);
    await client.writeOne(duplicate);
    await expect(
      pageOperation(inbox)(
        [delivered, duplicate],
        session,
        undefined,
        async () => {
          await inbox.markDelivered(delivered, undefined, session);
          await inbox.removeDuplicate(duplicate, undefined, session);
          return true;
        },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(removals).not.toHaveBeenCalled();
    expect((await client.findOne(delivered.id))?.status).toBe("TO_DELIVER");
    expect((await client.findOne(duplicate.id))?.status).toBe("TO_DELIVER");
    client.close();
    core.close();
  });

  it("reports stored completions before a failed removal batch", async () => {
    const core = InMemoryDelivery.create();
    const stored = vi.fn();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, {
          ...core.inbox,
          removeMany: () => {
            throw new ConnectError("removal failed", Code.Unavailable);
          },
        });
        router.service(ShardService, core.shards);
      }),
    );
    const inbox = new RemoteInbox(client);
    const delivered = domainMessage("stored-before-removal");
    const duplicate = domainMessage("still-pending");
    await client.writeMany([delivered, duplicate]);
    const apply = pageOperation(inbox);
    await expect(
      apply(
        [delivered, duplicate],
        session,
        undefined,
        async () => {
          await inbox.markDelivered(delivered, undefined, session);
          await inbox.removeDuplicate(duplicate, undefined, session);
          return true;
        },
        stored,
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(stored).toHaveBeenCalledTimes(1);
    expect((await client.findOne(delivered.id))?.status).toBe("DELIVERED");
    expect((await client.findOne(duplicate.id))?.status).toBe("TO_DELIVER");
    client.close();
    core.close();
  });

  it("compares retained deadlines with full nanosecond precision", async () => {
    const core = InMemoryDelivery.create();
    const removals = vi.fn(core.inbox.removeMany);
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, { ...core.inbox, removeMany: removals });
      }),
    );
    const inbox = new RemoteInbox(client);
    const wire = DeliveryMessageCodec.encode(domainMessage("precise-retention"));
    wire.status = InboxMessageStatus.DELIVERED;
    wire.keepUntil = create(TimestampSchema, { seconds: 1n, nanos: 123_456_789 });
    await core.inbox.writeOne(create(WriteMessageSchema, { message: wire }), {
      signal: new AbortController().signal,
    } as never);
    const row = await client.findOne(domainMessage("precise-retention").id);
    if (row === undefined) throw new Error("Stored row is missing.");
    let now = create(TimestampSchema, { seconds: 1n, nanos: 123_456_789 });
    const prior = Time.setProvider({ currentTime: () => now });
    try {
      const apply = pageOperation(inbox);
      await apply([row], session, undefined, () => Promise.resolve(true), vi.fn());
      expect(removals).not.toHaveBeenCalled();
      now = create(TimestampSchema, { seconds: 1n, nanos: 123_456_790 });
      await apply([row], session, undefined, () => Promise.resolve(true), vi.fn());
      expect(removals).toHaveBeenCalledTimes(1);
    } finally {
      Time.setProvider(prior);
      client.close();
      core.close();
    }
  });

  it("discards a stopped page and lets the same session process a later page", async () => {
    const core = InMemoryDelivery.create();
    const writes = vi.fn(core.inbox.writeMany);
    const removals = vi.fn(core.inbox.removeMany);
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, { ...core.inbox, writeMany: writes, removeMany: removals });
      }),
    );
    const inbox = new RemoteInbox(client);
    const pending = domainMessage("stopped-page");
    await client.writeOne(pending);
    const apply = pageOperation(inbox);
    expect(
      await apply(
        [pending],
        session,
        undefined,
        async () => {
          await inbox.markDelivered(pending, undefined, session);
          return false;
        },
        vi.fn(),
      ),
    ).toBe(false);
    expect(writes).not.toHaveBeenCalled();
    expect(removals).not.toHaveBeenCalled();
    expect((await client.findOne(pending.id))?.status).toBe("TO_DELIVER");
    expect(
      await apply(
        [pending],
        session,
        undefined,
        async () => {
          await inbox.markDelivered(pending, undefined, session);
          return true;
        },
        vi.fn(),
      ),
    ).toBe(true);
    expect((await client.findOne(pending.id))?.status).toBe("DELIVERED");
    client.close();
    core.close();
  });

  it("classifies a mixed page by exact retention deadlines and removes expired completions", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
      }),
    );
    const inbox = new RemoteInbox(client);
    const future = DeliveryMessageCodec.encode(domainMessage("future-retained"));
    future.status = InboxMessageStatus.DELIVERED;
    future.keepUntil = create(TimestampSchema, { seconds: 10n, nanos: 400_000_001 });
    const expired = DeliveryMessageCodec.encode(domainMessage("expired-retained"));
    expired.status = InboxMessageStatus.DELIVERED;
    expired.keepUntil = create(TimestampSchema, { seconds: 10n, nanos: 399_999_999 });
    const undated = DeliveryMessageCodec.encode(domainMessage("undated-retained"));
    undated.status = InboxMessageStatus.DELIVERED;
    await core.inbox.writeMany(
      { message: [future, expired, undated] } as never,
      { signal: new AbortController().signal } as never,
    );
    const rows = await client.readPage(ShardIndex.single());
    const now = create(TimestampSchema, { seconds: 10n, nanos: 400_000_000 });
    const prior = Time.setProvider({ currentTime: () => now });
    try {
      const recent = new Map<string, boolean>();
      const apply = pageOperation(inbox);
      await apply(
        rows,
        session,
        undefined,
        (isRecent) => {
          for (const row of rows) recent.set(row.signalId, isRecent(row));
          return Promise.resolve(true);
        },
        vi.fn(),
      );
      expect(recent).toEqual(
        new Map([
          [domainMessage("future-retained").signalId, true],
          [domainMessage("expired-retained").signalId, false],
          [domainMessage("undated-retained").signalId, false],
        ]),
      );
      expect((await client.findOne(domainMessage("future-retained").id))?.status).toBe("DELIVERED");
      expect(await client.findOne(domainMessage("expired-retained").id)).toBeUndefined();
      expect(await client.findOne(domainMessage("undated-retained").id)).toBeUndefined();
    } finally {
      Time.setProvider(prior);
      client.close();
      core.close();
    }
  });
});
