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
import type { StorageFactory } from "@spine-event-engine/storage";
import {
  TenantBoundary,
  TenantCatalogReads,
  type TenantCatalog,
  type TenantCatalogCursor,
  type TenantCatalogProvider,
  type TenantCatalogRead,
  type TenantCatalogSignal,
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
 * Creates an environment default from a provider catalog or transient memory.
 */
export const TenantIndexes: Readonly<{ fromFactory(factory: StorageFactory): TenantIndex }> =
  Object.freeze({
    /**
     * Selects a provider catalog when available without creating records.
     *
     * @param factory Environment storage factory.
     * @returns One live index for the environment lifetime.
     */
    fromFactory(factory): TenantIndex {
      const provider = factory as Partial<TenantCatalogProvider>;
      return typeof provider.tenantCatalog === "function"
        ? new StorageTenantIndex(provider.tenantCatalog())
        : new MemoryTenantIndex();
    },
  });

/**
 * Adapts a provider catalog to the public live membership contract.
 */
class StorageTenantIndex implements TenantIndex {
  /**
   * Binds the index to a provider catalog.
   *
   * @param catalog Provider catalog retained by its storage factory.
   */
  constructor(private readonly catalog: TenantCatalog) {}

  /**
   * Checks membership through the catalog.
   *
   * @param tenantId Tenant to inspect.
   * @returns Live catalog membership.
   */
  async contains(tenantId: TenantId): Promise<boolean> {
    return this.catalog.contains(TenantBoundary.from(tenantId));
  }

  /**
   * Lists complete named tenant identities.
   *
   * @returns Complete named tenant identities.
   */
  async all(): Promise<readonly TenantId[]> {
    return Object.freeze((await this.catalog.all()).map((boundary) => this.named(boundary)));
  }

  /**
   * Reads a finite provider page.
   *
   * @param request Finite provider page.
   * @returns Complete tenant page.
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
   * Registers a tenant through the provider catalog.
   *
   * @param tenantId Tenant to register.
   * @returns Provider confirmation.
   */
  async keep(tenantId: TenantId): Promise<void> {
    return this.catalog.keep(TenantBoundary.from(tenantId));
  }

  /**
   * Validates a named provider boundary.
   *
   * @param boundary Provider boundary.
   * @returns Its complete named identity.
   */
  private named(boundary: TenantBoundary): TenantId {
    if (boundary.single || boundary.tenantId === undefined)
      throw new Error("Multitenant provider catalog returned a single-tenant boundary.");
    return boundary.tenantId;
  }
}

/**
 * Retains explicit membership when a custom factory has no catalog.
 */
class MemoryTenantIndex implements TenantIndex {
  readonly #tenants = new Map<string, ReturnType<typeof TenantBoundary.from>>();

  readonly #order: ReturnType<typeof TenantBoundary.from>[] = [];

  readonly #identity = {};

  /**
   * Checks explicit memory membership.
   *
   * @param tenantId Tenant to inspect.
   * @returns Explicit membership.
   */
  contains(tenantId: TenantId): Promise<boolean> {
    return Promise.resolve().then(() =>
      this.#tenants.has(String(TenantBoundary.from(tenantId).key)),
    );
  }

  /**
   * Lists detached complete tenant identities.
   *
   * @returns Detached complete tenant identities.
   */
  all(): Promise<readonly TenantId[]> {
    return Promise.resolve(Object.freeze(this.#order.map((boundary) => boundary.tenantId)));
  }

  /**
   * Reads a bounded page without copying the full directory.
   *
   * @param request Finite page request.
   * @returns Bounded membership page.
   */
  page(request: TenantIndexRead): Promise<TenantIndexPage> {
    return Promise.resolve().then(() => this.readPage(request));
  }

  /**
   * Reads one page after promise admission.
   *
   * @param request Finite page request.
   * @returns Bounded membership page.
   */
  private readPage(request: TenantIndexRead): TenantIndexPage {
    TenantCatalogReads.require(request);
    const cursor = request.after;
    if (cursor !== undefined && !(cursor instanceof MemoryTenantIndexCursor))
      throw new TypeError("TenantIndex continuation is invalid.");
    const state = cursor?.position(this.#identity);
    const start = state?.index ?? 0;
    const length = state?.length ?? this.#order.length;
    const end = Math.min(length, start + request.count);
    request.signal.throwIfAborted();
    return {
      ids: this.#order.slice(start, end).map((boundary) => boundary.tenantId),
      ...(end < length ? { after: new MemoryTenantIndexCursor(this.#identity, end, length) } : {}),
      hasMore: end < length,
    };
  }

  /**
   * Registers one detached complete tenant identity.
   *
   * @param tenantId Tenant to register.
   * @returns Visible membership completion.
   */
  keep(tenantId: TenantId): Promise<void> {
    return Promise.resolve().then(() => {
      const boundary = TenantBoundary.from(tenantId);
      const key = String(boundary.key);
      if (this.#tenants.has(key)) return;
      this.#tenants.set(key, boundary);
      this.#order.push(boundary);
    });
  }
}

/**
 * Instance-bound continuation for a transient in-memory index.
 */
class MemoryTenantIndexCursor implements TenantIndexCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #index: number;

  readonly #length: number;

  /**
   * Captures one finite sweep position.
   *
   * @param identity Index identity.
   * @param index Next position.
   * @param length Sweep length.
   */
  constructor(identity: object, index: number, length: number) {
    this.#identity = identity;
    this.#index = index;
    this.#length = length;
    Object.freeze(this);
  }

  /**
   * Verifies the issuing index before returning the sweep position.
   *
   * @param identity Expected index identity.
   * @returns Finite sweep position.
   */
  position(identity: object): { index: number; length: number } {
    if (this.#identity !== identity) throw new TypeError("TenantIndex continuation is invalid.");
    return { index: this.#index, length: this.#length };
  }
}
