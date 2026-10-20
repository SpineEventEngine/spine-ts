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
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
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
  ENTITY_SCOPE_MUTATION_KEY,
  type EntityBackend,
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
   * Commits one Agent transition under the Entity scope queue and Version fence.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param entity Configured Entity storage layout.
   * @param entityId Typed Agent Entity identifier.
   * @param expectedVersion Version read before the Agent handler ran.
   * @param input Optional changed Entity state and history.
   * @param extra Applies or restores the Agent execution record with the Entity state.
   * @returns Completion after the fenced transition is stored.
   */
  commitAgentConditional<I, S extends Message>(
    entity: EntityStorageInput<I, S>,
    entityId: I,
    expectedVersion: number,
    input: EntityCommitInput<I, S> | undefined,
    extra: { apply(): void; restore(): void },
  ): Promise<void> {
    this.requireOpen();
    const backend = this.entities.backend(entity);
    const key = entity.id.key(entityId);
    const snapshot = input === undefined ? undefined : EntityCommitSnapshots.capture(input);
    if (snapshot !== undefined) {
      this.requireCompatible(snapshot);
      this.requireEnabledHistories(snapshot);
      this.validateRows(snapshot);
      if (snapshot.diagnostics?.length || snapshot.events?.length)
        throw new Error(
          "Agent completion cannot save delivery Events as Entity commit obligations.",
        );
    }
    return backend.mutationQueue.run(ENTITY_SCOPE_MUTATION_KEY, () =>
      this.applyAgentConditional(entity, backend, key, expectedVersion, snapshot, extra),
    );
  }

  /**
   * Applies one prepared Agent transition and restores affected rows on failure.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param entity Configured Entity storage layout.
   * @param backend Shared current records for this Entity scope.
   * @param key Canonical Entity ID key.
   * @param expectedVersion Version read before handler execution.
   * @param snapshot Optional captured Entity state transition.
   * @param extra Applies or restores the Agent execution record.
   * @returns Completion after the transition is stored.
   */
  private applyAgentConditional<I, S extends Message>(
    entity: EntityStorageInput<I, S>,
    backend: EntityBackend,
    key: string,
    expectedVersion: number,
    snapshot: EntityCommitInput<I, S> | undefined,
    extra: { apply(): void; restore(): void },
  ): Promise<void> {
    const prior = backend.current.get(key) as EntityRecord | undefined;
    if ((prior?.version?.number ?? 0) !== expectedVersion)
      throw new Error("Agent execution initial Entity Version is no longer current.");
    const layout = snapshot?.states?.length ? stateHistorySpec(entity.stateSchema) : undefined;
    const states =
      layout === undefined
        ? undefined
        : this.openRecords(entity.context, layout.spec, layout.group);
    const prepared =
      layout === undefined
        ? []
        : (snapshot?.states ?? []).map((record) => layout.spec.materialize(record));
    const priorStates = prepared.map((record) => states?.capture(record.id));
    try {
      this.writeAgentStates(states, prepared);
      if (snapshot !== undefined) backend.current.set(key, snapshot.next);
      extra.apply();
    } catch (error) {
      extra.restore();
      if (prior === undefined) backend.current.delete(key);
      else backend.current.set(key, prior);
      for (const priorState of priorStates) if (priorState !== undefined) states?.apply(priorState);
      throw error;
    }
    return Promise.resolve();
  }

  /**
   * Writes immutable Agent state history after checking each Version slot.
   *
   * @param states State-history records when that family is configured.
   * @param prepared Materialized state rows from the captured transition.
   */
  private writeAgentStates(
    states: TenantRecords<EntityStateKey, EntityRecord> | undefined,
    prepared: readonly ReturnType<RecordSpec<EntityStateKey, EntityRecord>["materialize"]>[],
  ): void {
    if (states === undefined) return;
    for (const record of prepared) {
      const existing = states.read(record.id);
      if (
        existing !== undefined &&
        !this.sameBytes(
          toBinary(EntityRecordSchema, existing),
          toBinary(EntityRecordSchema, record.record),
        )
      )
        throw new Error("Agent state history collides with another Version.");
      states.write(record);
    }
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
