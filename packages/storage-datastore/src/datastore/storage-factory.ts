import type { Message } from "@bufbuild/protobuf";
import { Datastore, type DatastoreOptions } from "@google-cloud/datastore";
import {
  RecordStorage,
  type RecordSpec,
  StorageFactory,
  type StorageContext,
} from "@spine-event-engine/storage";
import type {
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";

import { DatastoreRecordStorage } from "./record-storage.js";
import { DatastoreEntityStorage } from "./entity-history.js";

/** Explicit Google Cloud client settings used to construct a Datastore adapter. */
export type DatastoreStorageOptions = DatastoreOptions;

/** Adapter-local query bound for query paths requiring client-side reconciliation. */
export interface DatastoreStorageFactoryInput {
  /** The caller-owned Datastore client used by created storage handles. */
  readonly client: Datastore;
  /** Maximum entities reconciled locally by one query; must be a positive finite integer. */
  readonly maxClientSideScan?: number;
}

/**
 * Independently closeable Datastore entity-history provider handle.
 *
 * This structural framework/provider seam is not a remote history API. Closing
 * it never closes the caller-injected Google client or sibling handles. Reads
 * are finite and expose no cursor. Maintenance uses at most eight selected
 * rows per transaction; completed chunks can persist after a later failure and
 * callers retry. Identical immutable retries are safe; divergent content fails.
 */
export interface DatastoreEntityStorageHandle<I, S extends Message> {
  /** Provides current-record persistence for the entity scope. */
  readonly current: EntityRecordStorage<I, S>;
  /** Provides state-history persistence for the entity scope. */
  readonly states: EntityStateHistoryPort<I, S>;
  /** Provides event-history persistence for the entity scope. */
  readonly events: EntityEventHistoryPort<I>;
  /** Closes this handle without closing its caller-owned Datastore client. */
  close(): void;
  /**
   * Returns whether this handle accepts new operations.
   *
   * @returns `true` while the handle is open.
   */
  isOpen(): boolean;
}

/** A Google Cloud Datastore-backed implementation of the Spine TS storage port. */
export class DatastoreStorageFactory extends StorageFactory {
  readonly #client: Datastore;
  readonly #maxClientSideScan: number;

  /**
   * Creates a factory over a caller-owned Datastore client.
   *
   * @param input The client and optional client-side scan bound.
   * @returns The initialized storage factory.
   */
  constructor(input: DatastoreStorageFactoryInput) {
    super();
    this.#client = input.client;
    this.#maxClientSideScan = input.maxClientSideScan ?? 1_000;
    if (!Number.isInteger(this.#maxClientSideScan) || this.#maxClientSideScan <= 0) {
      throw new Error("Datastore maxClientSideScan must be a positive finite integer.");
    }
  }

  /**
   * Creates an adapter with caller-supplied Google Cloud client configuration.
   *
   * @param options The Google Cloud Datastore client settings.
   * @returns A storage factory that owns the client it creates.
   */
  static create(options: DatastoreStorageOptions): DatastoreStorageFactory {
    return new DatastoreStorageFactory({ client: new Datastore(options) });
  }

  /**
   * Creates the supported framework/provider seam for one durable entity scope.
   *
   * This consumes the frozen internal storage input; it is not a remote history
   * API. Each result is independently closeable, never closes the injected
   * client, binds its layout before access, and does not make current and
   * history calls atomic with one another.
   *
   * @param input The frozen framework storage input for one durable entity scope.
   * @returns An independently closeable entity-history provider handle.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): DatastoreEntityStorageHandle<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    return new DatastoreEntityStorage(input, this.#client);
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DatastoreRecordStorage(context, recordSpec, this.#client, this.#maxClientSideScan);
  }
}
