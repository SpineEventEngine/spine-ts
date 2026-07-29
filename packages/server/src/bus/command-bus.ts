import { clone } from "@bufbuild/protobuf";
import { ValidationException, Validate, AnyMessages } from "@spine-event-engine/core";
import { CommandSchema, type Command } from "@spine-event-engine/proto";

import {
  runtimeAccess,
  ServerRuntimeStateError,
  SingleProcessServerRuntime,
} from "../runtime/runtime.js";
import { CommandValidationError } from "./command-errors.js";
import { CommandDispatcherRegistry } from "./command-dispatcher-registry.js";
import type { CommandDispatcher } from "./command-dispatcher.js";

const internalCommandPosters = new WeakMap<CommandBus, (command: Command) => Promise<void>>();
const commandBusCloseStarters = new WeakMap<CommandBus, () => void>();
const commandBusDrainers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusCloseFinishers = new WeakMap<CommandBus, () => Promise<void>>();
const commandBusWorkCounters = new WeakMap<CommandBus, () => number>();

interface CommandBusAccess {
  postInternal(commandBus: CommandBus, command: Command): Promise<void>;
  beginClose(commandBus: CommandBus): void;
  drain(commandBus: CommandBus): Promise<void>;
  finishClose(commandBus: CommandBus): Promise<void>;
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

  constructor(dispatchers: Iterable<CommandDispatcher> = []) {
    this.#started = this.#runtime.start();
    internalCommandPosters.set(this, (command) => this.#postInternal(command));
    commandBusCloseStarters.set(this, () => {
      this.#beginClose();
    });
    commandBusDrainers.set(this, () => this.#drain());
    commandBusCloseFinishers.set(this, () => this.#finishClose());
    commandBusWorkCounters.set(this, () => this.#acceptedWorkCount);

    for (const dispatcher of dispatchers) {
      this.register(dispatcher);
    }
  }

  register<Dispatcher extends CommandDispatcher>(dispatcher: Dispatcher): Dispatcher {
    this.#registry.register(dispatcher);
    return dispatcher;
  }

  acceptedCommandTypes(): readonly string[] {
    return this.#registry.acceptedTypeUrls();
  }

  post(command: Command): Promise<void> {
    const accepted = clone(CommandSchema, command);

    if (this.#intakeState !== "open") {
      return Promise.reject(new ServerRuntimeStateError("enqueue", this.#intakeState));
    }

    return this.#enqueueAccepted(accepted);
  }

  /**
   * Stop accepting new command work and wait for accepted work to settle.
   *
   * Close is idempotent and returns the same close outcome on repeated calls.
   * Runtime close failures reject the returned promise.
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

  async #closeOnce(): Promise<void> {
    this.#beginClose();
    await this.#started;
    await this.#runtime.close();
    this.#intakeState = "closed";
  }

  async #dispatch(command: Command): Promise<void> {
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

    await registration.dispatcher.dispatch(clone(CommandSchema, command));
  }
}

/** @internal Command-bus access for framework-owned produced commands and coordinated close. */
export const commandBusAccess: CommandBusAccess = Object.freeze({
  postInternal(commandBus: CommandBus, command: Command): Promise<void> {
    const postInternal = internalCommandPosters.get(commandBus);

    if (postInternal === undefined) {
      throw new TypeError("Internal command post requires a CommandBus instance.");
    }

    return postInternal(command);
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

  acceptedWorkCount(commandBus: CommandBus): number {
    const acceptedWorkCount = commandBusWorkCounters.get(commandBus);

    if (acceptedWorkCount === undefined) {
      throw new TypeError("Command-bus work counting requires a CommandBus instance.");
    }

    return acceptedWorkCount();
  },
});
