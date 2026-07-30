import type { SignalTransport } from "@spine-event-engine/transport";

import type { BoundedContext } from "../context/bounded-context.js";
import {
  RuntimeTransportBinding,
  runtimeTransportBindingAccess,
  type RuntimeTransportBindingHandle,
} from "./runtime-transport.js";
import { SingleProcessServerRuntime } from "./runtime.js";
import { createContextRoutingPlan } from "./runtime-routing.js";

/** Opens framework-owned transport intake for one built bounded context.
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

/** Provides access to cleanup retained after a failed context transport open.
 *
 * @internal
 */
export const contextTransportAccess: Readonly<{
  failedOpenCleanup(error: unknown): RuntimeTransportBindingHandle | undefined;
}> = Object.freeze({
  failedOpenCleanup: (error: unknown): RuntimeTransportBindingHandle | undefined =>
    runtimeTransportBindingAccess.failedOpenCleanup(error),
});

/** Defines input for framework-owned bounded-context transport intake.
 *
 * @internal
 */
export interface ContextTransportInput {
  /** The built context receiving accepted envelopes. */
  readonly context: BoundedContext;
  /** The local signal transport that delivers envelopes. */
  readonly transport: SignalTransport;
}
