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

import type { SignalTransport } from "@spine-event-engine/transport";

import type { BoundedContext } from "../context/bounded-context.js";
import {
  RuntimeTransportBinding,
  runtimeTransportBindingAccess,
  type RuntimeTransportBindingHandle,
} from "./runtime-transport.js";
import { SingleProcessServerRuntime } from "./runtime.js";
import { createContextRoutingPlan } from "./runtime-routing.js";

/**
 * Opens framework-owned transport intake for one built bounded context.
 *
 * @internal
 */
export const ContextTransport: Readonly<{
  open(input: ContextTransportInput): Promise<RuntimeTransportBindingHandle>;
}> = Object.freeze({
  async open(input: ContextTransportInput): Promise<RuntimeTransportBindingHandle> {
    return await RuntimeTransportBinding.open({
      plan: createContextRoutingPlan(input.context),
      runtime: new SingleProcessServerRuntime(),
      transport: input.transport,
      onCommand: (command) => input.context.commandBus().post(command),
      onEvent: (event) => input.context.eventBus().post(event),
    });
  },
});

/**
 * Provides access to cleanup retained after a failed context transport open.
 *
 * @internal
 */
export const contextTransportAccess: Readonly<{
  failedOpenCleanup(error: unknown): RuntimeTransportBindingHandle | undefined;
}> = Object.freeze({
  failedOpenCleanup: (error: unknown): RuntimeTransportBindingHandle | undefined =>
    runtimeTransportBindingAccess.failedOpenCleanup(error),
});

/**
 * Defines input for framework-owned bounded-context transport intake.
 *
 * @internal
 */
export interface ContextTransportInput {
  // prettier-ignore

  /**
   * The built context receiving accepted envelopes.
   */
  readonly context: BoundedContext;

  /**
   * The local signal transport that delivers envelopes.
   */
  readonly transport: SignalTransport;
}
