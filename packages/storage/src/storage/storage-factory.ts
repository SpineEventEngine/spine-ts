import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { Storage, StorageContext } from "./storage.js";

/** Mandatory storage-adapter seam for Spine TS runtime storage. */
export abstract class StorageFactory implements Storage {
  #open = true;

  /** Close the storage factory. Future storage creation fails. */
  close(): void {
    this.#open = false;
  }

  /** Whether the storage factory still accepts storage creation. */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Create a record storage for one context and one declarative record specification.
   *
   * Repeated calls for the same logical context and record specification must
   * observe the same backing records and return independently closeable storage
   * handles.
   */
  createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.requireOpen();
    return this.onCreateRecordStorage(context, recordSpec);
  }

  protected abstract onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R>;

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("StorageFactory is closed.");
    }
  }
}
