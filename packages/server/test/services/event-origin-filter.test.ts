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
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages, TypeUrls } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  FieldPathSchema,
  MessageIdSchema,
  OriginSchema,
  type Origin,
} from "@spine-event-engine/proto";
import {
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  FilterSchema,
  Filter_Operator,
  TargetFiltersSchema,
  type Filter,
} from "@spine-event-engine/proto/client";
import { describe, expect, it } from "vitest";

import { EventOriginFilters } from "../../src/stand/event-origin-filter.js";
import { CreateProjectSchema } from "../../test-fixtures/generated/repository-routing/project_commands_pb.js";
import { ProjectCreatedSchema } from "../../test-fixtures/generated/repository-routing/project_events_pb.js";

describe("Event origin filters", () => {
  it("matches the complete immediately preceding Origin", () => {
    const expected = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "command-1" })),
        typeUrl: TypeUrls.derive(CreateProjectSchema),
      }),
      actorContext: create(ActorContextSchema, {
        actor: { value: "alice" },
        timestamp: { seconds: 100n },
        zoneId: { value: "Europe/Lisbon" },
      }),
    });
    const filters = create(TargetFiltersSchema, {
      filter: [
        create(CompositeFilterSchema, {
          operator: CompositeFilter_CompositeOperator.ALL,
          filter: [
            create(FilterSchema, {
              fieldPath: { fieldName: ["context", "past_message"] },
              operator: Filter_Operator.EQUAL,
              value: AnyMessages.pack(OriginSchema, expected),
            }),
          ],
        }),
      ],
    });
    const matches = EventOriginFilters.compile(filters);
    expect(
      matches(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-1" }),
          message: AnyMessages.pack(
            ProjectCreatedSchema,
            create(ProjectCreatedSchema, {
              id: "project-1",
              name: "First",
              priority: 1,
            }),
          ),
          context: create(EventContextSchema, { origin: { case: "pastMessage", value: expected } }),
        }),
      ),
    ).toBe(true);
    expect(
      matches(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-2" }),
          message: AnyMessages.pack(
            ProjectCreatedSchema,
            create(ProjectCreatedSchema, {
              id: "project-1",
              name: "First",
              priority: 1,
            }),
          ),
          context: create(EventContextSchema, {
            origin: {
              case: "pastMessage",
              value: create(OriginSchema, {
                message: expected.message,
                actorContext: create(ActorContextSchema, {
                  actor: { value: "bob" },
                  timestamp: { seconds: 100n },
                  zoneId: { value: "Europe/Lisbon" },
                }),
              }),
            },
          }),
        }),
      ),
    ).toBe(false);
  });

  it("rejects malformed and unsupported expected origins while leaving opaque Any bytes intact", () => {
    const origin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "command-2" })),
        typeUrl: TypeUrls.derive(CreateProjectSchema),
      }),
    });
    const filterFor = (value: Uint8Array, typeUrl = TypeUrls.derive(OriginSchema)) =>
      create(TargetFiltersSchema, {
        filter: [
          create(CompositeFilterSchema, {
            operator: CompositeFilter_CompositeOperator.ALL,
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["context", "past_message"] },
                operator: Filter_Operator.EQUAL,
                value: create(AnySchema, { typeUrl, value }),
              }),
            ],
          }),
        ],
      });
    const bytes = toBinary(OriginSchema, origin);
    const withUnknown = Uint8Array.from([...bytes, 0xa0, 0x06, 0x01]);
    expect(() => EventOriginFilters.compile(filterFor(Uint8Array.of(0xff)))).toThrow(
      "malformed Origin bytes",
    );
    expect(() =>
      EventOriginFilters.compile(filterFor(bytes, TypeUrls.derive(CreateProjectSchema))),
    ).toThrow("must pack spine.core.Origin");
    expect(() => EventOriginFilters.compile(filterFor(withUnknown))).toThrow(
      "unsupported unknown fields",
    );
    const matches = EventOriginFilters.compile(filterFor(bytes));
    const event = (actual: typeof origin) =>
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-3" }),
        message: AnyMessages.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, {
            id: "project-2",
            name: "Second",
            priority: 1,
          }),
        ),
        context: create(EventContextSchema, { origin: { case: "pastMessage", value: actual } }),
      });
    expect(matches(event(origin))).toBe(true);
    expect(matches(event(fromBinary(OriginSchema, withUnknown)))).toBe(false);
  });

  it("matches grandOrigin through nested ALL/EITHER and rejects unsupported filter shapes", () => {
    const prior = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "grand-command" })),
        typeUrl: TypeUrls.derive(CreateProjectSchema),
      }),
      actorContext: create(ActorContextSchema, {
        actor: { value: "alice" },
        timestamp: { seconds: 100n },
        zoneId: { value: "Europe/Lisbon" },
      }),
    });
    const expected = create(OriginSchema, {
      message: prior.message,
      actorContext: prior.actorContext,
      grandOrigin: prior,
    });
    const different = create(OriginSchema, {
      message: prior.message,
      actorContext: expected.actorContext,
      grandOrigin: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "other-grand" })),
          typeUrl: TypeUrls.derive(CreateProjectSchema),
        }),
        actorContext: prior.actorContext,
      }),
    });
    const criterion = create(FilterSchema, {
      fieldPath: { fieldName: ["context", "past_message"] },
      operator: Filter_Operator.EQUAL,
      value: AnyMessages.pack(OriginSchema, expected),
    });
    const nested = create(TargetFiltersSchema, {
      filter: [
        create(CompositeFilterSchema, {
          operator: CompositeFilter_CompositeOperator.ALL,
          compositeFilter: [
            create(CompositeFilterSchema, {
              operator: CompositeFilter_CompositeOperator.EITHER,
              filter: [criterion],
            }),
          ],
        }),
      ],
    });
    const matches = EventOriginFilters.compile(nested);
    expect(matches(projectEventWithOrigin(expected))).toBe(true);
    expect(matches(projectEventWithOrigin(different))).toBe(false);
    expect(() => EventOriginFilters.compile(create(TargetFiltersSchema))).toThrow("nonempty");
    expect(() =>
      EventOriginFilters.compile(
        create(TargetFiltersSchema, {
          idFilter: { id: [] },
          filter: nested.filter,
        }),
      ),
    ).toThrow("without id_filter");
    expect(() =>
      EventOriginFilters.compile(
        singleOriginCriterion(
          create(FilterSchema, {
            ...criterion,
            fieldPath: create(FieldPathSchema, { fieldName: ["message"] }),
          }),
        ),
      ),
    ).toThrow("only context.past_message EQUAL Origin");
    expect(() =>
      EventOriginFilters.compile(
        singleOriginCriterion(
          create(FilterSchema, {
            ...criterion,
            operator: Filter_Operator.GREATER_THAN,
          }),
        ),
      ),
    ).toThrow("only context.past_message EQUAL Origin");
  });
});

function singleOriginCriterion(filter: Filter) {
  return create(TargetFiltersSchema, {
    filter: [
      create(CompositeFilterSchema, {
        operator: CompositeFilter_CompositeOperator.ALL,
        filter: [filter],
      }),
    ],
  });
}

function projectEventWithOrigin(origin: Origin) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: "grand-origin-event" }),
    message: AnyMessages.pack(
      ProjectCreatedSchema,
      create(ProjectCreatedSchema, {
        id: "project-grand",
        name: "Grand",
        priority: 1,
      }),
    ),
    context: create(EventContextSchema, { origin: { case: "pastMessage", value: origin } }),
  });
}
