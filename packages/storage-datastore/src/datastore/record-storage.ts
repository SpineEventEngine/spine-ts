import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { Datastore } from "@google-cloud/datastore";
import {
  RecordStorage,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
} from "@spine-ts/storage";

import { CanonicalValue } from "./value-codec.js";

const payloadProperty = "$spine.payload";
const idProperty = "$spine.id";
const columnPrefix = "$spine.column.";
const columnTypePrefix = "$spine.columnType.";
const maxMutationsPerBatch = 500;
const maxCasAttempts = 3;
const casRetryDelayMs = 100;
const wrappedReadOptions = { wrapNumbers: true } as const;

/** Private flat Datastore-entity codec for one record storage handle. */
class FlatEntityCodec<I, R extends Message> {
  readonly #kind: string;

  constructor(
    private readonly context: StorageContext,
    private readonly recordSpec: RecordSpec<I, R>,
    private readonly maxClientSideScan: number,
  ) {
    this.#kind = `${context.name}:${recordSpec.schema.typeName}`;
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
      data[`${columnPrefix}${name}`] = providerValue(value, `Datastore record column "${name}"`);
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
          return [column, localValue(value, entity[`${columnTypePrefix}${column}`])];
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

/** Private initial handle for the Datastore adapter. */
export class DatastoreRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  readonly #codec: FlatEntityCodec<I, R>;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    readonly client: Datastore,
    maxClientSideScan: number,
  ) {
    super(context, recordSpec);
    this.#codec = new FlatEntityCodec(context, recordSpec, maxClientSideScan);
  }

  protected async deleteRecord(id: I): Promise<boolean> {
    const key = this.#codec.key(this.client, id);
    const entity = firstEntity(await this.client.get(key, wrappedReadOptions));

    if (entity === undefined) {
      return false;
    }

    await this.client.delete(key);
    return true;
  }

  protected async queryRecordEntries(
    _query: RecordQuery<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const query = this.#codec.createQuery(this.client);
    const providerLimit = this.#codec.queryLimit();
    translateQuery(
      query,
      _query,
      (id) => this.#codec.key(this.client, id),
      (column) => this.#codec.columnProperty(column),
    );
    query.limit(providerLimit);
    const entities = queryEntities(await this.client.runQuery(query, wrappedReadOptions));
    if (entities.length >= providerLimit) {
      throw new DatastoreQueryLimitError(providerLimit - 1);
    }
    const entries = entities.map((entity) => ({
      id: this.#codec.id(entity),
      record: this.#codec.decode(entity),
      columns: this.#codec.columns(entity),
    }));

    return applyQuery(entries, _query);
  }

  protected async readRecord(id: I): Promise<R | undefined> {
    const entity = firstEntity(
      await this.client.get(this.#codec.key(this.client, id), wrappedReadOptions),
    );

    return entity === undefined ? undefined : this.#codec.decode(entity);
  }

  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < maxCasAttempts; attempt += 1) {
      try {
        return await this.attemptCompareAndSet(id, expected, next);
      } catch (error) {
        if (attempt + 1 < maxCasAttempts && isRetriableTransactionConflict(error)) {
          await waitBeforeCasRetry(attempt);
          continue;
        }
        throw redactTransactionError(error);
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
      const entity = firstEntity(await transaction.get(key, wrappedReadOptions));
      const expectedPayload =
        expected === undefined
          ? undefined
          : this.#codec.encode(expected.record, expected.columns, expected.id)[payloadProperty];
      if (
        entity === undefined
          ? expected !== undefined
          : !payloadsEqual(entity[payloadProperty], expectedPayload)
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

/** Raised when a query would exceed the adapter's configured finite client-side scan budget. */
export class DatastoreQueryLimitError extends Error {
  constructor(readonly maxClientSideScan: number) {
    super(`Datastore query exceeded the client-side scan limit of ${String(maxClientSideScan)}.`);
    this.name = "DatastoreQueryLimitError";
  }
}

function isQueryableValue(value: unknown): value is QueryableValue {
  if (typeof value === "bigint") {
    return value >= -(1n << 63n) && value <= (1n << 63n) - 1n;
  }
  if (typeof value === "number") return Number.isFinite(value);
  return value === null || ["string", "boolean"].includes(typeof value);
}

function providerValue(value: unknown, label: string): unknown {
  if (typeof value === "bigint") {
    if (!isQueryableValue(value)) {
      throw new Error(`${label} must be an exact signed 64-bit integer.`);
    }
    return Datastore.int(value.toString());
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
    return Datastore.double(value);
  }
  if (!isQueryableValue(value)) throw new Error(`${label} has an unsupported value.`);
  return value;
}

function localValue(value: unknown, type: unknown): unknown {
  if (type === "bigint") {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "object" && value !== null && Datastore.isInt(value)) {
      return BigInt(value.value);
    }
    throw new Error("Datastore entity has an invalid bigint record column.");
  }
  if (typeof value === "object" && value !== null && Datastore.isInt(value)) {
    const integer = Number(value.value);
    return Number.isSafeInteger(integer) ? integer : BigInt(value.value);
  }
  return value;
}

interface QueriedEntry<I, R extends Message> extends RecordEntry<I, R> {
  readonly columns: ReadonlyMap<string, unknown>;
}

function translateQuery<I>(
  query: ReturnType<Datastore["createQuery"]>,
  recordQuery: RecordQuery<I>,
  keyFor: (id: I) => ReturnType<Datastore["key"]>,
  columnProperty: (column: string) => string,
): void {
  if (recordQuery.ids !== undefined && recordQuery.ids.length > 0) {
    query.filter(
      "__key__",
      recordQuery.ids.length === 1 ? "=" : "IN",
      recordQuery.ids.length === 1 ? keyFor(recordQuery.ids[0] as I) : recordQuery.ids.map(keyFor),
    );
  }
  for (const filter of recordQuery.filters ?? []) {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const providerValues =
      filter.column === "id"
        ? values.map((value) => keyFor(value as I))
        : values.map((value) => providerValue(value, `Datastore query filter "${filter.column}"`));
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
  query.order("__key__");
}

function applyQuery<I, R extends Message>(
  entries: readonly QueriedEntry<I, R>[],
  query: RecordQuery<I>,
): readonly RecordEntry<I, R>[] {
  const matching = entries.filter((entry) => matches(entry, query));
  const orders = query.sort ?? [];
  const sorted = [...matching].sort((left, right) => compareEntries(left, right, orders));
  const continuation = query.after;
  const continued =
    continuation === undefined
      ? sorted
      : sorted.filter((entry) => compareToContinuation(entry, orders, continuation) > 0);
  const start = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : start + query.limit;

  return continued.slice(start, end).map(({ id, record }) => ({ id, record }));
}

function matches<I, R extends Message>(entry: QueriedEntry<I, R>, query: RecordQuery<I>): boolean {
  return (
    (query.ids === undefined ||
      query.ids.length === 0 ||
      query.ids.some((id) => equalValues(id, entry.id))) &&
    (query.filters ?? []).every((filter) => {
      const actual = filter.column === "id" ? entry.id : entry.columns.get(filter.column);
      const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
      return expected.some((value) => equalValues(value, actual));
    })
  );
}

function compareEntries<I, R extends Message>(
  left: QueriedEntry<I, R>,
  right: QueriedEntry<I, R>,
  orders: readonly NonNullable<RecordQuery<I>["sort"]>[number][],
): number {
  for (const order of orders) {
    const comparison = compareValues(valueFor(left, order.field), valueFor(right, order.field));
    if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
  }
  return compareValues(left.id, right.id);
}

function compareToContinuation<I, R extends Message>(
  entry: QueriedEntry<I, R>,
  orders: readonly NonNullable<RecordQuery<I>["sort"]>[number][],
  after: NonNullable<RecordQuery<I>["after"]>,
): number {
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    if (order === undefined) throw new Error("Record query continuation sort order is invalid.");
    const comparison = compareValues(valueFor(entry, order.field), after.values[index]?.value);
    if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
  }
  return compareValues(entry.id, after.id);
}

function valueFor<I, R extends Message>(entry: QueriedEntry<I, R>, field: string): unknown {
  return field === "id" ? entry.id : entry.columns.get(field);
}

function equalValues(left: unknown, right: unknown): boolean {
  return CanonicalValue.equal(left, right);
}

function compareValues(left: unknown, right: unknown): number {
  return CanonicalValue.compare(left, right);
}

function payloadsEqual(left: unknown, right: unknown): boolean {
  if (
    !(left instanceof Uint8Array) ||
    !(right instanceof Uint8Array) ||
    left.byteLength !== right.byteLength
  ) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function redactTransactionError(error: unknown): Error {
  if (error instanceof Error && !/(credential|payload|secret)/i.test(error.message)) {
    return error;
  }

  return new Error("Datastore transaction failed.");
}

function isRetriableTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Error) || /(credential|payload|secret)/i.test(error.message)) {
    return false;
  }

  return Reflect.get(error, "code") === 10;
}

async function waitBeforeCasRetry(attempt: number): Promise<void> {
  const exponentialDelay = casRetryDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * exponentialDelay);

  await new Promise<void>((resolve) => setTimeout(resolve, exponentialDelay + jitter));
}

function firstEntity(response: unknown): Record<string | symbol, unknown> | undefined {
  if (!Array.isArray(response)) {
    throw new Error("Datastore returned an invalid entity response.");
  }

  const entity = (response as unknown[])[0];
  return entity === undefined ? undefined : entityRecord(entity);
}

function queryEntities(response: unknown): readonly Record<string | symbol, unknown>[] {
  if (!Array.isArray(response) || !Array.isArray(response[0])) {
    throw new Error("Datastore returned an invalid query response.");
  }

  return (response[0] as unknown[]).map(entityRecord);
}

function entityRecord(value: unknown): Record<string | symbol, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("Datastore returned an invalid entity response.");
  }

  return value as Record<string | symbol, unknown>;
}
