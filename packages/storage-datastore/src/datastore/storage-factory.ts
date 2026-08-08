import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { Datastore } from "@google-cloud/datastore";
import {
  RecordStorage,
  StorageFactory,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import type {
  EntityCommitStorage,
  EntityEventHistoryPort,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import { EntityCommitStorageFactories } from "@spine-event-engine/storage/internal/entity-commit";

import {
  DatastoreEntityCommitStorage,
  DatastoreEntityStorage,
  type OpenEntityRecords,
} from "./entity-history.js";
import { DatastoreRecordStorage } from "./record-storage.js";

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
 * @param context The storage context.
 * @param recordSpec The record-family contract.
 * @param client The caller-owned Datastore client.
 * @param maxClientSideScan The finite reconciliation bound.
 * @returns The customized storage handle.
 */
export type CreateRecordStorage<R extends Message = Message> = <I>(
  context: StorageContext,
  recordSpec: RecordSpec<I, R>,
  client: Datastore,
  maxClientSideScan: number,
) => RecordStorage<I, R>;

/**
 * Creates a coherent customized persistence provider for one Entity type.
 *
 * @param input The Entity storage contract.
 * @param client The caller-owned Datastore client.
 * @returns The customized Entity storage handle.
 */
export type CreateEntityStorage<S extends Message = Message> = <I>(
  input: EntityStorageInput<I, S>,
  client: Datastore,
) => DatastoreEntityStorageHandle<I, S>;

/**
 * Groups the current state, histories, and commits for one Entity type.
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
   * Provides atomic Entity commit access.
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
   */
  close(): void;
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
   * Sets a physical kind for every use of a record type.
   *
   * @param recordType The record type that receives the layout.
   * @param layout The selected physical layout.
   * @returns This builder.
   */
  organizeRecords<R extends Message>(recordType: GenMessage<R>, layout: RecordLayout): this;

  /**
   * Sets a physical kind for one source and record-type pair.
   *
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
export class DatastoreStorageFactory extends StorageFactory {
  readonly #client: Datastore;
  readonly #recordCreators: ReadonlyMap<string, CreateRecordStorage>;
  readonly #layouts: ReadonlyMap<string, RecordLayout>;
  readonly #entityCreators: ReadonlyMap<string, CreateEntityStorage>;

  /**
   * Starts a mutable factory configuration.
   *
   * @returns A new factory builder.
   */
  static newBuilder(): DatastoreStorageFactoryBuilder {
    return new Builder(
      (client, recordCreators, layouts, entityCreators) =>
        new DatastoreStorageFactory(client, recordCreators, layouts, entityCreators),
    );
  }

  /**
   * Creates a factory from resolved dependencies.
   *
   * @param client The caller-owned Datastore client.
   * @param recordCreators Custom record-storage providers by record family.
   * @param layouts Physical record layouts by record family.
   * @param entityCreators Custom Entity persistence providers by Entity type.
   * @internal
   */
  private constructor(
    client: Datastore,
    recordCreators: ReadonlyMap<string, CreateRecordStorage>,
    layouts: ReadonlyMap<string, RecordLayout>,
    entityCreators: ReadonlyMap<string, CreateEntityStorage>,
  ) {
    super();
    this.#client = client;
    this.#recordCreators = recordCreators;
    this.#layouts = layouts;
    this.#entityCreators = entityCreators;
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityStorage(input).commits,
    });
  }

  /**
   * Creates the selected Entity provider bundle.
   *
   * @param input The Entity persistence contract.
   * @returns The coherent Entity storage handle.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): DatastoreEntityStorageHandle<I, S> {
    if (!this.isOpen()) throw new Error("StorageFactory is closed.");
    const custom = this.#entityCreators.get(input.sourceType.typeName);
    if (custom !== undefined)
      return custom(input, this.#client) as DatastoreEntityStorageHandle<I, S>;
    const openRecords: OpenEntityRecords = (recordSpec, group) =>
      this.createEntityRecordStorage(input.context, recordSpec, group);
    const storage = new DatastoreEntityStorage(input, openRecords);
    const commits = new DatastoreEntityCommitStorage(
      input as EntityStorageInput<unknown, Message>,
      this.#client,
      openRecords,
    );
    return new DefaultEntityHandle(storage, commits);
  }

  /**
   * Creates a record-storage handle.
   *
   * @inheritdoc
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
    );
  }

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
    );
  }

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
}

class Builder implements DatastoreStorageFactoryBuilder {
  #client: Datastore | undefined;
  #recordCreators = new Map<string, CreateRecordStorage>();
  #layouts = new Map<string, RecordLayout>();
  #entityCreators = new Map<string, CreateEntityStorage>();

  constructor(
    private readonly create: (
      client: Datastore,
      recordCreators: ReadonlyMap<string, CreateRecordStorage>,
      layouts: ReadonlyMap<string, RecordLayout>,
      entityCreators: ReadonlyMap<string, CreateEntityStorage>,
    ) => DatastoreStorageFactory,
  ) {}

  setClient(client: Datastore): this {
    this.#client = client;
    return this;
  }

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

  useEntityStorage<S extends Message>(
    sourceType: GenMessage<S>,
    creator: CreateEntityStorage<S>,
  ): this {
    this.#entityCreators.set(sourceType.typeName, creator as unknown as CreateEntityStorage);
    return this;
  }

  build(): DatastoreStorageFactory {
    if (this.#client === undefined)
      throw new Error("DatastoreStorageFactory builder requires a client.");
    rejectKindCollisions(this.#layouts);
    return this.create(
      this.#client,
      new Map(this.#recordCreators),
      new Map(this.#layouts),
      new Map(this.#entityCreators),
    );
  }
}

class DefaultEntityHandle<I, S extends Message> implements DatastoreEntityStorageHandle<I, S> {
  readonly current: EntityRecordStorage<I>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly commits: EntityCommitStorage;
  readonly #storage: DatastoreEntityStorage<I, S>;

  constructor(storage: DatastoreEntityStorage<I, S>, commits: EntityCommitStorage) {
    this.#storage = storage;
    this.current = storage.current;
    this.states = storage.states;
    this.events = storage.events;
    this.commits = commits;
  }

  isOpen(): boolean {
    return this.#storage.isOpen();
  }
  close(): void {
    this.#storage.close();
    this.commits.close();
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
