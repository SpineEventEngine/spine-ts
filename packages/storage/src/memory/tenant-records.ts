import type { Message } from "@bufbuild/protobuf";

import type { RecordFilter, RecordOrder, RecordQuery } from "../record/record-query.js";
import type { RecordEntry, RecordSpec } from "../record/record-spec.js";

/** Record slice owned by one tenant of an in-memory record storage. */
export class TenantRecords<I, R extends Message> {
  readonly #records = new Map<string, RecordEntry<I, R>>();

  delete(id: I): boolean {
    return this.#records.delete(StoredValues.key(id));
  }

  query(spec: RecordSpec<I, R>, query: RecordQuery<I>): readonly R[] {
    const records = [...this.#records.values()].filter((entry) => matches(spec, entry, query));
    const sorted = records.sort((left, right) => compareEntries(left, right, query.sort ?? []));

    return applyLimit(sorted, query.limit).map((entry) => entry.record);
  }

  read(id: I): R | undefined {
    return this.#records.get(StoredValues.key(id))?.record;
  }

  write(record: RecordEntry<I, R>): void {
    this.#records.set(StoredValues.key(record.id), record);
  }

  writeAll(records: readonly RecordEntry<I, R>[]): void {
    for (const record of records) {
      this.write(record);
    }
  }
}

function applyLimit<I, R extends Message>(
  records: readonly RecordEntry<I, R>[],
  limit: number | undefined,
): readonly RecordEntry<I, R>[] {
  return limit === undefined ? records : records.slice(0, limit);
}

function compareEntries<I, R extends Message>(
  left: RecordEntry<I, R>,
  right: RecordEntry<I, R>,
  orders: readonly RecordOrder[],
): number {
  for (const order of orders) {
    const comparison = StoredValues.compare(
      resolveValue(left, order.field),
      resolveValue(right, order.field),
    );

    if (comparison !== 0) {
      return order.direction === "desc" ? comparison * -1 : comparison;
    }
  }

  return StoredValues.compare(left.id, right.id);
}

function matches<I, R extends Message>(
  spec: RecordSpec<I, R>,
  entry: RecordEntry<I, R>,
  query: RecordQuery<I>,
): boolean {
  return matchesIds(spec, entry, query.ids) && matchesFilters(entry, query.filters);
}

function matchesFilters<I, R extends Message>(
  entry: RecordEntry<I, R>,
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
  entry: RecordEntry<I, R>,
  ids: readonly I[] | undefined,
): boolean {
  if (ids === undefined || ids.length === 0) {
    return true;
  }

  return ids.some((id) => StoredValues.key(spec.cloneId(id)) === StoredValues.key(entry.id));
}

function resolveValue<I, R extends Message>(entry: RecordEntry<I, R>, field: string): unknown {
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
    return JSON.stringify(normalizeValue(value));
  },

  compare(left: unknown, right: unknown): number {
    const leftKey = this.key(left);
    const rightKey = this.key(right);

    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
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

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { bigint: value.toString() };
  }

  if (value instanceof Uint8Array) {
    return { bytes: [...value] };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = normalizeValue(Reflect.get(value, key));
      return result;
    }, {});
}
