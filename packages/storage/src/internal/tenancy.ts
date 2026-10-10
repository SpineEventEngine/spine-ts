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

import { clone, toBinary } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";
import type { StorageContext } from "../storage/storage.js";

const singleTenantKey = Symbol("single tenant");

/**
 * Provider-selection identity for one complete generated tenant value.
 *
 * @internal
 */
export interface TenantBoundary {
  // prettier-ignore

  /**
   * Stable in-process map key. Single tenancy uses one private symbol.
   */
  readonly key: string | symbol;

  /**
   * Whether this is the one explicit single-tenant boundary.
   */
  readonly single: boolean;

  /**
   * Complete cloned tenant ID, absent only for single tenancy.
   */
  readonly tenantId: TenantId | undefined;
}

interface MultitenantTenantBoundary extends TenantBoundary {
  readonly single: false;
  readonly tenantId: TenantId;
}

interface TenantBoundaryFactory {
  readonly single: TenantBoundary;

  /**
   * Creates a boundary for the supplied tenant.
   *
   * @param tenantId The complete generated tenant identifier.
   * @returns The immutable tenant boundary.
   */
  from(tenantId: TenantId): MultitenantTenantBoundary;

  /**
   * Validates a storage context and returns its complete tenant boundary.
   *
   * @param context The storage context.
   * @returns The validated tenant boundary.
   */
  of(context: StorageContext): TenantBoundary;
}

const singleTenantBoundary: TenantBoundary = Object.freeze({
  key: singleTenantKey,
  single: true,
  tenantId: undefined,
});

/**
 * Creates immutable provider tenant boundaries.
 *
 * @internal
 */
export const TenantBoundary: TenantBoundaryFactory = {
  // prettier-ignore

  /**
   * The explicit singleton used by single-tenant providers.
   */
  single: singleTenantBoundary,

  /**
   * Creates a boundary from a complete generated tenant ID.
   *
   * @param tenantId The generated tenant ID.
   * @returns An immutable tenant boundary.
   */
  from(tenantId: TenantId): MultitenantTenantBoundary {
    return new MultitenantBoundary(tenantId);
  },

  /**
   * Returns the boundary declared by a storage context.
   *
   * @param context The diagnostic context and tenant selection.
   * @returns The validated provider tenant boundary.
   */
  of(context: StorageContext): TenantBoundary {
    const tenantId = (context as { readonly tenantId?: TenantId }).tenantId;
    if (!context.multitenant) {
      if (tenantId !== undefined) {
        throw new Error(
          `Single-tenant storage "${context.name}" does not accept context.tenantId.`,
        );
      }
      return singleTenantBoundary;
    }
    if (tenantId === undefined) {
      throw new Error(`Multitenant storage "${context.name}" requires context.tenantId.`);
    }
    return new MultitenantBoundary(tenantId);
  },
};
Object.freeze(TenantBoundary);

/**
 * Clones and validates a complete multitenant identifier.
 */
class MultitenantBoundary implements MultitenantTenantBoundary {
  readonly #tenantId: TenantId;

  readonly key: string;

  readonly single = false;

  /**
   * Stores one validated tenant identity.
   * @param tenantId Complete generated tenant identifier.
   */
  constructor(tenantId: TenantId) {
    TenantIds.require(tenantId);
    this.#tenantId = clone(TenantIdSchema, tenantId);
    this.key = TenantIds.key(this.#tenantId);
    Object.freeze(this);
  }

  /**
   * Returns a detached complete tenant identifier.
   * @returns The cloned generated tenant identifier.
   */
  get tenantId(): TenantId {
    return clone(TenantIdSchema, this.#tenantId);
  }
}

const TenantIds = Object.freeze({
  /**
   * Rejects an empty or unspecified generated tenant identifier.
   * @param tenantId Identifier to validate.
   */
  require(tenantId: TenantId): void {
    const kind = tenantId.kind;
    const value =
      kind.case === "value"
        ? kind.value
        : kind.case === "domain" || kind.case === "email"
          ? kind.value.value
          : undefined;
    if (value === undefined || value.trim().length === 0) {
      throw new Error("Multitenant storage requires a non-empty TenantId.");
    }
  },

  /**
   * Encodes the complete generated tenant identifier as a map key.
   * @param tenantId Identifier to encode.
   * @returns Hexadecimal Protobuf bytes without unknown fields.
   */
  key(tenantId: TenantId): string {
    const bytes = toBinary(TenantIdSchema, tenantId, { writeUnknownFields: false });
    let encoded = "";
    for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
    return encoded;
  },
});

/**
 * Opaque continuation issued by one provider catalog instance.
 */
export interface TenantCatalogCursor {
  /**
   * Identifies an opaque in-process catalog continuation.
   */
  readonly [Symbol.toStringTag]: "TenantCatalogCursor";
}

/**
 * Structural cancellation accepted from a platform AbortSignal.
 */
export interface TenantCatalogSignal {
  /**
   * Whether cancellation has already been requested.
   */
  readonly aborted: boolean;

  /**
   * Throws when cancellation has been requested.
   */
  throwIfAborted(): void;

  /**
   * Observes one cancellation notification.
   * @param type Abort event name.
   * @param onAbort Callback notified on cancellation.
   * @param options One-shot listener selection.
   */
  addEventListener(type: "abort", onAbort: () => void, options?: { once?: boolean }): void;

  /**
   * Removes a previously registered cancellation listener.
   * @param type Abort event name.
   * @param onAbort Callback to remove.
   */
  removeEventListener(type: "abort", onAbort: () => void): void;
}

/**
 * Bounded provider tenant-page request.
 */
export interface TenantCatalogRead {
  /**
   * Positive safe page size, at most 127 native candidates.
   */
  readonly count: number;

  /**
   * Cancels discovery before native work and before results become visible.
   */
  readonly signal: TenantCatalogSignal;

  /**
   * Continuation issued by this same catalog instance.
   */
  readonly after?: TenantCatalogCursor;
}

/**
 * One finite tenant-catalog page.
 */
export interface TenantCatalogPage {
  /**
   * Complete boundaries selected from this page's native candidates.
   */
  readonly boundaries: readonly TenantBoundary[];

  /**
   * Continuation when more candidates remain.
   */
  readonly after?: TenantCatalogCursor;

  /**
   * Whether another page belongs to this finite sweep.
   */
  readonly hasMore: boolean;
}

/**
 * Validates common finite-page limits for provider catalogs.
 */
export const TenantCatalogReads: Readonly<{ require(request: TenantCatalogRead): void }> =
  Object.freeze({
    /**
     * Rejects invalid page bounds or cancellation.
     * @param request Requested finite page.
     */
    require(request: TenantCatalogRead): void {
      if (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 127)
        throw new RangeError("Tenant catalog count must be a positive safe integer at most 127.");
      request.signal.throwIfAborted();
    },
  });

/**
 * Provider-owned enumeration of storage tenant boundaries.
 *
 * @internal
 */
export interface TenantCatalog {
  // prettier-ignore

  /**
   * Lists the boundaries available for storage-backed startup work.
   *
   * @returns The available tenant boundaries.
   */
  all(): Promise<readonly TenantBoundary[]>;

  /**
   * Reads at most the requested number of native candidates per page.
   * @param request Finite page request and opaque continuation.
   * @returns A possibly empty continuing page or terminal page.
   */
  page(request: TenantCatalogRead): Promise<TenantCatalogPage>;

  /**
   * Closes resources owned by this catalog.
   *
   * @returns Completion of resource release.
   */
  close(): Promise<void>;

  /**
   * Records an admitted tenant when the provider requires an early cache.
   *
   * @param boundary The admitted boundary.
   * @returns Completion of the catalog update.
   */
  keep(boundary: TenantBoundary): Promise<void>;
}

/**
 * Storage-factory capability that owns one tenant catalog.
 *
 * @internal
 */
export interface TenantCatalogProvider {
  // prettier-ignore

  /**
   * Returns the catalog owned by this storage factory.
   *
   * @returns The provider-owned tenant catalog.
   */
  tenantCatalog(): TenantCatalog;
}
