import type { Message } from "@bufbuild/protobuf";

import type { RecordFilter, RecordOrder, RecordQuery } from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import { readPath, valueCompare, valueKey } from "../record/record-value.js";

interface StoredRecord<I, R extends Message> {
  readonly columns: ReadonlyMap<string, unknown>;
  readonly id: I;
  readonly record: R;
}

/** Record slice owned by one tenant of an in-memory record storage. */
export class TenantRecords<I, R extends Message> {
  readonly #records = new Map<string, StoredRecord<I, R>>();

  delete(id: I): boolean {
    return this.#records.delete(valueKey(id));
  }

  query(spec: RecordSpec<I, R>, query: RecordQuery<I>): readonly R[] {
    const records = [...this.#records.values()].filter((entry) => matches(spec, entry, query));
    const sorted = records.sort((left, right) => compareEntries(left, right, query.sort ?? []));

    return applyLimit(sorted, query.limit).map((entry) => entry.record);
  }

  read(id: I): R | undefined {
    return this.#records.get(valueKey(id))?.record;
  }

  write(spec: RecordSpec<I, R>, record: R): void {
    const id = spec.idValueIn(record);
    const key = valueKey(id);

    this.#records.set(key, {
      id: spec.cloneId(id),
      record,
      columns: spec.valuesIn(record),
    });
  }
}

function applyLimit<I, R extends Message>(
  records: readonly StoredRecord<I, R>[],
  limit: number | undefined,
): readonly StoredRecord<I, R>[] {
  return limit === undefined ? records : records.slice(0, limit);
}

function compareEntries<I, R extends Message>(
  left: StoredRecord<I, R>,
  right: StoredRecord<I, R>,
  orders: readonly RecordOrder[],
): number {
  for (const order of orders) {
    const comparison = valueCompare(
      resolveValue(left, order.field),
      resolveValue(right, order.field),
    );

    if (comparison !== 0) {
      return order.direction === "desc" ? comparison * -1 : comparison;
    }
  }

  return 0;
}

function matches<I, R extends Message>(
  spec: RecordSpec<I, R>,
  entry: StoredRecord<I, R>,
  query: RecordQuery<I>,
): boolean {
  return matchesIds(spec, entry, query.ids) && matchesFilters(entry, query.filters);
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

    return expected.some((value) => valueKey(actual) === valueKey(value));
  });
}

function matchesIds<I, R extends Message>(
  spec: RecordSpec<I, R>,
  entry: StoredRecord<I, R>,
  ids: readonly I[] | undefined,
): boolean {
  if (ids === undefined || ids.length === 0) {
    return true;
  }

  return ids.some((id) => valueKey(spec.cloneId(id)) === valueKey(entry.id));
}

function resolveValue<I, R extends Message>(entry: StoredRecord<I, R>, field: string): unknown {
  if (field === "id") {
    return entry.id;
  }

  if (entry.columns.has(field)) {
    return entry.columns.get(field);
  }

  return readPath(entry.record, field);
}
