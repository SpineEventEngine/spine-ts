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
  type TenantCatalogCursor,
  type TenantCatalogPage,
  type TenantCatalogRead,
  type TenantCatalogProvider,
  TenantCatalogReads,
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
import { AgentHistoryStorageFactories } from "../internal/agent-history.js";
import type { AgentHistoryStorage, AgentHistoryStorageInput } from "../entity/agent-history.js";
import { MemoryAgentHistory } from "./in-memory-agent-history.js";
import { AgentExecutionStorageFactories } from "../internal/agent-execution.js";
import type {
  AgentExecutionStorage,
  AgentExecutionStorageInput,
} from "../entity/agent-execution.js";
import { MemoryAgentExecution } from "./in-memory-agent-execution.js";

/**
 * In-memory factory for record storages and framework delegates such as the event store.
 */
export class InMemoryStorageFactory extends StorageFactory implements TenantCatalogProvider {
  readonly #backend: InMemoryStorageBackend;

  readonly #entities: MemoryEntityStorageFactory;

  readonly #catalog: MemoryTenantCatalog;

  /**
   * Creates a factory with a fresh backend, or deliberately shares one.
   * @param backend Selects the backend to create or share.
   */
  constructor(backend: InMemoryStorageBackend = new InMemoryStorageBackend()) {
    super();
    this.#backend = backend;
    this.#entities = new MemoryEntityStorageFactory(backend);
    this.#catalog = new MemoryTenantCatalog(backend);
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => this.createAgentHistoryStorage(input),
    });
    AgentExecutionStorageFactories.register(this, {
      createAgentExecutionStorage: (input) => this.createAgentExecutionStorage(input),
    });
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
   * Returns the factory's view of admitted in-memory tenant slices.
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
   * @typeParam I Typed Entity identifier.
   * @typeParam S Entity state message.
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
   * Creates an indexed Agent history handle for this memory factory.
   *
   * @typeParam Id Typed Agent identifier.
   * @param input Complete repository and tenant scope.
   * @returns Independently closeable history handle.
   */
  protected createAgentHistoryStorage<Id>(
    input: AgentHistoryStorageInput<Id>,
  ): AgentHistoryStorage<Id> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    return MemoryAgentHistory.open(this.#backend, input);
  }

  /**
   * Opens a durable Agent execution handle against this shared memory backend.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   * @param input Agent repository and Entity layout.
   * @returns Independently closeable execution handle.
   */
  protected createAgentExecutionStorage<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): AgentExecutionStorage<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    return MemoryAgentExecution.open(this.#backend, this, input);
  }

  /**
   * Creates an in-memory record storage.
   *
   * @typeParam I Typed record identifier.
   * @typeParam R Stored Proto message.
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

  /**
   * Binds the tenant and record family to the shared memory backend.
   *
   * @typeParam I Typed record identifier.
   * @typeParam R Stored Proto message.
   * @param context Complete storage context.
   * @param recordSpec Record layout and source type.
   * @param group Optional physical record family.
   * @returns Retained records for the selected boundary.
   */
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

/**
 * Admits and lists tenant boundaries within one memory backend.
 */
class MemoryTenantCatalog implements TenantCatalog {
  readonly #cursorIdentity = {};

  #open = true;

  /**
   * Binds the catalog to its memory backend.
   *
   * @param backend Backend retaining tenant boundaries.
   */
  constructor(private readonly backend: InMemoryStorageBackend) {}

  /**
   * Reads admitted tenant boundaries.
   *
   * @returns Known tenant boundaries.
   */
  all(): Promise<readonly TenantBoundary[]> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      return InMemoryStorageBackend.tenants(this.backend);
    });
  }

  /**
   * Reads one bounded admission-order page from a finite sweep.
   * @param request Page size, cancellation, and catalog continuation.
   * @returns Complete admitted boundaries and an optional continuation.
   */
  page(request: TenantCatalogRead): Promise<TenantCatalogPage> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      TenantCatalogReads.require(request);
      const after = request.after;
      if (after !== undefined && !(after instanceof MemoryTenantCursor))
        throw new TypeError("Memory tenant catalog continuation is invalid.");
      const cursor = after?.state(this.#cursorIdentity);
      const start = cursor?.index ?? 0;
      const length = cursor?.length ?? InMemoryStorageBackend.tenantCount(this.backend);
      const end = Math.min(length, start + request.count);
      const boundaries = InMemoryStorageBackend.tenantPage(this.backend, start, end - start);
      request.signal.throwIfAborted();
      this.requireOpen();
      return {
        boundaries,
        ...(end < length
          ? { after: new MemoryTenantCursor(this.#cursorIdentity, end, length) }
          : {}),
        hasMore: end < length,
      };
    });
  }

  /**
   * Adds one complete tenant boundary.
   *
   * @param boundary Tenant boundary to retain.
   * @returns Resolves when the tenant is admitted.
   */
  keep(boundary: TenantBoundary): Promise<void> {
    return Promise.resolve().then(() => {
      this.requireOpen();
      if (boundary.single) throw new Error("In-memory tenant catalog requires a tenant boundary.");
      InMemoryStorageBackend.admit(this.backend, boundary);
    });
  }

  /**
   * Closes this catalog view.
   *
   * @returns Resolves after closing the view.
   */
  close(): Promise<void> {
    this.#open = false;
    return Promise.resolve();
  }

  /**
   * Checks that this catalog view remains open.
   */
  private requireOpen(): void {
    if (!this.#open) throw new Error("In-memory tenant catalog is closed.");
  }
}

/**
 * An immutable continuation bound to one memory catalog and sweep length.
 */
class MemoryTenantCursor implements TenantCatalogCursor {
  readonly [Symbol.toStringTag] = "TenantCatalogCursor" as const;

  readonly #identity: object;

  readonly #index: number;

  readonly #length: number;

  /**
   * Captures one finite admission-order sweep position.
   * @param identity Private catalog issuance identity.
   * @param index Next admission-order position.
   * @param length Index length fixed at sweep start.
   */
  constructor(identity: object, index: number, length: number) {
    this.#identity = identity;
    this.#index = index;
    this.#length = length;
    Object.freeze(this);
  }

  /**
   * Verifies issuance by the requested catalog before revealing the position.
   * @param identity Private identity of the catalog reading this token.
   * @returns Fixed sweep length and next position.
   */
  state(identity: object): { index: number; length: number } {
    if (this.#identity !== identity)
      throw new TypeError("Memory tenant catalog continuation is invalid.");
    return { index: this.#index, length: this.#length };
  }
}
