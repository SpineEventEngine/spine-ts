/** Deterministic record query by IDs, columns, sorting, continuations, offsets, limits, and masks. */
export interface RecordQuery<I> extends RecordReadOptions {
  /** Exact identifier filter. */
  readonly ids?: readonly I[];
  /** Exact column filters. */
  readonly filters?: readonly RecordFilter[];
  /** Deterministic sort order. */
  readonly sort?: readonly RecordOrder[];
  /** Stable ordered row key after which the query should continue. */
  readonly after?: RecordContinuation<I>;
  /** Positive limit applied after sorting. */
  readonly limit?: number;
  /** Non-negative row offset applied after sorting and before the limit. */
  readonly offset?: number;
}

export const RecordQuery: Readonly<{
  validate<I>(query: RecordQuery<I>): void;
}> = Object.freeze({
  /** Validate a record query before execution. */
  validate<I>(query: RecordQuery<I>): void {
    if (
      query.limit !== undefined &&
      (!Number.isInteger(query.limit) || !Number.isFinite(query.limit) || query.limit <= 0)
    ) {
      throw new Error("Record query limit must be positive.");
    }
    if (
      query.offset !== undefined &&
      (!Number.isInteger(query.offset) || !Number.isFinite(query.offset) || query.offset < 0)
    ) {
      throw new Error("Record query offset must be non-negative.");
    }
    if (query.after !== undefined) {
      const sort = query.sort ?? [];
      if (query.after.values.length !== sort.length) {
        throw new Error("Record query continuation must match the sort order.");
      }
      for (let index = 0; index < sort.length; index += 1) {
        if (query.after.values[index]?.field !== sort[index]?.field) {
          throw new Error("Record query continuation must match the sort order.");
        }
      }
    }
  },
});

/** Read-time options for one record fetch. */
export interface RecordReadOptions {
  /** Optional simple mask applied to the cloned result. */
  readonly mask?: import("./record-mask.js").RecordMask;
}

/** Query sort order against one stored column, `id`, or a dotted record path. */
export interface RecordOrder {
  /** Stored column name, `id`, or a dotted record path. */
  readonly field: string;
  /** Sort direction, ascending by default. */
  readonly direction?: "asc" | "desc";
}

/**
 * Stable ordered row key used to continue a sorted query after one row.
 *
 * `values` must name the same fields, in the same order, as `RecordQuery.sort`.
 * `id` is the actual storage slot identifier for the row and breaks any
 * remaining ties.
 */
export interface RecordContinuation<I> {
  /** Ordered field values captured from the last row of the previous page. */
  readonly values: readonly RecordContinuationValue[];
  /** Actual storage slot identifier captured from the last row of the previous page. */
  readonly id: I;
}

/** One captured sort-field value in a record continuation. */
export interface RecordContinuationValue {
  /** Sort field this value was captured from. */
  readonly field: string;
  /** Captured value for the sort field. */
  readonly value: unknown;
}

/** Equality filter against one stored column or the `id` field. */
export interface RecordFilter {
  /** Stored column name or `id`. */
  readonly column: string;
  /** One accepted value or a small accepted set. */
  readonly value: unknown;
}
