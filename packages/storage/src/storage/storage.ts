/** Common closeable contract shared by storage factories and concrete storages. */
export interface Storage {
  /** Closes the storage. Future operations fail. */
  close(): void;
  /** Returns whether the storage accepts operations.
   * @returns Whether the storage is open.
   */
  isOpen(): boolean;
}

/** Structural context used to scope storage by bounded context and tenant. */
export interface StorageContext {
  /** Bounded-context name or equivalent storage namespace. */
  readonly name: string;
  /** Whether records are split into per-tenant slices. */
  readonly multitenant: boolean;
  /** Current tenant slice when the storage is multitenant. */
  readonly tenantId?: string;
}
