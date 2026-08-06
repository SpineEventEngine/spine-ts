import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionCreator,
  SubscriptionUpdateSink,
} from "../subscriptions/index.js";
import { DynamicUnaryForwarder } from "./dynamic-unary-forwarder.js";

/**
 * Adapts logical subscriptions to the shared dynamic membership owner.
 */
export class DynamicSubscriptionCreator implements SubscriptionCreator {
  readonly #owner: DynamicUnaryForwarder;

  /**
   * Creates the adapter for one shared dynamic owner.
   *
   * @param owner Serializes node and subscription reconciliation.
   */
  constructor(owner: DynamicUnaryForwarder) {
    this.#owner = owner;
  }

  subscribe(
    request: PublicSubscriptionWire,
    signal: AbortSignal,
  ): Promise<BackendSubscriptionEnvelope> {
    return this.#owner.subscribeDefinition(request, signal);
  }

  activate(
    request: {
      readonly wire: PublicSubscriptionWire;
      readonly updates: SubscriptionUpdateSink;
    },
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return this.#owner.activateDefinition(request.wire, request.updates);
  }

  cancel(request: { readonly wire: PublicSubscriptionWire }, signal: AbortSignal): Promise<void> {
    return this.#owner.cancelDefinition(request.wire, signal);
  }

  dispose(backend: BackendSubscriptionEnvelope, signal: AbortSignal): Promise<void> {
    return this.#owner.cancelDefinition(
      { kind: "public-subscription", bytes: backend.bytes.slice() },
      signal,
    );
  }
}
