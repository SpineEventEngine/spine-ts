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

import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";

import type { TenantId } from "@spine-event-engine/proto";
import { deliveryTenantKey } from "../delivery/delivery-tenant.js";

import { Delivery } from "../delivery/delivery.js";
import { receptionObservation } from "../delivery/reception-observation.js";
import { type DeliveryStrategy, UniformAcrossAllShards } from "../delivery/delivery-builder.js";
import type { InboxMessage } from "../delivery/inbox.js";
import { ShardIndex } from "../delivery/shard-index.js";
import type { EntityInbox, EntityInboxTarget } from "../repository/repository.js";
import {
  type DeliveryHandoff,
  type DeliveryEndpoint,
  DeliveryReadiness,
  InboxHandoff,
  type LocalInboxDrainOptions,
  type OnDeliveryReady,
} from "./local-inbox-handoff.js";

/**
 * Persists Entity Inbox rows and schedules Aggregate and Process Manager delivery.
 */
export class LocalEntityInbox implements EntityInbox {
  readonly #contextName: string;

  readonly #targets = new Map<string, EntityInboxTarget>();

  readonly #endpoints = new Map<string, readonly DeliveryEndpoint[]>();

  readonly #readiness: DeliveryReadiness;

  readonly #onAdmit: (tenantId?: TenantId) => Promise<void>;

  readonly #strategy: DeliveryStrategy;

  readonly #inFlightMessageIds = new Set<string>();

  readonly #acknowledgedMessageIds = new Set<string>();

  #nextVersion = 0n;

  /**
   * Creates a local Entity Inbox.
   * @param contextName Names the bounded context that owns this inbox.
   * @param readiness Coordinates delivery readiness after persistence.
   * @param onAdmit Checks current tenant membership before persistence or delivery.
   * @param strategy Derives shard ownership for Entity Inbox targets.
   */
  constructor(
    contextName: string,
    readiness: DeliveryReadiness | OnDeliveryReady = new DeliveryReadiness(),
    onAdmit: (tenantId?: TenantId) => Promise<void> = () => Promise.resolve(),
    strategy: DeliveryStrategy = UniformAcrossAllShards.singleShard(),
  ) {
    this.#contextName = contextName;
    this.#readiness =
      readiness instanceof DeliveryReadiness ? readiness : new DeliveryReadiness(readiness);
    this.#onAdmit = onAdmit;
    this.#strategy = strategy;
  }

  /**
   * Registers a target that delivers Entity Inbox messages.
   * @param target Handles messages for one Entity type.
   */
  register(target: EntityInboxTarget): void {
    this.#targets.set(target.targetTypeUrl, target);
    this.#endpoints.set(
      target.targetTypeUrl,
      Object.freeze(
        target.labels.flatMap((label) =>
          Array.from({ length: this.#strategy.shardCount }, (_, index) =>
            InboxHandoff.endpoint({
              label,
              inboxId: { targetTypeUrl: target.targetTypeUrl },
              shard: new ShardIndex(index, this.#strategy.shardCount),
            }),
          ),
        ),
      ),
    );
  }

  /**
   * Lists endpoints registered for Entity Inbox delivery.
   * @returns Returns immutable endpoint descriptions.
   */
  endpoints(): readonly DeliveryEndpoint[] {
    return Object.freeze([...this.#endpoints.values()].flat());
  }

  /**
   * Returns the context-owned target-to-shard strategy.
   *
   * @returns The immutable delivery strategy.
   */
  strategy(): DeliveryStrategy {
    return this.#strategy;
  }

  /**
   * Dispatches a durable inbox row through its Entity Inbox target.
   * @param message Contains the persisted Inbox row to deliver.
   * @param deliveryTenantId Identifies the tenant that owns the row when present.
   * @returns Completion after handler processing and follow-up registration.
   */
  async deliver(message: InboxMessage, deliveryTenantId?: TenantId): Promise<void> {
    await this.#deliver(message, deliveryTenantId, this.#expectedShard(message));
  }

  /**
   * Persists one Entity Inbox message and schedules eligible delivery.
   * @param delivery Stores the Inbox row and schedules eligible delivery.
   * @param input Describes the message to persist.
   * @param deliveryTenantId Identifies the tenant that owns the message when present.
   * @returns Resolves after the Inbox row is persisted and eligible delivery is scheduled.
   */
  async receive(
    delivery: Delivery,
    input: EntityInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage> {
    const routedInput = this.#route(input);
    const routed = this.#readiness.route(delivery);
    return await this.#receiveAndSchedule(routed, routedInput, deliveryTenantId);
  }

  /**
   * Persists a batch of Entity Inbox messages and schedules eligible delivery.
   * @param delivery Stores the Inbox rows and schedules eligible delivery.
   * @param inputs Describe the messages to persist.
   * @param deliveryTenantId Identifies the tenant that owns the messages when present.
   * @returns Resolves after the Inbox rows are persisted and eligible delivery is scheduled.
   */
  async receiveAll(
    delivery: Delivery,
    inputs: EntityInputs,
    deliveryTenantId?: TenantId,
  ): Promise<readonly InboxMessage[]> {
    const routed = this.#readiness.route(delivery);
    const routedInputs = inputs.map((input) => this.#route(input));
    return await this.#receiveAndScheduleAll(routed, routedInputs, deliveryTenantId);
  }

  /**
   * Persists one routed input and starts eligible delivery without awaiting its handler.
   *
   * @param delivery Delivery used for the stored row.
   * @param input Routed Entity input.
   * @param deliveryTenantId Tenant selected for the row.
   * @returns The stored Inbox message.
   */
  async #receiveAndSchedule(
    delivery: Delivery,
    input: RoutedEntityInput,
    deliveryTenantId?: TenantId,
  ): Promise<InboxMessage> {
    await this.#admitDeliveryTenant(deliveryTenantId);
    const written = await this.#writeInboxRow(
      delivery,
      input,
      Time.currentTime(),
      deliveryTenantId,
    );
    this.#scheduleWritten(delivery, written, input.shard, deliveryTenantId);
    return written.message;
  }

  /**
   * Persists each batch input, then schedules every successfully written row.
   *
   * @param delivery Delivery used for the stored rows.
   * @param inputs Routed Entity inputs in caller order.
   * @param deliveryTenantId Tenant selected for the batch.
   * @returns Stored Inbox messages in the same order as the inputs.
   */
  async #receiveAndScheduleAll(
    delivery: Delivery,
    inputs: readonly RoutedEntityInput[],
    deliveryTenantId?: TenantId,
  ): Promise<readonly InboxMessage[]> {
    await this.#admitDeliveryTenant(deliveryTenantId);
    const rows: BatchRow[] = [];
    let failure: unknown;
    for (const input of inputs) {
      try {
        rows.push({
          shard: input.shard,
          written: await this.#writeInboxRow(delivery, input, Time.currentTime(), deliveryTenantId),
        });
      } catch (error) {
        failure = error;
        break;
      }
    }
    for (const row of rows) {
      try {
        this.#scheduleWritten(delivery, row.written, row.shard, deliveryTenantId);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined)
      throw failure instanceof Error
        ? failure
        : new Error("Entity Inbox batch handoff failed.", { cause: failure });
    return Object.freeze(rows.map((row) => row.written.message));
  }

  /**
   * Prepares the tenant before Inbox persistence.
   *
   * @param deliveryTenantId Tenant selected for the incoming work.
   */
  async #admitDeliveryTenant(deliveryTenantId: TenantId | undefined): Promise<void> {
    await this.#onAdmit(deliveryTenantId);
  }

  /**
   * Starts one accepted row without awaiting its handler.
   *
   * @param delivery Delivery used for the exact stored row.
   * @param written Stored row and its handoff claim.
   * @param shard Shard recorded with the row.
   * @param deliveryTenantId Tenant selected for the delivery attempt.
   */
  #scheduleWritten(
    delivery: Delivery,
    written: InboxWrite,
    shard: ShardIndex,
    deliveryTenantId: TenantId | undefined,
  ): void {
    this.#trackMessage(written.message);
    try {
      const processing = written.handoff.complete(() =>
        this.#isAcknowledged(written.message)
          ? Promise.resolve()
          : this.#drainInboxRow(delivery, written.message, deliveryTenantId, shard),
      );
      void processing
        .finally(() => {
          this.#untrackMessage(written.message);
        })
        .catch(() => undefined);
    } catch (error) {
      this.#untrackMessage(written.message);
      throw error;
    }
  }

  async #writeInboxRow(
    delivery: Delivery,
    input: RoutedEntityInput,
    whenReceived: Timestamp,
    deliveryTenantId?: TenantId,
  ): Promise<InboxWrite> {
    const written = await delivery.inbox.receive({
      inboxId: input.inboxId,
      signalId: input.signalId,
      label: input.label,
      status: input.status,
      shard: input.shard,
      whenReceived,
      version: this.#takeVersion(),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    const endpoint = InboxHandoff.configuredEndpoint(
      written,
      this.#endpoints.get(written.inboxId.targetTypeUrl) ?? [],
    );

    return {
      message: written,
      handoff: this.#readiness.claim(
        endpoint === undefined ? undefined : InboxHandoff.ready(endpoint, deliveryTenantId),
        written,
      ),
    };
  }

  async #drainInboxRow(
    delivery: Delivery,
    message: InboxMessage,
    deliveryTenantId?: TenantId,
    expectedShard?: ShardIndex,
  ): Promise<void> {
    await InboxHandoff.drain(
      this.#drainOptions(message, delivery, deliveryTenantId, expectedShard),
    );
  }

  #drainOptions(
    message: InboxMessage,
    delivery: Delivery,
    deliveryTenantId: TenantId | undefined,
    expectedShard: ShardIndex | undefined,
  ): LocalInboxDrainOptions {
    return {
      delivery,
      received: message,
      node: this.#contextName,
      onDispatch: (next) => this.#deliver(next, deliveryTenantId, expectedShard),
      acceptMessage: (next) => this.#acceptsDrainedMessage(next, message),
      onResolved: (next) => {
        this.#recordAcknowledgement(next);
      },
      deliveryFailureMessage: "Entity Inbox delivery failed.",
      skippedMessage: "Entity Inbox delivery was skipped before the target row was delivered.",
      unfinishedMessage:
        "Entity Inbox delivery did not reach the target row before the local drain finished.",
    };
  }

  #acceptsDrainedMessage(next: InboxMessage, received: InboxMessage): boolean {
    return (
      deliveryTenantKey(next) === deliveryTenantKey(received) &&
      (InboxHandoff.sameMessageId(next.id, received.id) ||
        ((next.label === "HANDLE_COMMAND" || next.label === "REACT_UPON_EVENT") &&
          this.#targets.get(next.inboxId.targetTypeUrl)?.labels.includes(next.label) === true))
    );
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

  #route(input: EntityInput): RoutedEntityInput {
    return Object.freeze({
      ...input,
      shard: this.#strategy.shardFor(input.inboxId.targetId, input.inboxId.targetTypeUrl),
    });
  }

  async #deliver(
    message: InboxMessage,
    deliveryTenantId?: TenantId,
    expectedShard = this.#expectedShard(message),
  ): Promise<void> {
    receptionObservation.markManaged();
    LocalEntityInbox.#assert(message);
    await this.#admitDeliveryTenant(deliveryTenantId);

    const target = this.#targets.get(message.inboxId.targetTypeUrl);

    if (target === undefined) {
      throw new Error(
        `BoundedContext delivery has no Entity Inbox target for "${message.inboxId.targetTypeUrl}".`,
      );
    }

    if (
      message.shard.index !== expectedShard.index ||
      message.shard.ofTotal !== expectedShard.ofTotal
    ) {
      throw new Error("Entity Inbox delivery stored shard does not match the routed target.");
    }
    await target.deliver(message, deliveryTenantId);
  }

  #expectedShard(message: InboxMessage): ShardIndex {
    return this.#strategy.shardFor(message.inboxId.targetId, message.inboxId.targetTypeUrl);
  }

  static #assert(message: InboxMessage): asserts message is EntityMessage {
    if (message.label !== "HANDLE_COMMAND" && message.label !== "REACT_UPON_EVENT") {
      throw new Error(`BoundedContext delivery has no handler for inbox label "${message.label}".`);
    }
    if (message.status !== "TO_DELIVER") {
      throw new Error(
        `BoundedContext delivery cannot deliver Entity Inbox message with status "${message.status}".`,
      );
    }
  }
}

type EntityInput = Parameters<EntityInbox["receive"]>[1];
type EntityInputs = Parameters<EntityInbox["receiveAll"]>[1];
type EntityMessage = Parameters<EntityInboxTarget["deliver"]>[0];
type RoutedEntityInput = EntityInput & { readonly shard: ShardIndex };

interface InboxWrite {
  readonly message: InboxMessage;
  readonly handoff: DeliveryHandoff;
}

interface BatchRow {
  readonly shard: ShardIndex;
  readonly written: InboxWrite;
}
