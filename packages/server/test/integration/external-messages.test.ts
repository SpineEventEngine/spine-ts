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
import { AnySchema, StringValueSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  BoundedContextNameSchema,
  BoundedContextOnlineSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  ExternalEventsWantedSchema,
  type BoundedContextName,
  type Event,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import {
  unpackExternalEvent,
  wrapBoundedContextOnline,
  wrapExternalEvent,
  wrapExternalEventsWanted,
} from "../../src/integration/external-messages.js";
import { ReviewTaskAssignedSchema } from "../../test-fixtures/generated/handler-registry/events_pb.js";

describe("external integration messages", () => {
  it("wraps and recovers an exact domain Event with its EventId identity", () => {
    const value = event("published-event");
    const frame = wrapExternalEvent(value, origin());

    expect(frame.id.typeUrl).toBe(TypeUrls.derive(EventIdSchema));
    expect(fromBinary(EventIdSchema, frame.id.value)).toEqual(value.id);
    expect(unpackExternalEvent(frame)).toEqual(value);
  });

  it("rejects incomplete Events and controls without origins", () => {
    expect(() => wrapExternalEvent(create(EventSchema), origin())).toThrow(/EventId/u);
    expect(() =>
      wrapExternalEventsWanted(
        create(ExternalEventsWantedSchema),
        undefined as unknown as BoundedContextName,
      ),
    ).toThrow(/origin/u);
    expect(() => wrapBoundedContextOnline(create(BoundedContextOnlineSchema))).toThrow(/origin/u);
  });

  it("rejects malformed external Event wrapper type and identity values", () => {
    const frame = wrapExternalEvent(event("valid"), origin());
    expect(() => unpackExternalEvent({ ...frame, boundedContextName: undefined })).toThrow(
      /origin/u,
    );
    expect(() =>
      unpackExternalEvent({
        ...frame,
        originalMessage: create(AnySchema, {
          typeUrl: TypeUrls.derive(StringValueSchema),
          value: frame.originalMessage?.value ?? new Uint8Array(),
        }),
      }),
    ).toThrow(/does not contain an Event/u);
    expect(() =>
      unpackExternalEvent({
        ...frame,
        id: create(AnySchema, {
          typeUrl: TypeUrls.derive(StringValueSchema),
          value: toBinary(StringValueSchema, create(StringValueSchema, { value: "wrong" })),
        }),
      }),
    ).toThrow(/EventId wrapper identity/u);
    expect(() =>
      unpackExternalEvent({
        ...frame,
        id: create(AnySchema, {
          typeUrl: frame.id.typeUrl,
          value: toBinary(EventIdSchema, create(EventIdSchema, { value: "other" })),
        }),
      }),
    ).toThrow(/does not match Event.id/u);
  });

  it("uses distinct UUID identities for wanted and online control frames", () => {
    const wanted = wrapExternalEventsWanted(create(ExternalEventsWantedSchema), origin());
    const online = wrapBoundedContextOnline(
      create(BoundedContextOnlineSchema, { context: origin() }),
    );
    const wantedId = controlId(wanted.id.value);
    const onlineId = controlId(online.id.value);

    expect(wanted.id.typeUrl).toBe(TypeUrls.derive(StringValueSchema));
    expect(online.id.typeUrl).toBe(TypeUrls.derive(StringValueSchema));
    expect(wantedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(onlineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(wantedId).not.toBe(onlineId);
  });
});

function event(id: string): Event {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema),
    message: AnyMessages.pack(
      ReviewTaskAssignedSchema,
      create(ReviewTaskAssignedSchema, { id, name: "Review task" }),
    ),
  });
}

function origin() {
  return create(BoundedContextNameSchema, { value: "ExternalProducer" });
}

function controlId(value: Uint8Array): string {
  return fromBinary(StringValueSchema, value).value;
}
