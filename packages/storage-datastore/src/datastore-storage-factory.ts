import type { Message } from "@bufbuild/protobuf";
import { Datastore, type DatastoreOptions } from "@google-cloud/datastore";
import {
  RecordStorage,
  type RecordSpec,
  StorageFactory,
  type StorageContext,
} from "@spine-ts/storage";

import { DatastoreRecordStorage } from "./datastore-record-storage.js";

/** Explicit Google Cloud client settings used to construct a Datastore adapter. */
export type DatastoreStorageOptions = DatastoreOptions;

/** A Google Cloud Datastore-backed implementation of the Spine TS storage port. */
export class DatastoreStorageFactory extends StorageFactory {
  readonly #client: Datastore;

  constructor(input: { readonly client: Datastore }) {
    super();
    this.#client = input.client;
  }

  /** Creates an adapter with caller-supplied Google Cloud client configuration. */
  static create(options: DatastoreStorageOptions): DatastoreStorageFactory {
    return new DatastoreStorageFactory({ client: new Datastore(options) });
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DatastoreRecordStorage(context, recordSpec, this.#client);
  }
}
