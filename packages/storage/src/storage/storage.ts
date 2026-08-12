/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

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
 * Diagnostic context name and tenancy mode before one operation selects a tenant.
 *
 * This is configuration only. It cannot select a physical provider boundary;
 * multitenant storage operations require a complete `StorageContext`.
 */
export interface StorageMode {
  // prettier-ignore

  /**
   * Bounded Context name used only in diagnostics.
   */
  readonly name: string;

  /**
   * Whether each storage operation must select a complete tenant.
   */
  readonly multitenant: boolean;
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
