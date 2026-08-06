import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionCreator,
  SubscriptionTopicWire,
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

  subscribe(request: SubscriptionTopicWire, signal: AbortSignal): Promise<BackendSubscriptionEnvelope> {
    return this.#owner.subscribeDefinition(request, signal);
  }

  activate(
    _request: {
      readonly wire: PublicSubscriptionWire;
      readonly backend: BackendSubscriptionEnvelope;
      readonly updates: SubscriptionUpdateSink;
    },
    _signal: AbortSignal,
  ): Promise<void> {
    return Promise.resolve();
  }

  cancel(
    _request: { readonly wire: PublicSubscriptionWire; readonly backend: BackendSubscriptionEnvelope },
    _signal: AbortSignal,
  ): Promise<void> {
    return Promise.resolve();
  }

  dispose(_backend: BackendSubscriptionEnvelope, _signal: AbortSignal): Promise<void> {
    return Promise.resolve();
  }
}
