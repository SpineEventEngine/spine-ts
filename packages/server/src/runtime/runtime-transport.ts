import { clone } from "@bufbuild/protobuf";
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
  /** Close transport registrations first, then close the bound runtime. */
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
  /** Register command and event routes with the supplied transport. */
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

  constructor(input: RuntimeTransportBindingInput) {
    this.#input = input;
  }

  async open(): Promise<RuntimeTransportBindingHandle> {
    try {
      await this.#input.runtime.start();
      await this.#registerCommands();
      await this.#registerEvents();

      return new RuntimeTransportHandle(this.#handles, this.#input.runtime);
    } catch (error) {
      await new RuntimeTransportHandle(this.#handles, this.#input.runtime).close();
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

class RuntimeTransportHandle implements RuntimeTransportBindingHandle {
  readonly #handles: readonly TransportSubscriptionHandle[];
  readonly #runtime: SingleProcessServerRuntime;
  #close: Promise<void> | undefined;

  constructor(
    handles: readonly TransportSubscriptionHandle[],
    runtime: SingleProcessServerRuntime,
  ) {
    this.#handles = Object.freeze([...handles]);
    this.#runtime = runtime;
  }

  close(): Promise<void> {
    if (this.#close === undefined) {
      this.#close = this.#closeAll();
    }

    return this.#close;
  }

  async #closeAll(): Promise<void> {
    try {
      for (const handle of this.#handles) {
        await handle.close();
      }
    } finally {
      await this.#runtime.close();
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
  return validateEnvelope("command", CommandSchema.typeName, envelope, expectedTypeUrl, input);
}

function validateEventEnvelope(
  envelope: unknown,
  expectedTypeUrl: string,
  input: RuntimeTransportBindingInput,
): EnvelopeResult<"event", Event> {
  return validateEnvelope("event", EventSchema.typeName, envelope, expectedTypeUrl, input);
}

function validateEnvelope<Kind extends "command" | "event", Envelope>(
  signalKind: Kind,
  envelopeTypeName: string,
  envelope: unknown,
  expectedTypeUrl: string,
  input: RuntimeTransportBindingInput,
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

  return {
    status: "accepted",
    envelope: envelope as Envelope,
  };
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
