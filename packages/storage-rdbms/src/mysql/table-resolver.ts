import type { MysqlResolvedTable } from "./table-spec.js";

/**
 * Resolves stable MySQL-safe table names for record families.
 */
export class MysqlTableResolver {
  readonly #names = new Map<string, string>();
  readonly #resolved = new Map<string, string>();

  /**
   * Sets the ungrouped table name for a record type.
   *
   * @param recordType Names the record type.
   * @param name Specifies the physical table name.
   */
  setRecordName(recordType: string, name: string): void {
    this.set(`record:${recordType}`, name);
  }

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Names the source type.
   * @param recordType Names the record type.
   * @param name Specifies the physical table name.
   */
  setGroupName(sourceType: string, recordType: string, name: string): void {
    this.set(`group:${sourceType}:${recordType}`, name);
  }

  /**
   * Resolves the table layout for a record family.
   *
   * @param sourceType Names the source type.
   * @param group Names the optional storage group.
   * @param name Supplies an explicit table name.
   * @param recordType Names the grouped record type.
   * @returns Returns the resolved table layout.
   */
  resolve(
    sourceType: string,
    group: string | undefined,
    name?: string,
    recordType?: string,
  ): MysqlResolvedTable {
    const registered =
      group === undefined
        ? this.#names.get(`record:${sourceType}`)
        : (this.#names.get(`group:${sourceType}:${recordType ?? ""}`) ??
          this.#names.get(`record:${recordType ?? ""}`));
    const readable =
      name ??
      registered ??
      (group === undefined
        ? sourceType.replaceAll(".", "_")
        : `${group.replaceAll(".", "_")}_${(recordType ?? sourceType).slice(
            (recordType ?? sourceType).lastIndexOf(".") + 1,
          )}`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(readable) || Buffer.byteLength(readable) > 64) {
      throw new Error(`MySQL table name is invalid: ${readable}`);
    }
    const identity =
      group === undefined && this.#names.get(`record:${sourceType}`) !== undefined
        ? `record:${sourceType}`
        : group !== undefined &&
            this.#names.get(`group:${sourceType}:${recordType ?? ""}`) === undefined &&
            this.#names.get(`record:${recordType ?? ""}`) !== undefined
          ? `record:${recordType ?? sourceType}`
          : group === undefined
            ? sourceType
            : `${sourceType}\u0000${recordType ?? sourceType}\u0000${group}`;
    const previous = this.#resolved.get(readable);
    if (previous !== undefined && previous !== identity)
      throw new Error(`MySQL table name collides: ${readable}`);
    this.#resolved.set(readable, identity);
    return Object.freeze({
      tableName: readable,
    });
  }
  private set(identity: string, name: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || Buffer.byteLength(name) > 64)
      throw new Error(`MySQL table name is invalid: ${name}`);
    for (const [registered, value] of this.#names)
      if (registered !== identity && value === name)
        throw new Error(`MySQL table name collides: ${name}`);
    this.#names.set(identity, name);
  }
}
