import type {
  PublicSubscriptionWire,
  SubscriptionCoordinator,
  SubscriptionUpdateSink,
} from "../subscriptions/index.js";
import { DynamicUnaryForwarder } from "./dynamic-unary-forwarder.js";

/**
 * Adapts logical subscriptions to the shared dynamic membership owner.
 */
export class DynamicSubscriptionCreator implements SubscriptionCoordinator {
  readonly #owner: DynamicUnaryForwarder;

  /**
   * Creates the adapter for one shared dynamic owner.
   *
   * @param owner Serializes node and subscription reconciliation.
   */
  constructor(owner: DynamicUnaryForwarder) {
    this.#owner = owner;
  }

  /**
   * Rehydrates a retained durable definition into the current native membership.
   *
   * @param definition Supplies the retained canonical definition.
   * @param maxBackendEnvelopeBytes Limits each native child envelope.
   * @returns Completes after child creation settles.
   */
  rehydrate(definition: PublicSubscriptionWire, maxBackendEnvelopeBytes: number): Promise<void> {
    return this.#owner.rehydrateDefinition(definition, maxBackendEnvelopeBytes);
  }

  subscribe(
    request: PublicSubscriptionWire,
    signal: AbortSignal,
    maxBackendEnvelopeBytes?: number,
  ): Promise<void> {
    return this.#owner.subscribeDefinition(request, signal, maxBackendEnvelopeBytes);
  }

  activate(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return this.#owner.activateDefinition(request.wire, request.updates, signal);
  }

  cancel(request: { readonly wire: PublicSubscriptionWire }, signal: AbortSignal): Promise<void> {
    return this.#owner.cancelDefinition(request.wire, signal);
  }
}
