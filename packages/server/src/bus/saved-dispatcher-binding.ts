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
// prettier-ignore
import type {
  AgentSavedDispatchTarget,
} from "@spine-event-engine/proto/generated/spine/server/agent/execution_record_pb.js";
import type { CommandDispatcher } from "./command-dispatcher.js";
import type { EventDispatcher } from "./event-dispatcher.js";

/**
 * Prepares and rebinds one normal Event dispatcher without repeating recipient routing.
 */
export interface SavedEventBinding {
  /**
   * Prepares the exact recipient for saved dispatch.
   *
   * @param event Event envelope to prepare or dispatch.
   * @returns The exact saved recipient target.
   */
  prepare(event: Event): Promise<AgentSavedDispatchTarget>;

  /**
   * Checks whether a saved recipient still matches this dispatcher.
   *
   * @param target Persisted recipient target to compare or bind.
   * @returns Whether the target still matches this dispatcher.
   */
  matches(target: AgentSavedDispatchTarget): boolean;

  /**
   * Binds a saved envelope to its prepared recipient.
   *
   * @param event Event envelope to prepare or dispatch.
   * @param target Persisted recipient target to compare or bind.
   * @returns A callback that dispatches to the prepared recipient.
   */
  bind(event: Event, target: AgentSavedDispatchTarget): Promise<() => Promise<void>>;
}

/**
 * Prepares and rebinds one normal Command dispatcher without repeating routing.
 */
export interface SavedCommandBinding {
  /**
   * Prepares the exact recipient for saved dispatch.
   *
   * @param command Command envelope to prepare or dispatch.
   * @returns The exact saved recipient target.
   */
  prepare(command: Command): Promise<AgentSavedDispatchTarget>;

  /**
   * Checks whether a saved recipient still matches this dispatcher.
   *
   * @param target Persisted recipient target to compare or bind.
   * @returns Whether the target still matches this dispatcher.
   */
  matches(target: AgentSavedDispatchTarget): boolean;

  /**
   * Binds a saved envelope to its prepared recipient.
   *
   * @param command Command envelope to prepare or dispatch.
   * @param target Persisted recipient target to compare or bind.
   * @returns A callback that dispatches to the prepared recipient.
   */
  bind(command: Command, target: AgentSavedDispatchTarget): Promise<() => Promise<void>>;
}

const eventBindings = new WeakMap<EventDispatcher, SavedEventBinding>();
const commandBindings = new WeakMap<CommandDispatcher, SavedCommandBinding>();

interface SavedDispatcherBindingAccess {
  /**
   * Registers an event dispatcher with its saved-dispatch binding.
   *
   * @param dispatcher Dispatcher to register or inspect.
   * @param binding Saved-dispatch binding for this dispatcher.
   * @returns The dispatcher with its binding recorded.
   */
  event(dispatcher: EventDispatcher, binding: SavedEventBinding): EventDispatcher;

  /**
   * Registers a command dispatcher with its saved-dispatch binding.
   *
   * @param dispatcher Dispatcher to register or inspect.
   * @param binding Saved-dispatch binding for this dispatcher.
   * @returns The dispatcher with its binding recorded.
   */
  command(dispatcher: CommandDispatcher, binding: SavedCommandBinding): CommandDispatcher;

  /**
   * Finds the saved-dispatch binding for an event dispatcher.
   *
   * @param dispatcher Dispatcher to register or inspect.
   * @returns The registered event binding, if present.
   */
  forEvent(dispatcher: EventDispatcher): SavedEventBinding | undefined;

  /**
   * Finds the saved-dispatch binding for a command dispatcher.
   *
   * @param dispatcher Dispatcher to register or inspect.
   * @returns The registered command binding, if present.
   */
  forCommand(dispatcher: CommandDispatcher): SavedCommandBinding | undefined;
}

/**
 * Framework-only metadata adapters for saved Agent output acceptance.
 */
export const SavedDispatcherBindings: SavedDispatcherBindingAccess = Object.freeze({
  event(dispatcher: EventDispatcher, binding: SavedEventBinding): EventDispatcher {
    eventBindings.set(dispatcher, binding);
    return dispatcher;
  },
  command(dispatcher: CommandDispatcher, binding: SavedCommandBinding): CommandDispatcher {
    commandBindings.set(dispatcher, binding);
    return dispatcher;
  },
  forEvent(dispatcher: EventDispatcher): SavedEventBinding | undefined {
    return eventBindings.get(dispatcher);
  },
  forCommand(dispatcher: CommandDispatcher): SavedCommandBinding | undefined {
    return commandBindings.get(dispatcher);
  },
});
