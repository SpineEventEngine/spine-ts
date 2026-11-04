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

import type { TenantId } from "@spine-event-engine/proto";
import type {
  TenantCatalogCursor,
  TenantCatalogRead,
  TenantCatalogSignal,
} from "@spine-event-engine/storage/provider";

/**
 * Finite read request for a live tenant index.
 */
export type TenantIndexRead = TenantCatalogRead;

/**
 * Cancellation port for tenant-index traversal.
 */
export type TenantIndexSignal = TenantCatalogSignal;

/**
 * Opaque continuation returned by the same index instance.
 */
export type TenantIndexCursor = TenantCatalogCursor;

/**
 * Live application membership independent of storage destination resolution.
 */
export interface TenantIndex {
  // prettier-ignore

  /**
   * Checks current membership without registration or storage preparation.
   *
   * @param tenantId Complete tenant identity to inspect.
   * @returns Whether this index currently includes the tenant.
   */
  contains(tenantId: TenantId): Promise<boolean>;

  /**
   * Lists complete currently registered tenant identities.
   *
   * @returns Complete currently registered tenant identities.
   */
  all(): Promise<readonly TenantId[]>;

  /**
   * Reads a finite page from this index.
   *
   * @param request Bounded page and cancellation.
   * @returns Tenant identities and an opaque continuation.
   */
  page(request: TenantIndexRead): Promise<TenantIndexPage>;

  /**
   * Registers a tenant and returns after membership becomes visible.
   *
   * @param tenantId Complete tenant identity to register.
   * @returns Completion or rejection from this index.
   */
  keep(tenantId: TenantId): Promise<void>;
}

/**
 * One finite page of complete tenant identities.
 */
export interface TenantIndexPage {
  /**
   * Complete generated tenant identities.
   */
  readonly ids: readonly TenantId[];

  /**
   * Opaque continuation when another page remains.
   */
  readonly after?: TenantIndexCursor;

  /**
   * Whether another page belongs to this traversal.
   */
  readonly hasMore: boolean;
}

/**
 * Selects single-tenant execution without a tenant directory.
 */
export const SINGLE_TENANT: unique symbol = Symbol("SINGLE_TENANT");

/**
 * Selects single-tenant execution or an application-supplied directory.
 */
export type TenantIndexSetting = typeof SINGLE_TENANT | TenantIndex;
