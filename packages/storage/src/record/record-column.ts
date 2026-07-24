/** Queryable column calculated from a stored record. */
export class RecordColumn<R extends object, V = unknown> {
  readonly #read: (record: R) => V;

  constructor(
    readonly name: string,
    read: (record: R) => V,
    /** Stable provider-visible value-kind descriptor for layout compatibility. */
    readonly valueType: string,
  ) {
    if (valueType.trim().length === 0) {
      throw new Error("Storage record column requires a non-blank value type descriptor.");
    }
    this.#read = read;
  }

  /** Read the stored column value from a record snapshot. */
  valueIn(record: R): V {
    return this.#read(record);
  }
}
