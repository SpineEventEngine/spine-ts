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

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serialize } from "node:v8";
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "../../core/src/index.js";
import {
  BoundedContextOnlineSchema,
  BoundedContextNameSchema,
  ChannelIdSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  ExternalEventsWantedSchema,
  ExternalEventTypeSchema,
  ExternalMessageSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";
import {
  unpackExternalEvent,
  toExternalEvent,
  wrapBoundedContextOnline,
  wrapExternalEvent,
  wrapExternalEventsWanted,
} from "../../server/src/integration/external-messages.js";

describe("Wave 13 integration broker protobuf contract", () => {
  it("RED-14 preserves the exact ExternalMessage wrapper and ChannelId contracts", async () => {
    const wrapper = ExternalMessageSchema;
    const channel = ChannelIdSchema;
    const wanted = ExternalEventsWantedSchema;
    const externalType = ExternalEventTypeSchema;
    const online = BoundedContextOnlineSchema;
    expect(wrapper.typeName).toBe("spine.server.integration.ExternalMessage");
    expect(wrapper.fields.map((field) => [field.localName, field.number])).toEqual([
      ["id", 1],
      ["originalMessage", 2],
      ["boundedContextName", 4],
    ]);
    expect(required(wrapper.field.id.message, "ExternalMessage.id message").typeName).toBe(
      "google.protobuf.Any",
    );
    expect(
      required(wrapper.field.originalMessage.message, "ExternalMessage.originalMessage message")
        .typeName,
    ).toBe("google.protobuf.Any");
    expect(
      required(
        wrapper.field.boundedContextName.message,
        "ExternalMessage.boundedContextName message",
      ).typeName,
    ).toBe("spine.core.BoundedContextName");
    expect(
      wrapper.file.proto.messageType.find((message) => message.name === "ExternalMessage")
        ?.reservedRange,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ start: 3, end: 4 })]));
    expect(
      wrapper.file.proto.messageType.find((message) => message.name === "ExternalMessage")
        ?.reservedName,
    ).toContain("actor_context");
    expect(channel.typeName).toBe("spine.server.transport.ChannelId");
    expect(channel.fields.map((field) => [field.localName, field.number, field.scalar])).toEqual([
      ["targetType", 1, 9],
    ]);
    expect(wanted.typeName).toBe("spine.server.integration.ExternalEventsWanted");
    expect(wanted.fields).toHaveLength(1);
    expect(wanted.field.type.number).toBe(1);
    expect(wanted.field.type.fieldKind).toBe("list");
    if (wanted.field.type.fieldKind !== "list")
      throw new Error("Expected ExternalEventsWanted.type list field.");
    expect(wanted.field.type.listKind).toBe("message");
    expect(required(wanted.field.type.message, "ExternalEventsWanted.type message").typeName).toBe(
      "spine.server.integration.ExternalEventType",
    );
    expect(externalType.typeName).toBe("spine.server.integration.ExternalEventType");
    expect(
      externalType.fields.map((field) => [field.localName, field.number, field.scalar]),
    ).toEqual([["typeUrl", 1, 9]]);
    expect(online.typeName).toBe("spine.server.integration.BoundedContextOnline");
    expect(online.fields).toHaveLength(1);
    expect(online.field.context.number).toBe(1);
    expect(
      required(online.field.context.message, "BoundedContextOnline.context message").typeName,
    ).toBe("spine.core.BoundedContextName");
    expect(wrapper.file.proto.package).toContain("spine.server.integration");
    expect(wrapper.file.proto.options?.javaPackage).toBe("io.spine.server.integration");
    expect(channel.file.proto.package).toBe("spine.server.transport");
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "preserved-event-id" }),
      context: create(EventContextSchema),
      message: {
        typeUrl: "type.spine.io/google.protobuf.StringValue",
        value: toBinary(StringValueSchema, create(StringValueSchema, { value: "event" })),
      },
    });
    const frame = create(wrapper, {
      id: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.EventId",
        value: toBinary(EventIdSchema, required(event.id, "event identity")),
      }),
      originalMessage: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.Event",
        value: toBinary(EventSchema, event),
      }),
      boundedContextName: create(BoundedContextNameSchema, { value: "Wave13Producer" }),
    });
    const roundTripped = fromBinary(wrapper, toBinary(wrapper, frame));
    const roundTrippedId = required(roundTripped.id, "round-tripped wrapper identity");
    const roundTrippedOriginal = required(
      roundTripped.originalMessage,
      "round-tripped original message",
    );
    expect(roundTrippedId.typeUrl).toBe("type.spine.io/spine.core.EventId");
    expect(fromBinary(EventIdSchema, roundTrippedId.value)).toEqual(event.id);
    expect(roundTrippedOriginal.typeUrl).toBe("type.spine.io/spine.core.Event");
    expect(roundTripped.boundedContextName).toMatchObject({ value: "Wave13Producer" });
    expect(roundTrippedOriginal.value).toEqual(
      required(frame.originalMessage, "frame original message").value,
    );
    expect(fromBinary(EventSchema, roundTrippedOriginal.value)).toEqual(event);
    const protobufBytes = toBinary(wrapper, frame);
    expect(() => fromBinary(wrapper, Buffer.from(JSON.stringify(frame)))).toThrow();
    expect(() => fromBinary(wrapper, serialize(frame))).toThrow();
    expect(fromBinary(wrapper, protobufBytes)).toEqual(roundTripped);
    await expectPinnedSource(
      "../proto/spine/server/integration/broker.proto",
      "76a3b965391d989d32a1a6dbc84a4465d2f8f2386be7ed266fd201483dc9865d",
    );
    await expectPinnedSource(
      "../proto/spine/server/transport/transport.proto",
      "92df339007d7dda01a6df5b87c38d988bfedebabd6ac28eb7fbb874bcd5f73bd",
    );
    await expectPinnedSource(
      "../proto/spine/core/event.proto",
      "0c385d3fd98d68d35ce1d7887bd564b590daba47b959b99d205c2be56a737d29",
    );
    const origin = create(BoundedContextNameSchema, { value: "Wave13Producer" });
    expect(wrapExternalEvent(event, origin)).toEqual(frame);
    const wantedMessage = create(wanted, {
      type: [{ typeUrl: "type.spine.io/google.protobuf.StringValue" }],
    });
    const wantedFrame = wrapExternalEventsWanted(wantedMessage, origin);
    const onlineFrame = wrapBoundedContextOnline(create(online, { context: origin }));
    for (const controlFrame of [wantedFrame, onlineFrame]) {
      expect(controlFrame.id.typeUrl).toBe(TypeUrls.derive(StringValueSchema));
      expect(fromBinary(StringValueSchema, controlFrame.id.value).value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
    }
    expect(wantedFrame.id.value).not.toEqual(onlineFrame.id.value);
    expect(() =>
      unpackExternalEvent(
        create(wrapper, {
          ...frame,
          originalMessage: create(AnySchema, {
            ...required(frame.originalMessage, "frame original message"),
            typeUrl: "type.spine.io/google.protobuf.StringValue",
          }),
        }),
      ),
    ).toThrow();
    expect(() =>
      unpackExternalEvent(
        create(wrapper, {
          ...frame,
          id: create(AnySchema, {
            typeUrl: "type.spine.io/google.protobuf.StringValue",
            value: toBinary(StringValueSchema, create(StringValueSchema, { value: "wrong" })),
          }),
        }),
      ),
    ).toThrow();
    expect(() => wrapExternalEvent(create(EventSchema), origin)).toThrow(/EventId/u);
    expect(() => unpackExternalEvent(create(wrapper))).toThrow(/origin/u);
    expect(() =>
      wrapBoundedContextOnline(create(online, { context: create(BoundedContextNameSchema) })),
    ).toThrow(/origin/u);
    expect(toExternalEvent(create(EventSchema)).context).toMatchObject({ external: true });
  });
});

async function expectPinnedSource(relativePath: string, expected: string): Promise<void> {
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
}

function required<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new Error(`Expected ${label}.`);
  return value;
}
