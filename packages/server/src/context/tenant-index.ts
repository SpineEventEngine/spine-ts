import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { RecordSpec, type RecordStorage, type StorageFactory } from "@spine-ts/storage";

type TenantMode = "single-tenant" | "multitenant";
type TenantRecord = Message<"google.protobuf.StringValue"> & { value: string };

export interface TenantIndex {
  readonly tenantMode: TenantMode;
  all(): Promise<readonly string[]>;
  keep(tenantId: string): Promise<void>;
  close(): void;
}

const tenantRecordSpec = new RecordSpec<string, TenantRecord>({
  schema: StringValueSchema as GenMessage<TenantRecord>,
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

  async all(): Promise<readonly string[]> {
    this.requireOpen();
    return Object.freeze([]);
  }

  async keep(_tenantId: string): Promise<void> {
    this.requireOpen();
    throw new Error(
      `Single-tenant context "${this.contextName}" does not accept tenant recording.`,
    );
  }

  close(): void {
    this.#open = false;
  }

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("TenantIndex is closed.");
    }
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
