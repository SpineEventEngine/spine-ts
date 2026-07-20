import type { Message } from "@bufbuild/protobuf";
import { Datastore, type DatastoreOptions } from "@google-cloud/datastore";
import {
  RecordStorage,
  type RecordSpec,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";

import { DatastoreRecordStorage } from "./record-storage.js";

/** Explicit Google Cloud client settings used to construct a Datastore adapter. */
export type DatastoreStorageOptions = DatastoreOptions;

/** Adapter-local query bound for query paths requiring client-side reconciliation. */
export interface DatastoreStorageFactoryInput {
  readonly client: Datastore;
  /** Maximum entities reconciled locally by one query; must be a positive finite integer. */
  readonly maxClientSideScan?: number;
}

/** A Google Cloud Datastore-backed implementation of the Spine TS storage port. */
export class DatastoreStorageFactory extends StorageFactory {
  readonly #client: Datastore;
  readonly #maxClientSideScan: number;

  constructor(input: DatastoreStorageFactoryInput) {
    super();
    this.#client = input.client;
    this.#maxClientSideScan = input.maxClientSideScan ?? 1_000;
    if (!Number.isInteger(this.#maxClientSideScan) || this.#maxClientSideScan <= 0) {
      throw new Error("Datastore maxClientSideScan must be a positive finite integer.");
    }
  }

  /** Creates an adapter with caller-supplied Google Cloud client configuration. */
  static create(options: DatastoreStorageOptions): DatastoreStorageFactory {
    return new DatastoreStorageFactory({ client: new Datastore(options) });
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DatastoreRecordStorage(context, recordSpec, this.#client, this.#maxClientSideScan);
  }
}
