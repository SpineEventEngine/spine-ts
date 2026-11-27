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
import { ShardIndex, type DeliveryWorkSession } from "@spine-event-engine/server";
import { deliveryPortAccess } from "@spine-event-engine/server/spi/delivery";
import { DeliveryClient, DeliveryOutcomeUnknownError } from "../src/client/client.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { DeliveryMessageCodec } from "../src/wire/codec.js";
import { domainMessage } from "./shared-fixtures.js";

const session = { kind: "EXCLUSIVE", shard: ShardIndex.single() } as DeliveryWorkSession;

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
    await (
      inbox as RemoteInbox & {
        [deliveryPortAccess]: (
          messages: readonly import("@spine-event-engine/server").InboxMessage[],
          session: DeliveryWorkSession,
          options: undefined,
          process: () => Promise<boolean>,
          onWritesStored: () => void,
        ) => Promise<boolean>;
      }
    )[deliveryPortAccess](
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
      (
        inbox as RemoteInbox & {
          [deliveryPortAccess]: (
            messages: readonly import("@spine-event-engine/server").InboxMessage[],
            session: DeliveryWorkSession,
            options: undefined,
            process: () => Promise<boolean>,
            onWritesStored: () => void,
          ) => Promise<boolean>;
        }
      )[deliveryPortAccess](
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
    const apply = (
      inbox as RemoteInbox & {
        [deliveryPortAccess]: (
          messages: readonly import("@spine-event-engine/server").InboxMessage[],
          session: DeliveryWorkSession,
          options: undefined,
          process: () => Promise<boolean>,
          onWritesStored: () => void,
        ) => Promise<boolean>;
      }
    )[deliveryPortAccess];
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
      const apply = (
        inbox as RemoteInbox & {
          [deliveryPortAccess]: (
            messages: readonly import("@spine-event-engine/server").InboxMessage[],
            session: DeliveryWorkSession,
            options: undefined,
            process: () => Promise<boolean>,
            onWritesStored: () => void,
          ) => Promise<boolean>;
        }
      )[deliveryPortAccess];
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
});
