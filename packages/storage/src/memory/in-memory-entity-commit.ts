import { clone, toBinary, type Message } from "@bufbuild/protobuf";
import type { Event, EventId } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { eventStoreAccess, eventStoreRecordSpec } from "../event/event-store.js";
import { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
import type { EntityRecord } from "../entity/entity-record.js";
import type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
} from "../internal/entity-commit.js";
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

const commitHost = globalThis as typeof globalThis & {
  structuredClone<Value>(value: Value): Value;
};

/**
 * Implements provider-owned Entity commits for one shared in-memory backend.
 */
export class MemoryEntityCommitStorage implements EntityCommitStorage {
  readonly #entities: MemoryEntityStorageFactory;
  readonly #factory: StorageFactory;
  readonly #openRecords: <I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ) => TenantRecords<I, R>;
  readonly #input: EntityStorageInput<unknown, Message>;
  #open = true;

  /**
   * Creates a commit handle bound to one Entity source type.
   *
   * @param entities Opens the matching current Entity storage.
   * @param factory Owns the Event Store coordination lock.
   * @param openRecords Opens exact generic-record backing slices.
   * @param input Defines the Entity storage source type.
   */
  constructor(
    entities: MemoryEntityStorageFactory,
    factory: StorageFactory,
    openRecords: <I, R extends Message>(
      context: StorageContext,
      spec: RecordSpec<I, R>,
      group?: StorageGroup,
    ) => TenantRecords<I, R>,
    input: EntityStorageInput<unknown, Message>,
  ) {
    this.#entities = entities;
    this.#factory = factory;
    this.#openRecords = openRecords;
    this.#input = input;
  }

  /**
   * Applies one fully preflighted in-memory Entity commit.
   *
   * @param input Defines the current record, retained histories, and delivery events.
   * @returns The durable in-memory commit outcome.
   */
  commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    this.#requireOpen();
    this.#requireCompatible(input);
    const backend = this.#entities.backend(input.entity);
    const work = () =>
      backend.mutationQueue.run(ENTITY_SCOPE_MUTATION_KEY, () => this.#commit(input, backend));
    return input.events === undefined || input.events.length === 0
      ? work()
      : eventStoreAccess.withLock(this.#factory, input.context, work);
  }

  /**
   * Closes this commit handle without closing sibling handles.
   */
  close(): void {
    this.#open = false;
  }

  async #commit<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    liveBackend: EntityBackend,
  ): Promise<EntityCommitResult> {
    this.#requireEnabledHistories(input);
    const stateLayout =
      input.states === undefined || input.states.length === 0
        ? undefined
        : stateHistorySpec(input.entity.stateSchema);
    const eventLayout =
      input.diagnostics === undefined || input.diagnostics.length === 0
        ? undefined
        : eventHistorySpec(input.entity.stateSchema);
    const liveStates =
      stateLayout === undefined
        ? undefined
        : this.#openRecords(input.context, stateLayout.spec, stateLayout.group);
    const liveDiagnostics =
      eventLayout === undefined
        ? undefined
        : this.#openRecords(input.context, eventLayout.spec, eventLayout.group);
    const liveEvents =
      input.events === undefined || input.events.length === 0
        ? undefined
        : this.#openRecords(input.context, eventStoreRecordSpec);
    const stagedBackend: EntityBackend = {
      current: commitHost.structuredClone(liveBackend.current),
      mutationQueue: new KeyedSerialQueue(),
    };
    const stagedStates = InMemoryCommitValues.stage(liveStates);
    const stagedDiagnostics = InMemoryCommitValues.stage(liveDiagnostics);
    const stagedEvents = InMemoryCommitValues.stage(liveEvents);
    const stagedEntity = new InMemoryEntityStorage(
      this.#stagedInput(input.entity, stateLayout, stagedStates, eventLayout, stagedDiagnostics),
      stagedBackend,
    );
    try {
      const current = await stagedEntity.current.read(input.entityId);
      if (!InMemoryCommitValues.sameCurrent(current, input.expected)) return "conflict";

      const delivery = [...(input.events ?? [])].map((event) =>
        clone(eventStoreRecordSpec.recordType, event),
      );
      const materialized = delivery.map((event) => eventStoreRecordSpec.materialize(event));
      const ids = materialized.map((record) => record.id);
      if (
        new Set(ids.map((id) => id.value)).size !== ids.length ||
        ids.some((id) => stagedEvents?.read(id) !== undefined)
      ) {
        throw new Error("Entity commit requires unique delivery-event IDs.");
      }

      await stagedEntity.current.write(input.next);
      for (const state of input.states ?? []) await stagedEntity.states.append(state);
      for (const diagnostic of input.diagnostics ?? [])
        await stagedEntity.events.append(diagnostic);
      stagedEvents?.writeAll(materialized);

      InMemoryCommitValues.replace(liveBackend.current, stagedBackend.current);
      InMemoryCommitValues.publish(liveStates, stagedStates);
      InMemoryCommitValues.publish(liveDiagnostics, stagedDiagnostics);
      InMemoryCommitValues.publish(liveEvents, stagedEvents);
      return "committed";
    } finally {
      stagedEntity.close();
    }
  }

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

  #requireEnabledHistories<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if ((input.states?.length ?? 0) > 0 && !input.entity.stateHistory) {
      throw new Error("Entity commit cannot append state history when it is disabled.");
    }
    if ((input.diagnostics?.length ?? 0) > 0 && !input.entity.eventHistory) {
      throw new Error("Entity commit cannot append event history when it is disabled.");
    }
  }

  #requireCompatible<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (
      input.context.multitenant !== this.#input.context.multitenant ||
      TenantBoundary.of(input.context).key !== TenantBoundary.of(this.#input.context).key ||
      input.entity.sourceType.typeName !== this.#input.sourceType.typeName
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  #requireOpen(): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
  }
}

const InMemoryCommitValues = Object.freeze({
  sameCurrent(actual: EntityRecord | undefined, expected: EntityRecord | undefined): boolean {
    if (actual === undefined || expected === undefined) return actual === expected;
    return InMemoryCommitValues.equal(
      toBinary(EntityRecordSchema, actual),
      toBinary(EntityRecordSchema, expected),
    );
  },

  stage<I, R extends Message>(
    live: TenantRecords<I, R> | undefined,
  ): TenantRecords<I, R> | undefined {
    if (live === undefined) return undefined;
    const staged = new TenantRecords<I, R>();
    staged.replace(live.snapshot());
    return staged;
  },

  publish<I, R extends Message>(
    live: TenantRecords<I, R> | undefined,
    staged: TenantRecords<I, R> | undefined,
  ): void {
    if (live !== undefined && staged !== undefined) live.replace(staged.snapshot());
  },

  equal(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  },

  replace<K, V>(target: Map<K, V>, source: Map<K, V>): void {
    target.clear();
    for (const [key, value] of source) target.set(key, value);
  },
});
