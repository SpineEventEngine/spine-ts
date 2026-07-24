import { randomUUID } from "node:crypto";

import { clone, create } from "@bufbuild/protobuf";
import {
  BoolValueSchema,
  DoubleValueSchema,
  StringValueSchema,
  type Any,
  TimestampSchema,
  type Timestamp,
} from "@bufbuild/protobuf/wkt";
import { packAny } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  type ActorContext,
  CommandContextSchema,
  type Command,
  type CommandContext,
  CommandIdSchema,
  type CommandId,
  type Event,
  EventContextSchema,
  type EventContext,
  EventIdSchema,
  type EventId,
  MessageIdSchema,
  type Origin,
  OriginSchema,
  TenantIdSchema,
  UserIdSchema,
  type Version,
  VersionSchema,
} from "@spine-event-engine/proto";

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #value: number;

  constructor(value: Date) {
    this.#value = requireTime(value).getTime();
  }

  now(): Date {
    return new Date(this.#value);
  }
}

export class SignalIds {
  readonly #next: () => string;

  constructor(next: () => string = randomUUID) {
    this.#next = next;
  }

  command(uuid: string = this.#next()): CommandId {
    return create(CommandIdSchema, { uuid: requireCommandIdValue(uuid) });
  }

  event(value: string = this.#next()): EventId {
    return create(EventIdSchema, { value: requireEventIdValue(value) });
  }
}

export interface SignalMetadataOptions {
  readonly clock?: Clock;
  readonly ids?: SignalIds;
}

export interface ActorContextInput {
  readonly actor?: ActorContext["actor"];
  readonly tenantId?: ActorContext["tenantId"];
}

export interface CommandContextInput extends ActorContextInput {
  readonly actorContext?: ActorContext;
  readonly origin?: Origin;
}

export interface EventContextInput {
  readonly producerId?: string | number | boolean;
  readonly version?: number;
  readonly origin?: Origin;
}

export class SignalMetadata {
  readonly #clock: Clock;
  readonly #ids: SignalIds;

  constructor(options: SignalMetadataOptions = {}) {
    this.#clock = options.clock ?? new SystemClock();
    this.#ids = options.ids ?? new SignalIds();
  }

  commandId(uuid?: string): CommandId {
    return this.#ids.command(uuid);
  }

  eventId(value?: string): EventId {
    return this.#ids.event(value);
  }

  timestamp(value: Date = this.#clock.now()): Timestamp {
    const date = requireTime(value);
    const milliseconds = date.getTime();
    const seconds = Math.floor(milliseconds / 1_000);
    const nanos = (milliseconds - seconds * 1_000) * 1_000_000;

    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos,
    });
  }

  actorContext(input: ActorContextInput = {}): ActorContext {
    return create(ActorContextSchema, {
      ...(input.actor === undefined ? {} : { actor: clone(UserIdSchema, input.actor) }),
      ...(input.tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, input.tenantId) }),
    });
  }

  commandContext(input: CommandContextInput = {}): CommandContext {
    const actorContext = input.actorContext ?? readActorContext(input);

    return create(CommandContextSchema, {
      ...(actorContext === undefined
        ? {}
        : { actorContext: clone(ActorContextSchema, actorContext) }),
      ...(input.origin === undefined ? {} : { origin: clone(OriginSchema, input.origin) }),
    });
  }

  eventContext(input: EventContextInput = {}): EventContext {
    const producerId = this.producerId(input.producerId);

    return create(EventContextSchema, {
      timestamp: this.timestamp(),
      ...(producerId === undefined ? {} : { producerId }),
      ...(input.version === undefined ? {} : { version: this.version(input.version) }),
      ...(input.origin === undefined
        ? {}
        : {
            origin: {
              case: "pastMessage",
              value: clone(OriginSchema, input.origin),
            },
          }),
    });
  }

  originFromCommand(command: Command): Origin {
    return create(OriginSchema, {
      message: this.#messageId(
        packAny(CommandIdSchema, requireCommandId(command)),
        command.message?.typeUrl,
      ),
      ...(command.context?.actorContext === undefined
        ? {}
        : { actorContext: clone(ActorContextSchema, command.context.actorContext) }),
      ...(command.context?.origin === undefined
        ? {}
        : { grandOrigin: clone(OriginSchema, command.context.origin) }),
    });
  }

  originFromEvent(event: Event): Origin {
    const actorContext = readEventActorContext(event);
    const grandOrigin = readEventGrandOrigin(event);

    return create(OriginSchema, {
      message: this.#messageId(
        packAny(EventIdSchema, requireEventId(event)),
        event.message?.typeUrl,
      ),
      ...(actorContext === undefined ? {} : { actorContext }),
      ...(grandOrigin === undefined ? {} : { grandOrigin }),
    });
  }

  producerId(value: string | number | boolean | undefined): Any | undefined {
    switch (typeof value) {
      case "string":
        return packAny(StringValueSchema, create(StringValueSchema, { value }));
      case "boolean":
        return packAny(BoolValueSchema, create(BoolValueSchema, { value }));
      case "number":
        return Number.isFinite(value)
          ? packAny(DoubleValueSchema, create(DoubleValueSchema, { value }))
          : undefined;
      default:
        return undefined;
    }
  }

  version(number: number): Version {
    if (!Number.isInteger(number) || number < -2_147_483_648 || number > 2_147_483_647) {
      throw new Error("Signal metadata versions require a finite int32 number.");
    }

    return create(VersionSchema, { number });
  }

  commandFromEvent(
    event: Event,
    sequence: number,
  ): { readonly id: CommandId; readonly context: CommandContext } {
    const actorContext = readEventActorContext(event);

    return {
      id: this.commandId(causalId(requireEventId(event).value, sequence)),
      context: this.commandContext({
        ...(actorContext === undefined ? {} : { actorContext }),
        origin: this.originFromEvent(event),
      }),
    };
  }

  eventFromCommand(
    command: Command,
    sequence: number,
    input: EventContextInput,
  ): { readonly id: EventId; readonly context: EventContext } {
    const context = {
      ...(input.producerId === undefined ? {} : { producerId: input.producerId }),
      ...(input.version === undefined ? {} : { version: input.version }),
      origin: this.originFromCommand(command),
    } satisfies EventContextInput;

    return {
      id: this.eventId(causalId(requireCommandId(command).uuid, sequence)),
      context: this.eventContext(context),
    };
  }

  eventFromEvent(
    event: Event,
    sequence: number,
    input: EventContextInput,
  ): { readonly id: EventId; readonly context: EventContext } {
    const context = {
      ...(input.producerId === undefined ? {} : { producerId: input.producerId }),
      ...(input.version === undefined ? {} : { version: input.version }),
      origin: this.originFromEvent(event),
    } satisfies EventContextInput;

    return {
      id: this.eventId(causalId(requireEventId(event).value, sequence)),
      context: this.eventContext(context),
    };
  }

  #messageId(id: Any, typeUrl: string | undefined) {
    return create(MessageIdSchema, {
      id,
      typeUrl: typeUrl ?? "",
    });
  }
}

function readActorContext(input: ActorContextInput): ActorContext | undefined {
  return input.actor === undefined && input.tenantId === undefined
    ? undefined
    : create(ActorContextSchema, {
        ...(input.actor === undefined ? {} : { actor: clone(UserIdSchema, input.actor) }),
        ...(input.tenantId === undefined
          ? {}
          : { tenantId: clone(TenantIdSchema, input.tenantId) }),
      });
}

function readEventActorContext(event: Event): ActorContext | undefined {
  switch (event.context?.origin.case) {
    case "importContext":
      return clone(ActorContextSchema, event.context.origin.value);
    case "pastMessage":
      return event.context.origin.value.actorContext === undefined
        ? undefined
        : clone(ActorContextSchema, event.context.origin.value.actorContext);
    default:
      return undefined;
  }
}

function readEventGrandOrigin(event: Event): Origin | undefined {
  return event.context?.origin.case === "pastMessage"
    ? clone(OriginSchema, event.context.origin.value)
    : undefined;
}

function requireCommandId(command: Command): NonNullable<Command["id"]> {
  if (command.id === undefined || command.id.uuid.trim().length === 0) {
    throw new Error("Signal metadata requires a non-empty source command ID.");
  }

  return command.id;
}

function requireEventId(event: Event): NonNullable<Event["id"]> {
  if (event.id === undefined || event.id.value.trim().length === 0) {
    throw new Error("Signal metadata requires a non-empty source event ID.");
  }

  return event.id;
}

function requireCommandIdValue(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("Signal metadata command IDs require a non-empty command ID.");
  }

  return value;
}

function requireEventIdValue(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("Signal metadata event IDs require a non-empty event ID.");
  }

  return value;
}

function causalId(source: string, sequence: number): string {
  return `${source}-${sequence.toString()}`;
}

function requireTime(value: Date): Date {
  if (Number.isFinite(value.getTime())) {
    return value;
  }

  throw new TypeError("Signal metadata timestamps require a finite Date instance.");
}
