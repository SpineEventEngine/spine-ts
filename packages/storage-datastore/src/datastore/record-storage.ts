import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { Datastore } from "@google-cloud/datastore";
import {
  RecordStorage,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
  type StorageQueryCapabilities,
} from "@spine-event-engine/storage";

import { CanonicalValue } from "./value-codec.js";

const payloadProperty = "$spine.payload";
const idProperty = "$spine.id";
const columnPrefix = "$spine.column.";
const columnTypePrefix = "$spine.columnType.";
const maxMutationsPerBatch = 500;
const maxCasAttempts = 3;
const casRetryDelayMs = 100;
const wrappedReadOptions = { wrapNumbers: true } as const;

/**
 * Private flat Datastore-entity codec for one record storage handle.
 */
class FlatEntityCodec<I, R extends Message> {
  readonly #kind: string;

  constructor(
    private readonly context: StorageContext,
    private readonly recordSpec: RecordSpec<I, R>,
    private readonly maxClientSideScan: number,
  ) {
    this.#kind = CanonicalValue.encode([context.name, context.multitenant, recordSpec.storageKey]);
    if (Buffer.byteLength(this.#kind, "utf8") > 1_500)
      throw new Error("Datastore record kind exceeds the 1500-byte UTF-8 limit.");
  }

  key(client: Datastore, id: I): ReturnType<Datastore["key"]> {
    return client.key({
      path: [this.#kind, CanonicalValue.encode(id)],
      ...(this.context.multitenant ? { namespace: this.requiredTenantId() } : {}),
    });
  }

  encode(record: R, columns: ReadonlyMap<string, unknown>, id: I): Record<string, unknown> {
    const data: Record<string, unknown> = {
      [idProperty]: CanonicalValue.encode(id),
      [payloadProperty]: Buffer.from(
        toBinary(this.recordSpec.schema, record, { writeUnknownFields: false }),
      ),
    };

    for (const [name, value] of columns) {
      data[`${columnPrefix}${name}`] = RecordValues.provider(
        value,
        `Datastore record column "${name}"`,
      );
      if (typeof value === "bigint") data[`${columnTypePrefix}${name}`] = "bigint";
    }

    return data;
  }

  id(entity: Record<string | symbol, unknown>): I {
    const encodedId = entity[idProperty];

    if (typeof encodedId !== "string") {
      throw new Error("Datastore entity has no valid Spine record identifier.");
    }

    return CanonicalValue.decode(encodedId) as I;
  }

  columns(entity: Record<string | symbol, unknown>): ReadonlyMap<string, unknown> {
    return new Map(
      Object.entries(entity)
        .filter(([name]) => name.startsWith(columnPrefix))
        .map(([name, value]) => {
          const column = name.slice(columnPrefix.length);
          return [column, RecordValues.local(value, entity[`${columnTypePrefix}${column}`])];
        }),
    );
  }

  unindexedProperties(data: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(data).filter((name) => name.startsWith(columnTypePrefix));
  }

  createQuery(client: Datastore): ReturnType<Datastore["createQuery"]> {
    return this.context.multitenant
      ? client.createQuery(this.requiredTenantId(), this.#kind)
      : client.createQuery(this.#kind);
  }

  columnProperty(column: string): string {
    return `${columnPrefix}${column}`;
  }

  queryLimit(): number {
    return this.maxClientSideScan + 1;
  }

  decode(entity: Record<string | symbol, unknown>): R {
    const payload = entity[payloadProperty];

    if (!(payload instanceof Uint8Array)) {
      throw new Error("Datastore entity cannot be decoded.");
    }

    try {
      return fromBinary(this.recordSpec.schema, payload, { readUnknownFields: false });
    } catch {
      throw new Error("Datastore entity cannot be decoded.");
    }
  }

  private requiredTenantId(): string {
    const tenantId = this.context.tenantId;

    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new Error(`Multitenant storage "${this.context.name}" requires context.tenantId.`);
    }

    return tenantId;
  }
}

/**
 * Private initial handle for the Datastore adapter.
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
   */
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    readonly client: Datastore,
    maxClientSideScan: number,
  ) {
    super(context, recordSpec);
    this.#codec = new FlatEntityCodec(context, recordSpec, maxClientSideScan);
  }

  /**
   * Deletes the record at one storage slot.
   * @param id The storage slot identifier.
   * @returns Whether a record was deleted.
   */
  protected async deleteRecord(id: I): Promise<boolean> {
    const key = this.#codec.key(this.client, id);
    const entity = DatastoreResults.first(await this.client.get(key, wrappedReadOptions));

    if (entity === undefined) {
      return false;
    }

    await this.client.delete(key);
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
    );
    query.limit(providerLimit);
    const entities = DatastoreResults.entities(
      await this.client.runQuery(query, wrappedReadOptions),
    );
    if (providerLimit === this.#codec.queryLimit() && entities.length >= providerLimit) {
      throw new DatastoreQueryLimitError(providerLimit - 1);
    }
    const entries = entities.map((entity) => ({
      id: this.#codec.id(entity),
      record: this.#codec.decode(entity),
      columns: this.#codec.columns(entity),
    }));

    return LocalQueryResults.apply(entries, _query);
  }

  /**
   * Returns the supported Datastore query capabilities.
   * @returns The supported query capabilities.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
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
    const query = this.#codec.createQuery(this.client);
    DatastoreQueryPushdown.plan(
      query,
      plan,
      (id) => this.#codec.key(this.client, id),
      (column) => this.#codec.columnProperty(column),
    );
    const providerLimit = Math.min(
      this.#codec.queryLimit(),
      plan.candidateLimit === undefined ? Number.POSITIVE_INFINITY : plan.candidateLimit + 1,
    );
    query.limit(providerLimit);
    const entities = DatastoreResults.entities(
      await this.client.runQuery(query, wrappedReadOptions),
    );
    if (entities.length >= providerLimit && providerLimit === this.#codec.queryLimit()) {
      throw new DatastoreQueryLimitError(providerLimit - 1);
    }
    return entities.map((entity) => ({
      id: this.#codec.id(entity),
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
      await this.client.get(this.#codec.key(this.client, id), wrappedReadOptions),
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
    const transaction = this.client.transaction();
    try {
      await transaction.run();
      const entity = DatastoreResults.first(await transaction.get(key, wrappedReadOptions));
      const expectedPayload =
        expected === undefined
          ? undefined
          : this.#codec.encode(expected.record, expected.columns, expected.id)[payloadProperty];
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
        const data = this.#codec.encode(next.record, next.columns, next.id);
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
      await this.client.save(
        records.slice(offset, offset + maxMutationsPerBatch).map((record) => {
          const data = this.#codec.encode(record.record, record.columns, record.id);
          return {
            key: this.#codec.key(this.client, record.id),
            data,
            excludeFromIndexes: this.#codec.unindexedProperties(data),
          };
        }),
      );
    }
  }

  /**
   * Writes one materialized record.
   * @param record The materialized record to write.
   * @returns Completes when the record is written.
   */
  protected async writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    const data = this.#codec.encode(record.record, record.columns, record.id);
    await this.client.save({
      key: this.#codec.key(this.client, record.id),
      data,
      excludeFromIndexes: this.#codec.unindexedProperties(data),
    });
  }
}

type QueryableValue = string | number | boolean | bigint | null;

/**
 * Converts values between Spine records and the Datastore provider representation.
 */

/**
 * Converts values between Spine records and the Datastore provider representation.
 */
const RecordValues = Object.freeze(
  new (class {
    // prettier-ignore

    /**
     * Tests whether a value is supported by a Datastore indexed property.
     */
    queryable(value: unknown): value is QueryableValue {
      if (typeof value === "bigint") return value >= -(1n << 63n) && value <= (1n << 63n) - 1n;
      if (typeof value === "number") return Number.isFinite(value);
      return value === null || ["string", "boolean"].includes(typeof value);
    }

    /**
     * Encodes one queryable local value for the Datastore provider.
     */
    provider(value: unknown, label: string): unknown {
      if (typeof value === "bigint") {
        if (!this.queryable(value))
          throw new Error(`${label} must be an exact signed 64-bit integer.`);
        return Datastore.int(value.toString());
      }
      if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
        return Datastore.double(value);
      }
      if (!this.queryable(value)) throw new Error(`${label} has an unsupported value.`);
      return value;
    }

    /**
     * Decodes a Datastore property to the type retained in a record column.
     */
    local(value: unknown, type: unknown): unknown {
      if (type === "bigint") {
        if (typeof value === "bigint") return value;
        if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
        if (typeof value === "object" && value !== null && Datastore.isInt(value))
          return BigInt(value.value);
        throw new Error("Datastore entity has an invalid bigint record column.");
      }
      if (typeof value === "object" && value !== null && Datastore.isInt(value)) {
        const integer = Number(value.value);
        return Number.isSafeInteger(integer) ? integer : BigInt(value.value);
      }
      return value;
    }

    /**
     * Compares canonical local values for equality.
     */
    equal(left: unknown, right: unknown): boolean {
      return CanonicalValue.equal(left, right);
    }

    /**
     * Compares canonical local values for ordering.
     */
    compare(left: unknown, right: unknown): number {
      return CanonicalValue.compare(left, right);
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

/**
 * Translates safe normalized record queries to Datastore query operations.
 */
const DatastoreQueryPushdown = Object.freeze(
  new (class {
    // prettier-ignore

    /**
     * Translates the legacy record-query surface.
     */
    translate<I>(
      query: ReturnType<Datastore["createQuery"]>,
      recordQuery: RecordQuery<I>,
      keyFor: (id: I) => ReturnType<Datastore["key"]>,
      columnProperty: (column: string) => string,
    ): void {
      if (recordQuery.ids !== undefined && recordQuery.ids.length > 0) {
        query.filter(
          "__key__",
          recordQuery.ids.length === 1 ? "=" : "IN",
          recordQuery.ids.length === 1
            ? keyFor(recordQuery.ids[0] as I)
            : recordQuery.ids.map(keyFor),
        );
      }
      for (const filter of recordQuery.filters ?? []) {
        const values = Array.isArray(filter.value) ? filter.value : [filter.value];
        const providerValues =
          filter.column === "id"
            ? values.map((value) => keyFor(value as I))
            : values.map((value) =>
                RecordValues.provider(value, `Datastore query filter "${filter.column}"`),
              );
        query.filter(
          filter.column === "id" ? "__key__" : columnProperty(filter.column),
          values.length === 1 ? "=" : "IN",
          values.length === 1 ? providerValues[0] : providerValues,
        );
      }
      for (const order of recordQuery.sort ?? []) {
        query.order(order.field === "id" ? "__key__" : columnProperty(order.field), {
          descending: order.direction === "desc",
        });
      }
      if (!(recordQuery.sort ?? []).some((order) => order.field === "id")) query.order("__key__");
      if (recordQuery.after !== undefined && DatastoreRecordQuery.isKeysetPage(recordQuery))
        query.filter("__key__", ">", keyFor(recordQuery.after.id));
    }

    /**
     * Applies the all-or-nothing legal portion of a normalized query plan.
     */
    plan<I>(
      query: ReturnType<Datastore["createQuery"]>,
      plan: NormalizedQueryPlan<I>,
      keyFor: (id: I) => ReturnType<Datastore["key"]>,
      columnProperty: (column: string) => string,
    ): void {
      const legal = this.legal(plan);
      if (legal !== undefined) {
        this.predicate(query, legal, keyFor, columnProperty);
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
    ): void {
      if (predicate.kind === "all") {
        predicate.predicates.forEach((child) => {
          this.predicate(query, child, keyFor, columnProperty);
        });
        return;
      }
      if (predicate.kind === "ids") {
        const keys = predicate.ids.map(keyFor);
        const firstKey = keys[0];
        if (keys.length === 1 && firstKey !== undefined) {
          query.filter("__key__", "=", firstKey);
        } else {
          query.filter("__key__", "IN", keys);
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
        columnProperty(predicate.column),
        operator,
        RecordValues.provider(predicate.value, `Datastore query filter "${predicate.column}"`),
      );
    }
  })(),
);

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

    /** Returns whether a legacy query is exactly an ascending identifier keyset page. */
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
          (typeof continuation.id === "string" &&
            continuation.values.length === 1 &&
            continuationValue?.field === "id" &&
            typeof continuationValue.value === "string" &&
            RecordValues.equal(continuationValue.value, continuation.id)))
      );
    }
  })(),
);

/**
 * Applies record-query filtering, ordering, continuation, and paging locally.
 */

/**
 * Applies record-query filtering, ordering, continuation, and paging locally.
 */
const LocalQueryResults = Object.freeze(
  new (class {
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
        if (order === undefined)
          throw new Error("Record query continuation sort order is invalid.");
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
  })(),
);

/**
 * Protects transaction failures and coordinates bounded CAS retries.
 */

/**
 * Protects transaction failures and coordinates bounded CAS retries.
 */
const DatastoreTransactions = Object.freeze(
  new (class {
    // prettier-ignore

    /**
     * Redacts credential-like errors while preserving safe provider failures.
     */
    redact(error: unknown): Error {
      if (error instanceof Error && !/(credential|payload|secret)/i.test(error.message))
        return error;
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
  })(),
);

/**
 * Validates Datastore read and query response shapes.
 */

/**
 * Validates Datastore read and query response shapes.
 */
const DatastoreResults = Object.freeze(
  new (class {
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
     * Validates one provider entity object.
     */
    entity(value: unknown): Record<string | symbol, unknown> {
      if (typeof value !== "object" || value === null) {
        throw new Error("Datastore returned an invalid entity response.");
      }
      return value as Record<string | symbol, unknown>;
    }
  })(),
);
