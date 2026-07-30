import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { Storage, StorageContext } from "./storage.js";

/** Mandatory storage-adapter seam for Spine TS runtime storage. */
export abstract class StorageFactory implements Storage {
  #open = true;

  /** Closes the storage factory. Future storage creation fails. */
  close(): void {
    this.#open = false;
  }

  /** Returns whether the storage factory accepts storage creation.
   * @returns Whether the factory is open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Creates a record storage for one context and one declarative record specification.
   *
   * Repeated calls for the same logical context and record specification must
   * observe the same backing records and return independently closeable storage
   * handles.
   *
   * @param context - Supplies the bounded-context and tenant scope.
   * @param recordSpec - Supplies the declarative physical record layout.
   * @returns The independently closeable record storage handle.
   */
  createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.requireOpen();
    return this.onCreateRecordStorage(context, recordSpec);
  }

  /** Creates a provider-specific record storage.
   * @param context The storage context.
   * @param recordSpec The record specification.
   * @returns The created record storage.
   */
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
