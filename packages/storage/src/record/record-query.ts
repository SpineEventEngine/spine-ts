/** Deterministic record query by IDs, columns, sorting, limits, and masks. */
export interface RecordQuery<I> extends RecordReadOptions {
  /** Exact identifier filter. */
  readonly ids?: readonly I[];
  /** Exact column filters. */
  readonly filters?: readonly RecordFilter[];
  /** Deterministic sort order. */
  readonly sort?: readonly RecordOrder[];
  /** Positive limit applied after sorting. */
  readonly limit?: number;
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

/** Equality filter against one stored column or the `id` field. */
export interface RecordFilter {
  /** Stored column name or `id`. */
  readonly column: string;
  /** One accepted value or a small accepted set. */
  readonly value: unknown;
}
