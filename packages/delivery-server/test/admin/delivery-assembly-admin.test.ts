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

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  DeliveryShardPickupSchema,
  RemoveMessageSchema,
  ShardStatus,
  WriteMessageSchema,
  WriteMessagesSchema,
  type ShardInfoList,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";

import { DeliveryAssembly } from "../../src/server/assembly.js";
import { domainMessage as message } from "../core/domain-message.js";
import { pickedHandle } from "../session-fixtures.js";

const context = { signal: new AbortController().signal } as never;
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });

describe("delivery assembly Admin projection", () => {
  it("tracks actual counts and prunes released message-free shards from snapshots", async () => {
    const assembly = DeliveryAssembly.create();
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const firstMessage = message("first", first);
    const missing = message("missing", first);

    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: firstMessage }), context);
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: firstMessage }), context);
    await assembly.inbox.removeOne(create(RemoveMessageSchema, { message: missing }), context);
    const pickup = await assembly.managed.pickShardRaw(
      create(DeliveryShardPickupSchema, { shard: second, worker }),
      context,
    );
    await assembly.managed.releaseShardSession(pickedHandle(pickup), context);

    const snapshot = assembly.admin.getShardInfo(create(EmptySchema), context) as ShardInfoList;
    expect(snapshot).toMatchObject({
      shards: [
        {
          index: first,
          status: ShardStatus.NOT_PICKED,
          messages: 1,
        },
      ],
    });
    expect(snapshot.shards).toHaveLength(1);
  });

  it("replays the current shard after ACK and later publishes its changed stored count", async () => {
    const assembly = DeliveryAssembly.create();
    const only = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const iterator = assembly.admin
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();

    await assembly.inbox.writeOne(
      create(WriteMessageSchema, { message: message("before", only) }),
      context,
    );
    await expect(iterator.next()).resolves.toMatchObject({
      value: { value: { case: "created", value: true } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { value: { case: "update", value: { index: only, newMessagesCount: 1 } } },
    });
    const later = iterator.next();
    await assembly.inbox.writeOne(
      create(WriteMessageSchema, { message: message("after", only) }),
      context,
    );
    await expect(later).resolves.toMatchObject({
      value: {
        value: {
          case: "update",
          value: {
            index: only,
            newStatus: ShardStatus.NOT_PICKED,
            newMessagesCount: 2,
          },
        },
      },
    });
    await iterator.return?.();
  });

  it("counts retained delivered upserts in Admin", async () => {
    const assembly = DeliveryAssembly.create();
    const only = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const pending = message("retained", only);
    await assembly.inbox.writeOne(create(WriteMessageSchema, { message: pending }), context);
    await assembly.inbox.writeOne(
      create(WriteMessageSchema, {
        message: {
          ...pending,
          status: InboxMessageStatus.DELIVERED,
          keepUntil: create(TimestampSchema, { seconds: 4_102_444_800n, nanos: 0 }),
        },
      }),
      context,
    );
    expect(assembly.admin.getShardInfo(create(EmptySchema), context)).toMatchObject({
      shards: [{ index: only, messages: 1 }],
    });
  });

  it("counts the final stored identity once after repeated writeMany entries", async () => {
    const assembly = DeliveryAssembly.create();
    const only = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const pending = message("batch-retained", only);
    await assembly.inbox.writeMany(
      create(WriteMessagesSchema, {
        shard: only,
        message: [
          pending,
          {
            ...pending,
            status: InboxMessageStatus.DELIVERED,
            keepUntil: create(TimestampSchema, { seconds: 4_102_444_800n, nanos: 0 }),
          },
        ],
      }),
      context,
    );
    expect(assembly.admin.getShardInfo(create(EmptySchema), context)).toMatchObject({
      shards: [{ index: only, messages: 1 }],
    });
  });
});
