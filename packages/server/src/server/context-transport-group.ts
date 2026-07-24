import type { SignalTransport } from "@spine-event-engine/transport";

import type { BoundedContext } from "../context/bounded-context.js";
import { ContextTransport, contextTransportAccess } from "../runtime/context-transport.js";
import type { RuntimeTransportBindingHandle } from "../runtime/runtime-transport.js";
import { RetryableCloseGroup } from "./retryable-close.js";

/** @internal Retryable registrations owned by one server assembly. */
export class ContextTransportGroup {
  readonly #transport: SignalTransport;
  readonly #handles: RuntimeTransportBindingHandle[] = [];
  #closeGroup: RetryableCloseGroup | undefined;

  constructor(transport: SignalTransport) {
    this.#transport = transport;
  }

  async open(contexts: readonly BoundedContext[]): Promise<void> {
    for (const context of contexts) {
      try {
        this.#handles.push(await ContextTransport.open({ context, transport: this.#transport }));
      } catch (error) {
        const cleanup = contextTransportAccess.failedOpenCleanup(error);
        if (cleanup !== undefined) {
          this.#handles.push(cleanup);
        }
        throw error;
      }
    }
  }

  close(): Promise<void> {
    this.#closeGroup ??= new RetryableCloseGroup(
      this.#handles,
      "Server context transport close failed.",
    );
    return this.#closeGroup.close();
  }
}
