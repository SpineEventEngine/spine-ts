import type { Message } from "@bufbuild/protobuf";

import type {
  RecordContinuation,
  RecordFilter,
  RecordOrder,
  RecordQuery,
} from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordEntry } from "../record/record-storage.js";

/**
 * Record slice owned by one tenant of an in-memory record storage.
 */
export class TenantRecords<I, R extends Message> {
  readonly #records = new Map<string, StoredEntry<I, R>>();

  /**
   * Compares and replaces an expected materialized record in this tenant slice.
   * @param id Identifies the storage slot to compare and replace.
   * @param expected Specifies the materialized record required at the slot.
   * @param next Specifies the replacement record, or removes the slot when absent.
   * @returns Whether the expected record matched and the mutation was applied.
   */
  compareAndSet(
    id: I,
    expected: StoredRecord<I, R> | undefined,
    next: StoredRecord<I, R> | undefined,
  ): boolean {
    const key = StoredValues.key(id);
    const current = this.#records.get(key)?.stored;

    if (!StoredRecords.equal(current, expected)) {
      return false;
    }

    if (next === undefined) {
      this.#records.delete(key);
      return true;
    }

    this.#records.set(key, {
      slotId: id,
      stored: next,
    });
    return true;
  }

  /**
   * Removes one storage slot from this tenant slice.
   * @param id Identifies the storage slot to remove.
   * @returns Whether a record occupied the slot.
   */
  delete(id: I): boolean {
    return this.#records.delete(StoredValues.key(id));
  }

  /**
   * Returns materialized records matching a tenant-scoped query.
   * @param spec Supplies record identity cloning and materialized columns.
   * @param query Specifies filters, ordering, continuation, and windowing.
   * @returns The matching logical record entries in query order.
   */
  queryEntries(spec: RecordSpec<I, R>, query: RecordQuery<I>): readonly RecordEntry<I, R>[] {
    return TenantRecordQuery.entries(this.#records.values(), spec, query);
  }

  /**
   * Reads one record from this tenant slice.
   * @param id Identifies the storage slot to read.
   * @returns The stored record, or undefined when the slot is empty.
   */
  read(id: I): R | undefined {
    return this.#records.get(StoredValues.key(id))?.stored.record;
  }

  /**
   * Stores one materialized record in this tenant slice.
   * @param record Supplies the materialized record and storage identity.
   */
  write(record: StoredRecord<I, R>): void {
    this.#records.set(StoredValues.key(record.id), {
      slotId: record.id,
      stored: record,
    });
  }

  /**
   * Stores all materialized records in this tenant slice.
   * @param records Supplies the materialized records to store.
   */
  writeAll(records: readonly StoredRecord<I, R>[]): void {
    for (const record of records) {
      this.write(record);
    }
  }
}

type StoredRecord<I, R extends Message> = ReturnType<RecordSpec<I, R>["materialize"]>;

interface StoredEntry<I, R extends Message> {
  readonly slotId: I;
  readonly stored: StoredRecord<I, R>;
}

/**
 * Compares materialized records held within one tenant slice.
 */
const StoredRecords = {
  // prettier-ignore

  /**
   * Determines whether two materialized records represent the same stored value.
   */
  equal<I, R extends Message>(
    left: StoredRecord<I, R> | undefined,
    right: StoredRecord<I, R> | undefined,
  ): boolean {
    if (left === undefined || right === undefined) return left === right;
    return StoredValues.key(left.record) === StoredValues.key(right.record);
  },
};

/**
 * Filters, orders, continues, and windows records for a tenant query.
 */
const TenantRecordQuery = {
  // prettier-ignore

  /**
   * Produces logical entries for one tenant-scoped query.
   */
  entries<I, R extends Message>(
    entries: Iterable<StoredEntry<I, R>>,
    spec: RecordSpec<I, R>,
    query: RecordQuery<I>,
  ): readonly RecordEntry<I, R>[] {
    const matching = [...entries].filter((entry) => TenantRecordQuery.matches(spec, entry, query));
    const sorted = matching.sort((left, right) =>
      TenantRecordQuery.compareEntries(left, right, query.sort ?? []),
    );
    const continued = TenantRecordQuery.continueAfter(sorted, query.sort ?? [], query.after);
    return TenantRecordQuery.applyWindow(continued, query.offset, query.limit).map((entry) => ({
      id: entry.slotId,
      record: entry.stored.record,
    }));
  },

  /**
   * Applies offset and limit after filtering, ordering, and continuation.
   */
  applyWindow<T>(
    records: readonly T[],
    offset: number | undefined,
    limit: number | undefined,
  ): readonly T[] {
    const start = offset ?? 0;
    return records.slice(start, limit === undefined ? undefined : start + limit);
  },

  /**
   * Removes entries at or before a keyset continuation.
   */
  continueAfter<I, R extends Message>(
    records: readonly StoredEntry<I, R>[],
    orders: readonly RecordOrder[],
    after: RecordContinuation<I> | undefined,
  ): readonly StoredEntry<I, R>[] {
    return after === undefined
      ? records
      : records.filter(
          (entry) => TenantRecordQuery.compareToContinuation(entry, orders, after) > 0,
        );
  },

  /**
   * Orders entries by requested fields and storage-slot identity.
   */
  compareEntries<I, R extends Message>(
    left: StoredEntry<I, R>,
    right: StoredEntry<I, R>,
    orders: readonly RecordOrder[],
  ): number {
    for (const order of orders) {
      const comparison = StoredValues.compare(
        TenantRecordQuery.resolveValue(left.stored, order.field),
        TenantRecordQuery.resolveValue(right.stored, order.field),
      );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compare(left.slotId, right.slotId);
  },

  /**
   * Orders an entry relative to one keyset continuation.
   */
  compareToContinuation<I, R extends Message>(
    entry: StoredEntry<I, R>,
    orders: readonly RecordOrder[],
    after: RecordContinuation<I>,
  ): number {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (order === undefined) throw new Error("Record query continuation sort order is invalid.");
      const comparison = StoredValues.compare(
        TenantRecordQuery.resolveValue(entry.stored, order.field),
        after.values[index]?.value,
      );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compare(entry.slotId, after.id);
  },

  /**
   * Matches one entry against ID and column filters.
   */
  matches<I, R extends Message>(
    spec: RecordSpec<I, R>,
    entry: StoredEntry<I, R>,
    query: RecordQuery<I>,
  ): boolean {
    return (
      TenantRecordQuery.matchesIds(spec, entry, query.ids) &&
      TenantRecordQuery.matchesFilters(entry.stored, query.filters)
    );
  },

  /**
   * Matches materialized values against all requested column filters.
   */
  matchesFilters<I, R extends Message>(
    entry: StoredRecord<I, R>,
    filters: readonly RecordFilter[] | undefined,
  ): boolean {
    if (filters === undefined || filters.length === 0) return true;
    return filters.every((filter) => {
      const actual = TenantRecordQuery.resolveValue(entry, filter.column);
      const expected = Array.isArray(filter.value) ? filter.value : [filter.value];
      return expected.some((value) => StoredValues.key(actual) === StoredValues.key(value));
    });
  },

  /**
   * Matches an entry's storage slot against requested logical IDs.
   */
  matchesIds<I, R extends Message>(
    spec: RecordSpec<I, R>,
    entry: StoredEntry<I, R>,
    ids: readonly I[] | undefined,
  ): boolean {
    if (ids === undefined || ids.length === 0) return true;
    return ids.some((id) => StoredValues.key(spec.cloneId(id)) === StoredValues.key(entry.slotId));
  },

  /**
   * Resolves an ID, materialized column, or record path value.
   */
  resolveValue<I, R extends Message>(entry: StoredRecord<I, R>, field: string): unknown {
    if (field === "id") return entry.id;
    return entry.columns.has(field)
      ? entry.columns.get(field)
      : StoredValues.readPath(entry.record, field);
  },
};

/**
 * Produces canonical keys and deterministic comparisons for stored values.
 */
const StoredValues = {
  // prettier-ignore

  /**
   * Creates a canonical value key.
   */
  key(value: unknown): string {
    return StoredValues.encode(StoredValues.normalize(value));
  },

  /**
   * Compares values with the storage ordering rules.
   */
  compare(left: unknown, right: unknown): number {
    return StoredValues.compareNormalized(
      StoredValues.normalize(left),
      StoredValues.normalize(right),
    );
  },

  /**
   * Reads a dot-separated path from an object value.
   */
  readPath(value: unknown, path: string): unknown {
    let current = value;
    for (const segment of path.split(".").filter((part) => part.length > 0)) {
      if (typeof current !== "object" || current === null) return undefined;
      current = Reflect.get(current, segment);
    }
    return current;
  },

  /**
   * Compares normalized values of the same or distinct kinds.
   */
  compareNormalized(left: NormalizedValue, right: NormalizedValue): number {
    const leftKind = StoredValues.kind(left);
    const rightKind = StoredValues.kind(right);
    if (leftKind !== rightKind) return StoredValues.compareText(leftKind, rightKind);
    switch (leftKind) {
      case "undefined":
      case "null":
        return 0;
      case "boolean":
        return left === right ? 0 : left === false ? -1 : 1;
      case "number":
        return StoredValues.compareNumbers(left as number, right as number);
      case "string":
        return StoredValues.compareText(left as string, right as string);
      case "bigint":
        return StoredValues.compareBigInts(
          StoredValues.payload(left as NormalizedBigInt),
          StoredValues.payload(right as NormalizedBigInt),
        );
      case "bytes":
        return StoredValues.compareLists(
          StoredValues.payload(left as NormalizedBytes),
          StoredValues.payload(right as NormalizedBytes),
        );
      case "array":
        return StoredValues.compareLists(
          left as readonly NormalizedValue[],
          right as readonly NormalizedValue[],
        );
      case "object":
        return StoredValues.compareObjects(left as NormalizedObject, right as NormalizedObject);
    }
  },

  /**
   * Compares numbers while placing NaN after other numbers.
   */
  compareNumbers(left: number, right: number): number {
    if (Number.isNaN(left) || Number.isNaN(right))
      return Number.isNaN(left) && Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares encoded bigint payloads numerically.
   */
  compareBigInts(left: string, right: string): number {
    const l = BigInt(left);
    const r = BigInt(right);
    return l < r ? -1 : l > r ? 1 : 0;
  },

  /**
   * Compares lists lexicographically.
   */
  compareLists<T>(left: readonly T[], right: readonly T[]): number {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const comparison =
        typeof left[index] === "number" && typeof right[index] === "number"
          ? StoredValues.compareNumbers(left[index] as number, right[index] as number)
          : StoredValues.compareNormalized(
              left[index] as NormalizedValue,
              right[index] as NormalizedValue,
            );
      if (comparison !== 0) return comparison;
    }
    return StoredValues.compareNumbers(left.length, right.length);
  },

  /**
   * Compares normalized objects by keys and then values.
   */
  compareObjects(left: NormalizedObject, right: NormalizedObject): number {
    const leftKeys = Object.keys(left);
    const keyComparison = StoredValues.compareLists(leftKeys, Object.keys(right));
    if (keyComparison !== 0) return keyComparison;
    for (const key of leftKeys) {
      const comparison = StoredValues.compareNormalized(left[key], right[key]);
      if (comparison !== 0) return comparison;
    }
    return 0;
  },

  /**
   * Compares strings in code-unit order.
   */
  compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Normalizes a value for canonical storage comparison.
   */
  normalize(value: unknown): NormalizedValue {
    if (typeof value === "bigint") return StoredValues.tagged("bigint", value.toString());
    if (value instanceof Uint8Array) return StoredValues.tagged("bytes", [...value]);
    if (Array.isArray(value)) return value.map((entry) => StoredValues.normalize(entry));
    if (
      value === null ||
      value === undefined ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    )
      return value;
    if (typeof value !== "object") return undefined;
    return Object.keys(value)
      .sort()
      .reduce<NormalizedObject>((result, key) => {
        Object.defineProperty(result, key, {
          value: StoredValues.normalize(Reflect.get(value, key)),
          enumerable: true,
        });
        return result;
      }, StoredValues.emptyObject());
  },

  /**
   * Encodes a normalized value without type collisions.
   */
  encode(value: NormalizedValue): string {
    return JSON.stringify(StoredValues.encoded(value));
  },

  /**
   * Converts a normalized value to its tagged JSON representation.
   */
  encoded(value: NormalizedValue): EncodedValue {
    const kind = StoredValues.kind(value);
    switch (kind) {
      case "undefined":
        return ["undefined"];
      case "null":
        return ["null"];
      case "boolean":
        if (typeof value !== "boolean")
          throw new Error("Normalized boolean value has an unexpected type.");
        return ["boolean", value];
      case "number":
        if (typeof value !== "number")
          throw new Error("Normalized number value has an unexpected type.");
        return ["number", String(value)];
      case "string":
        if (typeof value !== "string")
          throw new Error("Normalized string value has an unexpected type.");
        return ["string", value];
      case "bigint":
        return ["bigint", StoredValues.payload(value as NormalizedBigInt)];
      case "bytes":
        return ["bytes", StoredValues.payload(value as NormalizedBytes)];
      case "array":
        return [
          "array",
          ...(value as readonly NormalizedValue[]).map((entry) => StoredValues.encoded(entry)),
        ];
      case "object":
        return [
          "object",
          ...Object.keys(value as NormalizedObject).map((key) => [
            key,
            StoredValues.encoded((value as NormalizedObject)[key]),
          ]),
        ];
    }
  },

  /**
   * Identifies a normalized value kind.
   */
  kind(value: NormalizedValue): ValueKind {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    if (Array.isArray(value)) return "array";
    const tag = StoredValues.tag(value);
    return tag ?? "object";
  },

  /**
   * Creates a frozen tagged normalized value.
   */
  tagged<K extends TaggedValueKind, P>(kind: K, payload: P): NormalizedTaggedValue<K, P> {
    const tagged = Object.create(null) as NormalizedTaggedValue<K, P>;
    Object.defineProperties(tagged, {
      [normalizedKind]: { value: kind },
      [normalizedPayload]: { value: payload },
    });
    return Object.freeze(tagged);
  },

  /**
   * Reads a recognized normalized tag.
   */
  tag(value: object): TaggedValueKind | undefined {
    const tag = (value as Partial<NormalizedTaggedValue<TaggedValueKind, unknown>>)[normalizedKind];
    return tag === "bigint" || tag === "bytes" ? tag : undefined;
  },

  /**
   * Creates an object with no prototype for normalized fields.
   */
  emptyObject(): NormalizedObject {
    return Object.create(null) as NormalizedObject;
  },

  /**
   * Reads a tagged normalized payload.
   */
  payload<P>(value: NormalizedTaggedValue<TaggedValueKind, P>): P {
    return value[normalizedPayload];
  },
};

type NormalizedValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | NormalizedBigInt
  | NormalizedBytes
  | readonly NormalizedValue[]
  | NormalizedObject;

interface NormalizedBigInt {
  readonly [normalizedKind]: "bigint";
  readonly [normalizedPayload]: string;
}

interface NormalizedBytes {
  readonly [normalizedKind]: "bytes";
  readonly [normalizedPayload]: readonly number[];
}

interface NormalizedObject {
  readonly [key: string]: NormalizedValue;
}

type ValueKind =
  "undefined" | "null" | "boolean" | "number" | "string" | "bigint" | "bytes" | "array" | "object";

type EncodedValue = readonly unknown[];

type TaggedValueKind = "bigint" | "bytes";

interface NormalizedTaggedValue<K extends TaggedValueKind, P> {
  readonly [normalizedKind]: K;
  readonly [normalizedPayload]: P;
}

const normalizedKind = Symbol("spine.storage.normalizedKind");
const normalizedPayload = Symbol("spine.storage.normalizedPayload");
