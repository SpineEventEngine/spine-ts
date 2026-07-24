import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-event-engine/storage";

type TenantMode = "single-tenant" | "multitenant";
type TenantRecord = Message<"google.protobuf.StringValue"> & { value: string };

export interface TenantIndex {
  readonly tenantMode: TenantMode;
  all(): Promise<readonly string[]>;
  keep(_tenantId: string): Promise<void>;
  close(): void;
}

const tenantRecordSpec = new RecordSpec<string, TenantRecord>({
  schema: StringValueSchema,
  extractId: (record) => record.value,
});

export function createTenantIndex(input: {
  readonly contextName: string;
  readonly tenantMode: TenantMode;
  readonly storageFactory: StorageFactory;
}): TenantIndex {
  return input.tenantMode === "single-tenant"
    ? new SingleTenantIndex(input.contextName)
    : new StorageTenantIndex(input.contextName, input.storageFactory);
}

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
    const value = requireTenantId(tenantId);
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

function requireTenantId(tenantId: string): string {
  if (typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw new Error("Tenant index requires a non-blank tenant ID.");
  }

  return tenantId;
}
