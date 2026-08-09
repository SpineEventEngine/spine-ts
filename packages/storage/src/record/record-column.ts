import type { RecordColumnType } from "./column-type.js";

/**
 * Queryable column calculated from a stored record.
 */
export class RecordColumn<R extends object, V = unknown> {
  readonly #read: (record: R) => V;

  /**
   * Creates a named column reader.
   * @param name The stable column name.
   * @param type The generated Protobuf value type.
   * @param read The record value reader.
   */
  constructor(
    readonly name: string,
    readonly type: RecordColumnType<V>,
    read: (record: R) => V,
  ) {
    this.#read = read;
  }

  /**
   * Reads the stored column value from a record snapshot.
   * @param record The record snapshot.
   * @returns The column value.
   */
  valueIn(record: R): V {
    return this.#read(record);
  }
}
