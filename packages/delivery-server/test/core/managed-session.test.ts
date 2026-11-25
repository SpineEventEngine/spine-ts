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
import { DeliveryShardPickupSchema } from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { InMemoryDelivery } from "../../src/index.js";
import { domainMessage, encodedBytes } from "./domain-message.js";

const context = { signal: new AbortController().signal } as never;
const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run-1" });

describe("managed delivery sessions", () => {
  it("recovers the same live worker and rejects a stale release after a fresh pickup", async () => {
    const core = InMemoryDelivery.create();
    const message = domainMessage("managed-1", shard);
    await core.inbox.writeOne({ message }, context);
    const request = create(DeliveryShardPickupSchema, { shard, worker });
    const first = await core.managed.pickShardForDelivery(request, context);
    expect(first.result.case).toBe("pickedUp");
    const handle = first.result.value;
    const recovered = await core.managed.pickShardForDelivery(request, context);
    expect(recovered.result.value.sessionId).toBe(handle.sessionId);
    const renewed = await core.managed.renewShardSession(handle, context);
    expect(renewed.sessionId).toBe(handle.sessionId);
    await core.managed.releaseShardSession(handle, context);
    const second = await core.managed.pickShardForDelivery(request, context);
    expect(second.result.value.sessionId).not.toBe(handle.sessionId);
    await core.managed.releaseShardSession(handle, context);
    const stillLive = await core.managed.pickShardForDelivery(request, context);
    expect(stillLive.result.value.sessionId).toBe(second.result.value.sessionId);
    expect(encodedBytes(message)).toBeGreaterThan(0);
  });
});
