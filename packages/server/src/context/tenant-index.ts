import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";

type TenantMode = "single-tenant" | "multitenant";
type TenantRecord = Message<"google.protobuf.StringValue"> & { value: string };

/** Tracks tenants that have been admitted by one bounded context. */
export interface TenantIndex {
  /** Identifies whether the owning context accepts tenant IDs. */
  readonly tenantMode: TenantMode;
  /** Lists the tenant IDs recorded by this index.
   * @returns The recorded tenant IDs.
   */
  all(): Promise<readonly string[]>;
  /** Records one tenant ID when the context is multitenant.
   * @param _tenantId The tenant ID to retain.
   */
  keep(_tenantId: string): Promise<void>;
  /** Closes the backing storage used by this index. */
  close(): void;
}

const tenantRecordSpec = new RecordSpec<string, TenantRecord>({
  schema: StringValueSchema,
  storageKey: "spine.server.Tenant:current",
  idKind: "string",
  extractId: (record) => record.value,
});

/** Creates tenant indexes for bounded-context storage. */
export const TenantIndexes: Readonly<{
  create(input: {
    readonly contextName: string;
    readonly tenantMode: TenantMode;
    readonly storageFactory: StorageFactory;
  }): TenantIndex;
  require(tenantId: string): string;
}> = Object.freeze({
  /**
   * Creates an index for one context.
   *
   * @param input - Identifies the context, tenancy mode, and storage factory.
   * @returns The matching tenant index.
   */
  create(input: {
    readonly contextName: string;
    readonly tenantMode: TenantMode;
    readonly storageFactory: StorageFactory;
  }): TenantIndex {
    return input.tenantMode === "single-tenant"
      ? new SingleTenantIndex(input.contextName)
      : new StorageTenantIndex(input.contextName, input.storageFactory);
  },
  require(tenantId: string): string {
    if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
      throw new Error("Tenant index requires a non-blank tenant ID.");
    }
    return tenantId;
  },
});

class SingleTenantIndex implements TenantIndex {
  readonly tenantMode = "single-tenant";
  #open = true;

  constructor(private readonly contextName: string) {}

  all(): Promise<readonly string[]> {
    const closed = this.closedError();
    if (closed !== undefined) {
      return Promise.reject(closed);
    }
    return Promise.resolve(Object.freeze([]));
  }

  keep(): Promise<void> {
    const closed = this.closedError();
    if (closed !== undefined) {
      return Promise.reject(closed);
    }
    return Promise.reject(
      new Error(`Single-tenant context "${this.contextName}" does not accept tenant recording.`),
    );
  }

  close(): void {
    this.#open = false;
  }

  private closedError(): Error | undefined {
    if (!this.#open) {
      return new Error("TenantIndex is closed.");
    }
    return undefined;
  }
}

class StorageTenantIndex implements TenantIndex {
  readonly tenantMode = "multitenant";
  readonly #storage: RecordStorage<string, TenantRecord>;

  constructor(contextName: string, storageFactory: StorageFactory) {
    this.#storage = storageFactory.createRecordStorage(
      {
        name: `__spine/${contextName}/tenants`,
        multitenant: false,
      },
      tenantRecordSpec,
    );
  }

  async all(): Promise<readonly string[]> {
    return Object.freeze(await this.#storage.index());
  }

  async keep(tenantId: string): Promise<void> {
    const value = TenantIndexes.require(tenantId);
    await this.#storage.write(
      create(StringValueSchema as GenMessage<TenantRecord>, {
        value,
      }),
    );
  }

  close(): void {
    this.#storage.close();
  }
}
