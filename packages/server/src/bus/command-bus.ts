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

import { clone, create } from "@bufbuild/protobuf";
import { ValidationException, Validate, AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, type Command } from "@spine-event-engine/proto";
import {
  AgentSavedDispatchPlanSchema as SavedPlanSchema,
  type AgentSavedDispatchPlan,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import { CommandValidationError } from "./command-errors.js";
import { ImplicitRequiredIds } from "../entity/implicit-required-id.js";
import { CommandDispatcherRegistry } from "./command-dispatcher-registry.js";
import type { CommandDispatcher } from "./command-dispatcher.js";
import { SavedDispatcherBindings } from "./saved-dispatcher-binding.js";

const internalCommandPosters = new WeakMap<CommandBus, (command: Command) => Promise<void>>();
const commandFollowUpPosters = new WeakMap<CommandBus, (command: Command) => Promise<void>>();
const savedPreparers = new WeakMap<
  CommandBus,
  (command: Command) => Promise<AgentSavedDispatchPlan>
>();
const savedFollowUps = new WeakMap<
  CommandBus,
  (command: Command, plan: AgentSavedDispatchPlan) => Promise<void>
>();
const commandBusCloseStarters = new WeakMap<CommandBus, () => void>();
const commandBusDrainers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusCloseFinishers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusAborters = new WeakMap<CommandBus, () => void>();
const commandBusWorkCounters = new WeakMap<CommandBus, () => number>();

interface CommandBusAccess {
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
   * Prepares a dispatch plan before persisting accepted output.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @param command Command envelope to prepare or dispatch.
   * @returns The exact saved recipient plan.
   */
  prepareSaved(commandBus: CommandBus, command: Command): Promise<AgentSavedDispatchPlan>;

  /**
   * Posts a prepared dispatch after its Agent result is saved.
   *
   * @param commandBus Command bus receiving this internal operation.
   * @param command Command envelope to prepare or dispatch.
   * @param plan Persisted recipient plan for this dispatch.
   * @returns A promise for completion of the saved dispatch.
   */
  postSavedFollowUp(
    commandBus: CommandBus,
    command: Command,
    plan: AgentSavedDispatchPlan,
  ): Promise<void>;

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
    internalCommandPosters.set(this, (command) => this.#postInternal(command));
    commandFollowUpPosters.set(this, (command) => this.#postInternalFollowUp(command));
    savedPreparers.set(this, (command) => this.#prepareSaved(command));
    savedFollowUps.set(this, (command, plan) => this.#postSavedFollowUp(command, plan));
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
   * @param command the command envelope to post.
   * @returns A promise that settles after queued command dispatch completes and may reject.
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
   * @returns A promise that settles after the command bus closes.
   *
   */
  close(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  #postInternal(command: Command): Promise<void> {
    const accepted = clone(CommandSchema, command);

    if (this.#intakeState === "closed") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    }

    return this.#enqueueAccepted(accepted);
  }

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

  async #prepareSaved(command: Command): Promise<AgentSavedDispatchPlan> {
    const dispatcher = this.#checkedDispatcher(command);
    const binding = SavedDispatcherBindings.forCommand(dispatcher);
    if (binding === undefined)
      throw new Error("Saved Agent Command matches a dispatcher without durable metadata.");
    return create(SavedPlanSchema, {
      targets: [await binding.prepare(clone(CommandSchema, command))],
    });
  }

  #postSavedFollowUp(command: Command, plan: AgentSavedDispatchPlan): Promise<void> {
    const accepted = clone(CommandSchema, command);
    const frozen = clone(SavedPlanSchema, plan);
    if (this.#intakeState === "closed")
      return Promise.reject(new ServerRuntimeStateError("enqueue", "closed"));
    this.#acceptedWorkCount++;
    return this.#started.then(() =>
      runtimeAccess.enqueueFollowUp(this.#runtime, () => this.#dispatchSaved(accepted, frozen)),
    );
  }

  async #dispatchSaved(command: Command, plan: AgentSavedDispatchPlan): Promise<void> {
    const dispatcher = this.#checkedDispatcher(command);
    const target = plan.targets[0];
    const binding = SavedDispatcherBindings.forCommand(dispatcher);
    if (plan.targets.length !== 1 || target === undefined || !binding?.matches(target))
      throw new Error("Saved Agent Command dispatcher binding changed before delivery.");
    const deliver = await binding.bind(clone(CommandSchema, command), target);
    await deliver();
  }

  #enqueueAccepted(command: Command): Promise<void> {
    this.#acceptedWorkCount++;
    return this.#started.then(() => this.#runtime.enqueue(() => this.#dispatch(command)));
  }

  #beginClose(): void {
    if (this.#intakeState === "open") {
      this.#intakeState = "closing";
    }
  }

  #drain(): Promise<void> {
    return this.#started.then(() => runtimeAccess.drain(this.#runtime));
  }

  #finishClose(): Promise<void> {
    this.#closed ??= this.#closeOnce();
    return this.#closed;
  }

  #abortClose(): void {
    this.#beginClose();
    void this.#started.then(() => this.#runtime.close()).catch(() => undefined);
    this.#intakeState = "closed";
  }

  async #closeOnce(): Promise<void> {
    this.#beginClose();
    await this.#started;
    await this.#runtime.close();
    this.#intakeState = "closed";
  }

  async #dispatch(command: Command): Promise<void> {
    await this.#checkedDispatcher(command).dispatch(clone(CommandSchema, command));
  }

  #checkedDispatcher(command: Command): CommandDispatcher {
    const packed = command.message;

    if (packed === undefined || packed.typeUrl === "") {
      throw new Error("CommandBus requires command.message.typeUrl.");
    }
    const typeUrl = packed.typeUrl;

    const registration = this.#registry.find(typeUrl);

    if (registration === undefined) {
      throw new Error(`No command dispatcher registered for "${typeUrl}".`);
    }

    const message = AnyMessages.unpack(packed, registration.schema);

    if (message === undefined) {
      throw CommandValidationError.invalidPayload();
    }

    try {
      Validate.check(registration.schema, message);
    } catch (error) {
      if (error instanceof ValidationException) {
        throw new CommandValidationError(error.asMessage());
      }
      throw error;
    }
    const implicitId = ImplicitRequiredIds.validateCommand(registration.schema, message);
    if (!implicitId.valid) {
      throw new CommandValidationError(implicitId.error);
    }

    return registration.dispatcher;
  }
}

/**
 * Provides framework-owned command posting and coordinated close access.
 *
 * @internal
 */
export const commandBusAccess: CommandBusAccess = Object.freeze({
  postInternal(commandBus: CommandBus, command: Command): Promise<void> {
    const postInternal = internalCommandPosters.get(commandBus);

    if (postInternal === undefined) {
      throw new TypeError("Internal command post requires a CommandBus instance.");
    }

    return postInternal(command);
  },

  postInternalFollowUp(commandBus: CommandBus, command: Command): Promise<void> {
    const post = commandFollowUpPosters.get(commandBus);
    if (post === undefined) {
      throw new TypeError("Internal command follow-up requires a CommandBus instance.");
    }
    return post(command);
  },

  prepareSaved(commandBus: CommandBus, command: Command): Promise<AgentSavedDispatchPlan> {
    const prepare = savedPreparers.get(commandBus);
    if (prepare === undefined)
      throw new TypeError("Saved Command preparation requires a CommandBus.");
    return prepare(command);
  },

  postSavedFollowUp(
    commandBus: CommandBus,
    command: Command,
    plan: AgentSavedDispatchPlan,
  ): Promise<void> {
    const post = savedFollowUps.get(commandBus);
    if (post === undefined) throw new TypeError("Saved Command delivery requires a CommandBus.");
    return post(command, plan);
  },

  beginClose(commandBus: CommandBus): void {
    const beginClose = commandBusCloseStarters.get(commandBus);

    if (beginClose === undefined) {
      throw new TypeError("Command-bus close coordination requires a CommandBus instance.");
    }

    beginClose();
  },

  drain(commandBus: CommandBus): Promise<void> {
    const drain = commandBusDrainers.get(commandBus);

    if (drain === undefined) {
      throw new TypeError("Command-bus drain requires a CommandBus instance.");
    }

    return drain();
  },

  finishClose(commandBus: CommandBus): Promise<void> {
    const finishClose = commandBusCloseFinishers.get(commandBus);

    if (finishClose === undefined) {
      throw new TypeError("Command-bus close completion requires a CommandBus instance.");
    }

    return finishClose();
  },

  abortClose(commandBus: CommandBus): void {
    const abortClose = commandBusAborters.get(commandBus);

    if (abortClose === undefined) {
      throw new TypeError("Command-bus close coordination requires a CommandBus instance.");
    }

    abortClose();
  },

  acceptedWorkCount(commandBus: CommandBus): number {
    const acceptedWorkCount = commandBusWorkCounters.get(commandBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Command-bus work counting requires a CommandBus instance.");
    }

    return acceptedWorkCount();
  },
});
