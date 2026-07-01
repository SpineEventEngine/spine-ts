/** Queryable column calculated from a stored record. */
export class RecordColumn<R extends object, V = unknown> {
  readonly #read: (record: R) => V;

  constructor(
    readonly name: string,
    read: (record: R) => V,
  ) {
    this.#read = read;
  }

  /** Read the stored column value from a record snapshot. */
  valueIn(record: R): V {
    return this.#read(record);
  }
}
