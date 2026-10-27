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
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  RecordStorage,
  StorageFactory,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import {
  type TenantCatalog,
  type TenantCatalogProvider,
} from "@spine-event-engine/storage/provider";
import {
  AgentExecutionRecords,
  AgentHistoryRecords,
  eventHistorySpec,
  stateHistorySpec,
} from "@spine-event-engine/storage/provider";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/provider";
import type {
  EntityCommitStorage,
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/provider";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/provider";
import { AgentHistoryStorageFactories } from "@spine-event-engine/storage/provider";
import { AgentExecutionStorageFactories } from "@spine-event-engine/storage/provider";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type { Event } from "@spine-event-engine/proto";

import {
  DatastoreEntityCommitStorage,
  DatastoreEntityStorage,
  type OpenEntityRecords,
} from "./entity-history.js";
import { DatastoreRecordStorage } from "./record-storage.js";
import { DatastoreAgentHistory, AgentHistoryHash } from "./agent-history.js";
import { DatastoreAgentExecution } from "./agent-execution.js";
import type { DatastoreExecutionRows } from "./agent-execution.js";
import type { AgentExecutionStorageInput } from "@spine-event-engine/storage/provider";
import {
  DefaultNamespaceConverter,
  NamespaceAssignments,
  type NamespaceConverter,
} from "./namespace.js";
import { DatastoreTenantCatalog } from "./tenant-catalog.js";

const maxClientSideScan = 1_000;

/**
 * Describes the physical Datastore kind used for a record family.
 */
export interface RecordLayout {
  // prettier-ignore

  /**
   * Names the physical Datastore kind.
   */
  readonly kind: string;
}

/**
 * Creates a customized provider for one record family.
 *
 * The custom provider handles tenant, ID, and column mapping. Builder-configured
 * namespace converters and stringifiers are not passed to this callback.
 *
 * @param context The storage context.
 * @param recordSpec The record-family contract.
 * @param client The caller-owned Datastore client.
 * @param maxClientSideScan The finite reconciliation bound.
 * @returns The customized storage handle.
 * @typeParam R Stored record message type.
 */
export interface CreateRecordStorage<R extends Message = Message> {
  /**
   * Creates the custom record handle for one identifier type.
   *
   * @typeParam I Record identifier type.
   * @param context Identifies the storage context.
   * @param recordSpec Defines the record family.
   * @param client Supplies the Datastore client.
   * @param maxClientSideScan Bounds local query reconciliation.
   * @returns The custom record handle.
   */
  // eslint-disable-next-line @typescript-eslint/prefer-function-type -- Documented generic call signature.
  <I>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    client: Datastore,
    maxClientSideScan: number,
  ): RecordStorage<I, R>;
}

/**
 * Creates a coherent customized persistence provider for one Entity type.
 *
 * The custom provider handles tenant, ID, and column mapping. Builder-configured
 * namespace converters and stringifiers are not passed to this callback.
 *
 * @param input The Entity storage contract.
 * @param client The caller-owned Datastore client.
 * @returns The customized Entity storage handle.
 * @typeParam S Entity state message type.
 */
export interface CreateEntityStorage<S extends Message = Message> {
  /**
   * Creates custom Entity persistence for one identifier type.
   *
   * @typeParam I Entity identifier type.
   * @param input Defines the Entity storage contract.
   * @param client Supplies the Datastore client.
   * @returns The custom Entity storage handle.
   */
  // eslint-disable-next-line @typescript-eslint/prefer-function-type -- Documented generic call signature.
  <I>(input: EntityStorageInput<I, S>, client: Datastore): DatastoreEntityStorageHandle<I, S>;
}

/**
 * Groups the current state, histories, and commits for one Entity type.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
export interface DatastoreEntityStorageHandle<I, S extends Message> {
  // prettier-ignore

  /**
   * Provides current Entity record access.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Provides retained state history access.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Provides retained diagnostic event history access.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Provides ordered Entity commit access.
   */
  readonly commits: EntityCommitStorage;

  /**
   * Returns whether the handle remains open.
   *
   * @returns `true` while operations are accepted.
   */
  isOpen(): boolean;

  /**
   * Closes the handle.
   *
   * @returns Completion after retained resources are closed.
   */
  close(): Promise<void>;

  /**
   * Closes an idle bundle during synchronous assembly rollback.
   */
  closeIdle(): void;
}

/**
 * Configures a Datastore storage factory before it is built.
 */
export interface DatastoreStorageFactoryBuilder {
  // prettier-ignore

  /**
   * Sets the caller-owned Datastore client.
   *
   * @param client Supplies the Datastore client.
   * @returns Returns this builder.
   */
  setClient(client: Datastore): this;

  /**
   * Sets the reversible converter used for multitenant native namespaces.
   *
   * @param converter Converts complete tenants to and from owned namespaces.
   * @returns Returns this builder.
   */
  setNamespaceConverter(converter: NamespaceConverter): this;

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry Supplies schema-bound message stringifiers.
   * @returns Returns this builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this;

  /**
   * Sets a physical kind for every use of a record type.
   *
   * @typeParam R Stored record message type.
   * @param recordType The record type that receives the layout.
   * @param layout The selected physical layout.
   * @returns This builder.
   */
  organizeRecords<R extends Message>(recordType: GenMessage<R>, layout: RecordLayout): this;

  /**
   * Sets a physical kind for one source and record-type pair.
   *
   * @typeParam S Entity state message type.
   * @typeParam R Stored record message type.
   * @param sourceType The Entity state type that owns the records.
   * @param recordType The record type that receives the layout.
   * @param layout The selected physical layout.
   * @returns This builder.
   */
  organizeRecords<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    layout: RecordLayout,
  ): this;

  /**
   * Sets a custom provider for every use of a record type.
   *
   * @typeParam R Stored record message type.
   * @param recordType The record type served by the provider.
   * @param creator The custom record-storage provider.
   * @returns This builder.
   */
  useRecordStorage<R extends Message>(
    recordType: GenMessage<R>,
    creator: CreateRecordStorage<R>,
  ): this;

  /**
   * Sets a custom provider for one source and record-type pair.
   *
   * @typeParam S Entity state message type.
   * @typeParam R Stored record message type.
   * @param sourceType The Entity state type that owns the records.
   * @param recordType The record type served by the provider.
   * @param creator The custom record-storage provider.
   * @returns This builder.
   */
  useRecordStorage<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    creator: CreateRecordStorage<R>,
  ): this;

  /**
   * Sets a custom persistence provider for one Entity state type.
   *
   * @typeParam S Entity state message type.
   * @param sourceType The Entity state type served by the provider.
   * @param creator The custom Entity persistence provider.
   * @returns This builder.
   */
  useEntityStorage<S extends Message>(
    sourceType: GenMessage<S>,
    creator: CreateEntityStorage<S>,
  ): this;

  /**
   * Builds a Datastore storage factory from this configuration.
   *
   * @returns The configured storage factory.
   */
  build(): DatastoreStorageFactory;
}

/**
 * A Google Cloud Datastore-backed implementation of the Spine TS storage port.
 */
export class DatastoreStorageFactory extends StorageFactory implements TenantCatalogProvider {
  readonly #commits = new Set<EntityCommitStorage>();

  readonly #bundles = new Set<DatastoreEntityStorageHandle<unknown, Message>>();

  /**
   * Repeatable asynchronous close completion.
   */
  #closing: Promise<void> | undefined;

  /**
   * Caller-supplied Datastore client.
   */
  readonly #client: Datastore;

  /**
   * Custom record creators indexed by source and record type.
   */
  readonly #recordCreators: ReadonlyMap<string, CreateRecordStorage>;

  /**
   * Physical layouts indexed by source and record type.
   */
  readonly #layouts: ReadonlyMap<string, RecordLayout>;

  /**
   * Custom Entity creators indexed by state type.
   */
  readonly #entityCreators: ReadonlyMap<string, CreateEntityStorage>;

  /**
   * Reversible tenant namespace assignment.
   */
  readonly #namespaceConverter: NamespaceAssignments;

  /**
   * Message-valued ID and column conversion registry.
   */
  readonly #stringifiers: StringifierRegistry;

  /**
   * Native tenant namespace catalog.
   */
  readonly #catalog: DatastoreTenantCatalog;

  /**
   * Starts a mutable factory configuration.
   *
   * @returns A new factory builder.
   */
  static newBuilder(): DatastoreStorageFactoryBuilder {
    return new Builder(
      (client, recordCreators, layouts, entityCreators, namespaceConverter, stringifiers) =>
        new DatastoreStorageFactory(
          client,
          recordCreators,
          layouts,
          entityCreators,
          namespaceConverter,
          stringifiers,
        ),
    );
  }

  /**
   * Creates a factory from resolved dependencies.
   *
   * @param client The caller-owned Datastore client.
   * @param recordCreators Custom record-storage providers by record family.
   * @param layouts Physical record layouts by record family.
   * @param entityCreators Custom Entity persistence providers by Entity type.
   * @param namespaceConverter Converts complete tenants to native namespaces.
   * @param stringifiers Converts message-valued IDs and columns.
   * @internal
   */
  private constructor(
    client: Datastore,
    recordCreators: ReadonlyMap<string, CreateRecordStorage>,
    layouts: ReadonlyMap<string, RecordLayout>,
    entityCreators: ReadonlyMap<string, CreateEntityStorage>,
    namespaceConverter: NamespaceConverter,
    stringifiers: StringifierRegistry,
  ) {
    super();
    this.#client = client;
    this.#recordCreators = recordCreators;
    this.#layouts = layouts;
    this.#entityCreators = entityCreators;
    this.#namespaceConverter = new NamespaceAssignments(namespaceConverter);
    this.#stringifiers = new StringifierRegistry(stringifiers);
    this.#catalog = new DatastoreTenantCatalog(client, this.#namespaceConverter);
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    this.registerAgentHistory();
    this.registerAgentExecution();
  }

  /**
   * Registers the required provider-only Agent history capability.
   */
  private registerAgentHistory(): void {
    AgentHistoryStorageFactories.register(this, {
      createAgentHistoryStorage: (input) => {
        if (!this.isOpen()) throw new Error("StorageFactory is closed.");
        return new DatastoreAgentHistory(
          input,
          new DatastoreRecordStorage(
            input.context,
            AgentHistoryRecords.spec((value) => AgentHistoryHash.value(value)),
            this.#client,
            maxClientSideScan,
            AgentHistoryRecords.group,
            "spine_agent_history",
            this.#namespaceConverter,
            this.#stringifiers,
          ),
        );
      },
    });
  }

  /**
   * Registers the native transactional Agent execution capability.
   */
  private registerAgentExecution(): void {
    AgentExecutionStorageFactories.register(this, {
      createAgentExecutionStorage: (input) => this.createAgentExecution(input),
    });
  }

  /**
   * Opens one Agent execution handle after factory lifecycle validation.
   *
   * @param input Requested fenced execution change.
   * @returns Tenant-scoped Agent execution storage handle.
   * @typeParam I Typed entity identifier.
   * @typeParam S Generated Entity state.
   */
  private createAgentExecution<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): DatastoreAgentExecution<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    return new DatastoreAgentExecution(input, this.executionRows(input));
  }

  /**
   * Opens the fixed execution kinds and existing Entity record families.
   *
   * @param input Requested fenced execution change.
   * @returns Tenant-scoped native record handles.
   * @typeParam I Typed entity identifier.
   * @typeParam S Generated Entity state.
   */
  private executionRows<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): DatastoreExecutionRows<I> {
    const context = input.entity.context;
    const digest = (value: string) => AgentHistoryHash.value(value);
    return {
      invocation: this.executionRecord(
        context,
        AgentExecutionRecords.invocationSpec(digest),
        AgentExecutionRecords.invocationGroup,
        "spine_agent_execution",
      ),
      head: this.executionRecord(
        context,
        AgentExecutionRecords.headSpec(digest),
        AgentExecutionRecords.headGroup,
        "spine_agent_execution_head",
      ),
      history: this.executionRecord(
        context,
        AgentHistoryRecords.spec(digest),
        AgentHistoryRecords.group,
        "spine_agent_history",
      ),
      current: this.executionRecord(context, input.entity.recordSpec),
      ...this.optionalExecutionRows(input),
      events: this.executionRecord(context, eventStoreRecordSpec),
    };
  }

  /**
   * Opens optional existing Entity state and diagnostic record families.
   *
   * @param input Typed Agent repository and history configuration.
   * @returns Optional native state and diagnostic handles.
   * @typeParam I Typed Agent identifier.
   * @typeParam S Generated Agent state.
   */
  private optionalExecutionRows<I, S extends Message>(
    input: AgentExecutionStorageInput<I, S>,
  ): Pick<DatastoreExecutionRows<I>, "states" | "diagnostics"> {
    const context = input.entity.context;
    const state = input.entity.stateHistory
      ? stateHistorySpec(input.entity.stateSchema)
      : undefined;
    const diagnostic = input.entity.eventHistory
      ? eventHistorySpec(input.entity.stateSchema)
      : undefined;
    return {
      ...(state === undefined
        ? {}
        : {
            states: this.executionRecord(
              context,
              state.spec,
              state.group,
            ) as unknown as DatastoreRecordStorage<unknown, EntityRecord>,
          }),
      ...(diagnostic === undefined
        ? {}
        : {
            diagnostics: this.executionRecord(
              context,
              diagnostic.spec,
              diagnostic.group,
            ) as unknown as DatastoreRecordStorage<unknown, Event>,
          }),
    };
  }

  /**
   * Resolves one native kind through the existing record layout.
   *
   * @param context Captured event storage context.
   * @param fixedKind Fixed native Datastore kind.
   * @param group Fixed storage group.
   * @param spec Typed record layout.
   * @returns Typed native record handle.
   * @typeParam I Typed entity identifier.
   * @typeParam R Typed persisted record.
   */
  private executionRecord<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
    fixedKind?: string,
  ): DatastoreRecordStorage<I, R> {
    const kind = fixedKind ?? this.resolve(spec, group, false).layout?.kind;
    return new DatastoreRecordStorage(
      context,
      spec,
      this.#client,
      maxClientSideScan,
      group,
      kind,
      this.#namespaceConverter,
      this.#stringifiers,
    );
  }

  /**
   * Creates the selected Entity provider bundle.
   *
   * @typeParam I Entity identifier type.
   * @typeParam S Entity state message type.
   * @param input The Entity persistence contract.
   * @returns The coherent Entity storage handle.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): DatastoreEntityStorageHandle<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const custom = this.#entityCreators.get(input.sourceType.typeName);
    if (custom !== undefined)
      return this.retainBundle(custom(input, this.#client) as DatastoreEntityStorageHandle<I, S>);
    const openRecords: OpenEntityRecords = (recordSpec, group) =>
      this.createEntityRecordStorage(input.context, recordSpec, group);
    const storage = new DatastoreEntityStorage(input, openRecords);
    const commits = new DatastoreEntityCommitStorage(
      input as EntityStorageInput<unknown, Message>,
      openRecords,
    );
    return this.retainBundle(new DefaultEntityHandle(storage, commits));
  }

  /**
   * Registers a coherent Entity bundle for factory shutdown.
   *
   * @param bundle The coherent Entity storage bundle.
   * @returns The tracked Entity storage bundle.
   * @typeParam I Entity identifier or record type.
   * @typeParam S Generated Entity state message type.
   */
  private retainBundle<I, S extends Message>(
    bundle: DatastoreEntityStorageHandle<I, S>,
  ): DatastoreEntityStorageHandle<I, S> {
    const retained: DatastoreEntityStorageHandle<I, S> = {
      current: bundle.current,
      states: bundle.states,
      events: bundle.events,
      commits: bundle.commits,
      isOpen: () => bundle.isOpen(),
      ...this.retainCleanup(bundle, () => this.#bundles.delete(retained)),
    };
    this.#bundles.add(retained);
    return retained;
  }

  /**
   * Opens direct built-in commit access without an unused Entity read bundle.
   *
   * @param input The captured Entity persistence input.
   * @returns The provider commit handle.
   * @typeParam I Entity identifier or record type.
   * @typeParam S Generated Entity state message type.
   */
  private createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const custom = this.#entityCreators.get(input.sourceType.typeName);
    if (custom !== undefined) {
      const bundle = custom(input, this.#client) as DatastoreEntityStorageHandle<I, S>;
      const adapter: EntityCommitStorage = {
        commit: (work) => bundle.commits.commit(work),
        ...this.retainCleanup(bundle, () => this.#commits.delete(adapter)),
      };
      this.#commits.add(adapter);
      return adapter;
    }
    const openRecords: OpenEntityRecords = (recordSpec, group) =>
      this.createEntityRecordStorage(input.context, recordSpec, group);
    const commits = new DatastoreEntityCommitStorage(
      input as EntityStorageInput<unknown, Message>,
      openRecords,
      () => this.#commits.delete(commits),
    );
    this.#commits.add(commits);
    return commits;
  }

  /**
   * Creates repeatable cleanup methods that retain a bundle until closure settles.
   *
   * @param bundle The complete provider bundle.
   * @param onRemove Removes the settled factory root.
   * @returns Repeatable close methods.
   */
  private retainCleanup(
    bundle: Pick<DatastoreEntityStorageHandle<unknown, Message>, "close" | "closeIdle">,
    onRemove: () => void,
  ): Pick<EntityCommitStorage, "close" | "closeIdle"> {
    let closing: Promise<void> | undefined;
    return {
      close: () => {
        if (closing !== undefined) return closing;
        try {
          closing = bundle.close();
        } catch (error) {
          closing = Promise.reject(
            error instanceof Error
              ? error
              : new Error("Datastore cleanup failed.", { cause: error }),
          );
        }
        return (closing = closing.then(
          () => {
            onRemove();
          },
          (error: unknown) => {
            onRemove();
            throw error;
          },
        ));
      },
      closeIdle: () => {
        bundle.closeIdle();
        onRemove();
      },
    };
  }

  /**
   * Creates provider-specific Datastore record storage.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored record message type.
   * @param context The storage context.
   * @param recordSpec The record specification.
   * @param group Separates records that share one source type.
   * @returns The created Datastore record storage.
   */
  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const resolved = this.resolve(recordSpec, group, true);
    const creator = resolved.creator;
    if (creator !== undefined)
      return creator(context, recordSpec, this.#client, maxClientSideScan) as RecordStorage<I, R>;
    return new DatastoreRecordStorage(
      context,
      recordSpec,
      this.#client,
      maxClientSideScan,
      group,
      resolved.layout?.kind,
      this.#namespaceConverter,
      this.#stringifiers,
    );
  }

  /**
   * Opens the built-in record provider for generated Entity families.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored record message type.
   * @param context Identifies the storage tenant and context.
   * @param recordSpec Defines the generated record family.
   * @param group Selects an optional grouped history family.
   * @returns A built-in Datastore record handle.
   */
  private createEntityRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const resolved = this.resolve(recordSpec, group, false);
    return new DatastoreRecordStorage(
      context,
      recordSpec,
      this.#client,
      maxClientSideScan,
      group,
      resolved.layout?.kind,
      this.#namespaceConverter,
      this.#stringifiers,
    );
  }

  /**
   * Resolves the registered creator and physical layout for a record family.
   *
   * @typeParam I Record identifier type.
   * @typeParam R Stored record message type.
   * @param recordSpec Defines the requested family.
   * @param group Selects an optional grouped family.
   * @param includeCreator Allows a custom record creator for ordinary records.
   * @returns Matching custom creator and physical layout, when registered.
   */
  private resolve<I, R extends Message>(
    recordSpec: RecordSpec<I, R>,
    group: StorageGroup | undefined,
    includeCreator: boolean,
  ): {
    readonly creator: CreateRecordStorage | undefined;
    readonly layout: RecordLayout | undefined;
  } {
    const source = recordSpec.sourceType.typeName;
    const record = recordSpec.recordType.typeName;
    const exact = key(group?.name ?? source, record);
    const fallback = key(
      group === undefined ? source : record,
      group === undefined ? source : record,
    );
    return {
      creator: includeCreator
        ? (this.#recordCreators.get(exact) ?? this.#recordCreators.get(fallback))
        : undefined,
      layout: this.#layouts.get(exact) ?? this.#layouts.get(fallback),
    };
  }

  /**
   * Returns the provider-owned native namespace catalog.
   *
   * @returns The Datastore tenant catalog.
   */
  tenantCatalog(): TenantCatalog {
    return this.#catalog;
  }

  /**
   * Closes the factory and its native tenant catalog.
   *
   * @returns Completion after retained resources are closed.
   */
  override close(): Promise<void> {
    this.fenceClose();
    if (this.#closing !== undefined) return this.#closing;
    const closing = Promise.withResolvers<undefined>();
    this.#closing = closing.promise;
    this.drain().then(() => {
      closing.resolve(undefined);
    }, closing.reject);
    return closing.promise;
  }

  /**
   * Waits for admitted commits before closing remaining factory resources.
   *
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(): Promise<void> {
    const errors: unknown[] = [];
    const roots = [...this.#commits, ...this.#bundles];
    const pending = roots.map((handle) => {
      try {
        return handle.close();
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error("Datastore cleanup failed.", { cause: error }),
        );
      }
    });
    for (const result of await Promise.allSettled(pending))
      if (result.status === "rejected") errors.push(result.reason);
    try {
      await this.#catalog.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Datastore factory close failed.");
  }
}

/**
 * Configures a Datastore storage factory before construction.
 */
class Builder implements DatastoreStorageFactoryBuilder {
  /**
   * Caller-supplied client required by build.
   */
  #client: Datastore | undefined;

  /**
   * Custom record creators indexed by family.
   */
  #recordCreators = new Map<string, CreateRecordStorage>();

  /**
   * Physical kind layouts indexed by family.
   */
  #layouts = new Map<string, RecordLayout>();

  /**
   * Custom Entity creators indexed by state type.
   */
  #entityCreators = new Map<string, CreateEntityStorage>();

  /**
   * Converter for multitenant Datastore namespaces.
   */
  #namespaceConverter: NamespaceConverter = new DefaultNamespaceConverter();

  /**
   * Converter for message-valued IDs and columns.
   */
  #stringifiers = new StringifierRegistry();

  /**
   * Creates a builder with the selected factory constructor.
   *
   * @param create Constructs the configured factory.
   */
  constructor(
    private readonly create: (
      client: Datastore,
      recordCreators: ReadonlyMap<string, CreateRecordStorage>,
      layouts: ReadonlyMap<string, RecordLayout>,
      entityCreators: ReadonlyMap<string, CreateEntityStorage>,
      namespaceConverter: NamespaceConverter,
      stringifiers: StringifierRegistry,
    ) => DatastoreStorageFactory,
  ) {}

  /**
   * Sets the caller-supplied Datastore client.
   *
   * @param client Connects to the chosen Datastore project.
   * @returns This builder.
   */
  setClient(client: Datastore): this {
    this.#client = client;
    return this;
  }

  /**
   * Sets reversible tenant namespace conversion.
   *
   * @param converter Converts complete tenant identities.
   * @returns This builder.
   */
  setNamespaceConverter(converter: NamespaceConverter): this {
    this.#namespaceConverter = converter;
    return this;
  }

  /**
   * Sets message-valued ID and column converters.
   *
   * @param registry Supplies schema-bound message stringifiers.
   * @returns This builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this {
    this.#stringifiers = new StringifierRegistry(registry);
    return this;
  }

  /**
   * Registers a physical kind for one source and record family.
   *
   * @typeParam R Stored record message type.
   * @param first Record type, or source type when three arguments are supplied.
   * @param second Layout, or record type when three arguments are supplied.
   * @param third Layout for a source-specific registration.
   * @returns This builder.
   */
  organizeRecords<R extends Message>(
    first: GenMessage<Message> | GenMessage<R>,
    second: GenMessage<R> | RecordLayout,
    third?: RecordLayout,
  ): this {
    const [source, record, layout] =
      third === undefined ? [undefined, first, second] : [first, second as GenMessage<R>, third];
    this.#layouts.set(
      key(source?.typeName ?? record.typeName, record.typeName),
      checkedLayout(layout),
    );
    return this;
  }

  /**
   * Registers a custom record provider for one family.
   *
   * @typeParam R Stored record message type.
   * @param first Record type, or source type when three arguments are supplied.
   * @param second Creator, or record type when three arguments are supplied.
   * @param third Creator for a source-specific registration.
   * @returns This builder.
   */
  useRecordStorage<R extends Message>(
    first: GenMessage<Message> | GenMessage<R>,
    second: GenMessage<R> | CreateRecordStorage<R>,
    third?: CreateRecordStorage<R>,
  ): this {
    const [source, record, creator] =
      third === undefined
        ? [undefined, first, second as CreateRecordStorage<R>]
        : [first, second as GenMessage<R>, third];
    this.#recordCreators.set(
      key(source?.typeName ?? record.typeName, record.typeName),
      creator as unknown as CreateRecordStorage,
    );
    return this;
  }

  /**
   * Registers a custom persistence provider for an Entity state type.
   *
   * @typeParam S Entity state message type.
   * @param sourceType Selects the Entity state type.
   * @param creator Builds its storage handle.
   * @returns This builder.
   */
  useEntityStorage<S extends Message>(
    sourceType: GenMessage<S>,
    creator: CreateEntityStorage<S>,
  ): this {
    this.#entityCreators.set(sourceType.typeName, creator as unknown as CreateEntityStorage);
    return this;
  }

  /**
   * Builds a factory after validating its client and kind registrations.
   *
   * @returns The configured Datastore storage factory.
   */
  build(): DatastoreStorageFactory {
    if (this.#client === undefined)
      throw new Error("DatastoreStorageFactory builder requires a client.");
    rejectKindCollisions(this.#layouts);
    return this.create(
      this.#client,
      new Map(this.#recordCreators),
      new Map(this.#layouts),
      new Map(this.#entityCreators),
      this.#namespaceConverter,
      this.#stringifiers,
    );
  }
}

/**
 * Combines generated Entity records and commit access for one source.
 *
 * @typeParam I Entity identifier type.
 * @typeParam S Entity state message type.
 */
class DefaultEntityHandle<I, S extends Message> implements DatastoreEntityStorageHandle<I, S> {
  #open = true;

  #idleOutcome: { error?: Error } | undefined;

  #closing: Promise<void> | undefined;

  /**
   * Current Entity record access.
   */
  readonly current: EntityRecordStorage<I>;

  /**
   * Retained state history access.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Retained diagnostic history access.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Ordered Entity commit access.
   */
  readonly commits: DatastoreEntityCommitStorage;

  /**
   * Shared record-family handles.
   */
  readonly #storage: DatastoreEntityStorage<I, S>;

  /**
   * Connects the generated storage and commit handle.
   *
   * @param storage Opens current and retained Entity records.
   * @param commits Writes one prepared Entity mutation.
   */
  constructor(storage: DatastoreEntityStorage<I, S>, commits: DatastoreEntityCommitStorage) {
    this.#storage = storage;
    this.current = storage.current;
    this.states = storage.states;
    this.events = storage.events;
    this.commits = commits;
  }

  /**
   * Returns whether the generated storage remains open.
   *
   * @returns Whether operations remain available.
   */
  isOpen(): boolean {
    return this.#open && this.#storage.isOpen();
  }

  /**
   * Closes generated records and commit access.
   *
   * @returns Completion after retained resources are closed.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing;
    this.#open = false;
    if (this.#idleOutcome !== undefined) {
      const failure = this.#idleOutcome.error;
      return (this.#closing = failure === undefined ? Promise.resolve() : Promise.reject(failure));
    }
    const completion = this.commits.close();
    return (this.#closing = this.drain(completion));
  }

  /**
   * Closes read records after an admitted commit settles.
   *
   * @param completion The admitted commit completion.
   * @returns Completion after admitted work and cleanup settle.
   */
  private async drain(completion: Promise<void>): Promise<void> {
    const errors: unknown[] = [];
    try {
      await completion;
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#storage.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Datastore Entity close failed.");
  }

  /**
   * Closes a bundle synchronously when no commit or close remains in progress.
   */
  closeIdle(): void {
    if (this.#idleOutcome !== undefined) {
      if (this.#idleOutcome.error !== undefined) throw this.#idleOutcome.error;
      return;
    }
    if (this.#closing !== undefined) throw new Error("Entity bundle close is in progress.");
    this.commits.assertIdle();
    this.#open = false;
    const errors: unknown[] = [];
    try {
      this.commits.closeIdle();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.#storage.close();
    } catch (error) {
      errors.push(error);
    }
    const failure =
      errors.length > 1
        ? new AggregateError(errors, "Datastore bundle idle close failed.")
        : errors[0] === undefined
          ? undefined
          : errors[0] instanceof Error
            ? errors[0]
            : new Error("Datastore cleanup failed.", { cause: errors[0] });
    this.#idleOutcome = failure === undefined ? {} : { error: failure };
    if (failure !== undefined) throw failure;
  }
}

function key(source: string, record: string): string {
  return `${source}\u0000${record}`;
}

function checkedLayout(layout: RecordLayout): RecordLayout {
  if (layout.kind.trim().length === 0 || Buffer.byteLength(layout.kind, "utf8") > 1_500)
    throw new Error("Datastore record kind must be non-blank and at most 1,500 bytes.");
  return Object.freeze({ kind: layout.kind });
}

function rejectKindCollisions(layouts: ReadonlyMap<string, RecordLayout>): void {
  const identities = new Map<string, string>();
  for (const [identity, layout] of layouts) {
    const previous = identities.get(layout.kind);
    if (previous !== undefined && previous !== identity)
      throw new Error("Distinct Datastore registrations cannot claim the same custom kind.");
    identities.set(layout.kind, identity);
  }
}
