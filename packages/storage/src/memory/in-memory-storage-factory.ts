import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageFactory } from "../storage/storage-factory.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";

/** In-memory factory for record storages and framework delegates such as the event store. */
export class InMemoryStorageFactory extends StorageFactory {
  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new InMemoryRecordStorage(context, recordSpec);
  }
}
