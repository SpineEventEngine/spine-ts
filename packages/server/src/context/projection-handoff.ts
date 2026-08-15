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

import type { TenantId } from "@spine-event-engine/proto";

import { Delivery } from "../delivery/delivery.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import type { ProjectionInbox, ProjectionInboxTarget } from "../repository/repository.js";
import {
  type DeliveryEndpoint,
  DeliveryReadiness,
  InboxHandoff,
  type OnDeliveryReady,
} from "./local-inbox-handoff.js";

const projectionLabels = ["UPDATE_SUBSCRIBER"] as const;

/**
 * Persists and replays delivery rows for projection subscribers.
 */
export class LocalProjectionInbox implements ProjectionInbox {
  readonly #contextName: string;
  readonly #targets = new Map<string, ProjectionInboxTarget>();
  readonly #endpoints = new Map<string, readonly DeliveryEndpoint[]>();
  readonly #readiness: DeliveryReadiness;
  readonly #keepTenant: (tenantId: TenantId) => Promise<void>;
  readonly #inFlightHandoffs = new Map<string, Promise<InboxMessage>>();
  readonly #inFlightMessageIds = new Set<string>();
  readonly #acknowledgedMessageIds = new Set<string>();
  #nextVersion = 0n;

  /**
   * Creates a local projection inbox.
   * @param contextName Names the bounded context that owns this inbox.
   * @param readiness Coordinates delivery readiness after persistence.
   * @param keepTenant Records a tenant before its message is persisted.
   */
  constructor(
    contextName: string,
    readiness: DeliveryReadiness | OnDeliveryReady = new DeliveryReadiness(),
    keepTenant: (tenantId: TenantId) => Promise<void> = () => Promise.resolve(),
  ) {
    this.#contextName = contextName;
    this.#readiness =
      readiness instanceof DeliveryReadiness ? readiness : new DeliveryReadiness(readiness);
    this.#keepTenant = keepTenant;
  }

  /**
   * Registers a target that replays projection messages.
   * @param target Handles messages for one projection type.
   */
  register(target: ProjectionInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
    this.#endpoints.set(
      target.targetTypeUrl,
      Object.freeze([
        InboxHandoff.endpoint({
          label: projectionLabels[0],
          inboxId: { targetTypeUrl: target.targetTypeUrl },
          shard: ShardIndex.single(),
        }),
      ]),
    );
  }

  /**
   * Lists endpoints registered for projection delivery.
   * @returns Returns immutable endpoint descriptions.
   */
  endpoints(): readonly DeliveryEndpoint[] {
    return Object.freeze([...this.#endpoints.values()].flat());
  }

  /**
   * Dispatches a durable inbox row through its projection target.
   * @param message Contains the persisted inbox row to replay.
   * @param deliveryTenantId Identifies the tenant that owns the row when present.
   * @returns A promise that resolves after the inbox row is replayed.
   */
  replay(message: InboxMessage, deliveryTenantId?: TenantId): Promise<void> {
    return this.#replay(message, deliveryTenantId);
  }

  /**
   * Persists and drains one projection inbox message.
   * @param delivery Stores and drains the inbox row.
   * @param input Describes the message to persist.
   * @param deliveryTenantId Identifies the tenant that owns the message when present.
   * @returns Resolves to the persisted inbox row.
   */
  async receive(
    delivery: Delivery,
    input: ProjectionInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage> {
    const routed = this.#readiness.route(delivery);
    return await InboxHandoff.coordinate({
      handoffs: this.#inFlightHandoffs,
      key: InboxHandoff.key(input, deliveryTenantId),
      onHandoff: () => this.#receiveAndDrain(routed, input, deliveryTenantId),
    });
  }

  async #receiveAndDrain(
    delivery: Delivery,
    input: ProjectionInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage> {
    if (deliveryTenantId !== undefined) {
      await this.#keepTenant(deliveryTenantId);
    }
    const written = await delivery.inbox.receive({
      inboxId: input.inboxId,
      signalId: input.signalId,
      label: input.label,
      status: input.status,
      shard: input.shard,
      whenReceived: new Date(),
      version: this.#takeVersion(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      ...(input.keepUntil === undefined ? {} : { keepUntil: input.keepUntil }),
    });

    const endpoint =
      written.outcome === "WRITTEN"
        ? InboxHandoff.configuredEndpoint(
            written.message,
            this.#endpoints.get(written.message.inboxId.targetTypeUrl) ?? [],
          )
        : undefined;
    this.#trackMessage(written.message);
    try {
      await this.#readiness
        .claim(endpoint === undefined ? undefined : InboxHandoff.ready(endpoint, deliveryTenantId))
        .complete(() =>
          this.#isAcknowledged(written.message)
            ? Promise.resolve()
            : InboxHandoff.drain({
                delivery,
                received: written.message,
                node: this.#contextName,
                onReplay: (message) => this.#replay(message, deliveryTenantId),
                acceptMessage: (message) =>
                  InboxHandoff.sameMessageId(message.id, written.message.id) ||
                  (message.label === "UPDATE_SUBSCRIBER" &&
                    this.#targets.has(message.inboxId.targetTypeUrl)),
                onAcknowledged: (message) => {
                  this.#recordAcknowledgement(message);
                },
                replayFailureMessage: "Projection inbox replay failed.",
                skippedMessage:
                  "Projection inbox delivery was skipped before the target row was delivered.",
                unfinishedMessage:
                  "Projection inbox delivery did not reach the target row before the local drain finished.",
              }),
        );
      return written.message;
    } finally {
      this.#untrackMessage(written.message);
    }
  }

  #trackMessage(message: InboxMessage): void {
    this.#inFlightMessageIds.add(InboxHandoff.messageIdKey(message));
  }

  #untrackMessage(message: InboxMessage): void {
    const key = InboxHandoff.messageIdKey(message);
    this.#inFlightMessageIds.delete(key);
    this.#acknowledgedMessageIds.delete(key);
  }

  #recordAcknowledgement(message: InboxMessage): void {
    const key = InboxHandoff.messageIdKey(message);
    if (this.#inFlightMessageIds.has(key)) this.#acknowledgedMessageIds.add(key);
  }

  #isAcknowledged(message: InboxMessage): boolean {
    return this.#acknowledgedMessageIds.has(InboxHandoff.messageIdKey(message));
  }

  #takeVersion(): bigint {
    this.#nextVersion += 1n;
    return this.#nextVersion;
  }

  async #replay(message: InboxMessage, deliveryTenantId?: TenantId): Promise<void> {
    LocalProjectionInbox.#assert(message);

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no projection subscriber target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    await target.replay(message, deliveryTenantId);
  }

  static #assert(message: InboxMessage): asserts message is ProjectionMessage {
    if (message.label !== "UPDATE_SUBSCRIBER") {
      throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
    }
    if (message.status !== "TO_DELIVER") {
      throw new Error(
        `BoundedContext delivery cannot replay projection inbox message with status "${message.status}".`,
      );
    }
  }
}

type ProjectionInput = Parameters<ProjectionInbox["receive"]>[1];
type ProjectionMessage = Parameters<ProjectionInboxTarget["replay"]>[0];
