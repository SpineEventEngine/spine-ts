import { create, toBinary } from "@bufbuild/protobuf";
import {
  AnySchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { ShardIndex } from "@spine-event-engine/server";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import {
  OptionalInboxMessageSchema,
  PageOfMessagesSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  ShardIndexSchema,
} from "@spine-event-engine/proto/delivery";
import { describe, expect, it } from "vitest";
import {
  DeliveryClient,
  DeliveryPagingError,
  DeliveryProtocolError,
  RemoteInbox,
} from "../src/index.js";
import { DeliveryMessageCodec } from "../src/wire/codec.js";
import { domainMessage, message, stringTarget, transport } from "./shared-fixtures.js";

describe("delivery codec and immutable snapshots", () => {
  it("opens a remote inbox without retained removal state", () => {
    const client = DeliveryClient.usingTransport(transport().transport);

    expect(new RemoteInbox(client)).toBeInstanceOf(RemoteInbox);
  });

  it("writes, pages, and directly removes only an exact pending remote row", async () => {
    const fake = transport();
    const client = DeliveryClient.usingTransport(fake.transport, { pageSize: 2 });
    const inbox = new RemoteInbox(client);
    const source = domainMessage();

    fake.reply(create(EmptySchema));
    await expect(inbox.receive(source)).resolves.toMatchObject({ outcome: "WRITTEN" });
    fake.reply(create(PageOfMessagesSchema, { message: [DeliveryMessageCodec.encode(source)] }));
    await expect(inbox.read(ShardIndex.single())).resolves.toHaveLength(1);
    await expect(inbox.read(ShardIndex.single(), { offset: 1 })).rejects.toBeInstanceOf(
      DeliveryPagingError,
    );

    const currentWire = DeliveryMessageCodec.encode({
      ...source,
      id: { ...source.id, value: "work" },
    });
    fake.reply(create(OptionalInboxMessageSchema, { message: currentWire }));
    const current = await client.findOne({ value: "work", shard: ShardIndex.single() });
    if (current === undefined) throw new Error("Expected remote message.");
    fake.reply(create(OptionalInboxMessageSchema, { message: currentWire }));
    fake.reply(create(EmptySchema));
    await expect(inbox.markDelivered(current)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("keeps malformed wire-message decoding on the public protocol-error identity", () => {
    const wire = create(InboxMessageSchema, {
      ...message("command"),
      id: create(InboxMessageIdSchema, {
        uuid: "message-1",
        index: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
      }),
    });

    expect(() => DeliveryMessageCodec.decode(wire, ShardIndex.single())).toThrow(
      DeliveryProtocolError,
    );
  });

  it("isolates decoded mutable dates and payload bytes from later caller mutation", () => {
    const wire = message("command");
    const first = DeliveryMessageCodec.decode(wire, ShardIndex.single());
    const second = DeliveryMessageCodec.decode(wire, ShardIndex.single());
    const expectedPayload = Array.from(second.signal?.value ?? []);

    first.whenReceived.setTime(9_999);
    first.signal?.value.fill(7);

    expect(second.whenReceived.getTime()).toBe(1_000);
    expect(Array.from(second.signal?.value ?? [])).toEqual(expectedPayload);
  });

  it("detaches target identity bytes in every immutable snapshot", () => {
    const source = domainMessage();
    const first = DeliveryMessageCodec.snapshot(source);
    const second = DeliveryMessageCodec.snapshot(source);
    const expected = Array.from(second.inboxId.targetId.value);

    source.inboxId.targetId.value.fill(7);
    expect(Array.from(first.inboxId.targetId.value)).toEqual(expected);
    first.inboxId.targetId.value.fill(9);
    expect(Array.from(second.inboxId.targetId.value)).toEqual(expected);
  });

  it("round-trips zero-valued numeric target identities", () => {
    for (const [schema, typeUrl] of [
      [Int32ValueSchema, "type.googleapis.com/google.protobuf.Int32Value"],
      [Int64ValueSchema, "type.googleapis.com/google.protobuf.Int64Value"],
    ] as const) {
      const targetId = create(AnySchema, {
        typeUrl,
        value: toBinary(schema, create(schema)),
      });
      const source = domainMessage();
      const messageWithZero = { ...source, inboxId: { ...source.inboxId, targetId } };

      expect(
        DeliveryMessageCodec.decode(
          DeliveryMessageCodec.encode(messageWithZero),
          ShardIndex.single(),
        ).inboxId.targetId,
      ).toEqual(targetId);
    }
  });

  it("rejects blank string targets before remote persistence", () => {
    const source = domainMessage();
    expect(() =>
      DeliveryMessageCodec.encode({
        ...source,
        inboxId: { ...source.inboxId, targetId: stringTarget(" ") },
      }),
    ).toThrow(TypeError);
  });

  it("preserves plain framework target IDs across the frozen wire EntityId", () => {
    const source = domainMessage();
    const plain = {
      ...source,
      inboxId: { ...source.inboxId, targetId: stringTarget("message-1") },
    };

    const decoded = DeliveryMessageCodec.decode(
      DeliveryMessageCodec.encode(plain),
      ShardIndex.single(),
    );

    expect(decoded.inboxId).toEqual(plain.inboxId);
  });

  it("encodes packed-looking framework target IDs as explicit StringValue payloads", () => {
    const source = domainMessage();
    const targetId = "type.spine.io/test.EntityId:cm91dGluZy1rZXk=";
    const wire = DeliveryMessageCodec.encode({
      ...source,
      inboxId: { ...source.inboxId, targetId: stringTarget(targetId) },
    });

    expect(wire.inboxId?.entityId?.id?.typeUrl).toBe(
      "type.googleapis.com/google.protobuf.StringValue",
    );
    expect(DeliveryMessageCodec.decode(wire, ShardIndex.single()).inboxId.targetId).toEqual(
      stringTarget(targetId),
    );
  });

  it("normalizes malformed StringValue target bytes to the delivery protocol error", () => {
    expect(() => DeliveryMessageCodec.decodeTarget("", Uint8Array.of(1))).toThrow(
      DeliveryProtocolError,
    );
    expect(
      DeliveryMessageCodec.decodeTarget("type.spine.io/test.EntityId", new Uint8Array()),
    ).toEqual(create(AnySchema, { typeUrl: "type.spine.io/test.EntityId" }));
    expect(() =>
      DeliveryMessageCodec.decodeTarget(
        "type.googleapis.com/google.protobuf.StringValue",
        new Uint8Array([0xff]),
      ),
    ).toThrow(DeliveryProtocolError);
    expect(() =>
      DeliveryMessageCodec.decodeTarget(
        "type.googleapis.com/google.protobuf.StringValue",
        toBinary(StringValueSchema, create(StringValueSchema, { value: " " })),
      ),
    ).toThrow(DeliveryProtocolError);

    expect(
      DeliveryMessageCodec.decodeTarget(
        "type.spine.io/test.EntityId",
        toBinary(StringValueSchema, create(StringValueSchema, { value: "legacy" })),
      ),
    ).toEqual(
      create(AnySchema, {
        typeUrl: "type.spine.io/test.EntityId",
        value: toBinary(StringValueSchema, create(StringValueSchema, { value: "legacy" })),
      }),
    );
  });
});
