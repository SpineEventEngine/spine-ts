import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageFactory } from "../storage/storage-factory.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";

/** In-memory factory for record storages and framework delegates such as the event store. */
export class InMemoryStorageFactory extends StorageFactory {
  readonly #records = new WeakMap<object, unknown>();

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new InMemoryRecordStorage(context, recordSpec, this.tenantRecords(recordSpec));
  }

  private tenantRecords<I, R extends Message>(
    recordSpec: RecordSpec<I, R>,
  ): Map<string, TenantRecords<I, R>> {
    let records = this.#records.get(recordSpec);

    if (records === undefined) {
      records = new Map<string, TenantRecords<unknown, Message>>();
      this.#records.set(recordSpec, records);
    }

    return records as Map<string, TenantRecords<I, R>>;
  }
}
