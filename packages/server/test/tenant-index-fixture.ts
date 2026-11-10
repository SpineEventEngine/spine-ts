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
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import {
  TenantBoundary,
  TenantCatalogReads,
  type TenantCatalog,
} from "@spine-event-engine/storage/provider";

import {
  SINGLE_TENANT,
  type TenantIndex,
  type TenantIndexPage,
  type TenantIndexRead,
  type TenantIndexSetting,
} from "../src/context/tenant-index.js";

/**
 * Requires a real directory where a test explicitly configured multitenant execution.
 *
 * @param setting Captured context or environment setting.
 * @returns The configured directory.
 */
export function requireTenantDirectory(setting: TenantIndexSetting): TenantIndex {
  if (setting === SINGLE_TENANT) throw new Error("Expected a configured tenant directory.");
  return setting;
}

/**
 * Explicit test directory backed by a selected in-memory catalog.
 */
export class TestTenantIndex implements TenantIndex {
  /**
   * Selects a dedicated catalog unless a test supplies one explicitly.
   *
   * @param catalog Catalog for this test directory.
   */
  constructor(
    private readonly catalog: TenantCatalog = new InMemoryStorageFactory().tenantCatalog(),
  ) {}

  /**
   * Checks current membership for a complete tenant identity.
   *
   * @param tenantId Tenant to inspect.
   * @returns Whether the catalog contains the tenant.
   */
  async contains(tenantId: TenantId): Promise<boolean> {
    return this.catalog.contains(TenantBoundary.from(tenantId));
  }

  /**
   * Lists the complete registered tenant identities.
   *
   * @returns Current complete tenant identities.
   */
  async all(): Promise<readonly TenantId[]> {
    return (await this.catalog.all()).map((boundary) => this.named(boundary));
  }

  /**
   * Reads one bounded page from the selected catalog.
   *
   * @param request Page request with cancellation.
   * @returns Complete tenant identities and continuation.
   */
  async page(request: TenantIndexRead): Promise<TenantIndexPage> {
    TenantCatalogReads.require(request);
    const page = await this.catalog.page(request);
    request.signal.throwIfAborted();
    return {
      ids: page.boundaries.map((boundary) => this.named(boundary)),
      ...(page.after === undefined ? {} : { after: page.after }),
      hasMore: page.hasMore,
    };
  }

  /**
   * Registers one complete tenant identity.
   *
   * @param tenantId Tenant to register.
   * @returns Catalog completion.
   */
  async keep(tenantId: TenantId): Promise<void> {
    return this.catalog.keep(TenantBoundary.from(tenantId));
  }

  /**
   * Rejects a single-tenant boundary in a multitenant directory.
   *
   * @param boundary Catalog entry.
   * @returns Complete named tenant identity.
   */
  private named(boundary: TenantBoundary): TenantId {
    if (boundary.single || boundary.tenantId === undefined)
      throw new Error("Multitenant provider catalog returned a single-tenant boundary.");
    return boundary.tenantId;
  }
}
