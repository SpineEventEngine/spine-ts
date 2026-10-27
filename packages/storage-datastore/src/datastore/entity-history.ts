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

import { clone, toBinary, type Message } from "@bufbuild/protobuf";
import { AnyPacker } from "@spine-event-engine/core";
import { type Timestamp } from "@bufbuild/protobuf/wkt";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/provider";
import {
  disabledEventHistoryPort,
  disabledStateHistoryPort,
  eventHistorySpec,
  stateHistorySpec,
  EntityCommitSnapshots,
  type EntityCommitInput,
  type EntityCommitStorage,
  type EntityEventHistoryPort,
  type EntityRecordStorage,
  type EntityStateHistoryPort,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { RecordSpec, type RecordStorage } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

import { DatastoreRecordStorage, type DatastorePageCursor } from "./record-storage.js";

/**
 * Opens one generated record family with its resolved Datastore layout.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 * @param spec The generated record-family contract.
 * @param group The optional generated storage group.
 * @returns The opened record-storage handle.
 */
export type OpenEntityRecords = <I, R extends Message>(
  spec: RecordSpec<I, R>,
  group?: import("@spine-event-engine/storage").StorageGroup,
) => RecordStorage<I, R>;

/**
 * Groups Entity current and optional history record families.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export class DatastoreEntityStorage<I, S extends Message> {
  // prettier-ignore

  /**
   * Provides access to current Entity records.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Provides access to retained Entity event history.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Provides access to retained Entity state history.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  readonly #records: readonly { close(): void }[];

  #open = true;

  /**
   * Creates storage handles for one Entity persistence contract.
   *
   * @param input The Entity persistence contract.
   * @param openRecords The function that opens each generated record family.
   */
  constructor(input: EntityStorageInput<I, S>, openRecords: OpenEntityRecords) {
    const current = openRecords(input.recordSpec);
    const states = input.stateHistory
      ? openRecords(
          stateHistorySpec(input.stateSchema).spec,
          stateHistorySpec(input.stateSchema).group,
        )
      : undefined;
    const events = input.eventHistory
      ? openRecords(
          eventHistorySpec(input.stateSchema).spec,
          eventHistorySpec(input.stateSchema).group,
        )
      : undefined;
    this.current = new CurrentStorage(input, current);
    this.states =
      states === undefined ? disabledStateHistoryPort() : new StateHistory(input, states);
    this.events =
      events === undefined ? disabledEventHistoryPort() : new EventHistory(input, events);
    this.#records = [current, states, events].filter((value) => value !== undefined);
  }

  /**
   * Closes all record-storage handles owned by this Entity storage.
   */
  close(): void {
    if (this.#open) {
      this.#open = false;
      for (const record of this.#records) record.close();
    }
  }

  /**
   * Returns whether this Entity storage remains open.
   *
   * @returns `true` when this storage accepts operations.
   */
  isOpen(): boolean {
    return this.#open;
  }
}

/**
 * Writes one Datastore Entity mutation in independent record order.
 */
export class DatastoreEntityCommitStorage implements EntityCommitStorage {
  #open = true;

  /**
   * Creates commit storage for one Entity persistence contract.
   *
   * @param input Defines the Entity source and tenant boundary.
   * @param openRecords Opens each generated record family.
   */
  constructor(
    private readonly input: EntityStorageInput<unknown, Message>,
    private readonly openRecords: OpenEntityRecords,
  ) {}

  /**
   * Writes histories and delivery Events before the current Entity record.
   *
   * A failed save may leave a completed prefix. One transient retry replays
   * captured records with the same versions and Event IDs.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Supplies the prepared Entity mutation.
   * @returns Completion after every requested record write.
   */
  async commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<void> {
    this.validate(input);
    const prepared = EntityCommitSnapshots.capture(input);
    const current = this.openRecords(prepared.entity.recordSpec);
    const stateLayout = stateHistorySpec(prepared.entity.stateSchema);
    const diagnosticLayout = eventHistorySpec(prepared.entity.stateSchema);
    const states = prepared.states?.length
      ? this.openRecords(stateLayout.spec, stateLayout.group)
      : undefined;
    const diagnostics = prepared.diagnostics?.length
      ? this.openRecords(diagnosticLayout.spec, diagnosticLayout.group)
      : undefined;
    const events = prepared.events?.length ? this.openRecords(eventStoreRecordSpec) : undefined;
    try {
      try {
        await this.apply(prepared, current, states, diagnostics, events);
      } catch (error) {
        if (!this.retryable(error)) throw error;
        await this.apply(prepared, current, states, diagnostics, events);
      }
    } finally {
      current.close();
      states?.close();
      diagnostics?.close();
      events?.close();
    }
  }

  /**
   * Writes independent record families in Entity commit order.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input Supplies immutable prepared records.
   * @param current Stores current Entity state.
   * @param states Stores state history when requested.
   * @param diagnostics Stores diagnostic Events when requested.
   * @param events Stores delivery Events when requested.
   * @returns Completion after every requested record write.
   */
  private async apply<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    current: RecordStorage<I, EntityRecord>,
    states:
      | RecordStorage<
          import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
          EntityRecord
        >
      | undefined,
    diagnostics: RecordStorage<import("@spine-event-engine/proto").EventId, Event> | undefined,
    events: RecordStorage<import("@spine-event-engine/proto").EventId, Event> | undefined,
  ): Promise<void> {
    if (states !== undefined)
      for (const record of input.states ?? []) await immutable(states, record);
    if (diagnostics !== undefined)
      for (const event of input.diagnostics ?? []) await immutable(diagnostics, event);
    if (events !== undefined)
      for (const event of input.events ?? []) await immutable(events, event);
    const previous = await current.read(input.entityId);
    if (
      previous === undefined ||
      !same(toBinary(EntityRecordSchema, previous), toBinary(EntityRecordSchema, input.next))
    )
      await current.write(input.next);
  }

  /**
   * Determines whether a Datastore abort occurred through provider error causes.
   *
   * @param error Supplies the operation failure.
   * @returns Whether one captured-input replay is safe.
   */
  private retryable(error: unknown): boolean {
    let current = error;
    for (let depth = 0; depth < 4; depth += 1) {
      if (typeof current !== "object" || current === null) return false;
      const failure = current as { code?: unknown; cause?: unknown };
      if (failure.code === 10) return true;
      current = failure.cause;
    }
    return false;
  }

  /**
   * Closes this commit storage to further commits.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Validates the Entity, tenant, history, and Event boundaries of a commit.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Supplies the proposed commit.
   */
  private validate<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
    if (
      input.entity.sourceType.typeName !== this.input.sourceType.typeName ||
      input.entity.stateSchema.typeName !== this.input.stateSchema.typeName ||
      TenantBoundary.of(input.context).key !== TenantBoundary.of(this.input.context).key ||
      TenantBoundary.of(input.entity.context).key !== TenantBoundary.of(this.input.context).key
    )
      throw new Error("Entity commit handle cannot commit another Entity source or tenant.");
    validateCommitEntityId(input);
    if ((input.states?.length ?? 0) > 0 && (!this.input.stateHistory || !input.entity.stateHistory))
      throw new Error("Entity commit cannot append state history when it is disabled.");
    if (
      (input.diagnostics?.length ?? 0) > 0 &&
      (!this.input.eventHistory || !input.entity.eventHistory)
    )
      throw new Error("Entity commit cannot append event history when it is disabled.");
    validateEvents(input.events ?? []);
  }
}

/**
 * Provides the current Entity records through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  /**
   * Creates current-record access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and columns.
   * @param records Provides current Entity record storage.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
  ) {}

  /**
   * Reads one current Entity record.
   *
   * @param id Identifies the Entity.
   * @returns The current record, or undefined when none is stored.
   */
  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }

  /**
   * Stores the current record for its Entity.
   *
   * @param record Supplies the current Entity record.
   * @returns Completion after the record is stored.
   */
  async write(record: EntityRecord): Promise<void> {
    const id = record.entityId === undefined ? undefined : this.input.id.unpack(record.entityId);
    if (id === undefined)
      throw new Error("Entity current record ID does not match its Entity ID schema.");
    await this.records.write(record);
  }

  /**
   * Returns current Entity records and their configured columns.
   *
   * @param plan Specifies the normalized query.
   * @returns Matching Entity records and column values.
   */
  async query(plan: import("@spine-event-engine/storage").NormalizedQueryPlan<I>) {
    return (await this.records.queryPlanEntries(plan)).map((entry) => ({
      ...entry,
      columns: new Map(
        this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
      ),
    }));
  }
}

/**
 * Provides retained Entity state history through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class StateHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  /**
   * Creates state-history access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and state schema.
   * @param records Provides retained state-history records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >,
  ) {}

  /**
   * Stores one immutable state-history record.
   *
   * @param record Supplies the state-history record.
   * @returns Completion after the record is retained.
   */
  append(record: EntityRecord): Promise<void> {
    this.requireOpen();
    return immutable(this.records, record);
  }

  /**
   * Reads recent state-history records in reverse order.
   *
   * @param id Identifies the Entity.
   * @param depth Sets the maximum number of records to read.
   * @param from Sets an optional upper version bound.
   * @returns Matching records from newest to oldest.
   */
  async backward(id: I, depth: number, from?: bigint): Promise<readonly EntityRecord[]> {
    this.requireOpen();
    requireDepth(depth);
    return this.pages(
      [
        entityFilter(this.input, id),
        ...(from === undefined ? [] : [numberFilter("version", "<=", from)]),
      ],
      [
        { property: "version", direction: "desc" },
        { property: "created", direction: "desc" },
      ],
      depth,
    );
  }

  /**
   * Reads the Entity state recorded at or before a time.
   *
   * @param id Identifies the Entity.
   * @param time Sets the latest creation time to include.
   * @returns The matching state, or undefined when none exists.
   */
  async stateAt(id: I, time: Timestamp): Promise<S | undefined> {
    this.requireOpen();
    const page = await this.provider().queryProviderPage({
      filters: [entityFilter(this.input, id), timestampFilter("created", "<=", time)],
      order: [
        { property: "created", direction: "desc" },
        { property: "version", direction: "desc" },
      ],
      limit: 1,
    });
    const found = page.entries[0]?.record;
    return found?.state === undefined
      ? undefined
      : AnyPacker.unpack(found.state, this.input.stateSchema);
  }

  /**
   * Stores no more than the newest state-history records for an Entity.
   *
   * @param id Identifies the Entity.
   * @param keep Sets the number of newest records to retain.
   * @returns Completion after older records are removed.
   */
  async trim(id: I, keep: number): Promise<void> {
    this.requireOpen();
    requireKeep(keep);
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [entityFilter(this.input, id)],
        order: [
          { property: "version", direction: "desc" },
          { property: "created", direction: "desc" },
        ],
        limit: 128,
      });
      const removable = page.entries.slice(keep);
      await this.provider().deleteProviderEntries(removable);
      if (!page.hasMore) break;
    }
  }

  /**
   * Removes state-history records created before a time.
   *
   * @param time Sets the exclusive creation-time boundary.
   * @returns Completion after matching records are removed.
   */
  async truncate(time: Timestamp): Promise<void> {
    this.requireOpen();
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [timestampFilter("created", "<", time)],
        order: [
          { property: "created", direction: "asc" },
          { property: "version", direction: "asc" },
        ],
        limit: 128,
      });
      await this.provider().deleteProviderEntries(page.entries);
      if (!page.hasMore) break;
    }
  }

  /**
   * Closes the state-history record handle.
   */
  close(): void {
    this.records.close();
  }

  /**
   * Returns the Datastore provider for state-history queries.
   *
   * @returns The typed Datastore record-storage handle.
   */
  private provider(): DatastoreRecordStorage<
    import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
    EntityRecord
  > {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >;
  }

  /**
   * Rejects operations after the record handle closes.
   */
  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }

  /**
   * Reads a bounded sequence of matching state-history pages.
   *
   * @param filters Specifies the Datastore filters.
   * @param order Specifies the Datastore sort order.
   * @param depth Sets the maximum number of records to read.
   * @returns Matching records in page order.
   */
  private async pages(
    filters: readonly import("./record-storage.js").DatastoreRangeFilter[],
    order: readonly { readonly property: string; readonly direction: "asc" | "desc" }[],
    depth: number,
  ): Promise<readonly EntityRecord[]> {
    const result: EntityRecord[] = [];
    let cursor: DatastorePageCursor | undefined;
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters,
        order,
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(128, depth - result.length),
      });
      result.push(...page.entries.map((entry) => clone(EntityRecordSchema, entry.record)));
      cursor = page.cursor;
      if (!page.hasMore || result.length === depth) break;
    }
    return result;
  }
}

/**
 * Provides retained Entity Event history through one record-family handle.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class EventHistory<I, S extends Message> implements EntityEventHistoryPort<I> {
  /**
   * Creates Event-history access for one Entity storage contract.
   *
   * @param input Defines the Entity identity and state schema.
   * @param records Provides retained Event-history records.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<import("@spine-event-engine/proto").EventId, Event>,
  ) {}

  /**
   * Stores one immutable Entity Event-history record.
   *
   * @param event Supplies the Event-history record.
   * @returns Completion after the Event is retained.
   */
  append(event: Event): Promise<void> {
    this.requireOpen();
    return immutable(this.records, event);
  }

  /**
   * Reads recent Entity Events in reverse order.
   *
   * @param id Identifies the Entity.
   * @param depth Sets the maximum number of Events to read.
   * @param from Sets an optional upper version bound.
   * @returns Matching Events from newest to oldest.
   */
  async backward(id: I, depth: number, from?: bigint): Promise<readonly Event[]> {
    this.requireOpen();
    requireDepth(depth);
    const result: Event[] = [];
    let cursor: DatastorePageCursor | undefined;
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [
          entityFilter(this.input, id),
          ...(from === undefined ? [] : [numberFilter("version", "<=", from)]),
        ],
        order: [
          { property: "version", direction: "desc" },
          { property: "created", direction: "desc" },
        ],
        ...(cursor === undefined ? {} : { cursor }),
        limit: Math.min(128, depth - result.length),
      });
      result.push(...page.entries.map((entry) => clone(EventSchema, entry.record)));
      cursor = page.cursor;
      if (!page.hasMore || result.length === depth) break;
    }
    return result;
  }

  /**
   * Removes Entity Events created before a time.
   *
   * @param time Sets the exclusive creation-time boundary.
   * @returns Completion after matching Events are removed.
   */
  async truncate(time: Timestamp): Promise<void> {
    this.requireOpen();
    for (;;) {
      const page = await this.provider().queryProviderPage({
        filters: [timestampFilter("created", "<", time)],
        order: [
          { property: "created", direction: "asc" },
          { property: "version", direction: "asc" },
        ],
        limit: 128,
      });
      await this.provider().deleteProviderEntries(page.entries);
      if (!page.hasMore) break;
    }
  }

  /**
   * Closes the Event-history record handle.
   */
  close(): void {
    this.records.close();
  }

  /**
   * Returns the Datastore provider for Event-history queries.
   *
   * @returns The typed Datastore record-storage handle.
   */
  private provider(): DatastoreRecordStorage<import("@spine-event-engine/proto").EventId, Event> {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto").EventId,
      Event
    >;
  }

  /**
   * Rejects operations after the record handle closes.
   */
  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }
}

/**
 * Stores a history record once and rejects divergent content for its ID.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 * @param records Provides immutable history record storage.
 * @param record Supplies the history record to retain.
 * @returns Completion after the record is present.
 */
async function immutable<I, R extends Message>(
  records: RecordStorage<I, R>,
  record: R,
): Promise<void> {
  const id = records.recordSpec.idValueIn(record);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await records.compareAndSet(id, undefined, record)) return;
    const existing = await records.read(id);
    if (existing === undefined) continue;
    if (
      !same(
        toBinary(records.recordSpec.recordType, existing),
        toBinary(records.recordSpec.recordType, record),
      )
    )
      throw new Error("Immutable history record has divergent content.");
    return;
  }
  throw new Error("Immutable history record was not retained.");
}

function same(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function requireDepth(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("History depth must be a positive safe integer.");
}
function requireKeep(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("History retention must be a non-negative safe integer.");
}

/**
 * Creates a Datastore filter for one Entity identifier.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @param input Defines the Entity ID schema.
 * @param id Identifies the Entity to match.
 * @returns The Datastore Entity ID filter.
 */
function entityFilter<I, S extends Message>(
  input: EntityStorageInput<I, S>,
  id: I,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property: "entity_id", operator: "=", value: input.id.pack(id) };
}

function numberFilter(
  property: string,
  operator: "=" | "<" | "<=" | ">" | ">=",
  value: bigint,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property, operator, value };
}

function timestampFilter(
  property: string,
  operator: "=" | "<" | "<=" | ">" | ">=",
  value: Timestamp,
): import("./record-storage.js").DatastoreRangeFilter {
  return { property, operator, value };
}
function validateEvents(events: readonly Event[]): void {
  const ids = events.map((event) => event.id?.value);
  if (
    ids.some((id) => id === undefined || id.trim().length === 0) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Entity commit requires non-blank unique delivery-event IDs.");
}

/**
 * Checks that current and history records identify the committed Entity.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 * @param input Supplies the Entity commit to check.
 */
function validateCommitEntityId<I, S extends Message>(input: EntityCommitInput<I, S>): void {
  const nextId =
    input.next.entityId === undefined ? undefined : input.entity.id.unpack(input.next.entityId);
  if (nextId === undefined || input.entity.id.key(nextId) !== input.entity.id.key(input.entityId))
    throw new Error("Entity commit current record ID does not match the committed Entity ID.");
  for (const record of input.states ?? []) {
    const stateId =
      record.entityId === undefined ? undefined : input.entity.id.unpack(record.entityId);
    if (
      stateId === undefined ||
      input.entity.id.key(stateId) !== input.entity.id.key(input.entityId)
    )
      throw new Error(
        "Entity commit state-history record ID does not match the committed Entity ID.",
      );
  }
  for (const event of input.diagnostics ?? []) {
    const producer = event.context?.producerId;
    const eventId = producer === undefined ? undefined : input.entity.id.unpack(producer);
    if (
      eventId === undefined ||
      input.entity.id.key(eventId) !== input.entity.id.key(input.entityId)
    )
      throw new Error("Entity commit diagnostic event ID does not match the committed Entity ID.");
  }
}
