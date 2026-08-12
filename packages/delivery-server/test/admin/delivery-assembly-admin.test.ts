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
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import {
  PickUpShardSchema,
  ReleaseShardSchema,
  RemoveMessageSchema,
  ShardStatus,
  WriteMessageSchema,
  type ShardInfoList,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
  type ShardIndex,
} from "@spine-event-engine/proto/delivery";

import { DeliveryAssembly } from "../../src/server/assembly.js";

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
    await assembly.shards.pickShard(create(PickUpShardSchema, { shard: second, worker }), context);
    await assembly.shards.releaseSession(
      create(ReleaseShardSchema, { shard: second, worker }),
      context,
    );

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

  it("discards a real mutation before ACK eligibility and publishes the later complete count", async () => {
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
});

function message(uuid: string, shard: ShardIndex) {
  return create(InboxMessageSchema, {
    id: { uuid, index: shard },
    signalId: { value: "signal" },
    inboxId: { entityId: { id: { typeUrl: "example.Entity" } }, typeUrl: "example.State" },
    payload: { case: "command", value: {} },
    label: 1,
    whenReceived: { seconds: 0n, nanos: 0 },
    status: InboxMessageStatus.TO_DELIVER,
  });
}
