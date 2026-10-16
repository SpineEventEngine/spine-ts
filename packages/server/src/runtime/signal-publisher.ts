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
   * Dispatches a committed Entity Event once after persistence.
   * @param event The committed Event envelope.
   * @returns Completion after dispatch or contained failure.
   */
  publishCommittedEvent(event: Event): Promise<void> {
    const snapshot = clone(EventSchema, event);
    return this.#publish("event", snapshot, () =>
      eventBusAccess.postStored(this.#eventBus, snapshot),
    );
  }

  /**
   * Dispatches a committed reactor or Process Manager Event once as follow-up work.
   * @param event The committed Event envelope.
   * @returns Completion after dispatch or contained failure.
   */
  publishReactorEvent(event: Event): Promise<void> {
    const snapshot = clone(EventSchema, event);
    return this.#publish("event", snapshot, () =>
      eventBusAccess.postStoredFollowUp(this.#eventBus, snapshot),
    );
  }

  /**
   * Dispatches a produced System Event once, persisting it when configured.
   * @param event The produced System Event envelope.
   * @returns Completion after dispatch or contained failure.
   */
  publishSystemEvent(event: Event): Promise<void> {
    const snapshot = clone(EventSchema, event);
    return this.#publish("system-event", snapshot, () =>
      eventBusAccess.postFollowUp(this.#systemEventBus, snapshot),
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
