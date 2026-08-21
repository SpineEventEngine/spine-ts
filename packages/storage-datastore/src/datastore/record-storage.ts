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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { and, Datastore, or, PropertyFilter } from "@google-cloud/datastore";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  ColumnMappings,
  defaultQueryCandidateLimit,
  RecordStorage,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
  type StorageQueryCapabilities,
} from "@spine-event-engine/storage";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { StorageQueryValues } from "@spine-event-engine/storage/provider";

import { DatastoreColumnMapping } from "./column-mapping.js";
import { DatastoreIdColumn } from "./id-column.js";
import {
  DefaultNamespaceConverter,
  NamespaceAssignments,
  type NamespaceConverter,
} from "./namespace.js";
const payloadProperty = "bytes";
const maxMutationsPerBatch = 500;
const maxCasAttempts = 3;
const casRetryDelayMs = 100;
const wrappedReadOptions = { wrapNumbers: true } as const;

/**
 * Describes one provider-side Datastore range filter.
 *
 * This is deliberately package-private adapter machinery. It is used by the
 * generated Entity-history implementation to keep large histories on the
 * provider rather than materializing them in Node.js.
 */
export interface DatastoreRangeFilter {
  // prettier-ignore

  /**
   * Names the Datastore property compared by this filter.
   */
  readonly property: string;

  /**
   * Selects the comparison applied by Datastore.
   */
  readonly operator: "=" | "<" | "<=" | ">" | ">=";

  /**
   * Provides the value on the right side of the comparison.
   */
  readonly value: unknown;
}

/**
 * Describes a bounded provider-side page over one Datastore record kind.
 */
export interface DatastorePageQuery {
  // prettier-ignore

  /**
   * Narrows the page with provider-side comparisons.
   */
  readonly filters?: readonly DatastoreRangeFilter[];

  /**
   * Defines the stable provider-side ordering of the page.
   */
  readonly order?: readonly { readonly property: string; readonly direction: "asc" | "desc" }[];

  /**
   * Continues after the last row returned by the preceding provider page.
   */
  readonly cursor?: DatastorePageCursor;

  /**
   * Limits the number of rows decoded for this page.
   */
  readonly limit: number;
}

/**
 * Returns one bounded Datastore page and its explicit keyset continuation.
 */
export interface DatastorePage<I, R extends Message> {
  // prettier-ignore

  /**
   * Contains the decoded records in provider order.
   */
  readonly entries: readonly RecordEntry<I, R>[];

  /**
   * Continues the next request after this page.
   */
  readonly cursor: DatastorePageCursor | undefined;

  /**
   * Tells whether Datastore reported another page.
   */
  readonly hasMore: boolean;
}

/**
 * Identifies the last provider row in a stable ordered page.
 */
export interface DatastorePageCursor {
  // prettier-ignore

  /**
   * Values for the requested provider ordering.
   */
  readonly values: readonly unknown[];

  /**
   * Physical key used as the deterministic final tie-breaker.
   */
  readonly key: unknown;
}

/**
 * Private flat Datastore-entity codec for one record storage handle.
 */
class FlatEntityCodec<I, R extends Message> {
  readonly #kind: string;
  readonly #namespace: string | undefined;
  readonly #idColumn: DatastoreIdColumn<I>;
  readonly #columnMapping: DatastoreColumnMapping;

  constructor(
    context: StorageContext,
    private readonly recordSpec: RecordSpec<I, R>,
    client: Datastore,
    private readonly maxClientSideScan: number,
    private readonly group: StorageGroup | undefined,
    kind: string | undefined,
    namespaceConverter: NamespaceConverter,
    stringifiers: StringifierRegistry,
  ) {
    this.#kind =
      kind ??
      (group === undefined
        ? recordSpec.sourceType.typeName
        : `${group.name}_${recordSpec.recordType.typeName.split(".").at(-1) ?? ""}`);
    if (this.#kind.trim().length === 0 || Buffer.byteLength(this.#kind, "utf8") > 1_500)
      throw new Error("Datastore record kind must be non-blank and at most 1,500 bytes.");
    const boundary = TenantBoundary.of(context);
    this.#namespace = boundary.single
      ? client.namespace
      : namespaceConverter.toNamespace(boundary.tenantId as NonNullable<typeof boundary.tenantId>);
    this.#idColumn = new DatastoreIdColumn(recordSpec.idType, stringifiers);
    this.#columnMapping = new DatastoreColumnMapping(stringifiers);
  }

  key(client: Datastore, id: I): ReturnType<Datastore["key"]> {
    return client.key({
      path: [this.#kind, this.#idColumn.value(id)],
      ...(this.#namespace === undefined ? {} : { namespace: this.#namespace }),
    });
  }

  encode(record: R, columns: ReadonlyMap<string, unknown>): Record<string, unknown> {
    const data: Record<string, unknown> = {
      [payloadProperty]: Buffer.from(
        toBinary(this.recordSpec.recordType, record, { writeUnknownFields: false }),
      ),
    };

    for (const [name, value] of columns) {
      data[name] = this.columnValue(name, value);
    }

    return data;
  }

  id(entity: Record<string | symbol, unknown>, client: Datastore): I {
    const key = datastoreKey(entity, client.KEY);
    const name = datastoreKeyName(key);
    if (typeof name !== "string") {
      throw new Error("Datastore entity has no valid Spine record identifier.");
    }
    return this.#idColumn.read(name);
  }

  columns(entity: Record<string | symbol, unknown>): ReadonlyMap<string, unknown> {
    return new Map(
      this.recordSpec.columns.map((column) => [column.name, column.valueIn(this.decode(entity))]),
    );
  }

  unindexedProperties(data: Readonly<Record<string, unknown>>): readonly string[] {
    void data;
    return [payloadProperty];
  }

  createQuery(client: Datastore): ReturnType<Datastore["createQuery"]> {
    return this.#namespace === undefined
      ? client.createQuery(this.#kind)
      : client.createQuery(this.#namespace, this.#kind);
  }

  columnProperty(column: string): string {
    if (!this.recordSpec.columns.some((candidate) => candidate.name === column)) {
      throw new Error(`Datastore record column "${column}" is not declared.`);
    }
    return column;
  }

  queryLimit(): number {
    return this.maxClientSideScan + 1;
  }

  namespace(): string | undefined {
    return this.#namespace;
  }

  columnValue(column: string, value: unknown): unknown {
    const declared = this.recordSpec.columns.find((candidate) => candidate.name === column);
    if (declared === undefined)
      throw new Error(`Datastore record column "${column}" is not declared.`);
    return ColumnMappings.value(this.#columnMapping, declared.type, value);
  }

  pageCursor(
    entity: Record<string | symbol, unknown>,
    order: readonly { readonly property: string; readonly direction: "asc" | "desc" }[],
    keySymbol: unknown,
  ): DatastorePageCursor {
    const key = datastoreKey(entity, keySymbol);
    const record = this.decode(entity);
    const values = order.map((item) => {
      if (item.property === "__key__") return key;
      const column = this.recordSpec.columns.find((candidate) => candidate.name === item.property);
      return column === undefined
        ? undefined
        : ColumnMappings.value(this.#columnMapping, column.type, column.valueIn(record));
    });
    if (key === undefined || values.some((value) => value === undefined))
      throw new Error("Datastore provider page continuation is malformed.");
    return { values, key };
  }

  decode(entity: Record<string | symbol, unknown>): R {
    const payload = entity[payloadProperty];

    if (!(payload instanceof Uint8Array)) {
      throw new Error("Datastore entity cannot be decoded.");
    }

    try {
      return fromBinary(this.recordSpec.recordType, payload, { readUnknownFields: false });
    } catch {
      throw new Error("Datastore entity cannot be decoded.");
    }
  }
}

function datastoreKey(entity: Record<string | symbol, unknown>, property: unknown): unknown {
  return typeof property === "symbol" ? entity[property] : undefined;
}

function datastoreKeyName(key: unknown): unknown {
  if (typeof key !== "object" || key === null) return undefined;
  const value = key as Record<string, unknown>;
  return value.name ?? (Array.isArray(value.path) ? value.path.at(-1) : undefined);
}

function keysetFilter(
  order: readonly { readonly property: string; readonly direction: "asc" | "desc" }[],
  cursor: DatastorePageCursor,
  keySymbol: unknown,
) {
  if (cursor.values.length !== order.length)
    throw new Error("Datastore provider page continuation is malformed.");
  const fields = [...order, { property: "__key__", direction: order.at(-1)?.direction ?? "asc" }];
  const values = [...cursor.values, cursor.key];
  const alternatives = fields.map((field, index) => {
    const equal = fields
      .slice(0, index)
      .map((prior, priorIndex) => new PropertyFilter(prior.property, "=", values[priorIndex]));
    const operator = field.direction === "asc" ? ">" : "<";
    const current = new PropertyFilter(field.property, operator, values[index]);
    return equal.length === 0 ? current : and([...equal, current]);
  });
  if (cursor.key === undefined || keySymbol === undefined)
    throw new Error("Datastore provider page continuation is malformed.");
  return or(alternatives);
}

function sameCursor(left: DatastorePageCursor, right: DatastorePageCursor | undefined): boolean {
  return (
    right !== undefined && JSON.stringify(left, cursorJson) === JSON.stringify(right, cursorJson)
  );
}

function cursorJson(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Provides one Datastore-backed storage handle for a record family.
 */
export class DatastoreRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  // prettier-ignore

  /**
   * Declares atomic conditional mutations for compatible Datastore handles.
   */
  override readonly atomicCompareAndSet = true;
  readonly #codec: FlatEntityCodec<I, R>;

  /**
   * Creates a Datastore-backed record storage handle.
   *
   * @param context Storage tenancy and naming context.
   * @param recordSpec Schema, identifier, and column materialization contract.
   * @param client Injected Datastore client owned by the factory.
   * @param maxClientSideScan Maximum candidate records to materialize locally.
   * @param group The optional generated storage group.
   * @param kind The optional physical Datastore kind override.
   * @param namespaceConverter Converts complete tenants to native namespaces.
   * @param stringifiers Converts message-valued IDs and declared columns.
   */
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    readonly client: Datastore,
    maxClientSideScan: number,
    group?: StorageGroup,
    kind?: string,
    namespaceConverter: NamespaceConverter = new DefaultNamespaceConverter(),
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    super(context, recordSpec);
    this.#codec = new FlatEntityCodec(
      context,
      recordSpec,
      client,
      maxClientSideScan,
      group,
      kind,
      namespaceConverter instanceof NamespaceAssignments
        ? namespaceConverter
        : new NamespaceAssignments(namespaceConverter),
      stringifiers,
    );
  }

  /**
   * Prepares one resolved physical row for an enclosing transaction.
   *
   * @param record The record to materialize.
   * @returns The Datastore key and property map.
   * @internal
   */
  transactionEntity(record: R): {
    readonly key: ReturnType<Datastore["key"]>;
    readonly data: Record<string, unknown>;
    readonly excludeFromIndexes: readonly string[];
  } {
    const materialized = this.recordSpec.materialize(record);
    return {
      key: this.#codec.key(this.client, materialized.id),
      data: this.#codec.encode(materialized.record, materialized.columns),
      excludeFromIndexes: [payloadProperty],
    };
  }

  /**
   * Decodes one entity read by a provider-owned multi-record transaction.
   *
   * @param entity The raw Datastore entity returned inside that transaction.
   * @returns The decoded record.
   * @internal
   */
  decodeTransactionEntity(entity: Record<string | symbol, unknown>): R {
    return this.#codec.decode(entity);
  }

  /**
   * Checks whether one transaction-read entity is the exact expected record.
   *
   * @param entity The raw Datastore entity returned inside that transaction.
   * @param expected The expected record snapshot.
   * @returns Whether the persisted payload exactly matches the snapshot.
   * @internal
   */
  matchesTransactionEntity(entity: Record<string | symbol, unknown>, expected: R): boolean {
    const expectedData = this.transactionEntity(expected).data[payloadProperty];
    return RecordValues.payloadEqual(entity[payloadProperty], expectedData);
  }

  /**
   * Reads one bounded, fully provider-executed page.
   *
   * Entity history uses this internal seam for records that would otherwise
   * exceed the public query materialization budget.
   *
   * @param request The provider filters, ordering, continuation, and row limit.
   * @returns The decoded page and an explicit continuation when more rows remain.
   * @internal
   */
  async queryProviderPage(request: DatastorePageQuery): Promise<DatastorePage<I, R>> {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0 || request.limit > 128)
      throw new Error(
        "Datastore provider page limit must be a positive integer no greater than 128.",
      );
    const query = this.#codec.createQuery(this.client);
    for (const filter of request.filters ?? []) {
      query.filter(
        new PropertyFilter(
          filter.property,
          filter.operator,
          this.#codec.columnValue(filter.property, filter.value),
        ),
      );
    }
    const order = request.order ?? [];
    for (const item of order) query.order(item.property, { descending: item.direction === "desc" });
    if (!order.some((item) => item.property === "__key__"))
      query.order("__key__", {
        descending: order.at(-1)?.direction === "desc",
      });
    if (request.cursor !== undefined) {
      const continuation = keysetFilter(order, request.cursor, this.client.KEY);
      query.filter(continuation);
    }
    query.limit(request.limit);
    const response = await this.provider(() => this.client.runQuery(query, wrappedReadOptions));
    const entities = DatastoreResults.entities(response);
    const info = DatastoreResults.queryInfo(response);
    const entries = entities.map((entity) => ({
      id: this.#codec.id(entity, this.client),
      record: this.#codec.decode(entity),
    }));
    const cursor = entities.at(-1);
    if (info.more && cursor === undefined)
      throw new Error("Datastore provider page continuation is malformed.");
    const next =
      cursor === undefined ? undefined : this.#codec.pageCursor(cursor, order, this.client.KEY);
    if (info.more && request.cursor !== undefined && sameCursor(request.cursor, next))
      throw new Error("Datastore provider page continuation did not advance.");
    return {
      entries,
      cursor: info.more ? next : undefined,
      hasMore: info.more,
    };
  }

  /**
   * Deletes a bounded group of provider entries.
   *
   * @param entries The entries selected by a preceding provider page.
   * @returns Completes after the provider deletes the group.
   * @internal
   */
  async deleteProviderEntries(entries: readonly RecordEntry<I, R>[]): Promise<void> {
    if (entries.length === 0) return;
    if (entries.length > 128)
      throw new Error("Datastore provider delete group must contain no more than 128 entries.");
    await this.provider(() =>
      this.client.delete(entries.map((entry) => this.#codec.key(this.client, entry.id))),
    );
  }

  /**
   * Deletes the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns Whether a record was deleted.
   */
  protected async deleteRecord(id: I): Promise<boolean> {
    const key = this.#codec.key(this.client, id);
    const entity = DatastoreResults.first(
      await this.provider(() => this.client.get(key, wrappedReadOptions)),
    );

    if (entity === undefined) {
      return false;
    }

    await this.provider(() => this.client.delete(key));
    return true;
  }

  /**
   * Returns records matching a query.
   * @param _query The record query.
   * @returns The matching storage entries.
   */
  protected async queryRecordEntries(
    _query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const query = this.#codec.createQuery(this.client);
    const providerLimit = DatastoreRecordQuery.limit(_query, this.#codec.queryLimit());
    DatastoreQueryPushdown.translate(
      query,
      _query,
      (id) => this.#codec.key(this.client, id),
      (column) => this.#codec.columnProperty(column),
      (column, value) => this.#codec.columnValue(column, value),
    );
    query.limit(providerLimit);
    const entities = DatastoreResults.entities(
      await this.provider(() => this.client.runQuery(query, wrappedReadOptions)),
    );
    if (providerLimit === this.#codec.queryLimit() && entities.length >= providerLimit) {
      throw new DatastoreQueryLimitError(providerLimit - 1);
    }
    const entries = entities.map((entity) => ({
      id: this.#codec.id(entity, this.client),
      record: this.#codec.decode(entity),
      columns: this.#codec.columns(entity),
    }));

    if (DatastoreRecordQuery.isKeysetPage(_query))
      return entries.map(({ id, record }) => ({ id, record }));
    return LocalQueryResults.apply(entries, _query);
  }

  /**
   * Returns the supported Datastore query capabilities.
   * @returns The supported query capabilities.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["order", "mask", "limit"],
    };
  }

  /**
   * Returns candidate records for a normalized query plan.
   * @param plan The normalized query plan.
   * @returns The candidate storage entries.
   */
  protected override async queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    if (plan.predicate !== undefined && DatastoreQueryPushdown.legal(plan) === undefined)
      throw new TypeError(
        "Datastore normalized query has an illegal predicate or inequality ordering.",
      );
    for (const order of plan.order ?? []) this.#codec.columnProperty(order.column);
    const query = this.#codec.createQuery(this.client);
    DatastoreQueryPushdown.plan(
      query,
      plan,
      (id) => this.#codec.key(this.client, id),
      (column) => this.#codec.columnProperty(column),
      (column, value) => this.#codec.columnValue(column, value),
    );
    const providerLimit = Math.min(
      this.#codec.queryLimit(),
      plan.limit ?? Number.POSITIVE_INFINITY,
      (plan.candidateLimit ?? defaultQueryCandidateLimit) + 1,
    );
    query.limit(providerLimit);
    const entities = DatastoreResults.entities(
      await this.provider(() => this.client.runQuery(query, wrappedReadOptions)),
    );
    if (entities.length >= providerLimit && providerLimit === this.#codec.queryLimit()) {
      throw new DatastoreQueryLimitError(providerLimit - 1);
    }
    return entities.map((entity) => ({
      id: this.#codec.id(entity, this.client),
      record: this.#codec.decode(entity),
    }));
  }

  /**
   * Reads the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns The stored record, if present.
   */
  protected async readRecord(id: I): Promise<R | undefined> {
    const entity = DatastoreResults.first(
      await this.provider(() =>
        this.client.get(this.#codec.key(this.client, id), wrappedReadOptions),
      ),
    );

    return entity === undefined ? undefined : this.#codec.decode(entity);
  }

  /**
   * Compares and conditionally replaces the record at one storage slot.
   * @param id The storage slot identifier.
   * @param expected The expected materialized record.
   * @param next The replacement materialized record, if any.
   * @returns Whether the conditional mutation was applied.
   */
  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxCasAttempts; attempt += 1) {
      try {
        return await this.attemptCompareAndSet(id, expected, next);
      } catch (error) {
        if (attempt + 1 < maxCasAttempts && DatastoreTransactions.retry(error)) {
          await DatastoreTransactions.wait(attempt);
          continue;
        }
        throw DatastoreTransactions.redact(error);
      }
    }

    throw new Error("Datastore compare-and-set retry limit was reached.");
  }

  private async attemptCompareAndSet(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const key = this.#codec.key(this.client, id);
    const transaction = this.transaction();
    try {
      await transaction.run();
      const entity = DatastoreResults.first(await transaction.get(key, wrappedReadOptions));
      const expectedPayload =
        expected === undefined
          ? undefined
          : this.#codec.encode(expected.record, expected.columns)[payloadProperty];
      if (
        entity === undefined
          ? expected !== undefined
          : !RecordValues.payloadEqual(entity[payloadProperty], expectedPayload)
      ) {
        await transaction.rollback();
        return false;
      }
      if (next === undefined) transaction.delete(key);
      else {
        const data = this.#codec.encode(next.record, next.columns);
        transaction.save({ key, data, excludeFromIndexes: this.#codec.unindexedProperties(data) });
      }
      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Writes materialized records.
   * @param records The materialized records to write.
   * @returns Completes when the records are written.
   */
  protected async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    for (let offset = 0; offset < records.length; offset += maxMutationsPerBatch) {
      const rows = records.slice(offset, offset + maxMutationsPerBatch).map((record) => {
        const data = this.#codec.encode(record.record, record.columns);
        return {
          key: this.#codec.key(this.client, record.id),
          data,
          excludeFromIndexes: this.#codec.unindexedProperties(data),
        };
      });
      await this.provider(() => this.client.save(rows));
    }
  }

  /**
   * Writes one materialized record.
   * @param record The materialized record to write.
   * @returns Completes when the record is written.
   */
  protected async writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    const data = this.#codec.encode(record.record, record.columns);
    const key = this.#codec.key(this.client, record.id);
    await this.provider(() =>
      this.client.save({
        key,
        data,
        excludeFromIndexes: this.#codec.unindexedProperties(data),
      }),
    );
  }

  private async provider<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new Error("Datastore provider operation failed.");
    }
  }

  /**
   * Creates a transaction scoped to this handle's selected namespace.
   *
   * @returns The namespace-scoped Datastore transaction.
   * @internal
   */
  transaction(): ReturnType<Datastore["transaction"]> {
    const transaction = this.client.transaction();
    const namespace = this.#codec.namespace();
    if (namespace !== undefined) transaction.namespace = namespace;
    return transaction;
  }
}

/**
 * Converts values between Spine records and the Datastore provider representation.
 */
const RecordValues = Object.freeze(
  new (class {
    // prettier-ignore

    /**
     * Compares canonical local values for equality.
     */
    equal(left: unknown, right: unknown): boolean {
      return StorageQueryValues.equal(left, right);
    }

    /**
     * Compares canonical local values for ordering.
     */
    compare(left: unknown, right: unknown): number {
      return StorageQueryValues.compare(left, right);
    }

    /**
     * Compares two persisted payload byte arrays.
     */
    payloadEqual(left: unknown, right: unknown): boolean {
      return (
        left instanceof Uint8Array &&
        right instanceof Uint8Array &&
        left.byteLength === right.byteLength &&
        left.every((value, index) => value === right[index])
      );
    }
  })(),
);

/**
 * Raised when a query would exceed the adapter's configured finite client-side scan budget.
 */
export class DatastoreQueryLimitError extends Error {
  // prettier-ignore

  /**
   * Creates the scan-budget error.
   *
   * @param maxClientSideScan Configured maximum number of locally scanned candidates.
   */
  constructor(readonly maxClientSideScan: number) {
    super(`Datastore query exceeded the client-side scan limit of ${String(maxClientSideScan)}.`);
    this.name = "DatastoreQueryLimitError";
  }
}

interface QueriedEntry<I, R extends Message> extends RecordEntry<I, R> {
  readonly columns: ReadonlyMap<string, unknown>;
}

/**
 * Translates safe normalized record queries to Datastore query operations.
 */

class DatastoreQueryPushdownHelper {
  // prettier-ignore

  /**
   * Translates the legacy record-query surface.
   */
  translate<I>(
      query: ReturnType<Datastore["createQuery"]>,
      recordQuery: RecordQuery<I>,
      keyFor: (id: I) => ReturnType<Datastore["key"]>,
      columnProperty: (column: string) => string,
      columnValue: (column: string, value: unknown) => unknown,
    ): void {
      if (recordQuery.ids !== undefined && recordQuery.ids.length > 0) {
        const keys = recordQuery.ids.map(keyFor);
        const first = recordQuery.ids[0];
        if (first === undefined) throw new Error("Datastore record query ID is invalid.");
        const key = keyFor(first);
        query.filter(
          new PropertyFilter(
            "__key__",
            keys.length === 1 ? "=" : "IN",
            keys.length === 1 ? key : keys,
          ),
        );
      }
      for (const filter of recordQuery.filters ?? []) {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        const providerValues =
          filter.column === "id"
            ? values.map((value) => keyFor(value as I))
            : values.map((value) => columnValue(filter.column, value));
        query.filter(
          new PropertyFilter(
            filter.column === "id" ? "__key__" : columnProperty(filter.column),
            values.length === 1 ? "=" : "IN",
            values.length === 1 ? providerValues[0] : providerValues,
          ),
        );
      }
      for (const order of recordQuery.sort ?? []) {
        query.order(order.field === "id" ? "__key__" : columnProperty(order.field), {
          descending: order.direction === "desc",
        });
      }
      if (!(recordQuery.sort ?? []).some((order) => order.field === "id")) query.order("__key__");
      if (recordQuery.after !== undefined && DatastoreRecordQuery.isKeysetPage(recordQuery))
        query.filter(new PropertyFilter("__key__", ">", keyFor(recordQuery.after.id)));
    }

  /**
   * Applies the all-or-nothing legal portion of a normalized query plan.
   */
  plan<I>(
    query: ReturnType<Datastore["createQuery"]>,
    plan: NormalizedQueryPlan<I>,
    keyFor: (id: I) => ReturnType<Datastore["key"]>,
    columnProperty: (column: string) => string,
    columnValue: (column: string, value: unknown) => unknown,
  ): void {
    const legal = this.legal(plan);
    if (legal !== undefined) {
      this.predicate(query, legal, keyFor, columnProperty, columnValue);
    }
    if (legal !== undefined || plan.predicate === undefined) {
      for (const order of plan.order ?? []) {
        query.order(columnProperty(order.column), { descending: order.direction === "desc" });
      }
      if ((plan.order?.length ?? 0) > 0) query.order("__key__");
    }
  }

  /**
   * Returns the predicate only when every clause satisfies provider restrictions.
   */
  legal<I>(plan: NormalizedQueryPlan<I>): NormalizedQueryPredicate<I> | undefined {
    const predicate = plan.predicate;
    if (predicate === undefined) return undefined;
    const leaves = predicate.kind === "all" ? predicate.predicates : [predicate];
    let idCount = 0;
    const inequalityColumns = new Set<string>();
    for (const leaf of leaves) {
      if (leaf.kind !== "ids" && leaf.kind !== "comparison") return undefined;
      if (leaf.kind === "ids") {
        idCount += leaf.ids.length;
        if (idCount > 30) return undefined;
        continue;
      }
      if (leaf.operator !== "equal") {
        inequalityColumns.add(leaf.column);
      }
    }
    if (inequalityColumns.size > 1) return undefined;
    const inequalityColumn = inequalityColumns.values().next().value;
    if (inequalityColumn !== undefined && plan.order?.[0]?.column !== inequalityColumn) {
      return undefined;
    }
    return predicate;
  }

  /**
   * Adds one already-legal normalized predicate to the provider query.
   */
  predicate<I>(
    query: ReturnType<Datastore["createQuery"]>,
    predicate: NormalizedQueryPredicate<I>,
    keyFor: (id: I) => ReturnType<Datastore["key"]>,
    columnProperty: (column: string) => string,
    columnValue: (column: string, value: unknown) => unknown,
  ): void {
    if (predicate.kind === "all") {
      predicate.predicates.forEach((child) => {
        this.predicate(query, child, keyFor, columnProperty, columnValue);
      });
      return;
    }
    if (predicate.kind === "ids") {
      const keys = predicate.ids.map(keyFor);
      const firstKey = keys[0];
      if (keys.length === 1 && firstKey !== undefined) {
        query.filter(new PropertyFilter("__key__", "=", firstKey));
      } else {
        query.filter(new PropertyFilter("__key__", "IN", keys));
      }
      return;
    }
    if (predicate.kind !== "comparison") return;
    const operator =
      predicate.operator === "equal"
        ? "="
        : predicate.operator === "greaterThan"
          ? ">"
          : predicate.operator === "lessThan"
            ? "<"
            : predicate.operator === "greaterOrEqual"
              ? ">="
              : "<=";
    query.filter(
      new PropertyFilter(
        columnProperty(predicate.column),
        operator,
        columnValue(predicate.column, predicate.value),
      ),
    );
  }
}

/**
 * Frozen Datastore query pushdown operations.
 */
const DatastoreQueryPushdown = Object.freeze(new DatastoreQueryPushdownHelper());

/**
 * Selects safe provider bounds for direct record queries.
 */
const DatastoreRecordQuery = Object.freeze(
  new (class {
    // prettier-ignore

    /**
     * Returns a caller limit only when it cannot change local query semantics.
     *
     * @param query Supplies the requested record query.
     * @param scanLimit Supplies the configured materialization limit.
     * @returns The finite provider row bound.
     */
    limit<I>(query: RecordQuery<I>, scanLimit: number): number {
      const requestedLimit = query.limit;
      if (requestedLimit !== undefined && this.isKeysetPage(query)) return requestedLimit;
      if (
        query.limit !== undefined &&
        query.ids === undefined &&
        query.filters === undefined &&
        query.sort === undefined &&
        query.after === undefined &&
        query.offset === undefined
      )
        return query.limit;
      return scanLimit;
    }

    /**
     * Returns whether a legacy query is exactly an ascending identifier keyset page.
     *
     * @param query The record query to classify.
     * @returns `true` when Datastore can apply its limit and continuation completely.
     */
    isKeysetPage<I>(query: RecordQuery<I>): boolean {
      const order = query.sort;
      const continuation = query.after;
      const continuationValue = continuation?.values[0];
      return (
        query.limit !== undefined &&
        query.ids === undefined &&
        query.filters === undefined &&
        query.offset === undefined &&
        order?.length === 1 &&
        order[0]?.field === "id" &&
        order[0].direction !== "desc" &&
        (continuation === undefined ||
          (continuation.values.length === 1 &&
            continuationValue?.field === "id" &&
            RecordValues.equal(continuationValue.value, continuation.id)))
      );
    }
  })(),
);

/**
 * Applies record-query filtering, ordering, continuation, and paging locally.
 */

class LocalQueryResultsHelper {
  // prettier-ignore

  /**
   * Applies one legacy record query to materialized candidate entries.
   */
  apply<I, R extends Message>(
      entries: readonly QueriedEntry<I, R>[],
      query: RecordQuery<I>,
    ): readonly RecordEntry<I, R>[] {
      const matching = entries.filter((entry) => this.matches(entry, query));
      const orders = query.sort ?? [];
      const sorted = [...matching].sort((left, right) => this.order(left, right, orders));
      const continuation = query.after;
      const continued =
        continuation === undefined
          ? sorted
          : sorted.filter((entry) => this.continuation(entry, orders, continuation) > 0);
      const start = query.offset ?? 0;
      const end = query.limit === undefined ? undefined : start + query.limit;

      return continued.slice(start, end).map(({ id, record }) => ({ id, record }));
    }

  /**
   * Tests whether a candidate satisfies the ID and equality filters.
   */
  matches<I, R extends Message>(entry: QueriedEntry<I, R>, query: RecordQuery<I>): boolean {
    return (
      (query.ids === undefined ||
        query.ids.length === 0 ||
        query.ids.some((id) => RecordValues.equal(id, entry.id))) &&
      (query.filters ?? []).every((filter) => {
        const actual = filter.column === "id" ? entry.id : entry.columns.get(filter.column);
        const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
        return expected.some((value) => RecordValues.equal(value, actual));
      })
    );
  }

  /**
   * Orders candidates by requested sort fields and canonical ID tie-breaker.
   */
  order<I, R extends Message>(
    left: QueriedEntry<I, R>,
    right: QueriedEntry<I, R>,
    orders: readonly NonNullable<RecordQuery<I>["sort"]>[number][],
  ): number {
    for (const order of orders) {
      const comparison = RecordValues.compare(
        this.value(left, order.field),
        this.value(right, order.field),
      );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return RecordValues.compare(left.id, right.id);
  }

  /**
   * Compares a candidate with a normalized continuation cursor.
   */
  continuation<I, R extends Message>(
    entry: QueriedEntry<I, R>,
    orders: readonly NonNullable<RecordQuery<I>["sort"]>[number][],
    after: NonNullable<RecordQuery<I>["after"]>,
  ): number {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (order === undefined) throw new Error("Record query continuation sort order is invalid.");
      const comparison = RecordValues.compare(
        this.value(entry, order.field),
        after.values[index]?.value,
      );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return RecordValues.compare(entry.id, after.id);
  }

  /**
   * Obtains an ID or indexed column value from a candidate.
   */
  value<I, R extends Message>(entry: QueriedEntry<I, R>, field: string): unknown {
    return field === "id" ? entry.id : entry.columns.get(field);
  }
}

/**
 * Frozen local record-query reconciliation operations.
 */
const LocalQueryResults = Object.freeze(new LocalQueryResultsHelper());

/**
 * Protects transaction failures and coordinates bounded CAS retries.
 */

class DatastoreTransactionsHelper {
  // prettier-ignore

  /**
   * Redacts credential-like errors while preserving safe provider failures.
   */
  redact(error: unknown): Error {
      void error;
      return new Error("Datastore transaction failed.");
    }

  /**
   * Identifies a safe-to-retry Datastore transaction conflict.
   */
  retry(error: unknown): boolean {
    return (
      error instanceof Error &&
      !/(credential|payload|secret)/i.test(error.message) &&
      Reflect.get(error, "code") === 10
    );
  }

  /**
   * Waits using exponential jitter before a bounded CAS retry.
   */
  async wait(attempt: number): Promise<void> {
    const exponentialDelay = casRetryDelayMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * exponentialDelay);
    await new Promise<void>((resolve) => setTimeout(resolve, exponentialDelay + jitter));
  }
}

/**
 * Frozen Datastore transaction retry and redaction operations.
 */
const DatastoreTransactions = Object.freeze(new DatastoreTransactionsHelper());

/**
 * Validates Datastore read and query response shapes.
 */

class DatastoreResultsHelper {
  // prettier-ignore

  /**
   * Extracts the optional first entity from a Datastore read response.
   */
  first(response: unknown): Record<string | symbol, unknown> | undefined {
      if (!Array.isArray(response))
        throw new Error("Datastore returned an invalid entity response.");
      const entity = (response as unknown[])[0];
      return entity === undefined ? undefined : this.entity(entity);
    }

  /**
   * Extracts entity rows from a Datastore query response.
   */
  entities(response: unknown): readonly Record<string | symbol, unknown>[] {
    if (!Array.isArray(response) || !Array.isArray(response[0])) {
      throw new Error("Datastore returned an invalid query response.");
    }
    return (response[0] as unknown[]).map((value) => this.entity(value));
  }

  /**
   * Extracts the provider continuation and the remaining-row indication.
   */
  queryInfo(response: unknown): {
    readonly cursor: Buffer | string | undefined;
    readonly more: boolean;
  } {
    if (!Array.isArray(response) || typeof response[1] !== "object" || response[1] === null)
      throw new Error("Datastore returned an invalid query response.");
    const info = response[1] as Record<string, unknown>;
    const cursor = info.endCursor;
    const moreResults = info.moreResults;
    if (
      moreResults !== "NO_MORE_RESULTS" &&
      moreResults !== "MORE_RESULTS_AFTER_LIMIT" &&
      moreResults !== "MORE_RESULTS_AFTER_CURSOR"
    )
      throw new Error("Datastore returned an invalid query response.");
    const more =
      moreResults === "MORE_RESULTS_AFTER_LIMIT" || moreResults === "MORE_RESULTS_AFTER_CURSOR";
    if (more && !(cursor instanceof Buffer || typeof cursor === "string"))
      throw new Error("Datastore returned an invalid query response.");
    return {
      cursor: cursor instanceof Buffer || typeof cursor === "string" ? cursor : undefined,
      more,
    };
  }

  /**
   * Validates one provider entity object.
   */
  entity(value: unknown): Record<string | symbol, unknown> {
    if (typeof value !== "object" || value === null) {
      throw new Error("Datastore returned an invalid entity response.");
    }
    return value as Record<string | symbol, unknown>;
  }
}

/**
 * Frozen Datastore provider response parsing operations.
 */
const DatastoreResults = Object.freeze(new DatastoreResultsHelper());
