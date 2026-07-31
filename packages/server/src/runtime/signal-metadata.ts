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
import { AnyMessages } from "@spine-event-engine/core";
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

/**
 * Supplies the current wall-clock time for signal metadata.
 */
export interface Clock {
  // prettier-ignore

  /**
   * Returns the current wall-clock time.
   *
   * @returns Current time as a `Date`.
   */
  now(): Date;
}

/**
 * Supplies system wall-clock time.
 */
export class SystemClock implements Clock {
  // prettier-ignore

  /**
   * Returns the current system time.
   *
   * @returns Current system time.
   */
  now(): Date {
    return new Date();
  }
}

/**
 * Supplies a fixed wall-clock time for deterministic work.
 */
export class FixedClock implements Clock {
  readonly #value: number;

  /**
   * Creates a clock fixed at one time.
   *
   * @param value Finite time to return from `now()`.
   */
  constructor(value: Date) {
    this.#value = SignalValues.time(value).getTime();
  }

  /**
   * Returns a fresh date at the configured time.
   *
   * @returns Fixed time.
   */
  now(): Date {
    return new Date(this.#value);
  }
}

/**
 * Creates validated command and event identifiers.
 */
export class SignalIds {
  readonly #next: () => string;

  /**
   * Creates an identifier source.
   *
   * @param next Function that supplies a new identifier when one is omitted.
   */
  constructor(next: () => string = randomUUID) {
    this.#next = next;
  }

  /**
   * Creates a validated command identifier.
   *
   * @param uuid Command UUID, generated when omitted.
   * @returns Command identifier.
   */
  command(uuid: string = this.#next()): CommandId {
    return create(CommandIdSchema, { uuid: SignalValues.command(uuid) });
  }

  /**
   * Creates a validated event identifier.
   *
   * @param value Event identifier value, generated when omitted.
   * @returns Event identifier.
   */
  event(value: string = this.#next()): EventId {
    return create(EventIdSchema, { value: SignalValues.event(value) });
  }
}

/**
 * Configures the sources used to create signal metadata.
 */
export interface SignalMetadataOptions {
  // prettier-ignore

  /**
   * Supplies timestamps; defaults to {@link SystemClock}.
   */
  readonly clock?: Clock;

  /**
   * Supplies command and event identifiers; defaults to {@link SignalIds}.
   */
  readonly ids?: SignalIds;
}

/**
 * Supplies optional actor and tenant data for a signal context.
 */
export interface ActorContextInput {
  // prettier-ignore

  /**
   * Identifies the acting user.
   */
  readonly actor?: ActorContext["actor"];

  /**
   * Identifies the tenant that contains the signal.
   */
  readonly tenantId?: ActorContext["tenantId"];
}

/**
 * Supplies actor and origin data for a command context.
 */
export interface CommandContextInput extends ActorContextInput {
  // prettier-ignore

  /**
   * Provides a prebuilt actor context in preference to separate actor fields.
   */
  readonly actorContext?: ActorContext;

  /**
   * Provides the signal origin.
   */
  readonly origin?: Origin;
}

/**
 * Supplies producer, version, and origin data for an event context.
 */
export interface EventContextInput {
  // prettier-ignore

  /**
   * Identifies the event producer with a supported scalar identifier.
   */
  readonly producerId?: string | number | boolean;

  /**
   * Declares the signed 32-bit event version.
   */
  readonly version?: number;

  /**
   * Provides the origin signal.
   */
  readonly origin?: Origin;
}

/**
 * Creates immutable metadata for commands and events.
 */
export class SignalMetadata {
  readonly #clock: Clock;
  readonly #ids: SignalIds;

  /**
   * Creates a metadata factory.
   *
   * @param options Optional clock and identifier sources.
   */
  constructor(options: SignalMetadataOptions = {}) {
    this.#clock = options.clock ?? new SystemClock();
    this.#ids = options.ids ?? new SignalIds();
  }

  /**
   * Creates a command identifier.
   *
   * @param uuid Optional command UUID.
   * @returns Validated command identifier.
   */
  commandId(uuid?: string): CommandId {
    return this.#ids.command(uuid);
  }

  /**
   * Creates an event identifier.
   *
   * @param value Optional event identifier value.
   * @returns Validated event identifier.
   */
  eventId(value?: string): EventId {
    return this.#ids.event(value);
  }

  /**
   * Creates a Protobuf timestamp from a finite date.
   *
   * @param value Date to convert; defaults to the configured clock.
   * @returns Protobuf timestamp.
   */
  timestamp(value: Date = this.#clock.now()): Timestamp {
    const date = SignalValues.time(value);
    const milliseconds = date.getTime();
    const seconds = Math.floor(milliseconds / 1_000);
    const nanos = (milliseconds - seconds * 1_000) * 1_000_000;

    return create(TimestampSchema, {
      seconds: BigInt(seconds),
      nanos,
    });
  }

  /**
   * Creates an actor context from actor and tenant input.
   *
   * @param input Optional actor and tenant values.
   * @returns Cloned actor context.
   */
  actorContext(input: ActorContextInput = {}): ActorContext {
    return create(ActorContextSchema, {
      ...(input.actor === undefined ? {} : { actor: clone(UserIdSchema, input.actor) }),
      ...(input.tenantId === undefined ? {} : { tenantId: clone(TenantIdSchema, input.tenantId) }),
    });
  }

  /**
   * Creates a command context from actor and origin input.
   *
   * @param input Optional actor context and origin values.
   * @returns Cloned command context.
   */
  commandContext(input: CommandContextInput = {}): CommandContext {
    const actorContext = input.actorContext ?? this.#actorContext(input);

    return create(CommandContextSchema, {
      ...(actorContext === undefined
        ? {}
        : { actorContext: clone(ActorContextSchema, actorContext) }),
      ...(input.origin === undefined ? {} : { origin: clone(OriginSchema, input.origin) }),
    });
  }

  /**
   * Creates an event context with a timestamp and optional causal data.
   *
   * @param input Optional producer, version, and origin values.
   * @returns Event context.
   */
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

  /**
   * Creates an origin from a command.
   *
   * @param command Source command.
   * @returns Origin that preserves actor and grand-origin context.
   */
  originFromCommand(command: Command): Origin {
    return create(OriginSchema, {
      message: this.#messageId(
        AnyMessages.pack(CommandIdSchema, this.#commandId(command)),
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

  /**
   * Creates an origin from an event.
   *
   * @param event Source event.
   * @returns Origin that preserves causal context.
   */
  originFromEvent(event: Event): Origin {
    const actorContext = this.#eventActor(event);
    const grandOrigin = this.#grandOrigin(event);

    return create(OriginSchema, {
      message: this.#messageId(
        AnyMessages.pack(EventIdSchema, this.#eventId(event)),
        event.message?.typeUrl,
      ),
      ...(actorContext === undefined ? {} : { actorContext }),
      ...(grandOrigin === undefined ? {} : { grandOrigin }),
    });
  }

  /**
   * Packs a supported finite scalar producer identifier.
   *
   * @param value Candidate producer identifier.
   * @returns Packed value, or `undefined` when it is unsupported.
   */
  producerId(value: string | number | boolean | undefined): Any | undefined {
    switch (typeof value) {
      case "string":
        return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value }));
      case "boolean":
        return AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value }));
      case "number":
        return Number.isFinite(value)
          ? AnyMessages.pack(DoubleValueSchema, create(DoubleValueSchema, { value }))
          : undefined;
      default:
        return undefined;
    }
  }

  /**
   * Creates a signed 32-bit event version.
   *
   * @param number Finite integer version.
   * @returns Protobuf version.
   */
  version(number: number): Version {
    if (!Number.isInteger(number) || number < -2_147_483_648 || number > 2_147_483_647) {
      throw new Error("Signal metadata versions require a finite int32 number.");
    }

    return create(VersionSchema, { number });
  }

  /**
   * Creates command metadata from an event.
   *
   * @param event Source event.
   * @param sequence Causal sequence number.
   * @returns Derived command identifier and context.
   */
  commandFromEvent(
    event: Event,
    sequence: number,
  ): { readonly id: CommandId; readonly context: CommandContext } {
    const actorContext = this.#eventActor(event);

    return {
      id: this.commandId(this.#causalId(this.#eventId(event).value, sequence)),
      context: this.commandContext({
        ...(actorContext === undefined ? {} : { actorContext }),
        origin: this.originFromEvent(event),
      }),
    };
  }

  /**
   * Creates event metadata from a command.
   *
   * @param command Source command.
   * @param sequence Causal sequence number.
   * @param input Additional event context input.
   * @returns Derived event identifier and context.
   */
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
      id: this.eventId(this.#causalId(this.#commandId(command).uuid, sequence)),
      context: this.eventContext(context),
    };
  }

  /**
   * Creates event metadata from an event.
   *
   * @param event Source event.
   * @param sequence Causal sequence number.
   * @param input Additional event context input.
   * @returns Derived event identifier and context.
   */
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
      id: this.eventId(this.#causalId(this.#eventId(event).value, sequence)),
      context: this.eventContext(context),
    };
  }

  #messageId(id: Any, typeUrl: string | undefined) {
    return create(MessageIdSchema, {
      id,
      typeUrl: typeUrl ?? "",
    });
  }
  #actorContext(input: ActorContextInput): ActorContext | undefined {
    return input.actor === undefined && input.tenantId === undefined
      ? undefined
      : this.actorContext(input);
  }

  #eventActor(event: Event): ActorContext | undefined {
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

  #grandOrigin(event: Event): Origin | undefined {
    return event.context?.origin.case === "pastMessage"
      ? clone(OriginSchema, event.context.origin.value)
      : undefined;
  }

  #commandId(command: Command): NonNullable<Command["id"]> {
    if (command.id === undefined || command.id.uuid.trim().length === 0)
      throw new Error("Signal metadata requires a non-empty source command ID.");
    return command.id;
  }

  #eventId(event: Event): NonNullable<Event["id"]> {
    if (event.id === undefined || event.id.value.trim().length === 0)
      throw new Error("Signal metadata requires a non-empty source event ID.");
    return event.id;
  }

  #causalId(source: string, sequence: number): string {
    return `${source}-${sequence.toString()}`;
  }
}

/**
 * Validates values shared by the clock and identifier sources.
 */
const SignalValues = Object.freeze({
  time(value: Date): Date {
    if (!Number.isFinite(value.getTime()))
      throw new TypeError("Signal metadata timestamps require a finite Date instance.");
    return value;
  },
  command(value: string): string {
    if (value.trim().length === 0)
      throw new Error("Signal metadata command IDs require a non-empty command ID.");
    return value;
  },
  event(value: string): string {
    if (value.trim().length === 0)
      throw new Error("Signal metadata event IDs require a non-empty event ID.");
    return value;
  },
});
