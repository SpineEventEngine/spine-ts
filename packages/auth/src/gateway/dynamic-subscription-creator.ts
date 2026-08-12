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
   * Restores a retained durable definition into the current native membership.
   *
   * @param definition Supplies the retained canonical definition.
   * @returns Completes after child creation settles.
   */
  rehydrate(definition: PublicSubscriptionWire): Promise<void> {
    return this.#owner.rehydrateDefinition(definition);
  }

  /**
   * Creates native children for one logical definition across current membership.
   *
   * @param request Supplies the canonical public definition.
   * @param signal Cancels child creation.
   * @param maxBackendEnvelopeBytes Limits every native child envelope.
   * @returns Completes after all current native children are installed.
   */
  subscribe(
    request: PublicSubscriptionWire,
    signal: AbortSignal,
    maxBackendEnvelopeBytes?: number,
  ): Promise<void> {
    return this.#owner.subscribeDefinition(request, signal, maxBackendEnvelopeBytes);
  }

  /**
   * Activates native children and relays their updates until cancellation.
   *
   * @param request Supplies the definition and update relay.
   * @param signal Ends active child streams.
   * @returns Completes after the active relay ends.
   */
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

  /**
   * Cancels every native child for a logical definition.
   *
   * @param request Supplies the definition to cancel.
   * @param signal Cancels cleanup.
   * @returns Completes after child cleanup settles.
   */
  cancel(request: { readonly wire: PublicSubscriptionWire }, signal: AbortSignal): Promise<void> {
    return this.#owner.cancelDefinition(request.wire, signal);
  }
}
