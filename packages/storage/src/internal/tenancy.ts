import { clone, toBinary } from "@bufbuild/protobuf";
import { TenantIdSchema, type TenantId } from "@spine-event-engine/proto";

const singleTenantKey = Symbol("single tenant");

/**
 * Provider-selection identity for one complete generated tenant value.
 *
 * @internal
 */
export interface TenantBoundary {
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

interface TenantBoundaryFactory {
  readonly single: TenantBoundary;
  from(tenantId: TenantId): TenantBoundary;
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
  /**
   * The explicit singleton used by single-tenant providers.
   */
  single: singleTenantBoundary,

  /**
   * Creates a boundary from a complete generated tenant ID.
   * @param tenantId The generated tenant ID.
   * @returns An immutable tenant boundary.
   */
  from(tenantId: TenantId): TenantBoundary {
    return new MultitenantBoundary(tenantId);
  },
};
Object.freeze(TenantBoundary);

class MultitenantBoundary implements TenantBoundary {
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
  /**
   * Returns the boundaries available for storage-backed startup work.
   */
  all(): Promise<readonly TenantBoundary[]>;

  /**
   * Releases resources owned by this catalog.
   */
  close(): Promise<void>;

  /**
   * Notes an admitted tenant when the provider requires an early cache.
   * @param boundary The admitted boundary.
   */
  keep(boundary: TenantBoundary): Promise<void>;
}

/**
 * Storage-factory capability that owns one tenant catalog.
 *
 * @internal
 */
export interface TenantCatalogProvider {
  /**
   * Returns the catalog owned by this storage factory.
   */
  tenantCatalog(): TenantCatalog;
}
