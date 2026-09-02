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

import { clone, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
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
  type EntityCommitInput,
  type EntityCommitResult,
  type EntityCommitStorage,
  type EntityEventHistoryPort,
  type EntityRecordStorage,
  type EntityStateHistoryPort,
  type EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { RecordSpec, type RecordStorage } from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { Datastore } from "@google-cloud/datastore";

import { DatastoreRecordStorage, type DatastorePageCursor } from "./record-storage.js";

interface PreparedCommitRow {
  readonly immutable: boolean;
  readonly entity: {
    readonly key: unknown;
    readonly data: Record<string, unknown>;
    readonly excludeFromIndexes: readonly string[];
  };
}

/**
 * Opens one generated record family with its resolved Datastore layout.
 *
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
 * Coordinates an Entity mutation through one Datastore transaction.
 */
export class DatastoreEntityCommitStorage implements EntityCommitStorage {
  #open = true;

  /**
   * Creates transactional commit storage for one Entity persistence contract.
   *
   * @param input The Entity persistence contract served by this instance.
   * @param openRecords The function that opens generated record families.
   */
  constructor(
    private readonly input: EntityStorageInput<unknown, Message>,
    private readonly openRecords: OpenEntityRecords,
  ) {}

  /**
   * Commits one Entity state transition and its generated history records.
   *
   * @param input The Entity mutation to commit.
   * @returns The committed or conflicting outcome.
   */
  async commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    this.validate(input);
    const current = this.openRecords(input.entity.recordSpec) as DatastoreRecordStorage<
      I,
      EntityRecord
    >;
    const stateLayout = stateHistorySpec(input.entity.stateSchema);
    const diagnosticLayout = eventHistorySpec(input.entity.stateSchema);
    const states = input.entity.stateHistory
      ? (this.openRecords(stateLayout.spec, stateLayout.group) as DatastoreRecordStorage<
          unknown,
          EntityRecord
        >)
      : undefined;
    const diagnostics = input.entity.eventHistory
      ? (this.openRecords(diagnosticLayout.spec, diagnosticLayout.group) as DatastoreRecordStorage<
          unknown,
          Event
        >)
      : undefined;
    const events = this.openRecords(eventStoreRecordSpec) as DatastoreRecordStorage<unknown, Event>;
    try {
      return await this.run(input, current, states, diagnostics, events);
    } finally {
      this.closeRecords(current, states, diagnostics, events);
    }
  }

  private async run<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    current: DatastoreRecordStorage<I, EntityRecord>,
    states: DatastoreRecordStorage<unknown, EntityRecord> | undefined,
    diagnostics: DatastoreRecordStorage<unknown, Event> | undefined,
    events: DatastoreRecordStorage<unknown, Event>,
  ): Promise<EntityCommitResult> {
    const prepared = this.prepare(input, current, states, diagnostics, events);
    validateCommitSize(prepared.map((row) => row.entity));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.tryCommit(input, current, prepared);
      } catch (error) {
        if (isAborted(error) && attempt < 2) {
          await abortBackoff(attempt);
          continue;
        }
        throw entityTransactionError(error);
      }
    }
    throw new Error("Datastore transaction did not complete.");
  }

  private prepare<I>(
    input: EntityCommitInput<I, Message>,
    current: DatastoreRecordStorage<I, EntityRecord>,
    states: DatastoreRecordStorage<unknown, EntityRecord> | undefined,
    diagnostics: DatastoreRecordStorage<unknown, Event> | undefined,
    events: DatastoreRecordStorage<unknown, Event>,
  ): readonly PreparedCommitRow[] {
    return coalesceImmutableRows([
      ...preparedRows(current, [input.next], false),
      ...preparedRows(states, input.states ?? [], true),
      ...preparedRows(diagnostics, input.diagnostics ?? [], true),
      ...preparedRows(events, input.events ?? [], true),
    ]);
  }

  private async tryCommit<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    current: DatastoreRecordStorage<I, EntityRecord>,
    prepared: readonly PreparedCommitRow[],
  ): Promise<EntityCommitResult> {
    const transaction = current.transaction();
    try {
      await transaction.run();
      const values = await this.load(transaction, prepared);
      if (await this.conflict(transaction, input, current, values)) return "conflict";
      this.validateImmutable(prepared, values);
      this.apply(transaction, prepared, values);
      await transaction.commit();
      return "committed";
    } catch (error) {
      await rollback(transaction);
      throw error;
    }
  }

  private async load(
    transaction: ReturnType<Datastore["transaction"]>,
    prepared: readonly PreparedCommitRow[],
  ): Promise<ReadonlyMap<string, Record<string, unknown> | undefined>> {
    const keys = [...uniqueKeys(prepared.map((row) => row.entity.key))].sort((left, right) =>
      keyId(left).localeCompare(keyId(right)),
    );
    const values: [string, Record<string, unknown> | undefined][] = [];
    for (const key of keys)
      values.push([
        keyId(key),
        first(await transaction.get(key as Parameters<typeof transaction.get>[0])),
      ]);
    return new Map(values);
  }

  private async conflict<I, S extends Message>(
    transaction: ReturnType<Datastore["transaction"]>,
    input: EntityCommitInput<I, S>,
    current: DatastoreRecordStorage<I, EntityRecord>,
    values: ReadonlyMap<string, Record<string, unknown> | undefined>,
  ): Promise<boolean> {
    const live = values.get(keyId(current.transactionEntity(input.next).key));
    const expected =
      input.expected === undefined ? undefined : current.transactionEntity(input.expected).data;
    if (sameData(live, expected) || sameData(live, current.transactionEntity(input.next).data))
      return false;
    await transaction.rollback();
    return true;
  }

  private validateImmutable(
    prepared: readonly PreparedCommitRow[],
    values: ReadonlyMap<string, Record<string, unknown> | undefined>,
  ): void {
    for (const row of prepared.filter((item) => item.immutable)) {
      const previous = values.get(keyId(row.entity.key));
      if (previous !== undefined && !sameData(previous, row.entity.data))
        throw new Error("Immutable history record has divergent content.");
    }
  }

  private apply(
    transaction: ReturnType<Datastore["transaction"]>,
    prepared: readonly PreparedCommitRow[],
    values: ReadonlyMap<string, Record<string, unknown> | undefined>,
  ): void {
    for (const row of prepared) {
      const previous = values.get(keyId(row.entity.key));
      if (previous === undefined || (!row.immutable && !sameData(previous, row.entity.data)))
        transaction.save(row.entity);
    }
  }

  private closeRecords(
    current: { close(): void },
    states: { close(): void } | undefined,
    diagnostics: { close(): void } | undefined,
    events: { close(): void },
  ): void {
    current.close();
    states?.close();
    diagnostics?.close();
    events.close();
  }

  /**
   * Closes this commit storage to further commits.
   */
  close(): void {
    this.#open = false;
  }

  private validate<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
    if (
      input.entity.sourceType.typeName !== this.input.sourceType.typeName ||
      TenantBoundary.of(input.context).key !== TenantBoundary.of(this.input.context).key
    )
      throw new Error("Entity commit handle cannot commit another Entity source or tenant.");
    validateCommitEntityId(input);
    if ((input.states?.length ?? 0) > 0 && !input.entity.stateHistory)
      throw new Error("Entity commit cannot append state history when it is disabled.");
    if ((input.diagnostics?.length ?? 0) > 0 && !input.entity.eventHistory)
      throw new Error("Entity commit cannot append event history when it is disabled.");
    validateEvents(input.events ?? []);
  }
}

class CurrentStorage<I, S extends Message> implements EntityRecordStorage<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<I, EntityRecord>,
  ) {}
  read(id: I): Promise<EntityRecord | undefined> {
    return this.records.read(id);
  }
  async write(record: EntityRecord): Promise<void> {
    const id = record.entityId === undefined ? undefined : this.input.id.unpack(record.entityId);
    if (id === undefined)
      throw new Error("Entity current record ID does not match its Entity ID schema.");
    await this.records.write(record);
  }
  async query(plan: import("@spine-event-engine/storage").NormalizedQueryPlan<I>) {
    return (await this.records.queryPlanEntries(plan)).map((entry) => ({
      ...entry,
      columns: new Map(
        this.input.columns.map((column) => [column.name, column.valueIn(entry.record)]),
      ),
    }));
  }
}

class StateHistory<I, S extends Message> implements EntityStateHistoryPort<I, S> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >,
  ) {}
  append(record: EntityRecord): Promise<void> {
    this.requireOpen();
    return immutable(this.records, record);
  }
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
      : fromBinary(this.input.stateSchema, found.state.value);
  }
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
  close(): void {
    this.records.close();
  }

  private provider(): DatastoreRecordStorage<
    import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
    EntityRecord
  > {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto/generated/spine/server/entity/state_key_pb.js").EntityStateKey,
      EntityRecord
    >;
  }

  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }

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

class EventHistory<I, S extends Message> implements EntityEventHistoryPort<I> {
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly records: RecordStorage<import("@spine-event-engine/proto").EventId, Event>,
  ) {}
  append(event: Event): Promise<void> {
    this.requireOpen();
    return immutable(this.records, event);
  }
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
  close(): void {
    this.records.close();
  }

  private provider(): DatastoreRecordStorage<import("@spine-event-engine/proto").EventId, Event> {
    return this.records as DatastoreRecordStorage<
      import("@spine-event-engine/proto").EventId,
      Event
    >;
  }

  private requireOpen(): void {
    if (!this.records.isOpen()) throw new Error("Entity history storage is closed.");
  }
}

async function immutable<I, R extends Message>(
  records: RecordStorage<I, R>,
  record: R,
): Promise<void> {
  const id = records.recordSpec.idValueIn(record);
  if (await records.compareAndSet(id, undefined, record)) return;
  const existing = await records.read(id);
  if (existing === undefined) throw new Error("Immutable history record was not retained.");
  if (
    !same(
      toBinary(records.recordSpec.recordType, existing),
      toBinary(records.recordSpec.recordType, record),
    )
  )
    throw new Error("Immutable history record has divergent content.");
}
function preparedRows<I, R extends Message>(
  storage: DatastoreRecordStorage<I, R> | undefined,
  records: readonly R[],
  immutable: boolean,
): readonly {
  readonly storage: DatastoreRecordStorage<I, R>;
  readonly record: R;
  readonly immutable: boolean;
  readonly entity: ReturnType<DatastoreRecordStorage<I, R>["transactionEntity"]>;
}[] {
  if (storage === undefined) {
    if (records.length > 0) throw new Error("Entity commit history is disabled.");
    return [];
  }
  return records.map((record) => ({
    storage,
    record,
    immutable,
    entity: storage.transactionEntity(record),
  }));
}
function coalesceImmutableRows<
  R extends {
    readonly immutable: boolean;
    readonly entity: { readonly key: unknown; readonly data: Record<string, unknown> };
  },
>(rows: readonly R[]): readonly R[] {
  const seen = new Map<string, R>();
  return rows.filter((row) => {
    if (!row.immutable) return true;
    const previous = seen.get(keyId(row.entity.key));
    if (previous === undefined) {
      seen.set(keyId(row.entity.key), row);
      return true;
    }
    if (!sameData(previous.entity.data, row.entity.data))
      throw new Error("Immutable history record has divergent content.");
    return false;
  });
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
function first(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) ? (value[0] as Record<string, unknown> | undefined) : undefined;
}
function keyId(key: unknown): string {
  return JSON.stringify(key);
}
function uniqueKeys(keys: readonly unknown[]): readonly unknown[] {
  return [...new Map(keys.map((key) => [keyId(key), key])).values()];
}
function sameData(
  left: Record<string | symbol, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const bytes = left.bytes;
  return (
    bytes instanceof Uint8Array && right.bytes instanceof Uint8Array && same(bytes, right.bytes)
  );
}
function isAborted(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === 10;
}
function entityTransactionError(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Immutable history record")) return error;
  return new Error("Datastore Entity transaction failed.");
}
function abortBackoff(attempt: number): Promise<void> {
  const delayMs = 20 * (attempt + 1) + Math.floor(Math.random() * 40);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
async function rollback(transaction: { rollback(): Promise<unknown> }): Promise<void> {
  try {
    await transaction.rollback();
  } catch {
    /* original provider error remains authoritative */
  }
}
function validateCommitSize(
  rows: readonly { readonly key: unknown; readonly data: Record<string, unknown> }[],
): void {
  if (rows.length > 500) throw new Error("Entity commit exceeds the 500-mutation limit.");
  if (uniqueKeys(rows.map((row) => row.key)).length > 25)
    throw new Error("Entity commit exceeds the 25 entity-group limit.");
  const bytes = rows.reduce(
    (total, row) =>
      total +
      Buffer.byteLength(
        JSON.stringify(row.data, (_key, value: unknown) =>
          value instanceof Uint8Array
            ? Buffer.from(value).toString("base64")
            : typeof value === "bigint"
              ? value.toString()
              : value,
        ),
        "utf8",
      ),
    0,
  );
  if (bytes > 9 * 1024 * 1024)
    throw new Error("Entity commit exceeds the transaction payload limit.");
}

function validateEvents(events: readonly Event[]): void {
  const ids = events.map((event) => event.id?.value);
  if (
    ids.some((id) => id === undefined || id.trim().length === 0) ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Entity commit requires non-blank unique delivery-event IDs.");
}

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
