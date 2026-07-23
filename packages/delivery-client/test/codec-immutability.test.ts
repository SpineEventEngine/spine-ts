import { create } from "@bufbuild/protobuf";
import { ShardIndex } from "@spine-ts/server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  ShardIndexSchema,
} from "@spine-ts/proto/delivery";
import { describe, expect, it } from "vitest";
import {
  DeliveryClient,
  DeliveryProtocolError,
  DeliveryQuarantineError,
  RemoteInbox,
} from "../src/index.js";
import { decodeInboxMessage } from "../src/wire/codec.js";
import { message, transport } from "./shared-fixtures.js";

describe("delivery codec and immutable snapshots", () => {
  it("requires a durable removal quarantine before admitting remote inbox work", () => {
    const client = DeliveryClient.usingTransport(transport().transport);

    expect(() => new RemoteInbox(client, undefined as never)).toThrow(DeliveryQuarantineError);
  });

  it("keeps malformed wire-message decoding on the public protocol-error identity", () => {
    const wire = create(InboxMessageSchema, {
      ...message("command"),
      id: create(InboxMessageIdSchema, {
        uuid: "message-1",
        index: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
      }),
    });

    expect(() => decodeInboxMessage(wire, ShardIndex.single())).toThrow(DeliveryProtocolError);
  });

  it("isolates decoded mutable dates and payload bytes from later caller mutation", () => {
    const wire = message("command");
    const first = decodeInboxMessage(wire, ShardIndex.single());
    const second = decodeInboxMessage(wire, ShardIndex.single());
    const expectedPayload = Array.from(second.signal?.value ?? []);

    first.whenReceived.setTime(9_999);
    first.signal?.value.fill(7);

    expect(second.whenReceived.getTime()).toBe(1_000);
    expect(Array.from(second.signal?.value ?? [])).toEqual(expectedPayload);
  });
});
