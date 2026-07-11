import type { Message } from "@bufbuild/protobuf";

import type {
  RecordContinuation,
  RecordFilter,
  RecordOrder,
  RecordQuery,
} from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordEntry } from "../record/record-storage.js";

/** Record slice owned by one tenant of an in-memory record storage. */
export class TenantRecords<I, R extends Message> {
  readonly #records = new Map<string, StoredEntry<I, R>>();

  compareAndSet(
    id: I,
    expected: StoredRecord<I, R> | undefined,
    next: StoredRecord<I, R> | undefined,
  ): boolean {
    const key = StoredValues.key(id);
    const current = this.#records.get(key)?.stored;

    if (!recordsEqual(current, expected)) {
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

  delete(id: I): boolean {
    return this.#records.delete(StoredValues.key(id));
  }

  queryEntries(spec: RecordSpec<I, R>, query: RecordQuery<I>): readonly RecordEntry<I, R>[] {
    const records = [...this.#records.values()].filter((entry) => matches(spec, entry, query));
    const sorted = records.sort((left, right) => compareEntries(left, right, query.sort ?? []));
    const continued = continueAfter(sorted, query.sort ?? [], query.after);

    return applyWindow(continued, query.offset, query.limit).map((entry) => ({
      id: entry.slotId,
      record: entry.stored.record,
    }));
  }

  read(id: I): R | undefined {
    return this.#records.get(StoredValues.key(id))?.stored.record;
  }

  write(record: StoredRecord<I, R>): void {
    this.#records.set(StoredValues.key(record.id), {
      slotId: record.id,
      stored: record,
    });
  }

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

function recordsEqual<I, R extends Message>(
  left: StoredRecord<I, R> | undefined,
  right: StoredRecord<I, R> | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  return StoredValues.key(left.record) === StoredValues.key(right.record);
}

function applyWindow<T>(
  records: readonly T[],
  offset: number | undefined,
  limit: number | undefined,
): readonly T[] {
  const start = offset ?? 0;
  const end = limit === undefined ? undefined : start + limit;

  return records.slice(start, end);
}

function continueAfter<I, R extends Message>(
  records: readonly StoredEntry<I, R>[],
  orders: readonly RecordOrder[],
  after: RecordContinuation<I> | undefined,
): readonly StoredEntry<I, R>[] {
  if (after === undefined) {
    return records;
  }

  return records.filter((entry) => compareToContinuation(entry, orders, after) > 0);
}

function compareEntries<I, R extends Message>(
  left: StoredEntry<I, R>,
  right: StoredEntry<I, R>,
  orders: readonly RecordOrder[],
): number {
  for (const order of orders) {
    const comparison = StoredValues.compare(
      resolveValue(left.stored, order.field),
      resolveValue(right.stored, order.field),
    );

    if (comparison !== 0) {
      return order.direction === "desc" ? comparison * -1 : comparison;
    }
  }

  return StoredValues.compare(left.slotId, right.slotId);
}

function compareToContinuation<I, R extends Message>(
  entry: StoredEntry<I, R>,
  orders: readonly RecordOrder[],
  after: RecordContinuation<I>,
): number {
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    if (order === undefined) {
      throw new Error("Record query continuation sort order is invalid.");
    }
    const comparison = StoredValues.compare(
      resolveValue(entry.stored, order.field),
      after.values[index]?.value,
    );

    if (comparison !== 0) {
      return order.direction === "desc" ? comparison * -1 : comparison;
    }
  }

  return StoredValues.compare(entry.slotId, after.id);
}

function matches<I, R extends Message>(
  spec: RecordSpec<I, R>,
  entry: StoredEntry<I, R>,
  query: RecordQuery<I>,
): boolean {
  return matchesIds(spec, entry, query.ids) && matchesFilters(entry.stored, query.filters);
}

function matchesFilters<I, R extends Message>(
  entry: StoredRecord<I, R>,
  filters: readonly RecordFilter[] | undefined,
): boolean {
  if (filters === undefined || filters.length === 0) {
    return true;
  }

  return filters.every((filter) => {
    const actual = resolveValue(entry, filter.column);
    const expected = Array.isArray(filter.value) ? filter.value : [filter.value];

    return expected.some((value) => StoredValues.key(actual) === StoredValues.key(value));
  });
}

function matchesIds<I, R extends Message>(
  spec: RecordSpec<I, R>,
  entry: StoredEntry<I, R>,
  ids: readonly I[] | undefined,
): boolean {
  if (ids === undefined || ids.length === 0) {
    return true;
  }

  return ids.some((id) => StoredValues.key(spec.cloneId(id)) === StoredValues.key(entry.slotId));
}

function resolveValue<I, R extends Message>(entry: StoredRecord<I, R>, field: string): unknown {
  if (field === "id") {
    return entry.id;
  }

  if (entry.columns.has(field)) {
    return entry.columns.get(field);
  }

  return StoredValues.readPath(entry.record, field);
}

const StoredValues = Object.freeze({
  key(value: unknown): string {
    return encodeNormalizedValue(normalizeValue(value));
  },

  compare(left: unknown, right: unknown): number {
    return compareNormalized(normalizeValue(left), normalizeValue(right));
  },

  readPath(value: unknown, path: string): unknown {
    let current = value;

    for (const segment of path.split(".").filter((part) => part.length > 0)) {
      if (typeof current !== "object" || current === null) {
        return undefined;
      }

      current = Reflect.get(current, segment);
    }

    return current;
  },
});

function compareNormalized(left: NormalizedValue, right: NormalizedValue): number {
  const leftKind = valueKind(left);
  const rightKind = valueKind(right);

  if (leftKind !== rightKind) {
    return compareText(leftKind, rightKind);
  }

  switch (leftKind) {
    case "undefined":
    case "null":
      return 0;
    case "boolean":
      return left === right ? 0 : left === false ? -1 : 1;
    case "number":
      return compareNumbers(left as number, right as number);
    case "string":
      return compareText(left as string, right as string);
    case "bigint":
      return compareBigInts(
        taggedPayload(left as NormalizedBigInt),
        taggedPayload(right as NormalizedBigInt),
      );
    case "bytes":
      return compareLists(
        taggedPayload(left as NormalizedBytes),
        taggedPayload(right as NormalizedBytes),
      );
    case "array":
      return compareLists(left as readonly NormalizedValue[], right as readonly NormalizedValue[]);
    case "object":
      return compareObjects(
        left as Readonly<Record<string, NormalizedValue>>,
        right as Readonly<Record<string, NormalizedValue>>,
      );
  }
}

function compareNumbers(left: number, right: number): number {
  if (Number.isNaN(left) || Number.isNaN(right)) {
    if (Number.isNaN(left) && Number.isNaN(right)) {
      return 0;
    }

    return Number.isNaN(left) ? 1 : -1;
  }

  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBigInts(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareLists<T>(left: readonly T[], right: readonly T[]): number {
  const sharedLength = Math.min(left.length, right.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const comparison =
      typeof left[index] === "number" && typeof right[index] === "number"
        ? compareNumbers(left[index] as number, right[index] as number)
        : compareNormalized(left[index] as NormalizedValue, right[index] as NormalizedValue);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return compareNumbers(left.length, right.length);
}

function compareObjects(
  left: Readonly<Record<string, NormalizedValue>>,
  right: Readonly<Record<string, NormalizedValue>>,
): number {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const keyComparison = compareLists(leftKeys, rightKeys);

  if (keyComparison !== 0) {
    return keyComparison;
  }

  for (const key of leftKeys) {
    const comparison = compareNormalized(left[key], right[key]);

    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeValue(value: unknown): NormalizedValue {
  if (typeof value === "bigint") {
    return taggedNormalizedValue("bigint", value.toString());
  }

  if (value instanceof Uint8Array) {
    return taggedNormalizedValue("bytes", [...value]);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "object") {
    if (
      value === undefined ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
    ) {
      return value;
    }

    return undefined;
  }

  return Object.keys(value)
    .sort()
    .reduce<NormalizedObject>((result, key) => {
      Object.defineProperty(result, key, {
        value: normalizeValue(Reflect.get(value, key)),
        enumerable: true,
      });
      return result;
    }, emptyNormalizedObject());
}

function encodeNormalizedValue(value: NormalizedValue): string {
  return JSON.stringify(toEncodedValue(value));
}

function toEncodedValue(value: NormalizedValue): EncodedValue {
  const kind = valueKind(value);

  switch (kind) {
    case "undefined":
      return ["undefined"];
    case "null":
      return ["null"];
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error("Normalized boolean value has an unexpected type.");
      }
      return ["boolean", value];
    case "number":
      if (typeof value !== "number") {
        throw new Error("Normalized number value has an unexpected type.");
      }
      return ["number", String(value)];
    case "string":
      if (typeof value !== "string") {
        throw new Error("Normalized string value has an unexpected type.");
      }
      return ["string", value];
    case "bigint":
      return ["bigint", taggedPayload(value as NormalizedBigInt)];
    case "bytes":
      return ["bytes", taggedPayload(value as NormalizedBytes)];
    case "array":
      return [
        "array",
        ...(value as readonly NormalizedValue[]).map((entry) => toEncodedValue(entry)),
      ];
    case "object":
      return [
        "object",
        ...Object.keys(value as NormalizedObject).map((key) => [
          key,
          toEncodedValue((value as NormalizedObject)[key]),
        ]),
      ];
  }
}

function valueKind(value: NormalizedValue): ValueKind {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  const taggedKind = normalizedTag(value);
  if (taggedKind !== undefined) {
    return taggedKind;
  }

  return "object";
}

function taggedNormalizedValue<K extends TaggedValueKind, P>(
  kind: K,
  payload: P,
): NormalizedTaggedValue<K, P> {
  const tagged = Object.create(null) as NormalizedTaggedValue<K, P>;
  Object.defineProperties(tagged, {
    [normalizedKind]: { value: kind },
    [normalizedPayload]: { value: payload },
  });

  return Object.freeze(tagged);
}

function normalizedTag(value: object): TaggedValueKind | undefined {
  const tag = (value as Partial<NormalizedTaggedValue<TaggedValueKind, unknown>>)[normalizedKind];

  return tag === "bigint" || tag === "bytes" ? tag : undefined;
}

function emptyNormalizedObject(): NormalizedObject {
  return Object.create(null) as NormalizedObject;
}

function taggedPayload<P>(value: NormalizedTaggedValue<TaggedValueKind, P>): P {
  return value[normalizedPayload];
}

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
