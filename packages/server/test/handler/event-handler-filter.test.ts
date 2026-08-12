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
import { StringifierRegistry } from "@spine-event-engine/core";
import { CommandContextSchema, EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { CompositeFilterSchema } from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { EventHandlerFilters } from "../../src/handler/event-handler-filter.js";

describe("Event handler field filtering", () => {
  it("prefers the matching filtered handler and otherwise uses the fallback", () => {
    const plan = EventHandlerFilters.compile([
      candidate("announcements", "id.value", "announcements"),
      candidate("fallback"),
    ]);

    expect(plan.select(create(EventSchema, { id: { value: "announcements" } }))).toEqual([
      "announcements",
    ]);
    expect(plan.select(create(EventSchema, { id: { value: "general" } }))).toEqual(["fallback"]);
  });

  it("ignores an Event when no filter matches and no fallback exists", () => {
    const plan = EventHandlerFilters.compile([
      candidate("announcements", "id.value", "announcements"),
    ]);

    expect(plan.select(create(EventSchema, { id: { value: "general" } }))).toEqual([]);
  });

  it("matches message-valued fields through compact Proto JSON", () => {
    const plan = EventHandlerFilters.compile([
      candidate("announcements", "id", '{"value":"announcements"}'),
    ]);

    expect(plan.select(create(EventSchema, { id: { value: "announcements" } }))).toEqual([
      "announcements",
    ]);
  });

  it("uses a configured message stringifier for literals and Event values", () => {
    const stringifiers = new StringifierRegistry();
    stringifiers.register(EventIdSchema, {
      fromString: (value) => create(EventIdSchema, { value: value.replace(/^message:/, "") }),
      toString: (value) => `message:${value.value}`,
    });
    const plan = EventHandlerFilters.compile(
      [candidate("announcements", "id", "message:announcements")],
      stringifiers,
    );
    stringifiers.register(EventIdSchema, {
      fromString: () => {
        throw new Error("mutated registry");
      },
      toString: () => {
        throw new Error("mutated registry");
      },
    });

    expect(plan.select(create(EventSchema, { id: { value: "announcements" } }))).toEqual([
      "announcements",
    ]);
  });

  it("does not match a missing optional intermediate message", () => {
    const plan = EventHandlerFilters.compile([
      candidate("payload", "message.type_url", "type.example/Message"),
    ]);

    expect(plan.select(create(EventSchema))).toEqual([]);
    expect(plan.select(null)).toEqual([]);
  });

  it("resolves oneof fields by their Proto source names", () => {
    const plan = EventHandlerFilters.compile([
      candidate("payload", "context.past_message.message.type_url", "type.example/Message"),
    ]);

    expect(
      plan.select(
        create(EventSchema, {
          context: {
            origin: {
              case: "pastMessage",
              value: { message: { typeUrl: "type.example/Message" } },
            },
          },
        }),
      ),
    ).toEqual(["payload"]);
    expect(plan.select(create(EventSchema, { context: {} }))).toEqual([]);
  });

  it("rejects conflicting paths, canonical values, and fallbacks", () => {
    expect(() =>
      EventHandlerFilters.compile([
        candidate("one", "id.value", "one"),
        candidate("two", "context.actor.value", "two"),
      ]),
    ).toThrow(/same Event field path/);
    expect(() =>
      EventHandlerFilters.compile([
        candidate("one", "id.value", "same"),
        candidate("two", "id.value", "same"),
      ]),
    ).toThrow(/duplicate canonical value/);
    expect(() =>
      EventHandlerFilters.compile([
        candidate("one", "id", '{"value":"same"}'),
        candidate("two", "id", '{ "value": "same" }'),
      ]),
    ).toThrow(/duplicate canonical value/);
    expect(() =>
      EventHandlerFilters.compile([
        candidate("filtered", "id.value", "filtered"),
        candidate("one"),
        candidate("two"),
      ]),
    ).toThrow(/more than one unfiltered fallback/);
    expect(() =>
      EventHandlerFilters.compile([
        candidate("event", "id.value", "same"),
        {
          value: "context",
          schema: CommandContextSchema,
          where: { eventField: "id.value", equals: "same" },
        },
      ]),
    ).toThrow(/same Event type/);
  });

  it("preserves multiple ordinary handlers when no filter is declared", () => {
    const plan = EventHandlerFilters.compile([candidate("one"), candidate("two")]);

    expect(plan.select(create(EventSchema))).toEqual(["one", "two"]);
  });

  it("rejects unknown, repeated, and non-message intermediate fields", () => {
    expect(() => EventHandlerFilters.compile([candidate("unknown", "unknown", "value")])).toThrow(
      /unknown field/,
    );
    expect(() =>
      EventHandlerFilters.compile([
        {
          value: "repeated",
          schema: CompositeFilterSchema,
          where: { eventField: "filter", equals: "value" },
        },
      ]),
    ).toThrow(/unsupported repeated or map field/);
    expect(() =>
      EventHandlerFilters.compile([
        {
          value: "map",
          schema: CommandContextSchema,
          where: { eventField: "attributes", equals: "value" },
        },
      ]),
    ).toThrow(/unsupported repeated or map field/);
    expect(() =>
      EventHandlerFilters.compile([candidate("scalar", "id.value.part", "value")]),
    ).toThrow(/intermediate field.*message/);
  });
});

function candidate(value: string, eventField?: string, equals?: string) {
  return {
    value,
    schema: EventSchema,
    ...(eventField === undefined || equals === undefined ? {} : { where: { eventField, equals } }),
  };
}
