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
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Inbox, InboxTargets } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { InboxMessageError, ShardIndex } from "../../src/index.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("Inbox", () => {
  it("removes an eligible exact delivered snapshot only while its shard session is current", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "T0191", multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory }));
    const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
    const message = createMessage("eligible", "signal", 1n);
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    );

    expect(session).toBeDefined();
    await inbox.storage.write(message);
    const delivered = await inbox.markDelivered(message);
    expect(delivered).toMatchObject({ status: "DELIVERED" });
    await expect(
      inbox.removeDelivered(required(delivered, "delivered"), required(session, "session")),
    ).resolves.toBe(true);
    await expect(inbox.readMessage(message.id)).resolves.toBeUndefined();
  });

  it("removes only unprotected delivered snapshots at the expiry boundary and is idempotent", async () => {
    const now = new Date(2_000);
    const factory = new InMemoryStorageFactory();
    const context = { name: "T0191-eligibility", multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory, now: () => now }));
    const registry = new ShardedWorkRegistry({ context, storageFactory: factory, now: () => now });
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    );
    const rows = [
      createMessage("absent", "absent", 1n),
      { ...createMessage("expired", "expired", 2n), keepUntil: new Date(2_000) },
      { ...createMessage("protected", "protected", 3n), keepUntil: new Date(2_001) },
    ];
    for (const row of rows) {
      await inbox.storage.write(row);
      await inbox.markDelivered(row);
    }

    const delivered = await Promise.all(rows.map((row) => inbox.readMessage(row.id)));
    await expect(
      inbox.removeDelivered(required(delivered[0], "absent"), required(session, "session")),
    ).resolves.toBe(true);
    await expect(
      inbox.removeDelivered(required(delivered[1], "expired"), required(session, "session")),
    ).resolves.toBe(true);
    await expect(
      inbox.removeDelivered(required(delivered[2], "protected"), required(session, "session")),
    ).resolves.toBe(false);
    await expect(
      inbox.removeDelivered(required(delivered[0], "absent"), required(session, "session")),
    ).resolves.toBe(false);
    await expect(inbox.readMessage(required(rows[2], "protected").id)).resolves.toMatchObject({
      status: "DELIVERED",
    });
  });

  it("does not remove an eligible delivered snapshot after cancellation or expired preflight", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "T0191-cancelled", multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory }));
    const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "cancelled" }),
    );
    const message = createMessage("cancelled", "target", 1n);
    await inbox.storage.write(message);
    const delivered = await inbox.markDelivered(message);
    const controller = new AbortController();
    controller.abort();

    await expect(
      inbox.removeDelivered(required(delivered, "delivered"), required(session, "session"), {
        signal: controller.signal,
      }),
    ).resolves.toBe(false);
    await expect(inbox.readMessage(message.id)).resolves.toMatchObject({ status: "DELIVERED" });
    await expect(
      inbox.removeDelivered(required(delivered, "delivered"), required(session, "session"), {
        timeoutMs: 0,
      }),
    ).resolves.toBe(false);
    await expect(inbox.readMessage(message.id)).resolves.toMatchObject({ status: "DELIVERED" });
    for (const timeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        inbox.removeDelivered(required(delivered, "delivered"), required(session, "session"), {
          timeoutMs,
        }),
      ).resolves.toBe(false);
    }
    await expect(inbox.readMessage(message.id)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("never removes a pending or replaced snapshot", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "T0191-exact", multitenant: false } as const;
    const inbox = new Inbox(new InboxStorage({ context, storageFactory: factory }));
    const registry = new ShardedWorkRegistry({ context, storageFactory: factory });
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    );
    const pending = createMessage("pending", "pending", 1n);
    const delivered = createMessage("replaced", "replaced", 1n);
    await inbox.storage.write(pending);
    await inbox.storage.write(delivered);
    const snapshot = await inbox.markDelivered(delivered);

    await expect(inbox.removeDelivered(pending, required(session, "session"))).resolves.toBe(false);
    await expect(
      inbox.removeDelivered(
        { ...required(snapshot, "snapshot"), version: 2n },
        required(session, "session"),
      ),
    ).resolves.toBe(false);
    await expect(inbox.readMessage(pending.id)).resolves.toMatchObject({ status: "TO_DELIVER" });
    await expect(inbox.readMessage(delivered.id)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("cannot delete after ownership transfers at the former validate-delete gap", async () => {
    let now = 1_000;
    const factory = new InMemoryStorageFactory();
    const context = { name: "T0191-transfer", multitenant: false } as const;
    const inbox = new Inbox(
      new InboxStorage({ context, storageFactory: factory, now: () => new Date(now) }),
    );
    const registry = new ShardedWorkRegistry({
      context,
      storageFactory: factory,
      leaseMs: 1_000,
      now: () => new Date(now),
    });
    const first = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "first" }, value: "worker" }),
    );
    const message = createMessage("transfer", "transfer", 1n);
    await inbox.storage.write(message);
    const delivered = await inbox.markDelivered(message);

    now = 2_000;
    const second = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "second" }, value: "worker" }),
    );
    expect(second).toBeDefined();
    await expect(
      inbox.removeDelivered(required(delivered, "delivered"), required(first, "first")),
    ).resolves.toBe(false);
    await expect(inbox.readMessage(message.id)).resolves.toMatchObject({ status: "DELIVERED" });
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
function required<T>(value: T, name: string): NonNullable<T> {
  if (value === undefined || value === null) throw new Error(`Expected ${name}.`);
  return value;
}
