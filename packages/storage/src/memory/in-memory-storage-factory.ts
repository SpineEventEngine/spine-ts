/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import type { Message } from "@bufbuild/protobuf";

import { eventHistorySpec, stateHistorySpec } from "../entity/entity-history-record-spec.js";
import type { RecordSpec } from "../record/record-spec.js";
import type { RecordStorage } from "../record/record-storage.js";
import type { StorageGroup } from "../record/storage-group.js";
import type { StorageContext } from "../storage/storage.js";
import { StorageFactory } from "../storage/storage-factory.js";
import {
  TenantBoundary,
  type TenantCatalog,
  type TenantCatalogProvider,
} from "../internal/tenancy.js";
import { InMemoryStorageBackend } from "./in-memory-storage-backend.js";
import { InMemoryRecordStorage } from "./in-memory-record-storage.js";
import { TenantRecords } from "./tenant-records.js";
import { MemoryEntityStorageFactory, type EntityStorageInput } from "./in-memory-entity-history.js";
import { MemoryEntityCommitStorage } from "./in-memory-entity-commit.js";
import {
  EntityCommitStorageFactories,
  type EntityCommitStorage,
} from "../internal/entity-commit.js";
import { DeliveryCleanupStorageFactories } from "../internal/delivery-cleanup.js";
import { MemoryDeliveryCleanupStorage } from "./memory-delivery-cleanup.js";

/**
 * In-memory factory for record storages and framework delegates such as the event store.
 */
export class InMemoryStorageFactory extends StorageFactory implements TenantCatalogProvider {
  readonly #backend: InMemoryStorageBackend;
  readonly #entities: MemoryEntityStorageFactory;
  readonly #catalog: MemoryTenantCatalog;

  /**
   * Creates a factory with a fresh backend, or deliberately shares one.
   * @param backend Selects the backend to own or share.
   */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    super();
    this.#backend = backend;
    this.#entities = new MemoryEntityStorageFactory(backend);
    this.#catalog = new MemoryTenantCatalog(backend);
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    DeliveryCleanupStorageFactories.register(this, {
      createDeliveryCleanupStorage: () =>
        new MemoryDeliveryCleanupStorage((context, spec, group) =>
          this.tenantRecords(context, spec, group),
        ),
    });
  }

  /**
   * Returns the factory-owned view of admitted in-memory tenant slices.
   *
   * @returns The in-memory tenant catalog.
   */
  tenantCatalog(): TenantCatalog {
    return this.#catalog;
  }

  /**
   * Closes the catalog view and this factory.
   */
  override close(): void {
    void this.#catalog.close();
    super.close();
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
    const tenant = TenantBoundary.of(context);
    const family = JSON.stringify([recordSpec.sourceType.typeName, group?.name ?? null]);
    return InMemoryStorageBackend.bind(
      this.#backend,
      "record",
      tenant,
      family,
      () => new TenantRecords<I, R>(),
    );
  }
}

class MemoryTenantCatalog implements TenantCatalog {
  #open = true;

  constructor(private readonly backend: InMemoryStorageBackend) {}

  all(): Promise<readonly TenantBoundary[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      return InMemoryStorageBackend.tenants(this.backend);
    });
  }

  keep(boundary: TenantBoundary): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      if (boundary.single) throw new Error("In-memory tenant catalog requires a tenant boundary.");
      InMemoryStorageBackend.admit(this.backend, boundary);
    });
  }

  close(): Promise<void> {
    this.#open = false;
    return Promise.resolve();
  }

  private requireOpen(): void {
    if (!this.#open) throw new Error("In-memory tenant catalog is closed.");
  }
}
