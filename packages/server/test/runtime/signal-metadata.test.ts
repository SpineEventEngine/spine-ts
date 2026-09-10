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
import {
  BoolValueSchema,
  DoubleValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { TypeUrls, AnyMessages } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  CommandSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  OriginSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { FixedClock, SignalMetadata } from "../../src/runtime/signal-metadata.js";

describe("SignalMetadata", () => {
  it("creates fresh ids, timestamps, and actor/tenant command contexts", () => {
    const metadata = new SignalMetadata({
      clock: new FixedClock(new Date("2026-07-09T10:11:12.345Z")),
    });

    expect(metadata.commandId().uuid).toMatch(UUID_PATTERN);
    expect(metadata.eventId().value).toMatch(UUID_PATTERN);
    expect(metadata.timestamp()).toEqual(timestampFor(new Date("2026-07-09T10:11:12.345Z")));
    expect(
      metadata.commandContext({
        actor: create(UserIdSchema, { value: "user-1" }),
        tenantId: createTenantId("tenant-1"),
      }),
    ).toEqual(
      create(CommandContextSchema, {
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "user-1" }),
          tenantId: createTenantId("tenant-1"),
        }),
      }),
    );
  });

  it("generates distinct UUID identifiers for new commands and events by default", () => {
    const metadata = new SignalMetadata();
    const commandIds = [metadata.commandId().uuid, metadata.commandId().uuid];
    const eventIds = [metadata.eventId().value, metadata.eventId().value];

    for (const id of [...commandIds, ...eventIds]) expect(id).toMatch(UUID_PATTERN);
    expect(new Set([...commandIds, ...eventIds]).size).toBe(4);
  });

  it("creates follow-up event and command metadata from source signals", () => {
    const timestamp = new Date("2026-07-09T11:12:13.456Z");
    const metadata = new SignalMetadata({
      clock: new FixedClock(timestamp),
    });
    const actorContext = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "user-1" }),
      tenantId: createTenantId("tenant-1"),
    });
    const grandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: TypeUrls.derive(UserIdSchema),
      }),
      actorContext,
    });
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "source-command" }),
      context: create(CommandContextSchema, {
        actorContext,
        origin: grandOrigin,
      }),
      message: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "payload-user" })),
    });

    const eventMetadata = metadata.eventFromCommand(command, {
      producerId: "task-1",
      version: 7,
    });

    expect(eventMetadata.id.value).toMatch(UUID_PATTERN);
    expect(eventMetadata.context.timestamp).toEqual(timestampFor(timestamp));
    expect(eventMetadata.context.producerId).toBeDefined();
    expect(
      eventMetadata.context.producerId === undefined
        ? undefined
        : AnyMessages.unpack(eventMetadata.context.producerId, StringValueSchema)?.value,
    ).toBe("task-1");
    expect(eventMetadata.context.version?.number).toBe(7);
    expect(eventMetadata.context.origin).toEqual({
      case: "pastMessage",
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(
            CommandIdSchema,
            create(CommandIdSchema, { uuid: "source-command" }),
          ),
          typeUrl: TypeUrls.derive(UserIdSchema),
        }),
        actorContext,
        grandOrigin,
      }),
    });

    const sourceEvent = create(EventSchema, {
      id: create(EventIdSchema, { value: "source-event" }),
      context: create(EventContextSchema, {
        origin: {
          case: "importContext",
          value: actorContext,
        },
      }),
      message: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "payload-user" })),
    });

    const commandMetadata = metadata.commandFromEvent(sourceEvent);
    expect(commandMetadata.id.uuid).toMatch(UUID_PATTERN);
    expect(commandMetadata.context).toEqual(
      create(CommandContextSchema, {
        actorContext,
        origin: create(OriginSchema, {
          message: create(MessageIdSchema, {
            id: AnyMessages.pack(EventIdSchema, create(EventIdSchema, { value: "source-event" })),
            typeUrl: TypeUrls.derive(UserIdSchema),
          }),
          actorContext,
        }),
      }),
    );
  });

  it("assigns fresh identifiers to framework-created signals without changing source envelopes", () => {
    const metadata = new SignalMetadata();
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "existing-command-id" }),
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "existing-event-id" }),
    });

    const ids = [
      metadata.commandFromCommand(command).id.uuid,
      metadata.commandFromEvent(event).id.uuid,
      metadata.eventFromCommand(command, {}).id.value,
      metadata.eventFromEvent(event, {}).id.value,
    ];
    for (const id of ids) expect(id).toMatch(UUID_PATTERN);
    expect(new Set(ids).size).toBe(4);
    expect(command.id).toEqual(create(CommandIdSchema, { uuid: "existing-command-id" }));
    expect(event.id).toEqual(create(EventIdSchema, { value: "existing-event-id" }));
  });

  it("normalizes pre-epoch timestamps with floor-style seconds and nanos", () => {
    const metadata = new SignalMetadata();

    expect(metadata.timestamp(new Date(-1))).toEqual(
      create(TimestampSchema, {
        seconds: -1n,
        nanos: 999_000_000,
      }),
    );
    expect(metadata.timestamp(new Date(-1_234))).toEqual(
      create(TimestampSchema, {
        seconds: -2n,
        nanos: 766_000_000,
      }),
    );
  });

  it("rejects non-finite, non-integer, and out-of-range version numbers", () => {
    const metadata = new SignalMetadata();

    expect(() => metadata.version(Number.NaN)).toThrow(/int32/i);
    expect(() => metadata.version(1.5)).toThrow(/int32/i);
    expect(() => metadata.version(2_147_483_648)).toThrow(/int32/i);
  });

  it("creates only requested optional context and producer metadata", () => {
    const metadata = new SignalMetadata({
      clock: new FixedClock(new Date("2026-07-09T12:00:00.000Z")),
    });
    const actorContext = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "user-explicit" }),
    });
    const origin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "command-origin" })),
        typeUrl: TypeUrls.derive(UserIdSchema),
      }),
    });

    expect(metadata.actorContext()).toEqual(create(ActorContextSchema));
    expect(metadata.commandContext({ actorContext, origin })).toEqual(
      create(CommandContextSchema, {
        actorContext,
        origin,
      }),
    );
    expect(metadata.eventContext()).toEqual(
      create(EventContextSchema, {
        timestamp: timestampFor(new Date("2026-07-09T12:00:00.000Z")),
      }),
    );

    const booleanProducer = metadata.eventContext({ producerId: true });
    const numericProducer = metadata.eventContext({ producerId: 42 });
    const int64Producer = metadata.eventContext({ producerId: 42n });

    expect(
      booleanProducer.producerId === undefined
        ? undefined
        : AnyMessages.unpack(booleanProducer.producerId, BoolValueSchema)?.value,
    ).toBe(true);
    expect(
      numericProducer.producerId === undefined
        ? undefined
        : AnyMessages.unpack(numericProducer.producerId, DoubleValueSchema)?.value,
    ).toBe(42);
    expect(
      int64Producer.producerId === undefined
        ? undefined
        : AnyMessages.unpack(int64Producer.producerId, Int64ValueSchema)?.value,
    ).toBe(42n);
    expect(metadata.producerId(undefined)).toBeUndefined();
  });

  it("rejects missing or empty event ids before deriving causality", () => {
    const metadata = new SignalMetadata();
    const eventMessage = AnyMessages.pack(
      UserIdSchema,
      create(UserIdSchema, { value: "payload-user" }),
    );

    expect(() =>
      metadata.commandFromEvent(
        create(EventSchema, {
          message: eventMessage,
        }),
      ),
    ).toThrow(/event ID/i);
    expect(() =>
      metadata.commandFromEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "" }),
          message: eventMessage,
        }),
      ),
    ).toThrow(/event ID/i);
  });

  it("rejects missing or empty command ids before deriving event metadata", () => {
    const metadata = new SignalMetadata();
    const commandMessage = AnyMessages.pack(
      UserIdSchema,
      create(UserIdSchema, { value: "payload-user" }),
    );

    expect(() =>
      metadata.eventFromCommand(
        create(CommandSchema, {
          message: commandMessage,
        }),
        {},
      ),
    ).toThrow(/command ID/i);
    expect(() =>
      metadata.eventFromCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: " " }),
          message: commandMessage,
        }),
        {},
      ),
    ).toThrow(/command ID/i);
  });

  it("rejects whitespace-only event ids before deriving causality", () => {
    const metadata = new SignalMetadata();
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "   " }),
      message: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "payload-user" })),
    });

    expect(() => metadata.commandFromEvent(event)).toThrow(/event ID/i);
    expect(() => metadata.eventFromEvent(event, { version: 1 })).toThrow(/event ID/i);
  });

  it("omits non-finite numeric producer ids from event metadata", () => {
    const metadata = new SignalMetadata();

    expect(metadata.eventContext({ producerId: Number.NaN }).producerId).toBeUndefined();
    expect(
      metadata.eventContext({ producerId: Number.POSITIVE_INFINITY }).producerId,
    ).toBeUndefined();
  });

  it("preserves past event origins without actor context", () => {
    const metadata = new SignalMetadata();
    const grandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "grand-command" })),
        typeUrl: TypeUrls.derive(UserIdSchema),
      }),
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "past-event" }),
      context: create(EventContextSchema, {
        origin: {
          case: "pastMessage",
          value: grandOrigin,
        },
      }),
      message: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "payload-user" })),
    });

    expect(metadata.originFromEvent(event)).toEqual(
      create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(EventIdSchema, create(EventIdSchema, { value: "past-event" })),
          typeUrl: TypeUrls.derive(UserIdSchema),
        }),
        grandOrigin,
      }),
    );
  });

  it("rejects invalid fixed clock dates", () => {
    expect(() => new FixedClock(new Date(Number.NaN))).toThrow(/finite Date/i);
  });

  it("clones nested actor-context inputs before returning them", () => {
    const metadata = new SignalMetadata();
    const actor = create(UserIdSchema, { value: "user-1" });
    const tenantId = createTenantId("tenant-1");

    const context = metadata.actorContext({ actor, tenantId });
    actor.value = "mutated-user";
    if (tenantId.kind.case === "value") {
      tenantId.kind.value = "mutated-tenant";
    }

    expect(context).toEqual(
      create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
        tenantId: createTenantId("tenant-1"),
      }),
    );
  });
});

function createTenantId(value: string) {
  return create(TenantIdSchema, {
    kind: {
      case: "value",
      value,
    },
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function timestampFor(value: Date) {
  const milliseconds = value.getTime();
  const seconds = Math.floor(milliseconds / 1_000);
  const nanos = (milliseconds - seconds * 1_000) * 1_000_000;

  return create(TimestampSchema, {
    seconds: BigInt(seconds),
    nanos,
  });
}
