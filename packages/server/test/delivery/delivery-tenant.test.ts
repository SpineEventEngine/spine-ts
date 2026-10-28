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

import { clone, create } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { ActorContextSchema, EventContextSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import { Delivery } from "../../src/delivery/delivery.js";
import { Inbox } from "../../src/delivery/inbox.js";
import { deliveryTenant, deliveryTenantKey } from "../../src/delivery/delivery-tenant.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { createMessage } from "./inbox-message-fixture.js";
import { tenant } from "../tenant-fixture.js";

describe("shared Delivery tenant identity", () => {
  it("distinguishes two Event envelopes with the same target and signal ID", () => {
    const first = eventForTenant("first", "same");
    const second = eventForTenant("second", "same");
    expect(deliveryTenant(first)).toEqual(tenant("first"));
    expect(deliveryTenantKey(first)).not.toBe(deliveryTenantKey(second));
    expect(() =>
      deliveryTenant({ ...first, signal: undefined } as unknown as typeof first),
    ).toThrow("signal is missing");
  });

  it("delivers the same signal and typed target once for each tenant in one physical Inbox", async () => {
    const delivery = new Delivery({
      context: { name: "TenantShared", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const inbox = delivery.inbox as Inbox;
    const first = eventForTenant("first", "row-first");
    const second = eventForTenant("second", "row-second");
    expect(deliveryTenant((await inbox.storage.write(first)).message)).toEqual(tenant("first"));
    expect(deliveryTenant((await inbox.storage.write(second)).message)).toEqual(tenant("second"));
    const seen: string[] = [];
    await delivery.run({
      onMessage: (message) => {
        seen.push(deliveryTenantKey(message));
      },
    });
    expect(seen).toEqual([deliveryTenantKey(first), deliveryTenantKey(second)]);
    await delivery.close();
  });

  it("leaves an Inbox row pending until its recipient is registered", async () => {
    const delivery = new Delivery({
      context: { name: "TenantShared", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
    });
    const row = eventForTenant("first", "pending-recipient");
    const written = await delivery.inbox.receive(row);
    const seen: string[] = [];
    let registered = false;
    delivery.setReplay(
      (message) => {
        seen.push(message.id.value);
      },
      () => registered,
    );
    delivery.wake(ShardIndex.single());
    await delivery.whenIdle();
    expect(seen).toEqual([]);
    expect((await delivery.inbox.readMessage(written.message.id))?.status).toBe("TO_DELIVER");
    registered = true;
    delivery.wake(ShardIndex.single());
    await delivery.whenIdle();
    expect(seen).toEqual([written.message.id.value]);
    expect(await delivery.inbox.readMessage(written.message.id)).toBeUndefined();
    await delivery.close();
  });
});

function eventForTenant(name: string, rowId: string) {
  const base = createMessage(rowId, "same-signal", 1n);
  if (base.signal === undefined) throw new Error("Expected a generated Event envelope.");
  const event = AnyPacker.unpack(base.signal, EventSchema);
  const context = create(EventContextSchema, {
    origin: {
      case: "importContext",
      value: create(ActorContextSchema, { tenantId: tenant(name) }),
    },
  });
  return {
    ...base,
    signal: AnyPacker.pack(EventSchema, clone(EventSchema, { ...event, context })),
  };
}
