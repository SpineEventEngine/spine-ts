import type { SignalTransport } from "@spine-event-engine/transport";

import type { BoundedContext } from "../context/bounded-context.js";
import { ContextTransport, contextTransportAccess } from "../runtime/context-transport.js";
import type { RuntimeTransportBindingHandle } from "../runtime/runtime-transport.js";
import { RetryableCloseGroup } from "./retryable-close.js";

/**
 * Groups the transport bindings opened for one server assembly.
 *
 * @internal
 */
export class ContextTransportGroup {
  readonly #transport: SignalTransport;
  readonly #handles: RuntimeTransportBindingHandle[] = [];
  #closeGroup: RetryableCloseGroup | undefined;

  /**
   * Creates a group for one signal transport.
   *
   * @param transport Carries signals for every context in the assembly.
   */
  constructor(transport: SignalTransport) {
    this.#transport = transport;
  }

  /**
   * Opens transport bindings for contexts in their supplied order.
   *
   * @param contexts Supplies the contexts whose intake must be opened.
   * @returns A promise that resolves after all context bindings open.
   */
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

  /**
   * Closes opened bindings, retaining unsuccessful closes for a later retry.
   * @returns A promise that settles after every close attempt finishes.
   */
  close(): Promise<void> {
    this.#closeGroup ??= new RetryableCloseGroup(
      this.#handles,
      "Server context transport close failed.",
    );
    return this.#closeGroup.close();
  }
}
