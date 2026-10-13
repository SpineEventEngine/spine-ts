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

import { clone } from "@bufbuild/protobuf";
import { CommandSchema, EventSchema, type Command, type Event } from "@spine-event-engine/proto";
import type { ILogLayer } from "loglayer";

import { commandBusAccess, CommandBus } from "../bus/command-bus.js";
import { eventBusAccess, EventBus } from "../bus/event-bus.js";
import { emitServerError } from "../server/server-log.js";

type PublicationKind = "command" | "event" | "rejection-event" | "system-event" | "stored-event";
type PublisherState = "open" | "closing" | "closed";
const storedDispatchAttempts = 3;

/**
 * Describes attempted admission of one committed Event to current recipients.
 */
export interface StoredEventPublication {
  /**
   * Admission outcome.
   */
  readonly status: "ADMITTED" | "FAILED" | "CANCELLED";

  /**
   * Committed Event ID.
   */
  readonly eventId: string;

  /**
   * Number of actual stored dispatch attempts.
   */
  readonly attempts: number;

  /**
   * First internal failure cause, never included in public repair results.
   */
  readonly cause?: unknown;
}

/**
 * Supplies cancellation to stored Event dispatch.
 */
export interface StoredEventPublicationOptions {
  /**
   * Stops later attempts when aborted.
   */
  readonly signal?: AbortSignal;
}
interface ProducedSignalObserver {
  readonly onCommand?: (command: Readonly<Command>) => void;
  readonly onEvent?: (event: Readonly<Event>) => void;
}

/**
 * Publishes produced signals and contains their detached dispatch failures for one context.
 *
 * @internal
 */
export class SignalPublisher {
  /**
   * Bus for produced Commands.
   */
  readonly #commandBus: CommandBus;

  /**
   * Bus for produced and stored Events.
   */
  readonly #eventBus: EventBus;

  /**
   * Bus for System Events.
   */
  readonly #systemEventBus: EventBus;

  /**
   * Context name included in safe diagnostics.
   */
  readonly #contextName: string;

  /**
   * Admitted publication work awaited by drain.
   */
  readonly #inFlight = new Set<Promise<void>>();

  /**
   * Test observers of produced signals.
   */
  readonly #observers = new Set<ProducedSignalObserver>();

  /**
   * Optional internal error logger.
   */
  #logger: ILogLayer | undefined;

  /**
   * Current publication lifecycle phase.
   */
  #state: PublisherState = "open";

  /**
   * Creates a publisher for the context buses.
   *
   * @param commandBus Accepts produced Commands.
   * @param eventBus Accepts produced Events.
   * @param systemEventBus Accepts produced System Events.
   * @param contextName Names the context in failure logs.
   */
  constructor(
    commandBus: CommandBus,
    eventBus: EventBus,
    systemEventBus: EventBus,
    contextName: string,
  ) {
    this.#commandBus = commandBus;
    this.#eventBus = eventBus;
    this.#systemEventBus = systemEventBus;
    this.#contextName = contextName;
  }

  /**
   * Publishes a produced Command for detached handling.
   *
   * @param command The produced Command envelope.
   * @returns A promise that settles after the Command is handled or its failure is contained.
   */
  publishCommand(command: Command): Promise<void> {
    return this.#publish("command", command, () =>
      commandBusAccess.postInternalFollowUp(this.#commandBus, command),
    );
  }

  /**
   * Publishes a produced Event for detached handling.
   *
   * @param event The produced Event envelope.
   * @returns A promise that settles after the Event is handled or its failure is contained.
   */
  publishEvent(event: Event): Promise<void> {
    return this.#publish("event", event, () => eventBusAccess.postFollowUp(this.#eventBus, event));
  }

  /**
   * Dispatches a rejection Event without recording it as committed produced output.
   *
   * @internal
   * @param event The rejection Event envelope.
   * @returns A promise that settles after detached rejection handling is contained.
   */
  publishRejectionEvent(event: Event): Promise<void> {
    return this.#publish("rejection-event", event, () =>
      eventBusAccess.postFollowUp(this.#eventBus, event),
    );
  }

  /**
   * Publishes one committed Aggregate Event and records its admission.
   *
   * Publishes the committed Event through stored-event handling without treating stored replay as
   * newly produced output.
   *
   * @internal
   * @param event The committed Aggregate Event envelope.
   * @param options Cancels remaining attempts without undoing earlier recipient effects.
   * @returns The admission outcome; admission does not guarantee recipient processing completion.
   */
  publishCommittedEvent(
    event: Event,
    options?: StoredEventPublicationOptions,
  ): Promise<StoredEventPublication> {
    return this.#publishStored("event", event, options, (snapshot, signal) =>
      eventBusAccess.postStored(this.#eventBus, snapshot, signal),
    );
  }

  /**
   * Publishes a committed Aggregate reactor Event as stored follow-up work and records it.
   *
   * @internal
   * @param event The committed follow-up Event envelope.
   * @param options Cancels remaining attempts without undoing earlier recipient effects.
   * @returns The admission outcome; admission does not guarantee recipient processing completion.
   */
  publishReactorEvent(
    event: Event,
    options?: StoredEventPublicationOptions,
  ): Promise<StoredEventPublication> {
    return this.#publishStored("event", event, options, (snapshot, signal) =>
      eventBusAccess.postStoredFollowUp(this.#eventBus, snapshot, signal),
    );
  }

  /**
   * Publishes a produced System Event for detached handling.
   *
   * @param event The produced System Event envelope.
   * @returns A promise that settles after the Event is handled or its failure is contained.
   */
  publishSystemEvent(event: Event): Promise<void> {
    return this.#publish("system-event", event, () =>
      eventBusAccess.postFollowUp(this.#systemEventBus, event),
    );
  }

  /**
   * Publishes a stored Event for detached handling.
   *
   * @param event The stored Event envelope.
   * @param options Cancels remaining attempts without undoing earlier recipient effects.
   * @returns The admission outcome; admission does not guarantee recipient processing completion.
   */
  redispatchStored(
    event: Event,
    options?: StoredEventPublicationOptions,
  ): Promise<StoredEventPublication> {
    return this.#publishStored("stored-event", event, options, (snapshot, signal) =>
      eventBusAccess.postStored(this.#eventBus, snapshot, signal),
    );
  }

  /**
   * Publishes a stored Event after current bus work for detached handling.
   *
   * @param event The stored Event envelope.
   * @param options Cancels remaining attempts without undoing earlier recipient effects.
   * @returns The admission outcome; admission does not guarantee recipient processing completion.
   */
  redispatchStoredFollowUp(
    event: Event,
    options?: StoredEventPublicationOptions,
  ): Promise<StoredEventPublication> {
    return this.#publishStored("stored-event", event, options, (snapshot, signal) =>
      eventBusAccess.postStoredFollowUp(this.#eventBus, snapshot, signal),
    );
  }

  /**
   * Records a failure that was contained during produced-signal handling.
   *
   * @param kind Identifies the handled signal category.
   * @param signal Identifies the signal when it is available.
   * @param error Contains the handled failure.
   */
  reportFailure(kind: PublicationKind, signal: Command | Event | undefined, error: unknown): void {
    const logger = this.#logger;
    if (logger === undefined) return;
    const event = kind !== "command";
    try {
      emitServerError(logger, "Produced signal handling failed.", {
        contextName: this.#contextName,
        ...(event
          ? {
              eventId: SignalPublisher.signalId(signal),
              eventType: signal?.message?.typeUrl ?? "unknown",
            }
          : {
              commandId: SignalPublisher.signalId(signal),
              commandType: signal?.message?.typeUrl ?? "unknown",
            }),
        operation: "signal_publisher.handle",
        reasonCode: "handled_failure",
        errorName:
          error instanceof Error &&
          ["Error", "TypeError", "RangeError", "AggregateError"].includes(error.name)
            ? error.name
            : undefined,
      });
    } catch {
      // Diagnostics cannot turn a contained publication failure into detached rejection.
    }
  }

  /**
   * Sets the logger used for contained publication failures.
   *
   * @param logger Receives contained publication failure records.
   */
  installLogger(logger: ILogLayer): void {
    this.#logger = logger;
  }

  /**
   * Clears the installed failure logger.
   */
  clearLogger(): void {
    this.#logger = undefined;
  }

  /**
   * Starts closing while trusted produced work admitted during context shutdown drains.
   * New trusted work remains admissible until `finishClose()` rejects it.
   */
  beginClose(): void {
    if (this.#state === "open") this.#state = "closing";
  }

  /**
   * Waits until all admitted produced signals have settled.
   *
   * @returns A promise that settles when admitted signal handling is complete.
   */
  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.all([...this.#inFlight]);
    }
  }

  /**
   * Completes closure after admitted signal handling settles.
   */
  finishClose(): void {
    this.#state = "closed";
  }

  /**
   * Stops publication while context assembly is being abandoned.
   */
  abortAssembly(): void {
    this.#state = "closed";
    this.#inFlight.clear();
  }

  /**
   * Observes admitted produced Commands and Events for package testing.
   *
   * @internal
   * @param observer Receives cloned admitted signal envelopes.
   * @returns A handle that stops this observation.
   */
  observe(observer: ProducedSignalObserver): { readonly close: () => void } {
    this.#observers.add(observer);
    return Object.freeze({ close: () => this.#observers.delete(observer) });
  }

  #publish(
    kind: PublicationKind,
    signal: Command | Event,
    publish: () => Promise<void>,
  ): Promise<void> {
    if (this.#state === "closed") {
      const rejected = Promise.reject(new Error("SignalPublisher is closed."));
      void rejected.catch((error: unknown) => {
        this.reportFailure(kind, signal, error);
      });
      return rejected;
    }
    this.#observe(kind, signal);
    const handled = Promise.resolve()
      .then(() => {
        if (this.#state === "closed") throw new Error("SignalPublisher is closed.");
        return publish();
      })
      .catch((error: unknown) => {
        this.reportFailure(kind, signal, error);
      });
    this.#inFlight.add(handled);
    void handled.then(() => {
      this.#inFlight.delete(handled);
    });
    return handled;
  }

  /**
   * Retries one captured stored Event through the actual recipient bus.
   *
   * @param kind Category used for failure diagnostics.
   * @param snapshot Captured Event reused across attempts.
   * @param options Optional cancellation of later attempts.
   * @param publish Admits the Event to the selected stored route.
   * @returns Finite admission outcome with the first internal failure cause.
   */
  async #dispatchStored(
    kind: PublicationKind,
    snapshot: Event,
    options: StoredEventPublicationOptions | undefined,
    publish: (snapshot: Event, signal?: AbortSignal) => Promise<void>,
  ): Promise<StoredEventPublication> {
    let cause: unknown;
    let attempts = 0;
    const eventId = SignalPublisher.signalId(snapshot);
    for (; attempts < storedDispatchAttempts;) {
      if (options?.signal?.aborted)
        return { status: "CANCELLED", eventId, attempts, cause: cause ?? options.signal.reason };
      attempts += 1;
      try {
        await SignalPublisher.#awaitStoredAttempt(
          publish(snapshot, options?.signal),
          options?.signal,
        );
        return { status: "ADMITTED", eventId, attempts };
      } catch (error) {
        cause ??= error;
        if (options?.signal?.aborted)
          return { status: "CANCELLED", eventId, attempts, cause: options.signal.reason ?? cause };
      }
    }
    this.reportFailure(kind, snapshot, cause);
    return { status: "FAILED", eventId, attempts, cause };
  }

  /**
   * Cancels the caller wait while the raw bus queue retains the attempt.
   *
   * @param attempt Underlying queued dispatch, observed even after cancellation.
   * @param signal Optional caller cancellation.
   * @returns Completion of dispatch or rejection when cancelled.
   */
  static async #awaitStoredAttempt(attempt: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal === undefined) return attempt;
    if (signal.aborted) throw signal.reason ?? new Error("Stored dispatch cancelled.");
    const cancelled = Promise.withResolvers<never>();
    const onAbort = () => {
      cancelled.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Stored dispatch cancelled.", { cause: signal.reason }),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await Promise.race([attempt, cancelled.promise]);
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Tracks one stored publication until its bounded attempt sequence settles.
   *
   * @param kind Category used for observation and diagnostics.
   * @param event Committed Event to snapshot.
   * @param options Optional cancellation of later attempts.
   * @param publish Admits the captured Event to the selected route.
   * @returns Finite admission outcome.
   */
  #publishStored(
    kind: PublicationKind,
    event: Event,
    options: StoredEventPublicationOptions | undefined,
    publish: (snapshot: Event, signal?: AbortSignal) => Promise<void>,
  ): Promise<StoredEventPublication> {
    if (this.#state === "closed") return Promise.reject(new Error("SignalPublisher is closed."));
    const snapshot = clone(EventSchema, event);
    this.#observe(kind, snapshot);
    const publication = this.#dispatchStored(kind, snapshot, options, publish);
    const settled = publication.then(() => undefined);
    this.#inFlight.add(settled);
    void settled.then(() => this.#inFlight.delete(settled));
    return publication;
  }

  #observe(kind: PublicationKind, signal: Command | Event): void {
    for (const observer of this.#observers) {
      try {
        if (kind === "command") observer.onCommand?.(clone(CommandSchema, signal as Command));
        if (kind === "event") observer.onEvent?.(clone(EventSchema, signal as Event));
      } catch {
        // Testing observation cannot change produced-signal publication.
      }
    }
  }

  /**
   * Returns a printable identifier for a signal.
   *
   * @param signal The signal to identify.
   * @returns The signal identifier, or `"unknown"` when unavailable.
   */
  static signalId(signal: Command | Event | undefined): string {
    const id = signal?.id;
    if (id === undefined) return "unknown";
    return "uuid" in id ? id.uuid : id.value;
  }
}
