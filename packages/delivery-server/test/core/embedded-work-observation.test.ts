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
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { ShardIndexSchema } from "@spine-event-engine/proto/delivery";
import { InboxService, ShardObservingService } from "@spine-event-engine/proto/delivery-server";
import { describe, expect, it, vi } from "vitest";

import { InMemoryDelivery } from "../../src/index.js";
import { domainMessage } from "./domain-message.js";

describe("embedded work observation", () => {
  it("offers existing work, repeats the notice, and ends the stream on close", async () => {
    vi.useFakeTimers();
    const delivery = InMemoryDelivery.create({ reminderIntervalMs: 200 });
    const transport = createRouterTransport((router) => {
      router.service(InboxService, delivery.inbox);
      router.service(ShardObservingService, delivery.observing);
    });
    const inbox = createClient(InboxService, transport);
    const observer = createClient(ShardObservingService, transport);
    const shard = create(ShardIndexSchema, { index: 3, ofTotal: 4 });
    const message = domainMessage("waiting-in-embedded-server", shard);
    try {
      await inbox.writeOne({ message });
      const notices = observer.observeAll({})[Symbol.asyncIterator]();
      expect(await notices.next()).toMatchObject({ done: false, value: { shard } });
      const next = notices.next();
      await vi.advanceTimersByTimeAsync(200);
      expect(await next).toMatchObject({ done: false, value: { shard } });
      const pending = notices.next();
      delivery.close();
      expect((await pending).done).toBe(true);
      await expect(inbox.writeOne({ message })).rejects.toMatchObject({ code: Code.Unavailable });
    } finally {
      delivery.close();
      vi.useRealTimers();
    }
  });

  it("rejects an interval that cannot schedule a reminder", () => {
    expect(() => InMemoryDelivery.create({ reminderIntervalMs: 0 })).toThrow(RangeError);
  });
});
