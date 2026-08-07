import type { Message } from "@bufbuild/protobuf";

import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { Storage, StorageContext } from "./storage.js";

/**
 * Mandatory storage-adapter seam for Spine TS runtime storage.
 */
export abstract class StorageFactory implements Storage {
  #open = true;

  /**
   * Closes the storage factory. Future storage creation fails.
   */
  close(): void {
    this.#open = false;
  }

  /**
   * Returns whether the storage factory accepts storage creation.
   * @returns Whether the factory is open.
   */
  isOpen(): boolean {
    return this.#open;
  }

  /**
   * Creates a record storage for one context and one declarative record specification.
   *
   * Repeated calls share backing records only when context, RecordSpec, and
   * StorageGroup all name the same physical family; two omitted groups are the
   * same ungrouped family. Handles remain independently closeable.
   *
   * @param context Supplies the bounded-context and tenant scope.
   * @param recordSpec Supplies the declarative physical record layout.
   * @param group Separates records that share one source type.
   * @returns The independently closeable record storage handle.
   */
  createRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    this.requireOpen();
    return this.onCreateRecordStorage(context, recordSpec, group);
  }

  /**
   * Creates a provider-specific record storage.
   *
   * @param context The storage context.
   * @param recordSpec The record specification.
   * @param group Separates records that share one source type.
   * @returns The created record storage.
   */
  protected abstract onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R>;

  private requireOpen(): void {
    if (!this.#open) {
      throw new Error("StorageFactory is closed.");
    }
  }
}
