/**
 * Names a distinct physical group for records with the same source and record types.
 */
export class StorageGroup {
  readonly #name: string;

  /**
   * Creates a named record-storage group.
   * @param name The non-blank provider-visible group name.
   */
  constructor(name: string) {
    if (name.trim().length === 0) {
      throw new Error("Storage group name must not be blank.");
    }
    this.#name = name;
  }

  /**
   * Returns the group name.
   * @returns The provider-visible group name.
   */
  get name(): string {
    return this.#name;
  }
}
