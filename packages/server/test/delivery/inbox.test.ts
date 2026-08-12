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
import { AnySchema, Int32ValueSchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, Identifiers } from "@spine-event-engine/core";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Inbox, InboxTargets } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxMessageError, ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("Inbox", () => {
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
        targetId: AnyMessages.pack(
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
    const text = AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: "7" }));
    const integer = AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 7 }));

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

  it("deduplicates equal typed targets but not printable values from another identifier kind", async () => {
    const inbox = open("Tasks");
    const first = {
      ...input(createMessage("ignored", "same-signal", 1n)),
      inboxId: {
        targetId: Identifiers.pack("int32", 42),
        targetTypeUrl: "type.example.dev/tasks.Typed",
      },
    };
    const duplicate = { ...first, version: 2n };
    const otherKind = {
      ...first,
      signalId: "same-signal",
      inboxId: {
        targetId: Identifiers.pack("string", "42"),
        targetTypeUrl: "type.example.dev/tasks.Typed",
      },
      version: 3n,
    };

    const written = await inbox.receive(first);
    await inbox.markDelivered(written.message);
    const sameTyped = await inbox.receive(duplicate);
    const differentTyped = await inbox.receive(otherKind);

    await expect(inbox.storage.admit(sameTyped.message)).resolves.toBeUndefined();
    await expect(inbox.storage.admit(differentTyped.message)).resolves.toMatchObject({
      inboxId: { targetId: Identifiers.pack("string", "42") },
    });
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
