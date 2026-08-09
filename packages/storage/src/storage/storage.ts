/**
 * Common closeable contract shared by storage factories and concrete storages.
 */
export interface Storage {
  // prettier-ignore

  /**
   * Closes the storage. Future operations fail.
   */
  close(): void;

  /**
   * Returns whether the storage accepts operations.
   * @returns Whether the storage is open.
   */
  isOpen(): boolean;
}

/**
 * Diagnostic context plus the provider tenant boundary for a storage operation.
 */
export type StorageContext = {
  // prettier-ignore

  /**
   * Bounded Context name used only in diagnostics.
   *
   * Providers must not use this value in a database, namespace, table, kind,
   * key, query, transaction, lock, cache key, or record-family identity.
   */
  readonly name: string;
} & (
  | {
      // prettier-ignore

      /**
       * Declares one unpartitioned single-tenant storage boundary.
       */
      readonly multitenant: false;

      /**
       * Single-tenant storage does not accept a tenant identifier.
       */
      readonly tenantId?: never;
    }
  | {
      // prettier-ignore

      /**
       * Declares storage partitioned by complete tenant identities.
       */
      readonly multitenant: true;

      /**
       * Complete generated tenant identity required for provider selection.
       */
      readonly tenantId: TenantId;
    }
);
import type { TenantId } from "@spine-event-engine/proto";
