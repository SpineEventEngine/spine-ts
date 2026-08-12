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
import type { Command } from "@spine-event-engine/proto";
import type { MessageSchema } from "@spine-event-engine/core";

/**
 * Small unicast command-dispatch seam for bus and repository adapters.
 *
 * Dispatchers declare the command message schemas they accept and perform
 * handling behind the bus seam. Repository-backed adapters own entity loading
 * and method invocation; the bus only routes accepted command envelopes.
 */
export interface CommandDispatcher {
  // prettier-ignore

  /**
   * Lists generated command message schemas accepted by this dispatcher.
   *
   * @returns the accepted message schemas.
   */
  messageSchemas(): readonly MessageSchema[];

  /**
   * Dispatches one generated Spine command envelope.
   *
   * @param command the command envelope to dispatch.
   * @returns A promise that resolves after the command is dispatched.
   */
  dispatch(command: Command): Promise<void>;
}
