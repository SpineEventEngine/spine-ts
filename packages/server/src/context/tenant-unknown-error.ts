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
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import type { TenantIndex } from "./tenant-index.js";

/**
 * Identifies a complete tenant absent from a receiving Bounded Context's live index.
 */
export class TenantUnknownError extends Error {
  /**
   * Stable structured error type for missing live membership.
   */
  readonly type = "TENANT_UNKNOWN" as const;

  readonly #tenant: ReturnType<typeof TenantBoundary.from>;

  /**
   * Captures the rejected tenant without retaining a mutable caller message.
   *
   * @param tenantId Complete unknown tenant identity.
   * @param contextName Receiving Bounded Context name.
   */
  constructor(
    tenantId: TenantId,
    readonly contextName: string,
  ) {
    const tenant = TenantBoundary.from(tenantId);
    const kind = tenant.tenantId.kind;
    const label =
      kind.case === "value" ? kind.value : kind.case === undefined ? "" : kind.value.value;
    super(`Tenant "${label}" is not registered for ${contextName}.`);
    this.name = "TenantUnknownError";
    this.#tenant = tenant;
  }

  /**
   * Returns a detached copy of the complete rejected identity.
   *
   * @returns Complete tenant identity.
   */
  get tenantId(): TenantId {
    return this.#tenant.tenantId;
  }
}

/**
 * Checks a receiving context's current membership after shape validation.
 */
export const TenantAdmissions: Readonly<{
  require(
    index: TenantIndex,
    contextName: string,
    multitenant: boolean,
    tenantId?: TenantId,
  ): Promise<void>;
}> = Object.freeze({
  /**
   * Requires live membership before tenant-specific work.
   *
   * @param index Receiving Bounded Context's effective index.
   * @param contextName Diagnostic context name.
   * @param multitenant Whether a tenant identity applies.
   * @param tenantId Complete supplied tenant identity, when applicable.
   * @returns Completion when current membership permits this input.
   */
  async require(index, contextName, multitenant, tenantId): Promise<void> {
    if (!multitenant) {
      if (tenantId !== undefined)
        throw new Error(`Single-tenant storage "${contextName}" does not accept context.tenantId.`);
      return;
    }
    if (tenantId === undefined)
      throw new Error(`Multitenant storage "${contextName}" requires context.tenantId.`);
    const boundary = TenantBoundary.from(tenantId);
    if (!(await index.contains(boundary.tenantId)))
      throw new TenantUnknownError(boundary.tenantId, contextName);
  },
});
