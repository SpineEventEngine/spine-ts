import type { Message } from "@bufbuild/protobuf";

import { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageFactory } from "../storage/storage-factory.js";
import { StorageScopes } from "../storage/canonical-scope.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";
import { MemoryEntityStorageFactory, type EntityStorageInput } from "./in-memory-entity-history.js";
import { MemoryEntityCommitStorage } from "./in-memory-entity-commit.js";
import {
  EntityCommitStorageFactories,
  type EntityCommitStorage,
} from "../internal/entity-commit.js";

/**
 * In-memory factory for record storages and framework delegates such as the event store.
 */
export class InMemoryStorageFactory extends StorageFactory {
  readonly #backend: InMemoryStorageBackend;
  readonly #entities: MemoryEntityStorageFactory;

  /**
   * Creates a factory with a fresh backend, or deliberately shares one.
   * @param backend Selects the backend to own or share.
   */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    super();
    this.#backend = backend;
    this.#entities = new MemoryEntityStorageFactory(backend);
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
  }

  /**
   * Creates the internal latest-state/history seam used by framework repositories.
   *
   * This is deliberately not exported from the root storage API. Provider
   * adapters expose the same structural method for the server runtime.
   * @param input Supplies the internal entity storage configuration.
   * @returns The created internal entity storage.
   */
  createEntityStorage(input: unknown): unknown {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const entity = input as EntityStorageInput<unknown, Message>;
    const stateHistory = entity.stateHistory ? stateHistorySpec(entity.stateSchema) : undefined;
    const eventHistory = entity.eventHistory ? eventHistorySpec(entity.stateSchema) : undefined;
    return this.#entities.create({
      ...entity,
      ...(stateHistory === undefined
        ? {}
        : {
            stateHistoryStorage: this.createRecordStorage(
              entity.context,
              stateHistory.spec,
              stateHistory.group,
            ),
          }),
      ...(eventHistory === undefined
        ? {}
        : {
            eventHistoryStorage: this.createRecordStorage(
              entity.context,
              eventHistory.spec,
              eventHistory.group,
            ),
          }),
    });
  }

  /**
   * Creates the provider-only atomic Entity commit seam used by repositories.
   *
   * @param input Supplies the internal Entity storage configuration.
   * @returns The independently closeable in-memory commit handle.
   */
  protected createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    return new MemoryEntityCommitStorage(
      this.#entities,
      this,
      (context, spec, group) => this.tenantRecords(context, spec, group),
      input as unknown as EntityStorageInput<unknown, Message>,
    );
  }

  /**
   * Creates an in-memory record storage.
   *
   * @param context The storage context.
   * @param recordSpec The record specification.
   * @param group Separates records that share a source type.
   * @returns The created record storage.
   */
  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return new InMemoryRecordStorage(context, recordSpec, () =>
      this.tenantRecords(context, recordSpec, group),
    );
  }

  private tenantRecords<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): TenantRecords<I, R> {
    const scope = StorageScopes.canonical(context, recordSpec.sourceType.typeName, group?.name);
    return InMemoryStorageBackend.bind(
      this.#backend,
      "record",
      scope,
      () => new TenantRecords<I, R>(),
    );
  }
}
