/** Common closeable contract shared by storage factories and concrete storages. */
export interface Storage {
  /** Close the storage. Future operations fail. */
  close(): void;
  /** Whether the storage still accepts operations. */
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
