import type { SignalTransport } from "@spine-ts/transport";

import type { BoundedContext } from "../context/bounded-context.js";
import {
  RuntimeTransportBinding,
  runtimeTransportBindingAccess,
  type RuntimeTransportBindingHandle,
} from "./runtime-transport.js";
import { SingleProcessServerRuntime } from "./runtime.js";
import { createContextRoutingPlan } from "./runtime-routing.js";

/** @internal Framework-owned transport intake for one built bounded context. */
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

/** @internal Package access to cleanup retained after a failed context transport open. */
export const contextTransportAccess: Readonly<{
  failedOpenCleanup(error: unknown): RuntimeTransportBindingHandle | undefined;
}> = Object.freeze({
  failedOpenCleanup: (error: unknown): RuntimeTransportBindingHandle | undefined =>
    runtimeTransportBindingAccess.failedOpenCleanup(error),
});

/** @internal Input for framework-owned bounded-context transport intake. */
export interface ContextTransportInput {
  readonly context: BoundedContext;
  readonly transport: SignalTransport;
}
