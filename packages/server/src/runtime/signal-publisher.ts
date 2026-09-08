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

import type { Command, Event } from "@spine-event-engine/proto";
import type { ILogLayer } from "loglayer";

import { commandBusAccess, CommandBus } from "../bus/command-bus.js";
import { eventBusAccess, EventBus } from "../bus/event-bus.js";
import { emitServerError } from "../server/server-log.js";

type PublicationKind = "command" | "event" | "system-event" | "stored-event" | "notification";
type PublisherState = "open" | "closing" | "closed";

/**
 * Owns contained admission and draining of signals produced inside one context.
 *
 * @internal
 */
export class SignalPublisher {
  readonly #commandBus: CommandBus;
  readonly #eventBus: EventBus;
  readonly #systemEventBus: EventBus;
  readonly #contextName: string;
  readonly #inFlight = new Set<Promise<void>>();
  #logger: ILogLayer | undefined;
  #state: PublisherState = "open";

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

  publishCommand(command: Command): Promise<void> {
    return this.#publish("command", command, () =>
      commandBusAccess.postInternalFollowUp(this.#commandBus, command),
    );
  }

  publishEvent(event: Event): Promise<void> {
    return this.#publish("event", event, () => eventBusAccess.postFollowUp(this.#eventBus, event));
  }

  publishSystemEvent(event: Event): Promise<void> {
    return this.#publish("system-event", event, () =>
      eventBusAccess.postFollowUp(this.#systemEventBus, event),
    );
  }

  redispatchStored(event: Event): Promise<void> {
    return this.#publish("stored-event", event, () =>
      eventBusAccess.postStored(this.#eventBus, event),
    );
  }

  redispatchStoredFollowUp(event: Event): Promise<void> {
    return this.#publish("stored-event", event, () =>
      eventBusAccess.postStoredFollowUp(this.#eventBus, event),
    );
  }

  reportFailure(kind: PublicationKind, signal: Command | Event | undefined, error: unknown): void {
    const logger = this.#logger;
    if (logger === undefined) return;
    emitServerError(logger, "Produced signal handling failed.", {
      context: this.#contextName,
      kind,
      signalId: SignalPublisher.signalId(signal),
      signalType: signal?.message?.typeUrl ?? "unknown",
      operation: "signal_publisher.handle",
      reasonCode: "handled_failure",
    });
    void error;
  }

  installLogger(logger: ILogLayer): void {
    this.#logger = logger;
  }

  clearLogger(): void {
    this.#logger = undefined;
  }

  beginClose(): void {
    if (this.#state === "open") this.#state = "closing";
  }

  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.all([...this.#inFlight]);
    }
  }

  finishClose(): void {
    this.#state = "closed";
  }

  abortAssembly(): void {
    this.#state = "closed";
    this.#inFlight.clear();
  }

  #publish(
    kind: Exclude<PublicationKind, "notification">,
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
    const handled = Promise.resolve()
      .then(publish)
      .catch((error: unknown) => {
        this.reportFailure(kind, signal, error);
      });
    this.#inFlight.add(handled);
    void handled.then(() => {
      this.#inFlight.delete(handled);
    });
    return handled;
  }

  static signalId(signal: Command | Event | undefined): string {
    const id = signal?.id;
    if (id === undefined) return "unknown";
    return "uuid" in id ? id.uuid : id.value;
  }
}
