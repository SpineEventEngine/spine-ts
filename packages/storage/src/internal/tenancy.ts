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
   * Selects the boundary declared by a storage context.
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

class MultitenantBoundary implements MultitenantTenantBoundary {
  readonly #tenantId: TenantId;
  readonly key: string;
  readonly single = false;

  constructor(tenantId: TenantId) {
    TenantIds.require(tenantId);
    this.#tenantId = clone(TenantIdSchema, tenantId);
    this.key = TenantIds.key(this.#tenantId);
    Object.freeze(this);
  }

  get tenantId(): TenantId {
    return clone(TenantIdSchema, this.#tenantId);
  }
}

const TenantIds = Object.freeze({
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

  key(tenantId: TenantId): string {
    const bytes = toBinary(TenantIdSchema, tenantId, { writeUnknownFields: false });
    let encoded = "";
    for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
    return encoded;
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
