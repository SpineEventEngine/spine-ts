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
import {
  snapshotTrustedReader,
  type TrustedReaderContext,
} from "@spine-event-engine/core/spi/trusted-reader";

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
 * Identifies one native child attempt and every ID it exposes to forwarding.
 */
interface ChildReaderAssociation {
  readonly logicalId: string;
  readonly initialId: string;
  readonly ids: Set<string>;
}

/**
 * Adapts Gateway unary operations to the deployment-owned membership kernel.
 * Durable logical ownership remains in the Gateway's subscription bindings.
 */
export class DynamicUnaryForwarder implements UnaryForwarder {
  readonly #readers = new Map<string, TrustedReaderContext>();

  readonly #children = new Map<string, Set<string>>();

  readonly #associationsById = new Map<string, ChildReaderAssociation>();

  readonly #pendingAssociations = new WeakMap<Uint8Array, ChildReaderAssociation>();

  readonly #activeAssociations = new WeakMap<BackendSubscriptionEnvelope, ChildReaderAssociation>();

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
      create: async (node, signal) => this.memberClient(await options.create(node, signal)),
      memberKey: (node) => node.id,
      sameMember: (left, right) =>
        left.endpoint === right.endpoint && left.tlsServerName === right.tlsServerName,
      definitionKey: (definition) => DynamicUnaryForwarder.definitionKey(definition),
      childDefinition: (definition, node) => this.childDefinition(definition, node),
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
   * Records the native child definition and its admitted logical reader.
   *
   * @param definition The serialized logical subscription definition.
   * @param node Selected managed application node.
   * @returns The child subscription definition.
   */
  private childDefinition(definition: Uint8Array, node: ApplicationNode): Uint8Array {
    const child = DynamicUnaryForwarder.childDefinition(definition, node);
    const logicalId = DynamicUnaryForwarder.definitionKey(definition);
    const reader = this.#readers.get(logicalId ?? "");
    const childId = DynamicUnaryForwarder.definitionKey(child);
    if (logicalId !== undefined && childId !== undefined) {
      const association = { logicalId, initialId: childId, ids: new Set<string>() };
      this.#pendingAssociations.set(child, association);
      this.associateChildId(association, childId, reader);
    }
    return child;
  }

  /**
   * Builds membership operations for one connected gateway client.
   *
   * @param client The connected gateway client.
   * @returns The member's forwarding and subscription operations.
   */
  private memberClient(
    client: DynamicUnaryClient,
  ): BackendMemberClient<
    Parameters<UnaryForwarder["forward"]>[0],
    BackendSubscriptionEnvelope,
    SubscriptionUpdateWire
  > {
    return {
      forward: (request) => client.forward(request),
      subscribe: (definition, signal) => this.subscribeChild(client, definition, signal),
      activate: (child, updates, signal) =>
        client.activate(
          {
            wire: {
              kind: "backend-subscription-envelope",
              bytes: child.bytes.slice(),
              ...this.readerField(child.bytes),
            },
            updates,
          },
          signal,
        ),
      dispose: (child, signal) => this.disposeChild(client, child, signal),
      close: () => client.close(),
    };
  }

  /**
   * Removes one native child and then retires its reader associations.
   *
   * @param client Connected member client that created this child.
   * @param child Backend-issued child envelope.
   * @param signal Cancellation signal for native disposal.
   * @returns Completion after native disposal and reader cleanup.
   */
  private async disposeChild(
    client: DynamicUnaryClient,
    child: BackendSubscriptionEnvelope,
    signal: AbortSignal,
  ): Promise<void> {
    await client.dispose(
      {
        kind: "backend-subscription-envelope",
        bytes: child.bytes.slice(),
        ...this.readerField(child.bytes),
      },
      signal,
    );
    const association = this.#activeAssociations.get(child);
    if (association !== undefined) this.retireChild(association);
  }

  /**
   * Starts a native child and tracks an assigned ID for its admitted reader.
   *
   * @param client Native subscription client.
   * @param definition The serialized subscription definition.
   * @param signal The cancellation signal for this operation.
   * @returns The managed-child subscription.
   */
  private subscribeChild(client: DynamicUnaryClient, definition: Uint8Array, signal: AbortSignal) {
    const reader = this.readerField(definition);
    const association = this.#pendingAssociations.get(definition);
    const result = client.subscribe(
      { kind: "public-subscription", bytes: definition.slice(), ...reader },
      signal,
    );
    return result.then(
      (child) => {
        if (association !== undefined) {
          this.#activeAssociations.set(child, association);
          this.rememberProducedChild(association, child.bytes);
        }
        return child;
      },
      (error: unknown) => {
        if (association !== undefined) this.retireChild(association);
        throw error;
      },
    );
  }

  /**
   * Finds detached reader facts for one retained logical or native child definition.
   *
   * @param bytes The serialized message bytes.
   * @returns The persisted reader binding field.
   */
  private readerField(bytes: Uint8Array): { readonly reader?: TrustedReaderContext } {
    let id: string | undefined;
    try {
      id = DynamicUnaryForwarder.definitionKey(bytes);
    } catch {
      return {};
    }
    const reader = this.#readers.get(id ?? "");
    return reader === undefined ? {} : { reader: snapshotTrustedReader(reader) };
  }

  /**
   * Records a backend-assigned child ID to its admitted logical reader.
   *
   * @param association Native child attempt that produced the backend ID.
   * @param produced Backend update produced for a subscription.
   */
  private rememberProducedChild(association: ChildReaderAssociation, produced: Uint8Array): void {
    if (this.#associationsById.get(association.initialId) !== association) return;
    let producedId: string | undefined;
    try {
      producedId = DynamicUnaryForwarder.definitionKey(produced);
    } catch {
      return;
    }
    if (producedId === undefined) return;
    this.associateChildId(association, producedId, this.#readers.get(association.initialId));
  }

  /**
   * Records one child ID with its attempt and current logical reader.
   *
   * @param association Native child attempt that introduced the ID.
   * @param childId Initial or backend-issued child ID.
   * @param reader Current verified reader facts, if supplied.
   */
  private associateChildId(
    association: ChildReaderAssociation,
    childId: string,
    reader: TrustedReaderContext | undefined,
  ): void {
    association.ids.add(childId);
    const children = this.#children.get(association.logicalId) ?? new Set<string>();
    children.add(childId);
    this.#children.set(association.logicalId, children);
    this.#associationsById.set(childId, association);
    if (reader !== undefined) this.#readers.set(childId, reader);
  }

  /**
   * Removes only IDs still associated with this retired child attempt.
   *
   * @param association Native child attempt after successful disposal.
   */
  private retireChild(association: ChildReaderAssociation): void {
    const children = this.#children.get(association.logicalId);
    for (const id of association.ids) {
      if (this.#associationsById.get(id) !== association) continue;
      this.#associationsById.delete(id);
      this.#readers.delete(id);
      children?.delete(id);
    }
    if (children?.size === 0) this.#children.delete(association.logicalId);
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
    return this.#kernel.close().finally(() => {
      this.#readers.clear();
      this.#children.clear();
      this.#associationsById.clear();
    });
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
    this.rememberReader(request);
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
    this.rememberReader(request);
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
   * @returns Completion after cancellation; rejects on unexpected child or bounded cleanup failure.
   */
  activateDefinition(
    wire: PublicSubscriptionWire,
    updates: SubscriptionUpdateSink,
    signal: AbortSignal,
  ): Promise<void> {
    this.rememberReader(wire);
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
    this.rememberReader(wire);
    return this.#kernel.cancel(wire.bytes, signal).then(() => {
      const id = DynamicUnaryForwarder.definitionKey(wire.bytes);
      if (id === undefined) return;
      this.#readers.delete(id);
      for (const childId of this.#children.get(id) ?? []) {
        this.#readers.delete(childId);
        this.#associationsById.delete(childId);
      }
      this.#children.delete(id);
    });
  }

  /**
   * Updates current reader facts for a retained definition and its native children.
   *
   * @param wire The admitted definition with current verified reader facts.
   */
  private rememberReader(wire: PublicSubscriptionWire): void {
    if (wire.reader === undefined) return;
    const id = DynamicUnaryForwarder.definitionKey(wire.bytes);
    if (id === undefined) return;
    const reader = snapshotTrustedReader(wire.reader);
    this.#readers.set(id, reader);
    for (const childId of this.#children.get(id) ?? []) this.#readers.set(childId, reader);
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

  /**
   * Sanitizes a gateway failure before returning it to the caller.
   *
   * @param error The failure being classified or propagated.
   */
  static #gatewayError(error: unknown): never {
    if (error instanceof Error && error.message === "backend membership is unavailable.")
      throw new Error("Gateway backend is absent.");
    if (error instanceof Error && error.message === "backend membership kernel is closed.")
      throw new Error("Gateway dynamic owner is closed.");
    throw error;
  }
}
