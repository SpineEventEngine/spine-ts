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
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "../../core/src/index.js";
import {
  BoundedContextOnlineSchema,
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
    expect(wrapper.field.id.message.typeName).toBe("google.protobuf.Any");
    expect(wrapper.field.originalMessage.message.typeName).toBe("google.protobuf.Any");
    expect(wrapper.field.boundedContextName.message.typeName).toBe("spine.core.BoundedContextName");
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
    expect(wanted.field.type.listKind).toBe("message");
    expect(wanted.field.type.message.typeName).toBe("spine.server.integration.ExternalEventType");
    expect(externalType.typeName).toBe("spine.server.integration.ExternalEventType");
    expect(
      externalType.fields.map((field) => [field.localName, field.number, field.scalar]),
    ).toEqual([["typeUrl", 1, 9]]);
    expect(online.typeName).toBe("spine.server.integration.BoundedContextOnline");
    expect(online.fields).toHaveLength(1);
    expect(online.field.context.number).toBe(1);
    expect(online.field.context.message.typeName).toBe("spine.core.BoundedContextName");
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
      id: {
        typeUrl: "type.spine.io/spine.core.EventId",
        value: toBinary(EventIdSchema, event.id),
      },
      originalMessage: {
        typeUrl: "type.spine.io/spine.core.Event",
        value: toBinary(EventSchema, event),
      },
      boundedContextName: { value: "Wave13Producer" },
    });
    const roundTripped = fromBinary(wrapper, toBinary(wrapper, frame));
    expect(roundTripped.id.typeUrl).toBe("type.spine.io/spine.core.EventId");
    expect(fromBinary(EventIdSchema, roundTripped.id.value)).toEqual(event.id);
    expect(roundTripped.originalMessage.typeUrl).toBe("type.spine.io/spine.core.Event");
    expect(roundTripped.boundedContextName).toMatchObject({ value: "Wave13Producer" });
    expect(roundTripped.originalMessage.value).toEqual(frame.originalMessage.value);
    expect(fromBinary(EventSchema, roundTripped.originalMessage.value)).toEqual(event);
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
    expect(wrapExternalEvent(event, { value: "Wave13Producer" })).toEqual(frame);
    const origin = { value: "Wave13Producer" };
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
          originalMessage: {
            ...frame.originalMessage,
            typeUrl: "type.spine.io/google.protobuf.StringValue",
          },
        }),
      ),
    ).toThrow();
    expect(() =>
      unpackExternalEvent(
        create(wrapper, {
          ...frame,
          id: {
            typeUrl: "type.spine.io/google.protobuf.StringValue",
            value: toBinary(StringValueSchema, create(StringValueSchema, { value: "wrong" })),
          },
        }),
      ),
    ).toThrow();
  });
});

async function expectPinnedSource(relativePath: string, expected: string): Promise<void> {
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected);
}
