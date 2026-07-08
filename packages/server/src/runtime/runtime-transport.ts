import { clone, fromBinary, toBinary } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-ts/proto";
import type {
  SignalTransport,
  TransportSubscription,
  TransportSubscriptionHandle,
} from "@spine-ts/transport";
import {
  acceptSignalIntake,
  failSignalIntake,
  type SignalIntakeFailure,
  type SignalIntakeResult,
} from "./signal-intake.js";
import {
  createServerRuntimeRoutingPlan,
  type CommandRuntimeRoutingRoute,
  type EventRuntimeRoutingRoute,
  type ServerRuntimeRoutingPlan,
  type ServerRuntimeRoutingPlanInput,
} from "./runtime-routing.js";
import { ServerRuntimeStateError, SingleProcessServerRuntime } from "./runtime.js";

/** Command callback invoked from accepted transport-backed runtime work. */
export type CommandRuntimeTransportHandler = (
  command: Command,
  route: CommandRuntimeRoutingRoute,
) => void | Promise<void>;

/** Event callback invoked from accepted transport-backed runtime work. */
export type EventRuntimeTransportHandler = (
  event: Event,
  route: EventRuntimeRoutingRoute,
) => void | Promise<void>;

/** Input accepted when opening a runtime transport binding. */
export interface RuntimeTransportBindingInput {
  /** Immutable routing plan that supplies command responders and event subscribers. */
  readonly plan: ServerRuntimeRoutingPlan;
  /** Adapter-agnostic local signal transport. */
  readonly transport: SignalTransport;
  /** Runtime queue that owns accepted asynchronous work. */
  readonly runtime: SingleProcessServerRuntime;
  /** Callback for valid command envelopes after runtime intake. */
  readonly onCommand: CommandRuntimeTransportHandler;
  /** Callback for valid event envelopes after runtime intake. */
  readonly onEvent: EventRuntimeTransportHandler;
}

/** Idempotent close handle returned by a runtime transport binding. */
export interface RuntimeTransportBindingHandle {
  /**
   * Stop transport intake, close transport registrations, then close the bound
   * runtime.
   */
  close(): Promise<void>;
}

/** Error raised when a publish-style event signal is refused at runtime transport intake. */
export class RuntimeTransportEnvelopeError extends Error {
  /** Structured refusal result with sanitized diagnostics only. */
  readonly result: SignalIntakeFailure;

  constructor(result: SignalIntakeFailure) {
    super(formatEnvelopeError(result));
    this.name = "RuntimeTransportEnvelopeError";
    this.result = result;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Framework-owned executable binding between runtime routing plans and `SignalTransport`. */
export const RuntimeTransportBinding: Readonly<{
  /** Create the immutable runtime routing plan used by this binding. */
  plan(input: ServerRuntimeRoutingPlanInput): ServerRuntimeRoutingPlan;
  /**
   * Register command and event routes with a same-host/local-only supplied
   * transport.
   *
   * The binding does not own endpoint names, filesystem placement, or remote
   * access policy; those remain adapter-owned behind `SignalTransport`.
   * Inbound generated Spine command/event envelopes are parsed into clean
   * generated messages and validated before handler callbacks are enqueued.
   * Closing first stops binding intake, then closes transport registrations,
   * and finally closes the runtime after already accepted work drains.
   */
  open(input: RuntimeTransportBindingInput): Promise<RuntimeTransportBindingHandle>;
}> = Object.freeze({
  plan(input: ServerRuntimeRoutingPlanInput): ServerRuntimeRoutingPlan {
    return createServerRuntimeRoutingPlan(input);
  },

  async open(input: RuntimeTransportBindingInput): Promise<RuntimeTransportBindingHandle> {
    const binder = new RuntimeTransportBinder(input);

    return await binder.open();
  },
});

class RuntimeTransportBinder {
  readonly #input: RuntimeTransportBindingInput;
  readonly #handles: TransportSubscriptionHandle[] = [];
  readonly #gate = new RuntimeTransportBindingGate();

  constructor(input: RuntimeTransportBindingInput) {
    this.#input = input;
  }

  async open(): Promise<RuntimeTransportBindingHandle> {
    try {
      await this.#input.runtime.start();
      await this.#registerCommands();
      await this.#registerEvents();

      return new RuntimeTransportHandle(this.#handles, this.#input.runtime, this.#gate);
    } catch (error) {
      await new RuntimeTransportHandle(this.#handles, this.#input.runtime, this.#gate).close();
      throw error;
    }
  }

  async #registerCommands(): Promise<void> {
    const subscriptions = subscriptionMap(this.#input.plan.commands.subscriptions);

    for (const route of this.#input.plan.commands.routes) {
      const subscription = requireSubscription(subscriptions, route.subscriptionDescriptorKey);
      const handle = await this.#input.transport.respond(subscription, (operation) =>
        this.#acceptCommand(route, operation.envelope),
      );
      this.#handles.push(handle);
    }
  }

  async #registerEvents(): Promise<void> {
    const subscriptions = subscriptionMap(this.#input.plan.events.subscriptions);
    const routes = [
      ...this.#input.plan.events.subscriberRoutes,
      ...this.#input.plan.events.reactorRoutes,
      ...this.#input.plan.events.applicationRoutes,
    ];

    for (const route of routes) {
      const subscription = requireSubscription(subscriptions, route.subscriptionDescriptorKey);
      const handle = await this.#input.transport.subscribe(subscription, (operation) => {
        this.#acceptEvent(route, operation.envelope);
      });
      this.#handles.push(handle);
    }
  }

  #acceptCommand(route: CommandRuntimeRoutingRoute, envelope: unknown): SignalIntakeResult {
    if (!this.#gate.isAccepting) {
      return runtimeFailure("command", this.#input);
    }

    const command = validateCommandEnvelope(envelope, route.message.typeUrl, this.#input);

    if (command.status === "failed") {
      return command;
    }

    try {
      void this.#input.runtime
        .enqueue(() => this.#input.onCommand(clone(CommandSchema, command.envelope), route))
        .catch(() => undefined);
    } catch (error) {
      if (error instanceof ServerRuntimeStateError) {
        return runtimeFailure("command", this.#input);
      }
      throw error;
    }

    return acceptSignalIntake("command");
  }

  #acceptEvent(route: EventRuntimeRoutingRoute, envelope: unknown): void {
    if (!this.#gate.isAccepting) {
      throw new RuntimeTransportEnvelopeError(runtimeFailure("event", this.#input));
    }

    const event = validateEventEnvelope(envelope, route.message.typeUrl, this.#input);

    if (event.status === "failed") {
      throw new RuntimeTransportEnvelopeError(event);
    }

    try {
      void this.#input.runtime
        .enqueue(() => this.#input.onEvent(clone(EventSchema, event.envelope), route))
        .catch(() => undefined);
    } catch (error) {
      if (error instanceof ServerRuntimeStateError) {
        throw new RuntimeTransportEnvelopeError(runtimeFailure("event", this.#input));
      }
      throw error;
    }
  }
}

class RuntimeTransportBindingGate {
  #state: "open" | "closing" | "closed" = "open";

  get isAccepting(): boolean {
    return this.#state === "open";
  }

  beginClose(): void {
    if (this.#state === "open") {
      this.#state = "closing";
    }
  }

  finishClose(): void {
    this.#state = "closed";
  }
}

class RuntimeTransportHandle implements RuntimeTransportBindingHandle {
  readonly #handles: readonly TransportSubscriptionHandle[];
  readonly #runtime: SingleProcessServerRuntime;
  readonly #gate: RuntimeTransportBindingGate;
  #close: Promise<void> | undefined;

  constructor(
    handles: readonly TransportSubscriptionHandle[],
    runtime: SingleProcessServerRuntime,
    gate: RuntimeTransportBindingGate,
  ) {
    this.#handles = Object.freeze([...handles]);
    this.#runtime = runtime;
    this.#gate = gate;
  }

  close(): Promise<void> {
    if (this.#close === undefined) {
      this.#close = this.#closeAll().catch((error: unknown) => {
        this.#close = undefined;
        throw error;
      });
    }

    return this.#close;
  }

  async #closeAll(): Promise<void> {
    this.#gate.beginClose();
    const failures: Error[] = [];

    for (const handle of this.#handles) {
      try {
        await handle.close();
      } catch (error) {
        failures.push(toError(error));
      }
    }

    try {
      await this.#runtime.close();
      this.#gate.finishClose();
    } catch (error) {
      failures.push(toError(error));
    }

    if (failures.length > 0) {
      throw closeFailure(failures);
    }
  }
}

type EnvelopeResult<Kind extends "command" | "event", Envelope> =
  { readonly status: "accepted"; readonly envelope: Envelope } | SignalIntakeFailure<Kind>;

function validateCommandEnvelope(
  envelope: unknown,
  expectedTypeUrl: string,
  input: RuntimeTransportBindingInput,
): EnvelopeResult<"command", Command> {
  return validateEnvelope(
    "command",
    CommandSchema.typeName,
    envelope,
    expectedTypeUrl,
    input,
    (record) => parseCommandEnvelope(record),
  );
}

function validateEventEnvelope(
  envelope: unknown,
  expectedTypeUrl: string,
  input: RuntimeTransportBindingInput,
): EnvelopeResult<"event", Event> {
  return validateEnvelope(
    "event",
    EventSchema.typeName,
    envelope,
    expectedTypeUrl,
    input,
    (record) => parseEventEnvelope(record),
  );
}

function validateEnvelope<Kind extends "command" | "event", Envelope>(
  signalKind: Kind,
  envelopeTypeName: string,
  envelope: unknown,
  expectedTypeUrl: string,
  input: RuntimeTransportBindingInput,
  parse: (envelope: Record<string, unknown>) => Envelope | undefined,
): EnvelopeResult<Kind, Envelope> {
  if (!isRecord(envelope)) {
    return envelopeFailure(signalKind, input, "envelope must be an object");
  }

  const typeName = readOwnValue(envelope, "$typeName");
  const message = readOwnValue(envelope, "message");

  if (typeName !== envelopeTypeName) {
    return envelopeFailure(signalKind, input, "unexpected envelope type", readTypeUrl(message));
  }
  if (!isRecord(message)) {
    return envelopeFailure(signalKind, input, "missing message");
  }

  const messageType = readOwnValue(message, "typeUrl");

  if (typeof messageType !== "string" || messageType.length === 0) {
    return envelopeFailure(signalKind, input, "missing message type URL");
  }
  if (messageType !== expectedTypeUrl) {
    return envelopeFailure(signalKind, input, "unexpected message type URL", messageType);
  }

  const parsed = parse(envelope);

  if (parsed === undefined) {
    return envelopeFailure(signalKind, input, "malformed generated envelope", messageType);
  }

  return {
    status: "accepted",
    envelope: parsed,
  };
}

function parseCommandEnvelope(envelope: Record<string, unknown>): Command | undefined {
  try {
    return fromBinary(
      CommandSchema,
      toBinary(CommandSchema, envelope as Command, { writeUnknownFields: false }),
      { readUnknownFields: false },
    );
  } catch {
    return undefined;
  }
}

function parseEventEnvelope(envelope: Record<string, unknown>): Event | undefined {
  try {
    return fromBinary(
      EventSchema,
      toBinary(EventSchema, envelope as Event, { writeUnknownFields: false }),
      { readUnknownFields: false },
    );
  } catch {
    return undefined;
  }
}

function subscriptionMap<Kind extends "command" | "event">(
  subscriptions: readonly TransportSubscription<Kind>[],
): ReadonlyMap<string, TransportSubscription<Kind>> {
  return new Map(subscriptions.map((subscription) => [subscription.descriptorKey, subscription]));
}

function requireSubscription<Kind extends "command" | "event">(
  subscriptions: ReadonlyMap<string, TransportSubscription<Kind>>,
  descriptorKey: string,
): TransportSubscription<Kind> {
  const subscription = subscriptions.get(descriptorKey);

  if (subscription === undefined) {
    throw new Error(`Runtime transport route is missing subscription "${descriptorKey}".`);
  }

  return subscription;
}

function envelopeFailure<Kind extends "command" | "event">(
  signalKind: Kind,
  input: RuntimeTransportBindingInput,
  reason: string,
  messageType?: string,
): SignalIntakeFailure<Kind> {
  return failSignalIntake(signalKind, "MALFORMED_ENVELOPE", {
    boundedContext: input.plan.context.name.value,
    runtimeState: input.runtime.state,
    reason,
    ...(messageType === undefined ? {} : { messageType }),
  });
}

function runtimeFailure<Kind extends "command" | "event">(
  signalKind: Kind,
  input: RuntimeTransportBindingInput,
): SignalIntakeFailure<Kind> {
  return failSignalIntake(signalKind, "RUNTIME_NOT_ACCEPTING", {
    boundedContext: input.plan.context.name.value,
    runtimeState: input.runtime.state,
    reason: "runtime is not accepting work",
  });
}

function formatEnvelopeError(result: SignalIntakeFailure): string {
  const reason = result.failure.diagnostics.reason;

  if (typeof reason === "string" && reason.length > 0) {
    return `Runtime transport ${result.signalKind} envelope refused: ${reason}.`;
  }

  return `Runtime transport ${result.signalKind} envelope refused.`;
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function closeFailure(failures: readonly Error[]): Error {
  const [failure] = failures;

  if (failures.length === 1 && failure !== undefined) {
    return failure;
  }

  return new Error(`Runtime transport close failed in ${String(failures.length)} operations.`);
}

function readTypeUrl(message: unknown): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }

  const value = readOwnValue(message, "typeUrl");
  return typeof value === "string" ? value : undefined;
}

function readOwnValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);

  if (descriptor === undefined || !("value" in descriptor)) {
    return undefined;
  }

  return descriptor.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
