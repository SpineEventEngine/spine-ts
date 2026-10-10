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
import { type StorageFactory } from "@spine-event-engine/storage";
import type {
  TenantCatalog,
  TenantCatalogCursor,
  TenantCatalogProvider,
  TenantCatalogRead,
} from "@spine-event-engine/storage/provider";
import { TenantBoundary } from "@spine-event-engine/storage/provider";
import { TenantCatalogReads } from "@spine-event-engine/storage/provider";
import { EffectiveTenants } from "./effective-tenant.js";

type TenantMode = "single-tenant" | "multitenant";

/**
 * Tracks tenants admitted through one factory-owned provider catalog.
 */
export interface TenantIndex {
  // prettier-ignore

  /**
   * Identifies whether the owning context accepts tenant IDs.
   */
  readonly tenantMode: TenantMode;

  /**
   * Lists complete tenants discovered by the provider.
   *
   * @returns The provider-owned tenant IDs.
   */
  all(): Promise<readonly TenantId[]>;

  /**
   * Reads a finite page for Agent recovery without enumerating the catalog.
   * @param request Bounded provider page and cancellation.
   * @returns Complete tenant IDs and an opaque continuation.
   */
  page(request: TenantCatalogRead): Promise<TenantIndexPage>;

  /**
   * Records one complete tenant through provider-native catalog state.
   *
   * @param tenantId The complete generated tenant ID.
   * @returns Completion of provider catalog admission.
   */
  keep(tenantId: TenantId): Promise<void>;

  /**
   * Closes this context view without closing the factory-owned catalog.
   */
  close(): void;
}

/**
 * One finite provider tenant page for Agent discovery.
 */
export interface TenantIndexPage {
  /**
   * Complete generated tenant identities from this provider page.
   */
  readonly ids: readonly TenantId[];

  /**
   * Opaque continuation when another provider page remains.
   */
  readonly after?: TenantCatalogCursor;

  /**
   * Whether the finite catalog traversal has another page.
   */
  readonly hasMore: boolean;
}

/**
 * Creates context views over factory-owned tenant catalogs.
 */
export const TenantIndexes: Readonly<{
  create(input: {
    readonly contextName: string;
    readonly tenantMode: TenantMode;
    readonly storageFactory: StorageFactory;
  }): TenantIndex;
}> = Object.freeze({
  // prettier-ignore

  /**
   * Creates an index view for one context.
   *
   * @param input Identifies the diagnostic context, tenancy mode, and factory.
   * @returns The matching tenant index.
   */
  create(input): TenantIndex {
    return input.tenantMode === "single-tenant"
      ? new SingleTenantIndex(input.contextName)
      : new StorageTenantIndex(input.contextName, tenantCatalog(input.storageFactory));
  },
});

/**
 * Reports the effective identity of one single-tenant context.
 */
class SingleTenantIndex implements TenantIndex {
  // prettier-ignore

  /**
   * Identifies the index mode.
   */
  readonly tenantMode = "single-tenant";

  /**
   * Whether callers may still use this index.
   */
  #open = true;

  /**
   * Captures the context name for closed-index diagnostics.
   *
   * @param contextName Name reported in diagnostics.
   */
  constructor(private readonly contextName: string) {}

  /**
   * Lists the effective single-tenant identity while open.
   *
   * @returns The single effective tenant, or rejection after close.
   */
  all(): Promise<readonly TenantId[]> {
    const closed = this.closedError();
    return closed === undefined
      ? Promise.resolve(Object.freeze([EffectiveTenants.current(false, undefined)]))
      : Promise.reject(closed);
  }

  /**
   * Returns the single effective tenant without a provider catalog.
   * @param request Finite page request.
   * @returns One terminal tenant page.
   */
  page(request: TenantCatalogRead): Promise<TenantIndexPage> {
    return Promise.resolve().then(() => {
      const closed = this.closedError();
      if (closed !== undefined) throw closed;
      TenantCatalogReads.require(request);
      if (request.after !== undefined)
        throw new TypeError("Single-tenant catalog does not accept a continuation.");
      return { ids: [EffectiveTenants.current(false, undefined)], hasMore: false };
    });
  }

  /**
   * Rejects tenant recording because a single-tenant context has a fixed identity.
   *
   * @returns A rejected promise explaining why recording is unavailable.
   */
  keep(): Promise<void> {
    const closed = this.closedError();
    return Promise.reject(
      closed ??
        new Error(`Single-tenant context "${this.contextName}" does not accept tenant recording.`),
    );
  }

  /**
   * Stops accepting index operations.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Returns a closed-index error while preserving an open index.
   *
   * @returns An error only when the index is closed.
   */
  private closedError(): Error | undefined {
    return this.#open ? undefined : new Error("TenantIndex is closed.");
  }
}

/**
 * Reads named tenants from the storage provider's catalog.
 */
class StorageTenantIndex implements TenantIndex {
  // prettier-ignore

  /**
   * Identifies the index mode.
   */
  readonly tenantMode = "multitenant";

  /**
   * Whether callers may still use this index.
   */
  #open = true;

  /**
   * Captures the provider catalog used for this context.
   *
   * @param contextName Name reported in diagnostics.
   * @param catalog Provider catalog for named tenants.
   */
  constructor(
    private readonly contextName: string,
    private readonly catalog: TenantCatalog,
  ) {}

  /**
   * Lists named tenants from the provider catalog.
   *
   * @returns Named tenant IDs, or rejection for an invalid/closed catalog.
   */
  async all(): Promise<readonly TenantId[]> {
    this.requireOpen();
    return Object.freeze(
      (await this.catalog.all()).map((boundary) => {
        if (boundary.single || boundary.tenantId === undefined)
          throw new Error("Multitenant provider catalog returned a single-tenant boundary.");
        return boundary.tenantId;
      }),
    );
  }

  /**
   * Reads exactly one bounded provider page.
   * @param request Finite page request.
   * @returns Validated complete tenant IDs.
   */
  async page(request: TenantCatalogRead): Promise<TenantIndexPage> {
    this.requireOpen();
    TenantCatalogReads.require(request);
    const page = await this.catalog.page(request);
    request.signal.throwIfAborted();
    this.requireOpen();
    const ids = page.boundaries.map((boundary) => {
      if (boundary.single || boundary.tenantId === undefined)
        throw new Error("Multitenant provider catalog returned a single-tenant boundary.");
      return boundary.tenantId;
    });
    return {
      ids,
      ...(page.after === undefined ? {} : { after: page.after }),
      hasMore: page.hasMore,
    };
  }

  /**
   * Records a named tenant in the provider catalog.
   *
   * @param tenantId Named tenant to record.
   * @returns Completion after the catalog records the tenant.
   */
  keep(tenantId: TenantId): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      return this.catalog.keep(TenantBoundary.from(tenantId));
    });
  }

  /**
   * Stops accepting index operations.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Rejects use of a closed index.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error(`TenantIndex for "${this.contextName}" is closed.`);
  }
}

function tenantCatalog(factory: StorageFactory): TenantCatalog {
  const provider = factory as Partial<TenantCatalogProvider>;
  if (typeof provider.tenantCatalog !== "function")
    throw new Error("Multitenant storage requires a provider-owned tenant catalog.");
  const catalog = provider.tenantCatalog();
  if (typeof catalog.page !== "function")
    throw new Error("Multitenant Agent storage requires a paged provider tenant catalog.");
  return catalog;
}
