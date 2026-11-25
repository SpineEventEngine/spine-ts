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
import { describe, expect, it } from "vitest";

import {
  PickUpShardSchema,
  ReleaseExpiredSessionsSchema,
  ReleaseShardSchema,
  RemoveMessageSchema,
  WriteMessagesSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";

import { InMemoryDeliveryState } from "../../src/core/in-memory-delivery-state.js";
import { InboxHandlers } from "../../src/core/inbox-service.js";
import { MutationAdmission } from "../../src/core/mutation-admission.js";
import { ShardHandlers } from "../../src/core/shard-service.js";
import { domainMessage } from "./domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
const message = (uuid: string) => domainMessage(uuid, shard);

describe("Shard transition notifications", () => {
  it("notifies initial pickup, stale takeover, explicit release, and expired release in admission order", async () => {
    let now = 0;
    const transitions: string[] = [];
    const shards = ShardHandlers.create(
      new InMemoryDeliveryState(),
      new MutationAdmission(),
      () => now,
      10,
      (value) => transitions.push(`${String(value.index)}/${String(value.ofTotal)}`),
    );
    const pick = () => shards.pickShard(create(PickUpShardSchema, { shard, worker }), context);
    await pick();
    now = 11;
    await pick();
    await shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await pick();
    now = 21;
    await shards.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 10_000_000 },
      }),
      context,
    );
    expect(transitions).toEqual(["0/1", "0/1", "0/1", "0/1", "0/1"]);
  });

  it("does not notify failed pickup or missing release", async () => {
    const transitions: number[] = [];
    const shards = ShardHandlers.create(
      new InMemoryDeliveryState(),
      new MutationAdmission(),
      () => 0,
      0,
      (value) => transitions.push(value.index),
    );
    const request = create(PickUpShardSchema, { shard, worker });
    await shards.releaseSession(create(ReleaseShardSchema, { shard, worker }), context);
    await shards.pickShard(request, context);
    await shards.pickShard(request, context);
    expect(transitions).toEqual([0]);
  });
});

describe("Inbox transition notifications", () => {
  it("separates stored-row and pending-work transitions per committed batch", async () => {
    const stored: number[] = [];
    const work: number[] = [];
    const inbox = InboxHandlers.create(
      new InMemoryDeliveryState(),
      new MutationAdmission(),
      (value) => {
        stored.push(value.index);
      },
      (value) => {
        work.push(value.index);
      },
    );
    await inbox.writeMany(
      create(WriteMessagesSchema, { shard, message: [message("a"), message("b"), message("a")] }),
      context,
    );
    await inbox.writeOne(create(WriteMessageSchema, { message: message("a") }), context);
    await inbox.removeOne(create(RemoveMessageSchema, { message: message("a") }), context);
    await inbox.removeOne(create(RemoveMessageSchema, { message: message("a") }), context);
    await inbox.writeOne(
      create(WriteMessageSchema, {
        message: domainMessage("done", shard, 0, 0, InboxMessageStatus.DELIVERED),
      }),
      context,
    );
    expect(stored).toEqual([0, 0, 0, 0]);
    expect(work).toEqual([0, 0, 0]);
  });
});
