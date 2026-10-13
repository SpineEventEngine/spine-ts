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
import { ApplicationNode } from "@spine-event-engine/deployment";
import {
  BackendMembershipKernel,
  type BackendMemberClient,
} from "@spine-event-engine/deployment/spi/backend-membership";
import { SubscriptionSchema, SubscriptionUpdateSchema } from "@spine-event-engine/proto/client";
import type { ILogLayer } from "loglayer";

import type { UnaryForwarder } from "./index.js";
import type {
  BackendSubscriptionEnvelope,
  PublicSubscriptionWire,
  SubscriptionCreator,
  SubscriptionUpdateSink,
  SubscriptionUpdateWire,
} from "../subscriptions/index.js";

/**
 * Represents a connected unary backend with deterministic disposal.
 * A custom subscription client validates relayed update IDs and Topics against
 * the actual Subscription accepted by its backend before forwarding updates.
 */
export interface DynamicUnaryClient extends UnaryForwarder, SubscriptionCreator {
  // prettier-ignore

  /**
   * Returns after releasing this connection when its node leaves membership.
   *
   * @returns Completion of connection cleanup.
   */
  close(): Promise<void>;
}

/**
 * Configures unary clients for discovered application nodes.
 */
export interface DynamicUnaryOptions {
  // prettier-ignore

  /**
   * Creates a client for one discovered application node.
   *
   * @param node Supplies the discovered application node.
   * @param signal Cancels client creation.
   * @returns The connected unary client.
   */
  readonly create: (node: ApplicationNode, signal: AbortSignal) => Promise<DynamicUnaryClient>;

  /**
   * Limits parallel client starts when supplied.
   */
  readonly maxConcurrentStarts?: number;

  /**
   * Limits one backend subscription envelope when supplied.
   */
  readonly maxBackendEnvelopeBytes?: number;

  /**
   * Receives adapter-local diagnostic records when supplied.
   */
  readonly logger?: ILogLayer;
}

/**
 * Adapts Gateway unary operations to the deployment-owned membership kernel.
 * Durable logical ownership remains in the Gateway's subscription bindings.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #kernel: BackendMembershipKernel<
    ApplicationNode,
    Parameters<UnaryForwarder["forward"]>[0],
    BackendSubscriptionEnvelope,
    SubscriptionUpdateWire
  >;

  /**
   * Creates the Gateway adapter around the deployment membership kernel.
   *
   * @param options Configures discovery clients and resource bounds.
   */
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
      create: async (node, signal) =>
        DynamicUnaryForwarder.memberClient(await options.create(node, signal)),
      memberKey: (node) => node.id,
      sameMember: (left, right) =>
        left.endpoint === right.endpoint && left.tlsServerName === right.tlsServerName,
      definitionKey: (definition) => DynamicUnaryForwarder.definitionKey(definition),
      childDefinition: (definition, node) =>
        DynamicUnaryForwarder.childDefinition(definition, node),
      childSize: (child) => child.bytes.byteLength,
      isActivationAck: (update) => DynamicUnaryForwarder.isActivationAck(update),
      logicalActivationAck: (definition, childAck) =>
        DynamicUnaryForwarder.logicalActivationAck(definition, childAck),
      ...(options.maxConcurrentStarts === undefined
        ? {}
        : { maxConcurrentStarts: options.maxConcurrentStarts }),
      ...(options.maxBackendEnvelopeBytes === undefined
        ? {}
        : { maxChildBytes: options.maxBackendEnvelopeBytes }),
    });
  }

  /**
   * Builds membership operations for one connected gateway client.
   *
   * @param client The connected gateway client.
   * @returns The member's forwarding and subscription operations.
   */
  private static memberClient(
    client: DynamicUnaryClient,
  ): BackendMemberClient<
    Parameters<UnaryForwarder["forward"]>[0],
    BackendSubscriptionEnvelope,
    SubscriptionUpdateWire
  > {
    return {
      forward: (request) => client.forward(request),
      subscribe: (definition, signal) =>
        client.subscribe({ kind: "public-subscription", bytes: definition.slice() }, signal),
      activate: (child, updates, signal) =>
        client.activate(
          {
            wire: { kind: "backend-subscription-envelope", bytes: child.bytes.slice() },
            updates,
          },
          signal,
        ),
      dispose: (child, signal) =>
        client.dispose(
          { kind: "backend-subscription-envelope", bytes: child.bytes.slice() },
          signal,
        ),
      close: () => client.close(),
    };
  }

  /**
   * Checks a response-only successful child activation acknowledgement.
   *
   * @param update The serialized child update.
   * @returns Whether the child is attached and ready.
   */
  private static isActivationAck(update: SubscriptionUpdateWire): boolean {
    const decoded = fromBinary(SubscriptionUpdateSchema, update.bytes);
    return decoded.response?.status?.status.case === "ok" && decoded.update.case === undefined;
  }

  /**
   * Transforms a child acknowledgement to the public logical subscription identity.
   *
   * @param definition The logical subscription definition.
   * @param childAck The validated child acknowledgement.
   * @returns The single logical acknowledgement.
   */
  private static logicalActivationAck(
    definition: Uint8Array,
    childAck: SubscriptionUpdateWire,
  ): SubscriptionUpdateWire {
    const update = fromBinary(SubscriptionUpdateSchema, childAck.bytes);
    update.subscription = fromBinary(SubscriptionSchema, definition);
    return { kind: "subscription-update", bytes: toBinary(SubscriptionUpdateSchema, update) };
  }

  /**
   * Updates connected clients from a complete application-node snapshot.
   *
   * @param nodes Supplies the complete node snapshot.
   * @returns Completion of client reconciliation.
   */
  reconcile(nodes: readonly ApplicationNode[]): Promise<void> {
    return this.#kernel.reconcile(nodes);
  }

  /**
   * Returns a unary response from the selected backend client.
   *
   * @param request Supplies the request to forward.
   * @returns The backend response bytes.
   */
  forward(request: Parameters<UnaryForwarder["forward"]>[0]): Promise<Uint8Array> {
    return this.#kernel
      .forward(request)
      .catch((error: unknown) => DynamicUnaryForwarder.#gatewayError(error));
  }

  /**
   * Closes all live backend clients.
   *
   * @returns Completion of backend cleanup.
   */
  close(): Promise<void> {
    return this.#kernel.close();
  }

  /**
   * Creates backend children for one logical Gateway subscription.
   *
   * @param request Supplies the public subscription wire.
   * @param signal Cancels child creation.
   * @param maxBackendEnvelopeBytes Limits one backend envelope when supplied.
   * @returns Completion of child creation.
   */
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
    return this.#kernel
      .subscribe(request.bytes, signal, maxBackendEnvelopeBytes)
      .catch((error: unknown) => DynamicUnaryForwarder.#gatewayError(error));
  }

  /**
   * Updates backend children for a retained Gateway subscription.
   *
   * @param request Supplies the retained public subscription wire.
   * @param maxBackendEnvelopeBytes Limits one backend envelope when supplied.
   * @returns Completion of child recreation.
   */
  async rehydrateDefinition(
    request: PublicSubscriptionWire,
    maxBackendEnvelopeBytes?: number,
  ): Promise<void> {
    if (
      maxBackendEnvelopeBytes !== undefined &&
      (!Number.isSafeInteger(maxBackendEnvelopeBytes) || maxBackendEnvelopeBytes < 1)
    )
      throw new RangeError("maxBackendEnvelopeBytes must be a positive safe integer.");
    await this.#kernel
      .rehydrate(request.bytes, maxBackendEnvelopeBytes)
      .catch((error: unknown) => DynamicUnaryForwarder.#gatewayError(error));
  }

  /**
   * Activates backend update relay for one Gateway subscription.
   *
   * @param wire Supplies the public subscription wire.
   * @param updates Receives relayed subscription updates.
   * @param signal Cancels update relay.
   * @returns Completion after cancellation.
   */
  activateDefinition(
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal,
  ): Promise<void> {
    return this.#kernel.activate(wire.bytes, updates, signal);
  }

  /**
   * Cancels backend children for one Gateway subscription.
   *
   * @param wire Supplies the public subscription wire.
   * @param signal Cancels child cleanup when supported.
   * @returns Completion of child cleanup.
   */
  cancelDefinition(wire: PublicSubscriptionWire, signal: AbortSignal): Promise<void> {
    return this.#kernel.cancel(wire.bytes, signal);
  }

  /**
   * Resolves when the supplied signal aborts.
   *
   * @param signal Supplies the signal to observe.
   * @returns Completion after the signal aborts.
   */
  static waitForAbort(signal: AbortSignal): Promise<void> {
    return BackendMembershipKernel.waitForAbort(signal);
  }

  /**
   * Returns the logical identifier encoded in public subscription bytes.
   *
   * @param bytes Supplies the public subscription bytes.
   * @returns The logical identifier, when present.
   */
  static definitionKey(bytes: Uint8Array): string | undefined {
    return fromBinary(SubscriptionSchema, bytes).id?.value;
  }

  /**
   * Returns bytes with only the immediate child subscription identifier rewritten.
   *
   * @param bytes Supplies the parent subscription bytes.
   * @param node Supplies the child application node.
   * @returns The rewritten child subscription bytes.
   */
  static childDefinition(bytes: Uint8Array, node: ApplicationNode): Uint8Array {
    const subscription = clone(SubscriptionSchema, fromBinary(SubscriptionSchema, bytes));
    const id = subscription.id?.value;
    if (id === undefined || id.length === 0) return bytes.slice();
    const subscriptionId = subscription.id;
    if (subscriptionId === undefined) return bytes.slice();
    subscriptionId.value = `${id}/${node.id}`;
    return toBinary(SubscriptionSchema, subscription);
  }

  static #gatewayError(error: unknown): never {
    if (error instanceof Error && error.message === "backend membership is unavailable.")
      throw new Error("Gateway backend is absent.");
    if (error instanceof Error && error.message === "backend membership kernel is closed.")
      throw new Error("Gateway dynamic owner is closed.");
    throw error;
  }
}
