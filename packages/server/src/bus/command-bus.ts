import { clone } from "@bufbuild/protobuf";
import { CommandSchema, type Command } from "@spine-ts/proto";

import { SingleProcessServerRuntime } from "../runtime/runtime.js";
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
    const typeUrl = command.message?.typeUrl;

    if (typeUrl === undefined || typeUrl === "") {
      throw new Error("CommandBus requires command.message.typeUrl.");
    }

    const dispatcher = this.#registry.find(typeUrl);

    if (dispatcher === undefined) {
      throw new Error(`No command dispatcher registered for "${typeUrl}".`);
    }

    await dispatcher.dispatch(clone(CommandSchema, command));
  }
}
