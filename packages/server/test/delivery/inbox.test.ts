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
import {
  AnySchema,
  Int32ValueSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyPacker, Identifiers } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Inbox, InboxTargets } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxMessageError, ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("Inbox", () => {
  it("deletes an eligible delivered ID without a session or exact row snapshot", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DirectDeleteById", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const pending = createMessage("direct", "direct-signal", 1n);
    await inbox.storage.write(pending);
    const delivered = required(await inbox.markDelivered(pending), "delivered");
    await expect(
      inbox.removeDelivered({ ...delivered, version: delivered.version + 1n }),
    ).resolves.toBe(true);
    await expect(inbox.readMessage(pending.id)).resolves.toBeUndefined();
  });
  it("preserves microsecond receipt precision across write and reads", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "PreciseReceiveOutput", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const receipt = await inbox.receive({
      ...createMessage("precise", "signal", 1n),
      whenReceived: create(TimestampSchema, { seconds: 1n, nanos: 234_001_000 }),
    });
    expect(receipt.message.whenReceived.seconds).toBe(1n);
    expect(receipt.message.whenReceived.nanos).toBe(234_001_000);

    const page = await inbox.read(ShardIndex.single());
    expect(page[0]?.whenReceived.seconds).toBe(1n);
    expect(page[0]?.whenReceived.nanos).toBe(234_001_000);
    const direct = await inbox.readMessage(receipt.message.id);
    expect(direct?.whenReceived.seconds).toBe(1n);
    expect(direct?.whenReceived.nanos).toBe(234_001_000);
  });

  it("matches precise Timestamp snapshots for acknowledgement and ID removals", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "PreciseSnapshotMutations", multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory }));
    const deliveredInput = {
      ...createMessage("delivered", "delivered-signal", 1n),
      whenReceived: create(TimestampSchema, { seconds: 1n, nanos: 234_001_000 }),
    };
    const duplicateInput = {
      ...createMessage("duplicate", "duplicate-signal", 2n),
      whenReceived: create(TimestampSchema, { seconds: 1n, nanos: 235_999_000 }),
    };
    await inbox.storage.write(deliveredInput);
    await inbox.storage.write(duplicateInput);
    const delivered = await inbox.markDelivered(deliveredInput);
    expect(delivered?.whenReceived.nanos).toBe(234_001_000);
    await expect(inbox.removeDelivered({ ...deliveredInput, status: "DELIVERED" })).resolves.toBe(
      true,
    );
    await expect(inbox.removeDuplicate(duplicateInput)).resolves.toBe(true);
  });

  it("checks cancellation before deleting a pending duplicate ID", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DuplicateCancellation", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const message = createMessage("cancelled", "signal", 1n);
    await inbox.storage.write(message);
    const controller = new AbortController();
    controller.abort();
    await expect(inbox.removeDuplicate(message, { signal: controller.signal })).resolves.toBe(
      false,
    );
    await expect(inbox.readMessage(message.id)).resolves.toMatchObject({ status: "TO_DELIVER" });
    await expect(inbox.removeDuplicate(message)).resolves.toBe(true);
    await expect(inbox.readMessage(message.id)).resolves.toBeUndefined();
  });

  it("deletes only eligible delivered IDs and reports an absent ID", async () => {
    const now = new Date(2_000);
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DeliveredEligibility", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        now: () => now,
      }),
    );
    const pending = createMessage("pending", "pending", 1n);
    const expired = { ...createMessage("expired", "expired", 2n), keepUntil: new Date(2_000) };
    const protectedRow = {
      ...createMessage("protected", "protected", 3n),
      keepUntil: new Date(2_001),
    };
    for (const row of [pending, expired, protectedRow]) await inbox.storage.write(row);
    const expiredDelivered = required(await inbox.markDelivered(expired), "expired");
    const protectedDelivered = required(await inbox.markDelivered(protectedRow), "protected");
    await expect(inbox.removeDelivered(pending)).resolves.toBe(false);
    await expect(inbox.removeDelivered(protectedDelivered)).resolves.toBe(false);
    await expect(inbox.removeDelivered(expiredDelivered)).resolves.toBe(true);
    await expect(inbox.removeDelivered(expiredDelivered)).resolves.toBe(false);
    await expect(inbox.readMessage(pending.id)).resolves.toMatchObject({ status: "TO_DELIVER" });
    await expect(inbox.readMessage(protectedRow.id)).resolves.toMatchObject({
      status: "DELIVERED",
    });
  });

  it("deletes an eligible ID without serializing unrelated signal data", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DirectCleanupPayload", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const pending = createMessage("direct-id", "signal", 1n);
    await inbox.storage.write(pending);
    const delivered = required(await inbox.markDelivered(pending), "direct-id");
    const idOnly = {
      ...delivered,
      signal: undefined as unknown as NonNullable<typeof delivered.signal>,
    };

    await expect(inbox.removeDelivered(idOnly)).resolves.toBe(true);
    await expect(inbox.readMessage(pending.id)).resolves.toBeUndefined();
  });

  it("checks cancellation and deadline before deleting a delivered ID", async () => {
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DeliveredCancellation", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
      }),
    );
    const pending = createMessage("delivered", "signal", 1n);
    await inbox.storage.write(pending);
    const delivered = required(await inbox.markDelivered(pending), "delivered");
    const controller = new AbortController();
    controller.abort();
    await expect(inbox.removeDelivered(delivered, { signal: controller.signal })).resolves.toBe(
      false,
    );
    await expect(inbox.removeDelivered(delivered, { timeoutMs: 0 })).resolves.toBe(false);
    for (const timeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(inbox.removeDelivered(delivered, { timeoutMs })).resolves.toBe(false);
    }
    await expect(inbox.readMessage(pending.id)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("retains a delivered row when the deadline expires while opening deletion storage", async () => {
    let clockReads = 0;
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DeadlineBeforeDelete", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        now: () => new Date(clockReads++ < 2 ? 0 : 10),
      }),
    );
    const pending = createMessage("deadline", "deadline-signal", 1n);
    await inbox.storage.write(pending);
    const delivered = required(await inbox.markDelivered(pending), "delivered");

    await expect(inbox.removeDelivered(delivered, { timeoutMs: 10 })).resolves.toBe(false);
    expect(clockReads).toBe(3);
    await expect(inbox.readMessage(pending.id)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("receives, orders, reads, and marks a direct generated row delivered", async () => {
    const inbox = open("Tasks");
    const later = createMessage("ignored", "later", 2n, new Date("2026-07-02T08:00:01.000Z"));
    const first = createMessage("ignored", "first", 1n);
    await inbox.receive(input(later));
    const written = await inbox.receive(input(first));
    expect((await inbox.read(ShardIndex.single())).map((row) => row.signalId)).toEqual([
      "first",
      "later",
    ]);
    expect(await inbox.readMessage(written.message.id)).toEqual(written.message);
    expect(await inbox.markDelivered(written.message)).toMatchObject({
      status: "DELIVERED",
      signalId: "first",
    });
  });

  it("shares one record family across diagnostic Bounded Context names", async () => {
    const factory = new InMemoryStorageFactory();
    const first = open("Tasks", factory);
    const second = open("Tasks", factory);
    const differentlyNamed = open("Other", factory);
    await first.receive(input(createMessage("ignored", "shared", 1n)));
    expect((await second.read(ShardIndex.single())).map((row) => row.signalId)).toEqual(["shared"]);
    expect((await differentlyNamed.read(ShardIndex.single())).map((row) => row.signalId)).toEqual([
      "shared",
    ]);
  });

  it("rejects invalid public read limits before storage access", async () => {
    await expect(open("Tasks").read(ShardIndex.single(), { limit: 0 })).rejects.toThrow(
      InboxMessageError,
    );
    await expect(open("Tasks").read(ShardIndex.single(), { limit: 1_001 })).rejects.toThrow(
      InboxMessageError,
    );
  });

  it("does not let caller mutation change the durable input snapshot", async () => {
    const inbox = open("Tasks");
    const value = {
      ...input(createMessage("ignored", "stable", 1n)),
      inboxId: {
        targetId: AnyPacker.pack(
          StringValueSchema,
          create(StringValueSchema, { value: "projection-1" }),
        ),
        targetTypeUrl: "type.example.dev/tasks.Projection",
      },
    };
    await inbox.receive(value);
    value.inboxId.targetId.value[0] = 0;
    expect(
      InboxTargets.equal(
        (await inbox.read(ShardIndex.single()))[0]?.inboxId.targetId as never,
        value.inboxId.targetId,
      ),
    ).toBe(false);
  });

  it("distinguishes same printable IDs across typed Any kinds", () => {
    const text = AnyPacker.pack(StringValueSchema, create(StringValueSchema, { value: "7" }));
    const integer = AnyPacker.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 7 }));

    expect(InboxTargets.equal(text, integer)).toBe(false);
    expect(InboxTargets.key(text)).not.toBe(InboxTargets.key(integer));
  });

  it("clones targets and rejects malformed string shard identities", () => {
    const source = Identifiers.pack("int32", 7);
    const snapshot = InboxTargets.clone(source);
    source.value.fill(0);
    expect(snapshot).toEqual(Identifiers.pack("int32", 7));
    expect(() => InboxTargets.clone(create(AnySchema))).toThrow(TypeError);

    expect(() =>
      InboxTargets.shardKey({
        typeUrl: "type.googleapis.com/google.protobuf.StringValue",
        value: Uint8Array.of(0xff),
      } as never),
    ).toThrow(TypeError);
    expect(() => InboxTargets.shardKey(Identifiers.pack("string", " "))).toThrow(TypeError);
  });
});

function open(name: string, factory = new InMemoryStorageFactory()): Inbox {
  return new Inbox(
    new InboxStorage({ context: { name, multitenant: false }, storageFactory: factory }),
  );
}
function input(message: ReturnType<typeof createMessage>) {
  const { id, ...value } = message;
  void id;
  return value;
}
function required<T>(value: T, name: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(`Expected ${name}.`);
  return value;
}
