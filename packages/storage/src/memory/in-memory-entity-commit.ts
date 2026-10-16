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

import { toBinary, type Message } from "@bufbuild/protobuf";
import { EventSchema, type Event, type EventId } from "@spine-event-engine/proto";
import type { EntityStateKey } from "@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js";
import { eventStoreRecordSpec } from "../event/event-store.js";
import { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
import {
  EntityCommitSnapshots,
  type EntityCommitInput,
  type EntityCommitStorage,
} from "../internal/entity-commit.js";
import { TenantBoundary } from "../internal/tenancy.js";
import type { EntityRecord } from "../entity/entity-record.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { StorageContext } from "../storage/storage.js";
import {
  MemoryEntityStorageFactory,
  type EntityStorageInput,
  type InMemoryEntityStorage,
} from "./in-memory-entity-history.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";

/**
 * Opens one tenant slice for a generated record family.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored message type.
 */
type OpenRecords = <I, R extends Message>(
  context: StorageContext,
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
) => TenantRecords<I, R>;

/**
 * Handles opened for one ordered Entity mutation.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state type.
 */
type CommitHandles<I, S extends Message> = readonly [
  InMemoryEntityStorage<I, S>,
  InMemoryRecordStorage<EntityStateKey, EntityRecord> | undefined,
  InMemoryRecordStorage<EventId, Event> | undefined,
  InMemoryRecordStorage<EventId, Event> | undefined,
];

/**
 * Writes in-memory Entity records in order and retains a completed prefix.
 */
export class MemoryEntityCommitStorage implements EntityCommitStorage {
  /**
   * Tenant boundary selected by this handle.
   */
  readonly #tenantKey: TenantBoundary["key"];

  /**

   * Whether this handle uses multitenant storage.

   */
  readonly #multitenant: boolean;

  /**

   * Whether this handle accepts commits.

   */
  #open = true;

  /**
   * Creates one source- and tenant-bound commit handle.
   *
   * @param entities Opens current Entity storage.
   * @param openRecords Opens generated history and Event record slices.
   * @param input Captures the Entity source and tenant boundary.
   */
  constructor(
    private readonly entities: MemoryEntityStorageFactory,
    private readonly openRecords: OpenRecords,
    private readonly input: EntityStorageInput<unknown, Message>,
  ) {
    this.#tenantKey = TenantBoundary.of(input.context).key;
    this.#multitenant = input.context.multitenant;
  }

  /**
   * Writes history, diagnostics, delivery Events, then current state.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed mutation.
   * @returns Completion after every record has been stored.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void> {
    this.requireOpen();
    this.requireCompatible(input);
    return this.apply(EntityCommitSnapshots.capture(input));
  }

  /**
   * Closes this handle to new commits.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Applies one captured mutation without cross-record compensation.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies immutable record snapshots.
   * @returns Completion after every requested record write.
   */
  private async apply<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void> {
    this.requireEnabledHistories(input);
    this.validateRows(input);
    const [entity, stateStorage, diagnosticStorage, eventStorage] = this.openCommit(input);
    try {
      for (const state of input.states ?? []) await entity.states.append(state);
      for (const diagnostic of input.diagnostics ?? []) await entity.events.append(diagnostic);
      for (const event of input.events ?? []) {
        if (event.id === undefined || eventStorage === undefined)
          throw new Error("Entity commit requires delivery-event IDs.");
        await this.appendEvent(eventStorage, event.id, event);
      }
      await entity.current.write(input.next);
    } finally {
      entity.close();
      stateStorage?.close();
      diagnosticStorage?.close();
      eventStorage?.close();
    }
  }

  /**
   * Opens the record families needed by one captured mutation.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies requested history and delivery records.
   * @returns Entity and record handles to close after the mutation.
   */
  private openCommit<I, S extends Message>(input: EntityCommitInput<I, S>): CommitHandles<I, S> {
    const states = input.states?.length ? stateHistorySpec(input.entity.stateSchema) : undefined;
    const diagnostics = input.diagnostics?.length
      ? eventHistorySpec(input.entity.stateSchema)
      : undefined;
    const stateStorage =
      states === undefined
        ? undefined
        : new InMemoryRecordStorage(input.context, states.spec, () =>
            this.openRecords(input.context, states.spec, states.group),
          );
    const diagnosticStorage =
      diagnostics === undefined
        ? undefined
        : new InMemoryRecordStorage(input.context, diagnostics.spec, () =>
            this.openRecords(input.context, diagnostics.spec, diagnostics.group),
          );
    const eventStorage = input.events?.length
      ? new InMemoryRecordStorage(input.context, eventStoreRecordSpec, () =>
          this.openRecords(input.context, eventStoreRecordSpec),
        )
      : undefined;
    const entityInput = { ...input.entity };
    delete entityInput.stateHistoryStorage;
    delete entityInput.eventHistoryStorage;
    const entity = this.entities.create({
      ...entityInput,
      ...(stateStorage === undefined ? {} : { stateHistoryStorage: stateStorage }),
      ...(diagnosticStorage === undefined ? {} : { eventHistoryStorage: diagnosticStorage }),
    });
    return [entity, stateStorage, diagnosticStorage, eventStorage];
  }

  /**
   * Writes one immutable delivery Event or accepts an identical retry.
   *
   * @param storage Supplies atomic single-record insertion.
   * @param id Identifies the delivery Event.
   * @param event Supplies the captured Event.
   * @returns Completion after an identical Event is stored.
   */
  private async appendEvent(
    storage: InMemoryRecordStorage<EventId, Event>,
    id: EventId,
    event: Event,
  ): Promise<void> {
    if (await storage.compareAndSet(id, undefined, event)) return;
    const prior = await storage.read(id);
    if (
      prior === undefined ||
      !this.sameBytes(toBinary(EventSchema, prior), toBinary(EventSchema, event))
    ) {
      throw new Error("Entity commit requires unique delivery-event IDs.");
    }
  }

  /**
   * Compares two stored Protobuf byte sequences.
   *
   * @param left First byte sequence.
   * @param right Second byte sequence.
   * @returns Whether every byte matches.
   */
  private sameBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  /**
   * Validates current identity and duplicate delivery IDs before writes.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the captured mutation.
   */
  private validateRows<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    const nextId =
      input.next.entityId === undefined ? undefined : input.entity.id.unpack(input.next.entityId);
    if (nextId === undefined || input.entity.id.key(nextId) !== input.entity.id.key(input.entityId))
      throw new Error("Entity commit current record identifies another Entity.");
    const ids = (input.events ?? []).map((event) => event.id?.value);
    if (ids.some((id) => id === undefined || id.trim() === "") || new Set(ids).size !== ids.length)
      throw new Error("Entity commit requires unique delivery-event IDs.");
  }

  /**
   * Rejects disabled history families.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed histories.
   */
  private requireEnabledHistories<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if ((input.states?.length ?? 0) > 0 && !input.entity.stateHistory)
      throw new Error("Entity commit cannot append state history when it is disabled.");
    if ((input.diagnostics?.length ?? 0) > 0 && !input.entity.eventHistory)
      throw new Error("Entity commit cannot append event history when it is disabled.");
  }

  /**
   * Checks the tenant and source captured by this handle.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the requested scope.
   */
  private requireCompatible<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (
      input.context.multitenant !== this.#multitenant ||
      TenantBoundary.of(input.context).key !== this.#tenantKey ||
      TenantBoundary.of(input.entity.context).key !== this.#tenantKey ||
      input.entity.sourceType.typeName !== this.input.sourceType.typeName
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  /**
   * Rejects commits after this handle closes.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
  }
}
