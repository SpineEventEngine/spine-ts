import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { Int32ValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, Identifiers } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";

import { InboxRecords } from "../../src/delivery/inbox-records.js";
import { DeliveryStorageCorruptionError, InboxMessageError, ShardIndex } from "../../src/index.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("InboxRecords", () => {
  it("round-trips one generated direct Inbox record without sharing caller snapshots", () => {
    const source = createMessage("message", "signal", 1n);
    const restored = InboxRecords.read(InboxRecords.write(source));
    expect(restored).toEqual(source);
    expect(restored).not.toBe(source);
    expect(restored.id).not.toBe(source.id);
  });

  it("preserves a typed JVM EntityId Any without forcing StringValue", () => {
    const targetId = AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value: 7 }));
    const source = {
      ...createMessage("typed-message", "typed-signal", 1n),
      inboxId: { targetId, targetTypeUrl: "type.example.dev/TypedEntity" },
    } as never;

    const wire = InboxRecords.write(source);

    expect(wire.inboxId?.entityId?.id).toEqual(targetId);
    expect(InboxRecords.read(wire).inboxId.targetId).toEqual(targetId);
  });

  it("round-trips JVM identifier goldens without collapsing their packed identity", () => {
    const targets = [
      Identifiers.pack("string", "42"),
      Identifiers.pack("int32", 42),
      Identifiers.pack("int64", 42n),
      Identifiers.pack(UserIdSchema, create(UserIdSchema, { value: "42" })),
    ];

    const restored = targets.map(
      (targetId, index) =>
        InboxRecords.read(
          InboxRecords.write({
            ...createMessage(`golden-${String(index)}`, `signal-${String(index)}`, 1n),
            inboxId: { targetId, targetTypeUrl: "type.example.dev/TypedEntity" },
          }),
        ).inboxId.targetId,
    );

    expect(restored).toEqual(targets);
    expect(
      new Set(
        restored.map(
          (target) => `${target.typeUrl}:${Buffer.from(target.value).toString("base64")}`,
        ),
      ).size,
    ).toBe(4);
  });

  it("rejects an invalid shard before serialization", () => {
    const fakeShard = { index: 0, ofTotal: 1, key: () => "0/1" };
    expect(() =>
      InboxRecords.write({
        ...createMessage("message", "signal", 1n),
        id: { value: "message", shard: fakeShard },
        shard: fakeShard,
      }),
    ).toThrow(InboxMessageError);
  });

  it("rejects a malformed signal payload", () => {
    expect(() =>
      InboxRecords.write({
        ...createMessage("message", "signal", 1n),
        signal: create(AnySchema, { typeUrl: "type", value: "not-bytes" as never }),
      }),
    ).toThrow(InboxMessageError);
  });

  it("rejects default and malformed primitive target identities", () => {
    const source = createMessage("message", "signal", 1n);
    expect(() =>
      InboxRecords.write({
        ...source,
        inboxId: { ...source.inboxId, targetId: create(AnySchema) },
      }),
    ).toThrow(InboxMessageError);

    const wire = InboxRecords.write(source);
    const corrupt = {
      ...wire,
      inboxId: {
        ...wire.inboxId,
        entityId: {
          id: create(AnySchema, {
            typeUrl: `type.googleapis.com/${StringValueSchema.typeName}`,
            value: Uint8Array.of(0xff),
          }),
        },
      },
    };
    expect(() => InboxRecords.read(corrupt as never)).toThrow(DeliveryStorageCorruptionError);
    expect(() =>
      InboxRecords.read({
        ...wire,
        inboxId: {
          ...wire.inboxId,
          entityId: { id: { typeUrl: "type.example.dev/Id", value: "not-bytes" } },
        },
      } as never),
    ).toThrow(DeliveryStorageCorruptionError);

    for (const text of ["", " "]) {
      const targetId = Identifiers.pack("string", text);
      expect(() =>
        InboxRecords.write({ ...source, inboxId: { ...source.inboxId, targetId } }),
      ).toThrow(InboxMessageError);
      expect(() =>
        InboxRecords.read({
          ...wire,
          inboxId: { ...wire.inboxId, entityId: { id: targetId } },
        } as never),
      ).toThrow(DeliveryStorageCorruptionError);
    }
  });

  it("accepts zero-valued numeric target identities", () => {
    for (const targetId of [Identifiers.pack("int32", 0), Identifiers.pack("int64", 0n)]) {
      const source = createMessage("zero", "signal", 1n);
      expect(
        InboxRecords.read(
          InboxRecords.write({ ...source, inboxId: { ...source.inboxId, targetId } }),
        ).inboxId.targetId,
      ).toEqual(targetId);
    }
  });

  it("preserves generated shard coordinates", () => {
    const shard = new ShardIndex(1, 2);
    const source = {
      ...createMessage("message", "signal", 1n),
      id: { value: "message", shard },
      shard,
    };
    expect(InboxRecords.read(InboxRecords.write(source)).shard).toEqual(shard);
  });
});
