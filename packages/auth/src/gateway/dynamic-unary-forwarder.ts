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

import { clone, fromBinary, toBinary } from "@bufbuild/protobuf";
import { ApplicationNode, BackendMembershipKernel } from "@spine-event-engine/deployment";
import { SubscriptionSchema } from "@spine-event-engine/proto/client";
import type { ILogLayer } from "loglayer";

import type { UnaryForwarder } from "./index.js";
import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionCreator,
  SubscriptionUpdateSink,
  SubscriptionUpdateWire,
} from "../subscriptions/index.js";

/** Represents a connected unary backend with deterministic disposal. */
export interface DynamicUnaryClient extends UnaryForwarder, SubscriptionCreator {
  /** Returns after releasing this connection when its node leaves membership. */
  close(): Promise<void>;
}

/** Configures unary clients for discovered application nodes. */
export interface DynamicUnaryOptions {
  readonly create: (node: ApplicationNode, signal: AbortSignal) => Promise<DynamicUnaryClient>;
  readonly maxConcurrentStarts?: number;
  readonly maxBackendEnvelopeBytes?: number;
  readonly logger?: ILogLayer;
}

/**
 * Auth adapter for the deployment-owned ephemeral backend membership kernel.
 * Durable logical ownership remains in the Gateway's subscription bindings.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #kernel: BackendMembershipKernel<
    ApplicationNode,
    Parameters<UnaryForwarder["forward"]>[0],
    BackendSubscriptionEnvelope,
    SubscriptionUpdateWire
  >;

  constructor(options: DynamicUnaryOptions) {
    if (
      options.maxBackendEnvelopeBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBackendEnvelopeBytes) ||
        options.maxBackendEnvelopeBytes < 1)
    )
      throw new RangeError("maxBackendEnvelopeBytes must be a positive safe integer.");
    this.#kernel = new BackendMembershipKernel<
      ApplicationNode,
      Parameters<UnaryForwarder["forward"]>[0],
      BackendSubscriptionEnvelope,
      SubscriptionUpdateWire
    >({
      create: async (node, signal) => {
        const client = await options.create(node, signal);
        return {
          forward: (request) => client.forward(request),
          subscribe: (definition, childSignal) =>
            client.subscribe(
              { kind: "public-subscription", bytes: definition.slice() },
              childSignal,
            ),
          activate: (child, updates, childSignal) =>
            client.activate(
              {
                wire: { kind: "backend-subscription-envelope", bytes: child.bytes.slice() },
                updates,
              },
              childSignal,
            ),
          dispose: (child, childSignal) =>
            client.dispose(
              { kind: "backend-subscription-envelope", bytes: child.bytes.slice() },
              childSignal,
            ),
          close: () => client.close(),
        };
      },
      memberKey: (node) => node.id,
      sameMember: (left, right) =>
        left.endpoint === right.endpoint && left.tlsServerName === right.tlsServerName,
      definitionKey: (definition) => DynamicUnaryForwarder.definitionKey(definition),
      childDefinition: (definition, node) =>
        DynamicUnaryForwarder.childDefinition(definition, node),
      childSize: (child) => child.bytes.byteLength,
      ...(options.maxConcurrentStarts === undefined
        ? {}
        : { maxConcurrentStarts: options.maxConcurrentStarts }),
      ...(options.maxBackendEnvelopeBytes === undefined
        ? {}
        : { maxChildBytes: options.maxBackendEnvelopeBytes }),
    });
  }

  reconcile(nodes: readonly ApplicationNode[]): Promise<void> {
    return this.#kernel.reconcile(nodes);
  }
  forward(request: Parameters<UnaryForwarder["forward"]>[0]): Promise<Uint8Array> {
    return this.#kernel.forward(request);
  }
  close(): Promise<void> {
    return this.#kernel.close();
  }
  subscribeDefinition(
    request: PublicSubscriptionWire,
    signal: AbortSignal,
    maxBackendEnvelopeBytes?: number,
  ): Promise<void> {
    if (
      maxBackendEnvelopeBytes !== undefined &&
      (!Number.isSafeInteger(maxBackendEnvelopeBytes) || maxBackendEnvelopeBytes < 1)
    )
      throw new RangeError("maxBackendEnvelopeBytes must be a positive safe integer.");
    return this.#kernel.subscribe(request.bytes, signal, maxBackendEnvelopeBytes);
  }
  async rehydrateDefinition(
    request: PublicSubscriptionWire,
    maxBackendEnvelopeBytes?: number,
  ): Promise<void> {
    if (
      maxBackendEnvelopeBytes !== undefined &&
      (!Number.isSafeInteger(maxBackendEnvelopeBytes) || maxBackendEnvelopeBytes < 1)
    )
      throw new RangeError("maxBackendEnvelopeBytes must be a positive safe integer.");
    await this.#kernel.rehydrate(request.bytes, maxBackendEnvelopeBytes);
  }
  activateDefinition(
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal,
  ): Promise<void> {
    return this.#kernel.activate(wire.bytes, updates, signal);
  }
  cancelDefinition(wire: PublicSubscriptionWire, signal: AbortSignal): Promise<void> {
    return this.#kernel.cancel(wire.bytes, signal);
  }
  static waitForAbort(signal: AbortSignal): Promise<void> {
    return BackendMembershipKernel.waitForAbort(signal);
  }
  static definitionKey(bytes: Uint8Array): string | undefined {
    return fromBinary(SubscriptionSchema, bytes).id?.value;
  }
  static childDefinition(bytes: Uint8Array, node: ApplicationNode): Uint8Array {
    const subscription = clone(SubscriptionSchema, fromBinary(SubscriptionSchema, bytes));
    const id = subscription.id?.value;
    if (id === undefined || id.length === 0) return bytes.slice();
    const subscriptionId = subscription.id;
    if (subscriptionId === undefined) return bytes.slice();
    subscriptionId.value = `${id}/${node.id}`;
    return toBinary(SubscriptionSchema, subscription);
  }
}
