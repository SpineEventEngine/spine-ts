import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageFactory } from "../storage/storage-factory.js";
import { canonicalStorageScope } from "../storage/canonical-scope.js";
import { bindMemoryBackendScope, InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";

/** In-memory factory for record storages and framework delegates such as the event store. */
export class InMemoryStorageFactory extends StorageFactory {
  readonly #backend: InMemoryStorageBackend;

  /** Create a factory with a fresh backend, or deliberately share `backend`. */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    super();
    this.#backend = backend;
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new InMemoryRecordStorage(context, recordSpec, () =>
      this.tenantRecords(context, recordSpec),
    );
  }

  private tenantRecords<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): TenantRecords<I, R> {
    const scope = canonicalStorageScope(context, recordSpec.storageKey);
    const fingerprint = recordSpec.compatibilityFingerprint;
    return bindMemoryBackendScope(
      this.#backend,
      scope,
      fingerprint,
      () => new TenantRecords<I, R>(),
    );
  }
}
