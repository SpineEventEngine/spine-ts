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

import type { Message } from "@bufbuild/protobuf";

import type {
  RecordContinuation,
  RecordFilter,
  RecordOrder,
  RecordQuery,
} from "../record/record-query.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordEntry } from "../record/record-storage.js";
import { CanonicalUtf8 } from "./canonical-utf8.js";

/**
 * Record slice for one tenant of an in-memory record storage.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
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

  /**
   * Captures one complete materialized slot for an Entity commit.
   *
   * @param id Identifies the affected slot.
   * @returns The slot key and its prior entry, including materialized columns.
   */
  capture(id: I): StoredSlot<I, R> {
    const key = StoredValues.key(id);
    return { key, entry: this.#records.get(key) };
  }

  /**
   * Applies or restores one prepared slot without recomputing its key.
   *
   * @param slot Supplies the prepared key and complete entry or prior absence.
   */
  apply(slot: StoredSlot<I, R>): void {
    if (slot.entry === undefined) this.#records.delete(slot.key);
    else this.#records.set(slot.key, slot.entry);
  }
}

/**
 * Describes one record after its storage columns are materialized.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 */
type StoredRecord<I, R extends Message> = ReturnType<RecordSpec<I, R>["materialize"]>;

/**
 * Stores one materialized record with its storage slot identity.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 */
interface StoredEntry<I, R extends Message> {
  readonly slotId: I;
  readonly stored: StoredRecord<I, R>;
}

/**
 * Holds comparison values prepared once for one bounded query.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 */
interface PreparedEntry<I, R extends Message> {
  readonly entry: StoredEntry<I, R>;
  readonly id: NormalizedValue;
  readonly values: readonly NormalizedValue[];
}

/**
 * Holds normalized continuation values for one bounded query.
 */
interface PreparedContinuation {
  readonly id: NormalizedValue;
  readonly values: readonly NormalizedValue[];
}

/**
 * Holds the canonical expected values for one query filter.
 */
interface PreparedFilter {
  readonly column: string;
  readonly keys: readonly string[];
}

/**
 * Captures one affected record slot for a prepared commit.
 *
 * @typeParam I Record identifier type.
 * @typeParam R Stored Protobuf message type.
 */
interface StoredSlot<I, R extends Message> {
  readonly key: string;
  readonly entry: StoredEntry<I, R> | undefined;
}

/**
 * Compares materialized records held within one tenant slice.
 */
const StoredRecords = {
  // prettier-ignore

  /**
   * Determines whether two materialized records represent the same stored value.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param left Supplies the first materialized record, when present.
   * @param right Supplies the second materialized record, when present.
   * @returns Whether both records have the same stored value.
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
   * Returns logical entries for one tenant-scoped query.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entries Supplies this tenant's stored entries.
   * @param spec Defines record identity and materialized columns.
   * @param query Specifies filters, ordering, continuation, and windowing.
   * @returns Matching logical record entries in query order.
   */
  entries<I, R extends Message>(
    entries: Iterable<StoredEntry<I, R>>,
    spec: RecordSpec<I, R>,
    query: RecordQuery<I>,
  ): readonly RecordEntry<I, R>[] {
    const bounded = TenantRecordQuery.selectBounded(entries, spec, query);
    if (bounded !== undefined) {
      return bounded.map((entry) => ({
        id: entry.slotId,
        record: entry.stored.record,
      }));
    }
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
   * Returns the finite ordered window without retaining every matching entry.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entries Supplies this tenant's stored entries.
   * @param spec Defines record identity and materialized columns.
   * @param query Specifies filters, ordering, continuation, and windowing.
   * @returns The selected window, or undefined when bounded selection does not apply.
   */
  selectBounded<I, R extends Message>(
    entries: Iterable<StoredEntry<I, R>>,
    spec: RecordSpec<I, R>,
    query: RecordQuery<I>,
  ): readonly StoredEntry<I, R>[] | undefined {
    const windowSize = TenantRecordQuery.boundedWindowSize(query.limit, query.offset);
    if (windowSize === undefined) return undefined;
    const offset = query.offset ?? 0;
    if (windowSize === 0) return [];

    const orders = query.sort ?? [];
    const selected: PreparedEntry<I, R>[] = [];
    const filters = TenantRecordQuery.prepareFilters(query.filters);
    const after =
      query.after === undefined ? undefined : TenantRecordQuery.prepareContinuation(query.after);
    for (const entry of entries) {
      if (
        !TenantRecordQuery.matchesIds(spec, entry, query.ids) ||
        !TenantRecordQuery.matchesPreparedFilters(entry.stored, filters)
      )
        continue;
      const prepared = TenantRecordQuery.prepareEntry(entry, orders);
      if (
        after !== undefined &&
        TenantRecordQuery.comparePreparedAfter(prepared, orders, after) <= 0
      )
        continue;
      TenantRecordQuery.insertSelected(selected, prepared, windowSize, orders);
    }
    return selected.slice(offset).map((candidate) => candidate.entry);
  },

  /**
   * Determines the finite selection capacity of one bounded query.
   * @param limit Maximum returned record count.
   * @param offset Number of leading matches to skip.
   * @returns Required capacity, or undefined for an unbounded query.
   */
  boundedWindowSize(limit: number | undefined, offset: number | undefined): number | undefined {
    if (limit === undefined || !Number.isFinite(limit)) return undefined;
    const start = offset ?? 0;
    if (!Number.isInteger(start) || !Number.isInteger(limit) || start < 0 || limit < 0)
      return undefined;
    return start + limit;
  },

  /**
   * Prepares expected filter values once for a bounded query.
   * @param filters Supplies the requested column filters.
   * @returns Canonical expected values for each filter.
   */
  prepareFilters(
    filters: readonly RecordFilter[] | undefined,
  ): readonly PreparedFilter[] | undefined {
    return filters?.map((filter) => ({
      column: filter.column,
      keys: (Array.isArray(filter.value) ? filter.value : [filter.value]).map((value) =>
        StoredValues.key(value),
      ),
    }));
  },

  /**
   * Matches materialized columns against filter keys prepared for this query.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the materialized record.
   * @param filters Supplies the prepared column filters, when present.
   * @returns Whether every filter matches the record.
   */
  matchesPreparedFilters<I, R extends Message>(
    entry: StoredRecord<I, R>,
    filters: readonly PreparedFilter[] | undefined,
  ): boolean {
    if (filters === undefined || filters.length === 0) return true;
    return filters.every((filter) =>
      filter.keys.includes(StoredValues.key(TenantRecordQuery.resolveValue(entry, filter.column))),
    );
  },

  /**
   * Normalizes an entry's identity and ordered fields once for this query.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the matching materialized record.
   * @param orders Specifies the requested sort fields.
   * @returns The prepared comparison values and original entry.
   */
  prepareEntry<I, R extends Message>(
    entry: StoredEntry<I, R>,
    orders: readonly RecordOrder[],
  ): PreparedEntry<I, R> {
    const id = StoredValues.normalize(entry.slotId);
    return {
      entry,
      id,
      values: orders.map((order) =>
        order.field === "id"
          ? id
          : StoredValues.normalize(TenantRecordQuery.resolveValue(entry.stored, order.field)),
      ),
    };
  },

  /**
   * Normalizes the requested keyset position once for this query.
   * @typeParam I Record identifier type.
   * @param after Supplies the keyset position.
   * @returns The prepared continuation values.
   */
  prepareContinuation<I>(after: RecordContinuation<I>): PreparedContinuation {
    return {
      id: StoredValues.normalize(after.id),
      values: after.values.map((value) => StoredValues.normalize(value.value)),
    };
  },

  /**
   * Compares prepared entries by requested fields and storage identity.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param left Supplies the first prepared entry.
   * @param right Supplies the second prepared entry.
   * @param orders Specifies the requested sort fields.
   * @returns A negative, zero, or positive comparison result.
   */
  comparePrepared<I, R extends Message>(
    left: PreparedEntry<I, R>,
    right: PreparedEntry<I, R>,
    orders: readonly RecordOrder[],
  ): number {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (order === undefined) throw new Error("Record query sort order is invalid.");
      const comparison =
        order.field === "id"
          ? StoredValues.compareIdentityNormalized(left.id, right.id)
          : StoredValues.compareNormalized(left.values[index], right.values[index]);
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compareIdentityNormalized(left.id, right.id);
  },

  /**
   * Compares one prepared entry to a normalized keyset continuation.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the prepared entry.
   * @param orders Specifies the requested sort fields.
   * @param after Supplies the prepared continuation.
   * @returns A negative, zero, or positive comparison result.
   */
  comparePreparedAfter<I, R extends Message>(
    entry: PreparedEntry<I, R>,
    orders: readonly RecordOrder[],
    after: PreparedContinuation,
  ): number {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (order === undefined) throw new Error("Record query continuation sort order is invalid.");
      const comparison =
        order.field === "id"
          ? StoredValues.compareIdentityNormalized(entry.id, after.values[index])
          : StoredValues.compareNormalized(entry.values[index], after.values[index]);
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compareIdentityNormalized(entry.id, after.id);
  },

  /**
   * Adds an entry to a bounded, ordered top window.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param selected Supplies the current prepared window to update.
   * @param entry Supplies the prepared candidate entry.
   * @param windowSize Sets the maximum number of entries to retain.
   * @param orders Specifies the requested sort order.
   */
  insertSelected<I, R extends Message>(
    selected: PreparedEntry<I, R>[],
    entry: PreparedEntry<I, R>,
    windowSize: number,
    orders: readonly RecordOrder[],
  ): void {
    const comparison = (candidate: PreparedEntry<I, R>): number =>
      TenantRecordQuery.comparePrepared(candidate, entry, orders);
    let low = 0;
    let high = selected.length;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      const candidate = selected[middle];
      if (candidate === undefined) throw new Error("Bounded record selection is sparse.");
      if (comparison(candidate) <= 0) low = middle + 1;
      else high = middle;
    }
    if (low === windowSize) return;
    selected.splice(low, 0, entry);
    if (selected.length > windowSize) selected.pop();
  },

  /**
   * Applies offset and limit after filtering, ordering, and continuation.
   * @typeParam T Record entry type.
   * @param records Supplies ordered matching records.
   * @param offset Sets the number of leading records to skip.
   * @param limit Sets the maximum number of records to return.
   * @returns The requested record window.
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
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param records Supplies ordered matching records.
   * @param orders Specifies the requested sort order.
   * @param after Supplies the continuation position, when present.
   * @returns Records after the continuation position.
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
   * Returns the comparison of entries by requested fields and storage-slot identity.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param left Supplies the first entry to compare.
   * @param right Supplies the second entry to compare.
   * @param orders Specifies the requested sort order.
   * @returns A negative, zero, or positive comparison result.
   */
  compareEntries<I, R extends Message>(
    left: StoredEntry<I, R>,
    right: StoredEntry<I, R>,
    orders: readonly RecordOrder[],
  ): number {
    for (const order of orders) {
      const comparison =
        order.field === "id"
          ? StoredValues.compareIdentity(left.slotId, right.slotId)
          : StoredValues.compare(
              TenantRecordQuery.resolveValue(left.stored, order.field),
              TenantRecordQuery.resolveValue(right.stored, order.field),
            );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compareIdentity(left.slotId, right.slotId);
  },

  /**
   * Returns the comparison of an entry with one keyset continuation.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the entry to compare.
   * @param orders Specifies the requested sort order.
   * @param after Supplies the continuation position.
   * @returns A negative, zero, or positive comparison result.
   */
  compareToContinuation<I, R extends Message>(
    entry: StoredEntry<I, R>,
    orders: readonly RecordOrder[],
    after: RecordContinuation<I>,
  ): number {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (order === undefined) throw new Error("Record query continuation sort order is invalid.");
      const comparison =
        order.field === "id"
          ? StoredValues.compareIdentity(entry.slotId, after.values[index]?.value)
          : StoredValues.compare(
              TenantRecordQuery.resolveValue(entry.stored, order.field),
              after.values[index]?.value,
            );
      if (comparison !== 0) return order.direction === "desc" ? comparison * -1 : comparison;
    }
    return StoredValues.compareIdentity(entry.slotId, after.id);
  },

  /**
   * Matches one entry against ID and column filters.
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param spec Defines record identity and materialized columns.
   * @param entry Supplies the candidate entry.
   * @param query Specifies ID and column filters.
   * @returns Whether the entry matches the query filters.
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
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the materialized record and columns.
   * @param filters Specifies column filters, when present.
   * @returns Whether every filter matches the entry.
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
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param spec Defines how record identifiers are copied.
   * @param entry Supplies the candidate entry.
   * @param ids Specifies requested identifiers, when present.
   * @returns Whether the entry matches a requested identifier.
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
   * @typeParam I Record identifier type.
   * @typeParam R Stored Protobuf message type.
   * @param entry Supplies the materialized record.
   * @param field Names the ID, column, or record path to read.
   * @returns The resolved field value.
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
   * @param value Supplies the value to encode.
   * @returns A canonical key for the value.
   */
  key(value: unknown): string {
    return StoredValues.encode(StoredValues.normalize(value));
  },

  /**
   * Compares values with the storage ordering rules.
   * @param left Supplies the first value.
   * @param right Supplies the second value.
   * @returns A negative, zero, or positive comparison result.
   */
  compare(left: unknown, right: unknown): number {
    return StoredValues.compareNormalized(
      StoredValues.normalize(left),
      StoredValues.normalize(right),
    );
  },

  /**
   * Compares storage slot identities with canonical UTF-8 text ordering.
   * @param left Supplies the first identity.
   * @param right Supplies the second identity.
   * @returns A negative, zero, or positive comparison result.
   */
  compareIdentity(left: unknown, right: unknown): number {
    return StoredValues.compareIdentityNormalized(
      StoredValues.normalize(left),
      StoredValues.normalize(right),
    );
  },

  /**
   * Reads a dot-separated path from an object value.
   * @param value Supplies the value to inspect.
   * @param path Names the dot-separated property path.
   * @returns The value at the path, or undefined when absent.
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
   * @param left Supplies the first normalized value.
   * @param right Supplies the second normalized value.
   * @returns A negative, zero, or positive comparison result.
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
   * Compares normalized storage identities, treating text as canonical UTF-8 bytes.
   * @param left Supplies the first normalized identity.
   * @param right Supplies the second normalized identity.
   * @returns A negative, zero, or positive comparison result.
   */
  compareIdentityNormalized(left: NormalizedValue, right: NormalizedValue): number {
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
        return CanonicalUtf8.compare(left as string, right as string);
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
        return StoredValues.compareIdentityLists(
          left as readonly NormalizedValue[],
          right as readonly NormalizedValue[],
        );
      case "object":
        return StoredValues.compareIdentityObjects(
          left as NormalizedObject,
          right as NormalizedObject,
        );
    }
  },

  /**
   * Compares numbers while placing NaN after other numbers.
   * @param left Supplies the first number.
   * @param right Supplies the second number.
   * @returns A negative, zero, or positive comparison result.
   */
  compareNumbers(left: number, right: number): number {
    if (Number.isNaN(left) || Number.isNaN(right))
      return Number.isNaN(left) && Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares encoded bigint payloads numerically.
   * @param left Supplies the first encoded bigint.
   * @param right Supplies the second encoded bigint.
   * @returns A negative, zero, or positive comparison result.
   */
  compareBigInts(left: string, right: string): number {
    const l = BigInt(left);
    const r = BigInt(right);
    return l < r ? -1 : l > r ? 1 : 0;
  },

  /**
   * Compares lists lexicographically.
   * @typeParam T List element type.
   * @param left Supplies the first list.
   * @param right Supplies the second list.
   * @returns A negative, zero, or positive comparison result.
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
   * @param left Supplies the first normalized object.
   * @param right Supplies the second normalized object.
   * @returns A negative, zero, or positive comparison result.
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
   * @param left Supplies the first string.
   * @param right Supplies the second string.
   * @returns A negative, zero, or positive comparison result.
   */
  compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
  },

  /**
   * Compares identity-value lists recursively.
   * @param left Supplies the first normalized identity list.
   * @param right Supplies the second normalized identity list.
   * @returns A negative, zero, or positive comparison result.
   */
  compareIdentityLists(
    left: readonly NormalizedValue[],
    right: readonly NormalizedValue[],
  ): number {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const comparison = StoredValues.compareIdentityNormalized(left[index], right[index]);
      if (comparison !== 0) return comparison;
    }
    return StoredValues.compareNumbers(left.length, right.length);
  },

  /**
   * Compares object-shaped identities by canonical keys and values.
   * @param left Supplies the first normalized identity object.
   * @param right Supplies the second normalized identity object.
   * @returns A negative, zero, or positive comparison result.
   */
  compareIdentityObjects(left: NormalizedObject, right: NormalizedObject): number {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    const keyComparison = StoredValues.compareIdentityLists(leftKeys, rightKeys);
    if (keyComparison !== 0) return keyComparison;
    for (const key of leftKeys) {
      const comparison = StoredValues.compareIdentityNormalized(left[key], right[key]);
      if (comparison !== 0) return comparison;
    }
    return 0;
  },

  /**
   * Normalizes a value for canonical storage comparison.
   * @param value Supplies the value to normalize.
   * @returns The normalized value representation.
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
   * @param value Supplies the normalized value.
   * @returns A canonical JSON string.
   */
  encode(value: NormalizedValue): string {
    return JSON.stringify(StoredValues.encoded(value));
  },

  /**
   * Converts a normalized value to its tagged JSON representation.
   * @param value Supplies the normalized value.
   * @returns The tagged JSON representation.
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
   * Returns the kind of a normalized value.
   * @param value Supplies the normalized value.
   * @returns The normalized value kind.
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
   * @typeParam K Tag kind.
   * @typeParam P Payload type.
   * @param kind Identifies the tag kind.
   * @param payload Supplies the tag payload.
   * @returns The frozen tagged value.
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
   * @param value Supplies the object to inspect.
   * @returns The recognized tag, or undefined for an ordinary object.
   */
  tag(value: object): TaggedValueKind | undefined {
    const tag = (value as Partial<NormalizedTaggedValue<TaggedValueKind, unknown>>)[normalizedKind];
    return tag === "bigint" || tag === "bytes" ? tag : undefined;
  },

  /**
   * Creates an object with no prototype for normalized fields.
   * @returns An empty object without a prototype.
   */
  emptyObject(): NormalizedObject {
    return Object.create(null) as NormalizedObject;
  },

  /**
   * Reads a tagged normalized payload.
   * @typeParam P Payload type.
   * @param value Supplies the tagged value.
   * @returns The tagged payload.
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

/**
 * Pairs a normalized value kind with its encoded payload.
 *
 * @typeParam K Normalized value kind.
 * @typeParam P Encoded payload type.
 */
interface NormalizedTaggedValue<K extends TaggedValueKind, P> {
  readonly [normalizedKind]: K;
  readonly [normalizedPayload]: P;
}

const normalizedKind = Symbol("spine.storage.normalizedKind");
const normalizedPayload = Symbol("spine.storage.normalizedPayload");
