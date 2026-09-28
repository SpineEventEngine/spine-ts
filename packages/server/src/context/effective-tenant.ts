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

import { create } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import { TenantBoundary } from "@spine-event-engine/storage/provider";

const singleTenantId = create(TenantIdSchema, {
  kind: { case: "value", value: "SINGLE_TENANT" },
});
const singleTenantValue = TenantBoundary.from(singleTenantId).key;

/**
 * Resolves execution identity separately from the storage provider's single-tenant partition.
 */
export const EffectiveTenants: Readonly<{
  current(multitenant: boolean, tenantId: TenantId | undefined): TenantId;
  destination(tenantId: TenantId, multitenant: boolean): TenantId | undefined;
}> = Object.freeze({
  /**
   * Resolves the current operation's tenant, including single-tenant execution.
   *
   * @param multitenant Whether the source context requires a named tenant.
   * @param tenantId Tenant from the triggering signal or client request.
   * @returns Validated effective tenant identity.
   */
  current(multitenant: boolean, tenantId: TenantId | undefined): TenantId {
    if (multitenant) {
      if (tenantId === undefined) throw new Error("Multitenant operation requires tenantId.");
      return TenantBoundary.from(tenantId).tenantId;
    }
    if (tenantId !== undefined)
      throw new Error("Single-tenant operation does not accept tenantId.");
    return TenantBoundary.from(singleTenantId).tenantId;
  },

  /**
   * Validates the destination tenant before a query accesses its Stand.
   *
   * @param tenantId Effective tenant from the triggering operation.
   * @param multitenant Whether the destination stores separate tenant partitions.
   * @returns Tenant selection for the destination Stand.
   */
  destination(tenantId: TenantId, multitenant: boolean): TenantId | undefined {
    if (multitenant) return TenantBoundary.from(tenantId).tenantId;
    if (TenantBoundary.from(tenantId).key !== singleTenantValue) {
      throw new Error("Query tenant is incompatible with the single-tenant destination.");
    }
    return undefined;
  },
});
