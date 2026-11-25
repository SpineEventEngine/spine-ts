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
import { expect, it, vi } from "vitest";
import { ShardedWorkAvailableSchema } from "@spine-event-engine/proto/delivery-server";
import { DeliveryClient, DeliveryProtocolError } from "../src/client/client.js";
import { transport } from "./shared-fixtures.js";

it("releases a paused work stream immediately when its caller aborts", async () => {
  const fake = transport();
  fake.streamReplyAndHold([
    create(ShardedWorkAvailableSchema, { shard: { index: 0, ofTotal: 1 } }),
  ]);
  const client = DeliveryClient.usingTransport(fake.transport);
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const stream = client
    .observeAvailableShards({ signal: controller.signal })
    [Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toMatchObject({ value: { index: 0, ofTotal: 1 } });
  controller.abort();
  expect(fake.streamAborts).toBe(1);
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  client.close();
  expect(fake.streamAborts).toBe(1);
});

it("rejects work observation before transport for a closed or pre-aborted caller", async () => {
  const fake = transport();
  const client = DeliveryClient.usingTransport(fake.transport);
  const cancelled = new AbortController();
  const reason = new Error("caller stopped");
  cancelled.abort(reason);
  await expect(
    client.observeAvailableShards({ signal: cancelled.signal })[Symbol.asyncIterator]().next(),
  ).rejects.toBe(reason);
  client.close();
  await expect(client.observeAvailableShards()[Symbol.asyncIterator]().next()).rejects.toThrow(
    "Delivery client is closed.",
  );
  expect(fake.streamAborts).toBe(0);
});

it("rejects a work notice without a shard and closes its stream", async () => {
  const fake = transport();
  fake.streamReplyAndHold([create(ShardedWorkAvailableSchema)]);
  const client = DeliveryClient.usingTransport(fake.transport);
  try {
    await expect(
      client.observeAvailableShards()[Symbol.asyncIterator]().next(),
    ).rejects.toBeInstanceOf(DeliveryProtocolError);
    expect(fake.streamAborts).toBe(1);
  } finally {
    client.close();
  }
});
