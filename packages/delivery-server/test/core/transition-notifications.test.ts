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
  DeliveryShardPickupSchema,
  ReleaseExpiredSessionsSchema,
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
import { ShardSessionRuntime } from "../../src/core/shard-service.js";
import { pickedHandle } from "../session-fixtures.js";
import { domainMessage } from "./domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" });
const message = (uuid: string) => domainMessage(uuid, shard);

describe("Shard transition notifications", () => {
  it("notifies pickup, renewal, release, and explicit expiry in admission order", async () => {
    let nanos = 0;
    const transitions: string[] = [];
    const sessions = new ShardSessionRuntime(
      new InMemoryDeliveryState(),
      new MutationAdmission(),
      () => ({ $typeName: "google.protobuf.Timestamp", seconds: 1n, nanos }),
      10,
      (value) => transitions.push(`${String(value.index)}/${String(value.ofTotal)}`),
    );
    const request = create(DeliveryShardPickupSchema, { shard, worker });
    const first = await sessions.managed.pickShardRaw(request, context);
    const handle = pickedHandle(first);
    nanos = 1_000_000;
    await sessions.managed.renewShardSession(handle, context);
    await sessions.managed.releaseShardSession(handle, context);
    await sessions.managed.pickShardRaw(request, context);
    nanos = 12_000_000;
    await sessions.raw.releaseSessions(
      create(ReleaseExpiredSessionsSchema, {
        inactivityPeriod: { seconds: 0n, nanos: 10_000_000 },
      }),
      context,
    );
    expect(transitions).toEqual(["0/1", "0/1", "0/1", "0/1", "0/1"]);
    sessions.close();
  });

  it("does not notify no-work or conflicting managed pickup", async () => {
    const transitions: number[] = [];
    const sessions = new ShardSessionRuntime(
      new InMemoryDeliveryState(),
      new MutationAdmission(),
      () => ({ $typeName: "google.protobuf.Timestamp", seconds: 1n, nanos: 0 }),
      60_000,
      (value) => transitions.push(value.index),
    );
    const request = create(DeliveryShardPickupSchema, { shard, worker });
    expect((await sessions.managed.pickShardForDelivery(request, context)).result?.case).toBe(
      "noWork",
    );
    await sessions.managed.pickShardRaw(request, context);
    expect((await sessions.managed.pickShardForDelivery(request, context)).result?.case).toBe(
      "busy",
    );
    expect(transitions).toEqual([0]);
    sessions.close();
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
