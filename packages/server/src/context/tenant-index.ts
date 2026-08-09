import type { TenantId } from "@spine-event-engine/proto";
import { TenantBoundary, type StorageFactory } from "@spine-event-engine/storage";
import type {
  TenantCatalog,
  TenantCatalogProvider,
} from "@spine-event-engine/storage/internal/tenancy";

type TenantMode = "single-tenant" | "multitenant";

/**
 * Tracks tenants admitted through one factory-owned provider catalog.
 */
export interface TenantIndex {
  // prettier-ignore

  /** Identifies whether the owning context accepts tenant IDs. */
  readonly tenantMode: TenantMode;

  /**
   * Lists complete tenants discovered by the provider.
   *
   * @returns The provider-owned tenant IDs.
   */
  all(): Promise<readonly TenantId[]>;

  /**
   * Admits one complete tenant through provider-native catalog state.
   *
   * @param tenantId The complete generated tenant ID.
   * @returns Completion of provider catalog admission.
   */
  keep(tenantId: TenantId): Promise<void>;

  /** Closes this context view without closing the factory-owned catalog. */
  close(): void;
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

class SingleTenantIndex implements TenantIndex {
  readonly tenantMode = "single-tenant";
  #open = true;

  constructor(private readonly contextName: string) {}

  all(): Promise<readonly TenantId[]> {
    const closed = this.closedError();
    return closed === undefined ? Promise.resolve(Object.freeze([])) : Promise.reject(closed);
  }

  keep(): Promise<void> {
    const closed = this.closedError();
    return Promise.reject(
      closed ??
        new Error(`Single-tenant context "${this.contextName}" does not accept tenant recording.`),
    );
  }

  close(): void {
    this.#open = false;
  }

  private closedError(): Error | undefined {
    return this.#open ? undefined : new Error("TenantIndex is closed.");
  }
}

class StorageTenantIndex implements TenantIndex {
  readonly tenantMode = "multitenant";
  #open = true;

  constructor(
    private readonly contextName: string,
    private readonly catalog: TenantCatalog,
  ) {}

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

  keep(tenantId: TenantId): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      return this.catalog.keep(TenantBoundary.from(tenantId));
    });
  }

  close(): void {
    this.#open = false;
  }

  private requireOpen(): void {
    if (!this.#open) throw new Error(`TenantIndex for "${this.contextName}" is closed.`);
  }
}

function tenantCatalog(factory: StorageFactory): TenantCatalog {
  const provider = factory as Partial<TenantCatalogProvider>;
  if (typeof provider.tenantCatalog !== "function")
    throw new Error("Multitenant storage requires a provider-owned tenant catalog.");
  return provider.tenantCatalog();
}
