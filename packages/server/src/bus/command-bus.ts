import { clone } from "@bufbuild/protobuf";
import { ValidationException, checkValid, unpackAny } from "@spine-ts/core";
import { CommandSchema, type Command } from "@spine-ts/proto";

import { SingleProcessServerRuntime } from "../runtime/runtime.js";
import { CommandValidationError } from "./command-errors.js";
import { CommandDispatcherRegistry } from "./command-dispatcher-registry.js";
import type { CommandDispatcher } from "./command-dispatcher.js";

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

  constructor(dispatchers: Iterable<CommandDispatcher> = []) {
    this.#started = this.#runtime.start();

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

    return this.#started.then(() => this.#runtime.enqueue(() => this.#dispatch(accepted)));
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

    const message = unpackAny(packed, registration.schema);

    if (message === undefined) {
      throw CommandValidationError.invalidPayload();
    }

    try {
      checkValid(registration.schema, message);
    } catch (error) {
      if (error instanceof ValidationException) {
        throw new CommandValidationError(error.asMessage());
      }
      throw error;
    }

    await registration.dispatcher.dispatch(clone(CommandSchema, command));
  }
}
