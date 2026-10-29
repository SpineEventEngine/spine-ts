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
import { eventStoreRecordSpec, EventStoreGroups } from "../event/event-store.js";
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
import { AgentHistoryStorageFactories } from "../internal/agent-history.js";
import { AgentHistoryRecords } from "../entity/agent-history-record-spec.js";
import { AgentModelPreferences } from "../internal/agent-model-preferences.js";
import {
  StoragePreparations,
  type EntityStoragePreparationInput,
} from "../internal/storage-preparation.js";
import type { AgentHistoryStorage, AgentHistoryStorageInput } from "../entity/agent-history.js";
import { MemoryAgentHistory } from "./in-memory-agent-history.js";

/**
 * In-memory factory for record storages and framework delegates such as the event store.
 */
export class InMemoryStorageFactory extends StorageFactory implements TenantCatalogProvider {
  readonly #backend: InMemoryStorageBackend;

  readonly #entities: MemoryEntityStorageFactory;

  readonly #catalog: MemoryTenantCatalog;

  readonly #commits = new Set<MemoryEntityCommitStorage>();

  #closing: Promise<void> | undefined;

  /**
   * Creates a factory with a fresh backend, or deliberately shares one.
   *
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
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    StoragePreparations.register(this, {
      prepareRecord: (context, spec, group) => this.prepareRecord(context, spec, group),
      prepareEntity: (input) => this.prepareEntity(input),
      prepareAgentHistory: (input) => this.prepareAgentHistory(input),
      prepareAgentCommit: (input) => this.prepareAgentCommit(input),
    });
  }

  /**
   * Validates the local memory connection while the factory remains open.
   *
   * @returns Completion without a remote request or tenant admission.
   */
  override checkConnection(): Promise<void> {
    return this.isOpen()
      ? Promise.resolve()
      : Promise.reject(new Error("StorageFactory is closed."));
  }

  /**
   * Checks one ordinary record definition without constructing a handle.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param context Complete storage scope.
   * @param spec Declarative record family.
   * @param group Optional physical group.
   * @returns Completion after local validation.
   */
  private prepareRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): Promise<void> {
    try {
      if (!this.isOpen()) throw new Error("StorageFactory is closed.");
      this.declareRecord(context, spec, group);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Memory preparation failed.", { cause: error }),
      );
    }
  }

  /**
   * Checks current Entity and enabled histories without constructing handles.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Declarative Entity layout.
   * @returns Completion after local validation.
   */
  private prepareEntity<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
  ): Promise<void> {
    try {
      if (!this.isOpen()) throw new Error("StorageFactory is closed.");
      this.declareEntity(input);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Memory preparation failed.", { cause: error }),
      );
    }
  }

  /**
   * Checks the surviving Agent audit family without creating records.
   *
   * @typeParam I Agent identifier type.
   * @param input Agent state type and complete scope.
   * @returns Completion after local validation.
   */
  private prepareAgentHistory<I>(input: AgentHistoryStorageInput<I>): Promise<void> {
    try {
      if (!this.isOpen()) throw new Error("StorageFactory is closed.");
      TenantBoundary.of(input.context);
      if (input.stateType.trim().length === 0) throw new TypeError("Agent state type is required.");
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Memory preparation failed.", { cause: error }),
      );
    }
  }

  /**
   * Creates the Agent's current, enabled history, audit, and preference families.
   * @param input Complete declarative Agent Entity layout.
   * @returns Completion after local compatibility validation.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  private prepareAgentCommit<I, S extends Message>(
    input: EntityStoragePreparationInput<I, S>,
  ): Promise<void> {
    try {
      if (!this.isOpen()) throw new Error("StorageFactory is closed.");
      this.declareEntity(input);
      this.declareRecord(
        input.context,
        AgentHistoryRecords.spec((value) => value),
        AgentHistoryRecords.group,
      );
      this.declareRecord(
        input.context,
        AgentModelPreferences.spec((value) => value),
        AgentModelPreferences.group,
      );
      if (input.stateSchema.typeName.trim().length === 0)
        throw new TypeError("Agent state type is required.");
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error("Memory Agent preparation failed.", { cause: error }),
      );
    }
  }

  /**
   * Records all Entity family definitions without opening tenant slices.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state type.
   * @param input Declarative Entity layout.
   */
  private declareEntity<I, S extends Message>(input: EntityStoragePreparationInput<I, S>): void {
    const tenant = TenantBoundary.of(input.context);
    if (!InMemoryStorageBackend.sameColumns(input.columns, input.recordSpec.columns))
      throw new Error("Memory Entity query columns differ from the current record definition.");
    InMemoryStorageBackend.define(
      this.#backend,
      "entity",
      tenant,
      input.sourceType.typeName,
      input.recordSpec,
    );
    if (input.stateHistory) {
      const history = stateHistorySpec(input.stateSchema);
      this.declareRecord(input.context, history.spec, history.group);
    }
    if (input.eventHistory) {
      const history = eventHistorySpec(input.stateSchema);
      this.declareRecord(input.context, history.spec, history.group);
    }
    this.declareRecord(
      input.context,
      eventStoreRecordSpec,
      EventStoreGroups.forContext(input.context.name),
    );
  }

  /**
   * Records an ordinary physical family without admitting a tenant.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Record message type.
   * @param context Complete storage scope.
   * @param spec Declarative record layout.
   * @param group Optional physical group.
   */
  private declareRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): void {
    const family = JSON.stringify([
      spec.sourceType.typeName,
      group === undefined ? null : (EventStoreGroups.identity(group) ?? group.name),
    ]);
    InMemoryStorageBackend.define(
      this.#backend,
      "record",
      TenantBoundary.of(context),
      family,
      spec,
    );
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
   * Closes retained resources after admitted work settles.
   *
   * @returns The repeatable close outcome.
   */
  override close(): Promise<void> {
    this.fenceClose();
    if (this.#closing !== undefined) return this.#closing;
    const commits = [...this.#commits].map((handle) => handle.close());
    return (this.#closing = this.drain(commits));
  }

  /**
   * Waits for commit handles, then reports their and catalog cleanup failures.
   *
   * @param commits The admitted commit completions.
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(commits: readonly Promise<void>[]): Promise<void> {
    const settled = await Promise.allSettled(commits);
    const failures: unknown[] = [];
    for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
    try {
      await this.#catalog.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Memory storage factory close failed.");
  }

  /**
   * Creates the internal latest-state/history seam used by framework repositories.
   *
   * This is deliberately not exported from the root storage API. Provider
   * adapters expose the same structural method for the server runtime.
   *
   * @param input Supplies the internal entity storage configuration.
   * @returns The created internal entity storage.
   */
  createEntityStorage(input: unknown): unknown {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const entity = input as EntityStorageInput<unknown, Message>;
    this.declareEntity(entity);
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
   * Creates the provider-only ordered Entity commit seam used by repositories.
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
    this.declareEntity(input);
    const handle = new MemoryEntityCommitStorage(
      this.#entities,
      (context, spec, group) => this.tenantRecords(context, spec, group),
      input as unknown as EntityStorageInput<unknown, Message>,
      this.#backend,
      () => this.#commits.delete(handle),
    );
    this.#commits.add(handle);
    return handle;
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
    if (input.stateType.trim().length === 0) throw new TypeError("Agent state type is required.");
    return MemoryAgentHistory.open(this.#backend, input);
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
    this.declareRecord(context, recordSpec, group);
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
    const family = JSON.stringify([
      recordSpec.sourceType.typeName,
      group === undefined ? null : (EventStoreGroups.identity(group) ?? group.name),
    ]);
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
   * Binds explicit membership to the shared memory backend.
   *
   * @param backend Backend retaining registered tenant boundaries.
   */
  constructor(private readonly backend: InMemoryStorageBackend) {}

  /**
   * Checks explicit membership without admitting a storage family.
   *
   * @param boundary Complete tenant boundary to inspect.
   * @returns Whether the boundary was registered through this catalog.
   */
  contains(boundary: TenantBoundary): Promise<boolean> {
    this.requireOpen();
    return Promise.resolve(InMemoryStorageBackend.contains(this.backend, boundary));
  }

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
   *
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
   *
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
   *
   * @param identity Private identity of the catalog reading this token.
   * @returns Fixed sweep length and next position.
   */
  state(identity: object): { index: number; length: number } {
    if (this.#identity !== identity)
      throw new TypeError("Memory tenant catalog continuation is invalid.");
    return { index: this.#index, length: this.#length };
  }
}
