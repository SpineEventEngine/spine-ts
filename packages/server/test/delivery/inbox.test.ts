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
  it("replaces the same message ID with one ordinary provider write", async () => {
    const inbox = open("ReplaceInboxMessage");
    const original = createMessage("same-id", "first", 1n);
    const replacement = { ...createMessage("same-id", "second", 2n), id: original.id };

    await inbox.storage.write(original);
    const written = await inbox.storage.write(replacement);

    expect(written.signalId).toBe("second");
    expect((await inbox.readMessage(original.id))?.signalId).toBe("second");
    expect((await inbox.read(ShardIndex.single())).map((row) => row.id.value)).toEqual(["same-id"]);
  });

  it("orders adjacent-second receipts and continues pages by full timestamp", async () => {
    const inbox = open("AdjacentSecondOrder");
    const before = create(TimestampSchema, { seconds: 100n, nanos: 999_000_000 });
    const after = create(TimestampSchema, { seconds: 101n, nanos: 1_000_000 });
    const earlier = { ...createMessage("earlier", "signal-early", 1n), whenReceived: before };
    const later = { ...createMessage("later", "signal-late", 1n), whenReceived: after };
    await inbox.storage.write(later);
    await inbox.storage.write(earlier);

    const shard = ShardIndex.single();
    expect((await inbox.read(shard)).map((row) => row.id.value)).toEqual(["earlier", "later"]);
    expect((await inbox.newestPending(shard))?.id.value).toBe("later");
    const firstPage = await inbox.read(shard, { limit: 1 });
    expect(firstPage.map((row) => row.id.value)).toEqual(["earlier"]);
    expect(
      (
        await inbox.read(shard, {
          after: { messageId: "earlier", whenReceived: before, version: 1n },
        })
      ).map((row) => row.id.value),
    ).toEqual(["later"]);
  });

  it("finds the newest pending row by full receive time, version, and ID", async () => {
    const inbox = open("NewestPendingOrder");
    const time = create(TimestampSchema, { seconds: 10n, nanos: 777 });
    const rows = [
      { ...createMessage("older", "older", 9n), whenReceived: time },
      { ...createMessage("alpha", "alpha", 10n), whenReceived: time },
      { ...createMessage("zeta", "zeta", 10n), whenReceived: time },
    ];
    for (const row of rows) await inbox.storage.write(row);
    expect((await inbox.newestPending(ShardIndex.single()))?.id.value).toBe("zeta");
    await inbox.markDelivered(required(rows[2], "newest row"));
    expect((await inbox.newestPending(ShardIndex.single()))?.id.value).toBe("alpha");
    await inbox.removeDuplicate(required(rows[1], "middle row"));
    expect((await inbox.newestPending(ShardIndex.single()))?.id.value).toBe("older");
    await inbox.removeDuplicate(required(rows[0], "oldest row"));
    expect(await inbox.newestPending(ShardIndex.single())).toBeUndefined();
  });

  it("stores a new pending receipt without a completion deadline", async () => {
    const inbox = open("PendingWithoutDeadline");
    const received = await inbox.receive(input(createMessage("pending-deadline", "signal", 1n)));

    expect(received.keepUntil).toBeUndefined();
    expect((await inbox.readMessage(received.id))?.keepUntil).toBeUndefined();
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
    expect(receipt.whenReceived.seconds).toBe(1n);
    expect(receipt.whenReceived.nanos).toBe(234_001_000);

    const page = await inbox.read(ShardIndex.single());
    expect(page[0]?.whenReceived.seconds).toBe(1n);
    expect(page[0]?.whenReceived.nanos).toBe(234_001_000);
    const direct = await inbox.readMessage(receipt.id);
    expect(direct?.whenReceived.seconds).toBe(1n);
    expect(direct?.whenReceived.nanos).toBe(234_001_000);
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

  it("cleans expired delivered messages by shard while retaining pending work", async () => {
    let now = new Date(2_000);
    const inbox = new Inbox(
      new InboxStorage({
        context: { name: "DeliveredPredicate", multitenant: false },
        storageFactory: new InMemoryStorageFactory(),
        now: () => now,
      }),
    );
    const expired = createMessage("expired", "expired", 1n);
    const protectedMessage = createMessage("protected", "protected", 2n);
    const pending = createMessage("pending", "pending", 3n);
    for (const message of [expired, protectedMessage, pending]) await inbox.storage.write(message);
    await inbox.markDelivered(expired);
    now = new Date(2_001);
    await inbox.markDelivered(protectedMessage);
    now = new Date(7_000);

    await expect(inbox.removeExpiredDelivered(ShardIndex.single())).resolves.toBe(true);
    await expect(inbox.readMessage(expired.id)).resolves.toBeUndefined();
    await expect(inbox.readMessage(protectedMessage.id)).resolves.toMatchObject({
      status: "DELIVERED",
    });
    await expect(inbox.readMessage(pending.id)).resolves.toMatchObject({ status: "TO_DELIVER" });
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
    expect(await inbox.readMessage(written.id)).toEqual(written);
    expect(await inbox.markDelivered(written)).toMatchObject({
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
    await expect(open("Tasks").read(ShardIndex.single(), { limit: 1_001 })).resolves.toEqual([]);
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
