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

import { clone, type Message } from "@bufbuild/protobuf";
import { EventSchema, type Event, type EventId } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { eventStoreAccess, eventStoreRecordSpec } from "../event/event-store.js";
import { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
import type { EntityRecord } from "../entity/entity-record.js";
import type { EntityCommitInput, EntityCommitStorage } from "../internal/entity-commit.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { StorageContext } from "../storage/storage.js";
import type { StorageFactory } from "../storage/storage-factory.js";
import { TenantBoundary } from "../internal/tenancy.js";
import {
  InMemoryEntityStorage,
  KeyedSerialQueue,
  MemoryEntityStorageFactory,
  ENTITY_SCOPE_MUTATION_KEY,
  type EntityBackend,
  type EntityStorageInput,
} from "./in-memory-entity-history.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";

/**
 * Opens the in-memory tenant slice for a generated record family.
 * @typeParam I Record identifier type.
 * @typeParam R Record message type.
 * @param context Supplies the storage and tenant context.
 * @param spec Supplies the materialized record layout.
 * @param group Selects a grouped history family when present.
 * @returns The tenant record slice.
 */
type OpenRecords = <I, R extends Message>(
  context: StorageContext,
  spec: RecordSpec<I, R>,
  group?: StorageGroup,
) => TenantRecords<I, R>;

/**
 * Implements provider Entity commits for one shared in-memory backend.
 */
export class MemoryEntityCommitStorage implements EntityCommitStorage {
  readonly #entities: MemoryEntityStorageFactory;

  readonly #factory: StorageFactory;

  readonly #openRecords: OpenRecords;

  readonly #input: EntityStorageInput<unknown, Message>;

  readonly #tenantKey: TenantBoundary["key"];

  readonly #multitenant: boolean;

  #open = true;

  /**
   * Creates a commit handle bound to one Entity source type.
   *
   * @param entities Opens the matching current Entity storage.
   * @param factory Provides the Event Store coordination lock.
   * @param openRecords Opens exact generic-record backing slices.
   * @param input Defines the Entity storage source type.
   */
  constructor(
    entities: MemoryEntityStorageFactory,
    factory: StorageFactory,
    openRecords: OpenRecords,
    input: EntityStorageInput<unknown, Message>,
  ) {
    this.#entities = entities;
    this.#factory = factory;
    this.#openRecords = openRecords;
    this.#input = input;
    this.#tenantKey = TenantBoundary.of(input.context).key;
    this.#multitenant = input.context.multitenant;
  }

  /**
   * Applies one fully preflighted in-memory Entity commit.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Defines the current record, retained histories, and delivery events.
   * @returns Completion after the in-memory commit.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void> {
    this.#requireOpen();
    this.#requireCompatible(input);
    const tenant = TenantBoundary.of(input.context);
    const context: StorageContext =
      tenant.tenantId === undefined
        ? { name: input.context.name, multitenant: false }
        : { name: input.context.name, multitenant: true, tenantId: tenant.tenantId };
    const snapshot: EntityCommitInput<I, S> = {
      ...input,
      context,
      entity: { ...input.entity, context },
      entityId: input.entity.id.clone(input.entityId),
      next: clone(EntityRecordSchema, input.next),
      ...(input.states === undefined
        ? {}
        : { states: input.states.map((record) => clone(EntityRecordSchema, record)) }),
      ...(input.diagnostics === undefined
        ? {}
        : { diagnostics: input.diagnostics.map((event) => clone(EventSchema, event)) }),
      ...(input.events === undefined
        ? {}
        : { events: input.events.map((event) => clone(EventSchema, event)) }),
    };
    const backend = this.#entities.backend(snapshot.entity);
    const work = () =>
      backend.mutationQueue.run(ENTITY_SCOPE_MUTATION_KEY, () => this.#commit(snapshot, backend));
    return snapshot.events === undefined || snapshot.events.length === 0
      ? work()
      : eventStoreAccess.withLock(this.#factory, snapshot.context, work);
  }

  /**
   * Applies an Agent completion only while the current Entity Version matches.
   * @typeParam I Typed Entity identifier.
   * @typeParam S Generated Entity state.
   * @param entity Existing Entity layout.
   * @param entityId Typed Entity identifier.
   * @param expectedVersion Version observed before Agent handlers ran.
   * @param input Current-state mutation, absent for a no-op.
   * @param extra Staged execution and history publication with restoration.
   * @returns Completion after conditional Entity and execution publication.
   */
  commitConditional<I, S extends Message>(
    entity: EntityStorageInput<I, S>,
    entityId: I,
    expectedVersion: number,
    input: EntityCommitInput<I, S> | undefined,
    extra: { apply(): void; restore(): void },
  ): Promise<void> {
    this.#requireOpen();
    const backend = this.#entities.backend(entity);
    const work = () =>
      backend.mutationQueue.run(ENTITY_SCOPE_MUTATION_KEY, async () => {
        this.#checkCurrentVersion(backend, entity.id.key(entityId), expectedVersion);
        if (input === undefined) {
          try {
            extra.apply();
          } catch (error) {
            extra.restore();
            throw error;
          }
          return;
        }
        await this.#commit(input, backend, extra);
      });
    return input?.events?.length
      ? eventStoreAccess.withLock(this.#factory, entity.context, work)
      : work();
  }

  /**
   * Checks the current Version while the Entity mutation queue is held.
   */
  #checkCurrentVersion(backend: EntityBackend, key: string, expected: number): void {
    const current = backend.current.get(key) as EntityRecord | undefined;
    const actual = current?.version?.number ?? 0;
    if (actual !== expected)
      throw new Error("Agent execution initial Entity Version is no longer current.");
  }

  /**
   * Closes this commit handle without closing sibling handles.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Prepares and publishes one affected-record Entity commit under its existing queue.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies current and immutable records.
   * @param liveBackend Supplies the live current-record map and queue.
   */
  async #commit<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    liveBackend: EntityBackend,
    extra?: { apply(): void; restore(): void },
  ): Promise<void> {
    const stage = this.stage(input, liveBackend);
    try {
      await this.#writeStage(input, stage);
      this.#publish(stage, liveBackend, extra);
    } finally {
      stage.entity.close();
    }
  }

  /**
   * Opens only record families used by one commit.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies configured histories and delivery Events.
   * @returns Live affected record families and their layouts.
   */
  private live<I, S extends Message>(input: EntityCommitInput<I, S>) {
    this.#requireEnabledHistories(input);
    const stateLayout = input.states?.length
      ? stateHistorySpec(input.entity.stateSchema)
      : undefined;
    const eventLayout = input.diagnostics?.length
      ? eventHistorySpec(input.entity.stateSchema)
      : undefined;
    const states =
      stateLayout === undefined
        ? undefined
        : this.#openRecords(input.context, stateLayout.spec, stateLayout.group);
    const diagnostics =
      eventLayout === undefined
        ? undefined
        : this.#openRecords(input.context, eventLayout.spec, eventLayout.group);
    const events = input.events?.length
      ? this.#openRecords(input.context, eventStoreRecordSpec)
      : undefined;
    return { stateLayout, eventLayout, states, diagnostics, events };
  }

  /**
   * Captures affected rows and creates isolated adapters for preparation.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed record changes.
   * @param backend Supplies the live current-record map.
   * @returns The prepared affected-record workspace.
   */
  private stage<I, S extends Message>(input: EntityCommitInput<I, S>, backend: EntityBackend) {
    const live = this.live(input);
    const key = input.entity.id.key(input.entityId);
    const previous = backend.current.get(key);
    const ids = this.#ids(input, live);
    const stagedBackend: EntityBackend = {
      current: new Map(previous === undefined ? [] : [[key, previous]]),
      mutationQueue: new KeyedSerialQueue(),
    };
    const stagedStates = InMemoryCommitValues.stage(live.states, ids.stateIds);
    const stagedDiagnostics = InMemoryCommitValues.stage(live.diagnostics, ids.diagnosticIds);
    const stagedEvents = InMemoryCommitValues.stage(live.events, ids.deliveryIds);
    const entity = new InMemoryEntityStorage(
      this.#stagedInput(
        input.entity,
        live.stateLayout,
        stagedStates,
        live.eventLayout,
        stagedDiagnostics,
      ),
      stagedBackend,
    );
    return {
      live,
      key,
      previous,
      ...ids,
      stagedBackend,
      stagedStates,
      stagedDiagnostics,
      stagedEvents,
      entity,
    };
  }

  /**
   * Materializes the storage identities and delivery rows before live application.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the changed records.
   * @param live Supplies generated history layouts.
   * @returns Affected keys and cloned delivery rows.
   */
  #ids<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    live: ReturnType<MemoryEntityCommitStorage["live"]>,
  ) {
    const stateIds = (input.states ?? []).map((record) => {
      const layout = live.stateLayout;
      if (layout === undefined)
        throw new TypeError("Cannot read properties of undefined (reading 'spec')");
      return layout.spec.materialize(record).id;
    });
    const diagnosticIds = (input.diagnostics ?? []).map((event) => {
      const layout = live.eventLayout;
      if (layout === undefined)
        throw new TypeError("Cannot read properties of undefined (reading 'spec')");
      return layout.spec.materialize(event).id;
    });
    const materialized = (input.events ?? []).map((event) =>
      eventStoreRecordSpec.materialize(clone(eventStoreRecordSpec.recordType, event)),
    );
    const deliveryIds = materialized.map((record) => record.id);
    return { stateIds, diagnosticIds, materialized, deliveryIds };
  }

  /**
   * Validates and writes only staged records before any live change.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed record changes.
   * @param stage Supplies affected-record adapters and materialized Events.
   */
  async #writeStage<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    stage: {
      readonly key: string;
      readonly deliveryIds: readonly EventId[];
      readonly stagedEvents: TenantRecords<EventId, Event> | undefined;
      readonly entity: InMemoryEntityStorage<I, S>;
      readonly materialized: readonly ReturnType<typeof eventStoreRecordSpec.materialize>[];
    },
  ): Promise<void> {
    const nextId =
      input.next.entityId === undefined ? undefined : input.entity.id.unpack(input.next.entityId);
    if (nextId === undefined || input.entity.id.key(nextId) !== stage.key)
      throw new Error("Entity commit current record identifies another Entity.");
    if (
      new Set(stage.deliveryIds.map((id) => id.value)).size !== stage.deliveryIds.length ||
      stage.deliveryIds.some((id) => stage.stagedEvents?.read(id) !== undefined)
    )
      throw new Error("Entity commit requires unique delivery-event IDs.");
    await stage.entity.current.write(input.next);
    for (const state of input.states ?? []) await stage.entity.states.append(state);
    for (const diagnostic of input.diagnostics ?? []) await stage.entity.events.append(diagnostic);
    stage.stagedEvents?.writeAll(stage.materialized);
  }

  /**
   * Applies prepared rows synchronously and restores affected entries on failure.
   *
   * @param stage Supplies the complete affected-record preparation.
   * @param backend Supplies the live current-record map.
   */
  #publish(
    stage: Omit<ReturnType<MemoryEntityCommitStorage["stage"]>, "entity">,
    backend: EntityBackend,
    extra?: { apply(): void; restore(): void },
  ): void {
    const changes = [
      ...InMemoryCommitValues.changes(stage.live.states, stage.stagedStates, stage.stateIds),
      ...InMemoryCommitValues.changes(
        stage.live.diagnostics,
        stage.stagedDiagnostics,
        stage.diagnosticIds,
      ),
      ...InMemoryCommitValues.changes(stage.live.events, stage.stagedEvents, stage.deliveryIds),
    ];
    const next = stage.stagedBackend.current.get(stage.key);
    try {
      for (const change of changes) change.apply();
      backend.current.set(stage.key, next);
      extra?.apply();
    } catch (error) {
      extra?.restore();
      if (stage.previous === undefined) backend.current.delete(stage.key);
      else backend.current.set(stage.key, stage.previous);
      for (const change of changes.reverse()) change.restore();
      throw error;
    }
  }

  /**
   * Connects affected staged history slices to the existing Entity adapters.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param entity Supplies the Entity storage layout.
   * @param stateLayout Supplies the enabled state-history layout.
   * @param states Supplies the affected staged state rows.
   * @param eventLayout Supplies the enabled diagnostic-history layout.
   * @param diagnostics Supplies the affected staged diagnostic rows.
   * @returns The staged Entity storage layout.
   */
  #stagedInput<I, S extends Message>(
    entity: EntityStorageInput<I, S>,
    stateLayout: ReturnType<typeof stateHistorySpec> | undefined,
    states:
      | TenantRecords<
          import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
          EntityRecord
        >
      | undefined,
    eventLayout: ReturnType<typeof eventHistorySpec> | undefined,
    diagnostics: TenantRecords<EventId, Event> | undefined,
  ): EntityStorageInput<I, S> {
    const base = { ...entity };
    delete base.stateHistoryStorage;
    delete base.eventHistoryStorage;
    return {
      ...base,
      ...(stateLayout === undefined || states === undefined
        ? {}
        : {
            stateHistoryStorage: new InMemoryRecordStorage(
              entity.context,
              stateLayout.spec,
              () => states,
            ),
          }),
      ...(eventLayout === undefined || diagnostics === undefined
        ? {}
        : {
            eventHistoryStorage: new InMemoryRecordStorage(
              entity.context,
              eventLayout.spec,
              () => diagnostics,
            ),
          }),
    };
  }

  /**
   * Rejects history rows when their corresponding history is disabled.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the requested histories.
   */
  #requireEnabledHistories<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if ((input.states?.length ?? 0) > 0 && !input.entity.stateHistory) {
      throw new Error("Entity commit cannot append state history when it is disabled.");
    }
    if ((input.diagnostics?.length ?? 0) > 0 && !input.entity.eventHistory) {
      throw new Error("Entity commit cannot append event history when it is disabled.");
    }
  }

  /**
   * Checks the tenant and Entity source type captured by this handle.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the requested scope.
   */
  #requireCompatible<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (
      input.context.multitenant !== this.#multitenant ||
      TenantBoundary.of(input.context).key !== this.#tenantKey ||
      TenantBoundary.of(input.entity.context).key !== this.#tenantKey ||
      input.entity.sourceType.typeName !== this.#input.sourceType.typeName
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  /**
   * Rejects commits after this handle closes.
   */
  #requireOpen(): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
  }
}

/**
 * Prepares only affected materialized rows for an in-memory commit.
 */
const InMemoryCommitValues = Object.freeze({
  /**
   * Captures the affected live rows in an isolated tenant slice.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param live Supplies the live tenant slice when enabled.
   * @param ids Identifies affected slots.
   * @returns An isolated slice with only affected prior entries.
   */
  stage<I, R extends Message>(
    live: TenantRecords<I, R> | undefined,
    ids: readonly I[],
  ): TenantRecords<I, R> | undefined {
    if (live === undefined) return undefined;
    const staged = new TenantRecords<I, R>();
    for (const id of ids) staged.apply(live.capture(id));
    return staged;
  },

  /**
   * Builds synchronous apply and restore operations for affected slots.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param live Supplies the live tenant slice when enabled.
   * @param staged Supplies fully prepared replacements.
   * @param ids Identifies affected slots.
   * @returns Operations that preserve complete prior entries and absence.
   */
  changes<I, R extends Message>(
    live: TenantRecords<I, R> | undefined,
    staged: TenantRecords<I, R> | undefined,
    ids: readonly I[],
  ): MemoryCommitChange<I, R>[] {
    if (live === undefined || staged === undefined) return [];
    const seen = new Set<string>();
    return ids.flatMap((id) => {
      const prior = live.capture(id);
      if (seen.has(prior.key)) return [];
      seen.add(prior.key);
      const prepared = staged.capture(id);
      return [new MemoryCommitChange(live, prepared, prior)];
    });
  },
});

/**
 * Applies one affected materialized row and restores its complete prior slot.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Record message type.
 */
class MemoryCommitChange<I, R extends Message> {
  /**
   * Captures the prepared and prior versions of one slot.
   *
   * @param live Supplies the affected tenant slice.
   * @param prepared Supplies the replacement entry or absence.
   * @param prior Supplies the complete prior entry or absence.
   */
  constructor(
    private readonly live: TenantRecords<I, R>,
    private readonly prepared: ReturnType<TenantRecords<I, R>["capture"]>,
    private readonly prior: ReturnType<TenantRecords<I, R>["capture"]>,
  ) {}

  /**
   * Applies the fully prepared materialized row.
   */
  apply(): void {
    this.live.apply(this.prepared);
  }

  /**
   * Restores the complete prior row or absence.
   */
  restore(): void {
    this.live.apply(this.prior);
  }
}
