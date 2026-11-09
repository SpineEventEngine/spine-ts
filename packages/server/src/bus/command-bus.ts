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

import { clone, create, equals } from "@bufbuild/protobuf";
import type { Any } from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  Validate,
  AnyPacker,
  type MessageSchema,
} from "@spine-event-engine/core";
import { CommandSchema, type Command } from "@spine-event-engine/proto";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import type { ServerEnvironment } from "../server/server-environment.js";
import { CommandValidationError } from "./command-errors.js";
import { ImplicitRequiredIds } from "../entity/implicit-required-id.js";
import { CommandDispatcherRegistry } from "./command-dispatcher-registry.js";
import type { CommandDispatcher } from "./command-dispatcher.js";

const internalCommandPosters = new WeakMap<CommandBus, (command: Command) => Promise<void>>();
const commandFollowUpPosters = new WeakMap<CommandBus, (command: Command) => Promise<void>>();
const commandBusCloseStarters = new WeakMap<CommandBus, () => void>();
const commandBusDrainers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusCloseFinishers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusAborters = new WeakMap<CommandBus, () => void>();
const commandBusWorkCounters = new WeakMap<CommandBus, () => number>();
const commandBusRuntimes = new WeakMap<CommandBus, SingleProcessServerRuntime>();
const commandAdmissions = new WeakMap<CommandBus, (command: Command) => Promise<void>>();

/**
 * Framework-only operations for coordinating a CommandBus with its runtime and environment.
 */
interface CommandBusAccess {
  /**
   * Binds this context bus's private runtime to its captured environment.
   * @param commandBus Framework context bus.
   * @param environment Exact environment containing the context.
   */
  bindEnvironment(commandBus: CommandBus, environment: ServerEnvironment): void;

  /**
   * Sets receiving-context admission before command dispatch.
   *
   * @param commandBus Context command bus.
   * @param onAdmit Checks current tenant membership.
   */
  setAdmission(commandBus: CommandBus, onAdmit: (command: Command) => Promise<void>): void;

  /**
   * Posts an accepted internal command.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @param command Command envelope to prepare or dispatch.
   * @returns A promise for completion of the accepted command dispatch.
   */
  postInternal(commandBus: CommandBus, command: Command): Promise<void>;

  /**
   * Posts an internal command after intake begins closing.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @param command Command envelope to prepare or dispatch.
   * @returns A promise for completion of the command follow-up.
   */
  postInternalFollowUp(commandBus: CommandBus, command: Command): Promise<void>;

  /**
   * Stops accepting new external work.
   *
   * @param commandBus Command bus receiving this internal operation.
   */
  beginClose(commandBus: CommandBus): void;

  /**
   * Waits for accepted dispatches to settle.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @returns A promise that settles when accepted work drains.
   */
  drain(commandBus: CommandBus): Promise<void>;

  /**
   * Completes the bus shutdown.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @returns A promise that settles when shutdown completes.
   */
  finishClose(commandBus: CommandBus): Promise<void>;

  /**
   * Restores intake after an aborted shutdown.
   *
   * @param commandBus Command bus receiving this internal operation.
   */
  abortClose(commandBus: CommandBus): void;

  /**
   * Returns the number of accepted dispatches still in progress.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @returns The number of accepted dispatches still in progress.
   */
  acceptedWorkCount(commandBus: CommandBus): number;
}

/**
 * Lifecycle state controlling external command admission and shutdown.
 */
type CommandBusIntakeState = "open" | "closing" | "closed";

/**
 * Small single-process unicast command bus.
 *
 * Commands are accepted asynchronously through `post()` and routed by enclosed
 * message type URL to exactly one registered dispatcher.
 */
export class CommandBus {
  readonly #registry = new CommandDispatcherRegistry();

  readonly #runtime = new SingleProcessServerRuntime();

  readonly #started: Promise<void>;

  #intakeState: CommandBusIntakeState = "open";

  #acceptedWorkCount = 0;

  #closed: Promise<void> | undefined;

  /**
   * Creates a bus and registers its initial dispatchers.
   *
   * @param dispatchers the dispatchers to register.
   */
  constructor(dispatchers: Iterable<CommandDispatcher> = []) {
    this.#started = this.#runtime.start();
    commandBusRuntimes.set(this, this.#runtime);
    internalCommandPosters.set(this, (command) => this.#postInternal(command));
    commandFollowUpPosters.set(this, (command) => this.#postInternalFollowUp(command));
    commandBusCloseStarters.set(this, () => {
      this.#beginClose();
    });
    commandBusDrainers.set(this, () => {
      return this.#drain();
    });
    commandBusCloseFinishers.set(this, () => this.#finishClose());
    commandBusAborters.set(this, () => {
      this.#abortClose();
    });
    commandBusWorkCounters.set(this, () => this.#acceptedWorkCount);

    for (const dispatcher of dispatchers) {
      this.register(dispatcher);
    }
  }

  /**
   * Registers a dispatcher.
   *
   * @typeParam Dispatcher Concrete Command dispatcher type returned to the caller.
   * @param dispatcher the dispatcher to register.
   * @returns the registered dispatcher.
   */
  register<Dispatcher extends CommandDispatcher>(dispatcher: Dispatcher): Dispatcher {
    this.#registry.register(dispatcher);
    return dispatcher;
  }

  /**
   * Lists command type URLs accepted by registered dispatchers.
   *
   * @returns the accepted command type URLs.
   */
  acceptedCommandTypes(): readonly string[] {
    return this.#registry.acceptedTypeUrls();
  }

  /**
   * Posts a command for asynchronous dispatch.
   *
   * Repository-backed Entity recipients complete dispatch after their Inbox
   * receipt is stored and eligible delivery is scheduled. Handler processing
   * may continue after this promise resolves. Other registered dispatchers
   * determine completion through their own dispatch promises.
   *
   * @param command the command envelope to post.
   * @returns Completion or failure of the registered dispatcher handoff.
   */
  post(command: Command): Promise<void> {
    const accepted = clone(CommandSchema, command);

    if (this.#intakeState !== "open") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", this.#intakeState));
    }

    return this.#enqueueAccepted(accepted);
  }

  /**
   * Stops accepting new command work and waits for accepted work to settle.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * Runtime close failures reject the returned promise.
   *
   * @returns A promise that settles after the command bus closes.
   *
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  /**
   * Clones and queues an internal command while the bus can still accept work.
   */
  #postInternal(command: Command): Promise<void> {
    const accepted = clone(CommandSchema, command);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    return this.#enqueueAccepted(accepted);
  }

  /**
   * Queues an internal follow-up in the runtime lane reserved for accepted work during close.
   */
  #postInternalFollowUp(command: Command): Promise<void> {
    const accepted = clone(CommandSchema, command);
    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }
    this.#acceptedWorkCount++;
    return this.#started.then(() =>
      runtimeAccess.enqueueFollowUp(this.#runtime, () => this.#dispatch(accepted)),
    );
  }

  /**
   * Counts and schedules a command already accepted by the bus.
   */
  #enqueueAccepted(command: Command): Promise<void> {
    this.#acceptedWorkCount++;
    return this.#started.then(() => this.#runtime.enqueue(() => this.#dispatch(command)));
  }

  /**
   * Moves command intake from open to closing.
   */
  #beginClose(): void {
    if (this.#intakeState === "open") {
      this.#intakeState = "closing";
    }
  }

  /**
   * Waits for the runtime queue to finish accepted dispatches.
   */
  #drain(): Promise<void> {
    return this.#started.then(() => runtimeAccess.drain(this.#runtime));
  }

  /**
   * Completes or reuses the bus close operation.
   */
  #finishClose(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  /**
   * Forces intake closed and starts best-effort runtime shutdown.
   */
  #abortClose(): void {
    this.#beginClose();
    void this.#started.then(() => this.#runtime.close()).catch(() => undefined);
    this.#intakeState = "closed";
  }

  /**
   * Closes intake, waits for startup, then closes the command runtime.
   */
  async #closeOnce(): Promise<void> {
    this.#beginClose();
    await this.#started;
    await this.#runtime.close();
    this.#intakeState = "closed";
  }

  /**
   * Checks tenant admission and dispatches a validated command.
   */
  async #dispatch(command: Command): Promise<void> {
    const dispatcher = this.#checkedDispatcher(command);
    await commandAdmissions.get(this)?.(command);
    await dispatcher.dispatch(command);
  }

  /**
   * Validates the command envelope and payload, then resolves its registered dispatcher.
   */
  #checkedDispatcher(command: Command): CommandDispatcher {
    CommandValidationError.checkEnvelope(command);
    const packed = command.message;
    const typeUrl = packed.typeUrl;

    const registration = this.#registry.find(typeUrl);

    if (registration === undefined) {
      throw new Error(`No command dispatcher registered for "${typeUrl}".`);
    }

    this.#validatePayload(packed, registration.schema);
    return registration.dispatcher;
  }

  /**
   * Checks a decoded domain Command against its schema and implicit ID rule.
   * @param packed Packed domain Command message.
   * @param schema Registered domain Command schema.
   */
  #validatePayload(packed: Any, schema: MessageSchema): void {
    const message = AnyPacker.tryUnpack(packed, schema);
    if (message === undefined) {
      throw CommandValidationError.invalidPayload();
    }

    if (equals(schema, message, create(schema))) {
      throw CommandValidationError.invalidEnvelope(
        ["message"],
        "Non-default command message must be set.",
      );
    }

    try {
      Validate.check(schema, message);
    } catch (error) {
      if (error instanceof ValidationException) {
        throw new CommandValidationError(error.asMessage());
      }
      throw error;
    }
    const implicitId = ImplicitRequiredIds.validateCommand(schema, message);
    if (!implicitId.valid) {
      throw new CommandValidationError(implicitId.error);
    }
  }
}

/**
 * Provides framework-owned command posting and coordinated close access.
 *
 * @internal
 */
export const commandBusAccess: CommandBusAccess = Object.freeze({
  /**
   * Binds the private queue to its framework context's captured environment.
   * @param commandBus Framework context bus.
   * @param environment Exact environment containing the context.
   */
  bindEnvironment(commandBus: CommandBus, environment: ServerEnvironment): void {
    const runtime = commandBusRuntimes.get(commandBus);
    if (runtime === undefined)
      throw new TypeError("Framework binding requires a CommandBus instance.");
    runtimeAccess.bindFrameworkEnvironment(runtime, environment);
  },

  /**
   * Sets the context's live Command tenant check.
   *
   * @param commandBus Context command bus.
   * @param onAdmit Checks current membership.
   */
  setAdmission(commandBus: CommandBus, onAdmit: (command: Command) => Promise<void>): void {
    if (!commandBusWorkCounters.has(commandBus))
      throw new TypeError("Command admission requires a CommandBus instance.");
    commandAdmissions.set(commandBus, onAdmit);
  },

  /**
   * Posts a framework-generated command through the bus internal admission path.
   */
  postInternal(commandBus: CommandBus, command: Command): Promise<void> {
    const postInternal = internalCommandPosters.get(commandBus);

    if (postInternal === undefined) {
      throw new TypeError("Internal command post requires a CommandBus instance.");
    }

    return postInternal(command);
  },

  /**
   * Posts a framework follow-up that may run while accepted work is draining.
   */
  postInternalFollowUp(commandBus: CommandBus, command: Command): Promise<void> {
    const post = commandFollowUpPosters.get(commandBus);
    if (post === undefined) {
      throw new TypeError("Internal command follow-up requires a CommandBus instance.");
    }
    return post(command);
  },

  /**
   * Stops external command intake for coordinated context shutdown.
   */
  beginClose(commandBus: CommandBus): void {
    const beginClose = commandBusCloseStarters.get(commandBus);

    if (beginClose === undefined) {
      throw new TypeError("Command-bus close coordination requires a CommandBus instance.");
    }

    beginClose();
  },

  /**
   * Waits until commands already accepted by this bus complete.
   */
  drain(commandBus: CommandBus): Promise<void> {
    const drain = commandBusDrainers.get(commandBus);

    if (drain === undefined) {
      throw new TypeError("Command-bus drain requires a CommandBus instance.");
    }

    return drain();
  },

  /**
   * Finishes closing the command runtime.
   */
  finishClose(commandBus: CommandBus): Promise<void> {
    const finishClose = commandBusCloseFinishers.get(commandBus);

    if (finishClose === undefined) {
      throw new TypeError("Command-bus close completion requires a CommandBus instance.");
    }

    return finishClose();
  },

  /**
   * Aborts close coordination and makes the bus terminal.
   */
  abortClose(commandBus: CommandBus): void {
    const abortClose = commandBusAborters.get(commandBus);

    if (abortClose === undefined) {
      throw new TypeError("Command-bus close coordination requires a CommandBus instance.");
    }

    abortClose();
  },

  /**
   * Returns the count of accepted command dispatches still in progress.
   */
  acceptedWorkCount(commandBus: CommandBus): number {
    const acceptedWorkCount = commandBusWorkCounters.get(commandBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Command-bus work counting requires a CommandBus instance.");
    }

    return acceptedWorkCount();
  },
});
