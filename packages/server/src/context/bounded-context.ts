import { clone, type Message } from "@bufbuild/protobuf";
import { EventSchema, type Command, type Event } from "@spine-ts/proto";
import {
  EventStore,
  InMemoryStorageFactory,
  RecordColumn,
  RecordSpec,
  type RecordStorage,
  type StorageContext,
  type StorageFactory,
} from "@spine-ts/storage";

import { CommandBus } from "../bus/command-bus.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import { EventBus, eventBusAccess } from "../bus/event-bus.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  Repository,
  repositoryAccess,
  type ConcreteRepositoryEntityType,
  type RepositoryEntityType,
  type RepositoryIdentitySnapshot,
  type RepositoryView,
} from "../repository/repository.js";
import type {
  DescriptorMessageSchema,
  DescriptorFieldMetadata,
  EntityMetadata,
} from "../entity/entity-metadata.js";
import { Stand } from "../stand/stand.js";

/** Tenant isolation mode declared by a bounded context specification. */
export type TenantMode = "single-tenant" | "multitenant";

/** Immutable bounded context name value. */
export interface BoundedContextName {
  /** Non-empty, non-blank bounded context name. */
  readonly value: string;
}

/** Small immutable bounded-context specification snapshot. */
export interface ContextSpecSnapshot {
  /** Bounded context name value. */
  readonly name: BoundedContextName;
  /** Whether the context requires tenant isolation. */
  readonly multitenant: boolean;
  /** Whether the context stores its domain event log. */
  readonly storesEvents: boolean;
}

/** Small built bounded-context metadata snapshot. */
export interface BoundedContextSnapshot {
  /** Bounded context name value. */
  readonly name: BoundedContextName;
  /** Tenant isolation mode for the built context. */
  readonly tenantMode: TenantMode;
  /** Context specification used to build the context. */
  readonly spec: ContextSpecSnapshot;
}

/** Minimal repository owner marker retained after registration. */
interface RepositoryOwner {
  /** Bounded context name. */
  readonly name: BoundedContextName;
}

/** Context-owned storage data needed while repositories register. */
interface RepositoryRegistration {
  /** Bounded context name. */
  readonly name: BoundedContextName;
  /** Storage context derived from the bounded context spec. */
  readonly storageContext: StorageContext;
  /** Context storage factory. */
  readonly storageFactory: StorageFactory;
  /** Context-owned read-side Stand used by framework repository dispatch. */
  readonly stand: Stand;
  /** Stored-event dispatch callback into the owning context event bus. */
  readonly dispatchStored: (event: Event) => Promise<void>;
  /** Records post-commit stored-event dispatch failures for diagnostics. */
  readonly recordStoredEventDispatchFailure: (event: Event, error: unknown) => void;
}

interface RegistrationSnapshot {
  readonly entityType: RepositoryEntityType;
  readonly entityFamily: RepositoryView["entityFamily"];
  readonly stateSchema: DescriptorMessageSchema;
  readonly metadata: EntityMetadata;
  readonly stateFullTypeName: string;
  readonly idField: DescriptorFieldMetadata;
  readonly snapshot: RepositoryIdentitySnapshot;
}

/** Post-only command endpoint exposed by a built bounded context. */
export interface CommandEndpoint {
  /** Canonical command message type URLs accepted by this endpoint. */
  acceptedCommandTypes(): readonly string[];

  /** Posts a command into the context-owned command bus. */
  post(command: Command): Promise<void>;
}

/** Post-only event endpoint exposed by a built bounded context. */
export interface EventEndpoint {
  /** Posts an event into the context-owned event bus. */
  post(event: Event): Promise<void>;
}

/** Observable failure from asynchronous already-stored event dispatch. */
export interface StoredEventDispatchFailure {
  /** Stored event whose post-commit dispatch failed. */
  readonly event: Event;
  /** Failure thrown by dispatcher acceptance, dispatch, subscriber execution, or Stand update. */
  readonly error: unknown;
}

/** Error thrown when a bounded context name cannot be accepted. */
export class BoundedContextNameError extends Error {
  /** Rejected raw value. */
  readonly value: unknown;

  /** Create a deterministic bounded-context name validation error. */
  constructor(value: unknown) {
    super("A Bounded Context name cannot be empty or blank.");
    this.name = "BoundedContextNameError";
    this.value = value;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

interface FrameworkConstructionToken {
  readonly frameworkConstructionToken: true;
}

const frameworkConstructionToken: FrameworkConstructionToken = Object.freeze({
  frameworkConstructionToken: true,
});
let constructBoundedContext:
  | ((
      snapshot: BoundedContextSnapshot,
      commandBus: CommandBus,
      eventBus: EventBus,
      stand: Stand,
      storageFactory: StorageFactory,
      repositories: readonly RepositoryView[],
      token: FrameworkConstructionToken,
    ) => BoundedContext)
  | undefined;
let constructBoundedContextBuilder:
  | ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => BoundedContextBuilder)
  | undefined;
let constructContextSpec:
  ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => ContextSpec) | undefined;

/** Built bounded context that owns the write-side and event-side buses. */
export class BoundedContext {
  readonly #snapshot: BoundedContextSnapshot;
  readonly #commandBus: CommandBus;
  readonly #eventBus: EventBus;
  readonly #commandEndpoint: CommandEndpoint;
  readonly #eventEndpoint: EventEndpoint;
  readonly #registeredRepositories: RegistrationSnapshot[] = [];
  readonly #storedEventDispatchFailures: StoredEventDispatchFailure[] = [];
  readonly #repositoryStorages = new Set<RecordStorage<unknown, Message>>();
  readonly #storageFactory: StorageFactory;
  readonly #stand: Stand;

  static {
    constructBoundedContext = (
      snapshot,
      commandBus,
      eventBus,
      stand,
      storageFactory,
      repositories,
      token,
    ): BoundedContext =>
      new BoundedContext(
        snapshot,
        commandBus,
        eventBus,
        stand,
        storageFactory,
        repositories,
        token,
      );
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(
    snapshot: BoundedContextSnapshot,
    commandBus: CommandBus,
    eventBus: EventBus,
    stand: Stand,
    storageFactory: StorageFactory,
    repositories: readonly RepositoryView[],
    token: FrameworkConstructionToken,
  ) {
    requireFrameworkConstructionToken(token, "BoundedContext instances are framework-owned.");
    this.#snapshot = cloneContextSnapshot(snapshot);
    this.#commandBus = commandBus;
    this.#eventBus = eventBus;
    this.#stand = stand;
    this.#storageFactory = storageFactory;
    this.#commandEndpoint = Object.freeze({
      acceptedCommandTypes: () => this.#commandBus.acceptedCommandTypes(),
      post: (command: Command) => this.#commandBus.post(command),
    });
    this.#eventEndpoint = Object.freeze({
      post: (event: Event) => this.#eventBus.post(event),
    });
    this.#registerRepositories(repositories);
    Object.freeze(this);
  }

  #registerRepositories(repositories: readonly RepositoryView[]): void {
    const preparedRepositories = this.#prepareRepositories(repositories);

    try {
      for (const preparedRepository of preparedRepositories) {
        rejectRegisteredRepository(preparedRepository.repository);
      }
      for (const preparedRepository of preparedRepositories) {
        this.#stand.register(preparedRepository.snapshot.stateSchema, {
          idField: preparedRepository.snapshot.idField.localName,
        });
        preparedRepository.commit();
        this.#registeredRepositories.push(preparedRepository.snapshot);
        this.#repositoryStorages.add(preparedRepository.storage);
      }
    } catch (error) {
      this.#failRegistration(error, preparedRepositories);
    }
  }

  #prepareRepositories(repositories: readonly RepositoryView[]): PreparedRepository[] {
    const registration: RepositoryRegistration = {
      name: cloneName(this.#snapshot.name),
      storageContext: createStorageContext(this.#snapshot.spec),
      storageFactory: this.#storageFactory,
      stand: this.#stand,
      dispatchStored: (event) => eventBusAccess.postStored(this.#eventBus, event),
      recordStoredEventDispatchFailure: (event, error) => {
        this.#recordStoredEventDispatchFailure(event, error);
      },
    };
    const preparedRepositories: PreparedRepository[] = [];
    try {
      for (const repository of repositories) {
        preparedRepositories.push(prepareRepositoryForContext(repository, registration));
      }
    } catch (error) {
      this.#failRegistration(error, preparedRepositories);
    }
    return preparedRepositories;
  }

  #failRegistration(error: unknown, preparedRepositories: readonly PreparedRepository[]): never {
    const closeErrors = closePreparedRepositories(preparedRepositories);
    if (closeErrors.length > 0) {
      throw new AggregateError(
        [error, ...closeErrors],
        "Repository registration failed, and prepared repository storage cleanup also failed.",
      );
    }
    throw error;
  }

  /** Creates a builder for a single-tenant bounded context. */
  static singleTenant(name: string): BoundedContextBuilder {
    return createBoundedContextBuilder(createSpecSnapshot(name, false));
  }

  /** Creates a builder for a multitenant bounded context. */
  static multitenant(name: string): BoundedContextBuilder {
    return createBoundedContextBuilder(createSpecSnapshot(name, true));
  }

  /** Bounded context name. */
  get name(): BoundedContextName {
    return this.#snapshot.name;
  }

  /** Tenant mode declared for this context. */
  get tenantMode(): TenantMode {
    return this.#snapshot.tenantMode;
  }

  /** Whether this context is multitenant. */
  get isMultitenant(): boolean {
    return this.#snapshot.tenantMode === "multitenant";
  }

  /** Context spec used to build this context. */
  get spec(): ContextSpec {
    return createContextSpec(this.#snapshot.spec);
  }

  /** Copy-safe immutable metadata snapshot of this context. */
  get snapshot(): BoundedContextSnapshot {
    return cloneContextSnapshot(this.#snapshot);
  }

  /** Post-only command endpoint owned by this context. */
  commandBus(): CommandEndpoint {
    return this.#commandEndpoint;
  }

  /** Post-only event endpoint owned by this context. */
  eventBus(): EventEndpoint {
    return this.#eventEndpoint;
  }

  /** Context-owned read-side Stand for direct entity state access and in-process updates. */
  stand(): Stand {
    return this.#stand;
  }

  /** Copy-safe list of frozen snapshot-backed repository views registered with this context. */
  registeredRepositories(): readonly RepositoryView[] {
    return this.#registeredRepositories.map((snapshot) => createRepositoryView(snapshot));
  }

  /** Copy-safe diagnostics for asynchronous already-stored event dispatch failures. */
  storedEventDispatchFailures(): readonly StoredEventDispatchFailure[] {
    return this.#storedEventDispatchFailures.map(cloneDispatchFailure);
  }

  #recordStoredEventDispatchFailure(event: Event, error: unknown): void {
    this.#storedEventDispatchFailures.push(
      Object.freeze({
        event: clone(EventSchema, event),
        error,
      }),
    );
  }
}

/** Builder for assembling a JVM-familiar {@link BoundedContext}. */
export class BoundedContextBuilder {
  readonly #specSnapshot: ContextSpecSnapshot;
  readonly #commandDispatchers = new Set<CommandDispatcher>();
  readonly #eventDispatchers = new Set<EventDispatcher>();
  readonly #repositories = new Set<RepositoryView>();
  #storageFactory: StorageFactory | undefined;

  static {
    constructBoundedContextBuilder = (snapshot, token): BoundedContextBuilder =>
      new BoundedContextBuilder(snapshot, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(specSnapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) {
    requireFrameworkConstructionToken(
      token,
      "BoundedContextBuilder instances are framework-owned.",
    );
    this.#specSnapshot = cloneSpecSnapshot(specSnapshot);
    Object.freeze(this);
  }

  /** Bounded context name configured for the context to build. */
  get name(): BoundedContextName {
    return this.#specSnapshot.name;
  }

  /** Context spec configured for the context to build. */
  get spec(): ContextSpec {
    return createContextSpec(this.#specSnapshot);
  }

  /** Tenant mode configured for the context to build. */
  get tenantMode(): TenantMode {
    return toTenantMode(this.#specSnapshot.multitenant);
  }

  /** Whether this builder will create a multitenant context. */
  isMultitenant(): boolean {
    return this.#specSnapshot.multitenant;
  }

  /** Adds a repository to the context registration list. */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    requireRepositoryInstance(repository, "BoundedContextBuilder.add(repository)");
    this.#repositories.add(repository);
    return this;
  }

  /** Removes a repository from the context registration list. */
  remove<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    requireRepositoryInstance(repository, "BoundedContextBuilder.remove(repository)");
    this.#repositories.delete(repository);
    return this;
  }

  /** Adds a command dispatcher to the context being built. */
  addCommandDispatcher(dispatcher: CommandDispatcher): this {
    this.#commandDispatchers.add(dispatcher);
    return this;
  }

  /** Removes a command dispatcher from the context being built. */
  removeCommandDispatcher(dispatcher: CommandDispatcher): this {
    this.#commandDispatchers.delete(dispatcher);
    return this;
  }

  /** Adds an event dispatcher to the context being built. */
  addEventDispatcher(dispatcher: EventDispatcher): this {
    this.#eventDispatchers.add(dispatcher);
    return this;
  }

  /** Removes an event dispatcher from the context being built. */
  removeEventDispatcher(dispatcher: EventDispatcher): this {
    this.#eventDispatchers.delete(dispatcher);
    return this;
  }

  /** Uses the passed storage factory for context event, repository state, and Stand storage. */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /** Builds a bounded context that owns configured command and event buses. */
  build(): BoundedContext {
    const repositories = [...this.#repositories];
    preflightRepositories(repositories);
    const storageFactory = this.#storageFactory ?? new InMemoryStorageFactory();
    const commandBus = new CommandBus([
      ...this.#commandDispatchers,
      ...repositoryCommandDispatchers(repositories),
    ]);
    const eventStore = this.createEventStore(storageFactory);

    try {
      const eventBus = new EventBus(eventStore, [
        ...repositoryEventDispatchers(repositories),
        ...this.#eventDispatchers,
      ]);
      const stand = new Stand({
        context: createStorageContext(this.#specSnapshot),
        storageFactory,
      });
      return createBoundedContext(
        this.#specSnapshot,
        commandBus,
        eventBus,
        stand,
        storageFactory,
        repositories,
      );
    } catch (error) {
      closeEventStore(eventStore, error);
      throw error;
    }
  }

  private createEventStore(storageFactory: StorageFactory): EventStore {
    return new EventStore(createStorageContext(this.#specSnapshot), storageFactory);
  }
}

/** Immutable context spec used by the bounded-context builder. */
export class ContextSpec {
  readonly #snapshot: ContextSpecSnapshot;

  static {
    constructContextSpec = (snapshot, token): ContextSpec => new ContextSpec(snapshot, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) {
    requireFrameworkConstructionToken(token, "ContextSpec instances are framework-owned.");
    this.#snapshot = cloneSpecSnapshot(snapshot);
    Object.freeze(this);
  }

  /** Bounded context name. */
  get name(): BoundedContextName {
    return this.#snapshot.name;
  }

  /** Whether the context requires tenant isolation. */
  get multitenant(): boolean {
    return this.#snapshot.multitenant;
  }

  /** Tenant mode derived from {@link multitenant}. */
  get tenantMode(): TenantMode {
    return toTenantMode(this.#snapshot.multitenant);
  }

  /** Whether this spec stores its event log. Domain context specs do. */
  get storesEvents(): boolean {
    return this.#snapshot.storesEvents;
  }

  /** Copy-safe immutable snapshot of this spec. */
  get snapshot(): ContextSpecSnapshot {
    return cloneSpecSnapshot(this.#snapshot);
  }
}

function requireFrameworkConstructionToken(token: unknown, message: string): void {
  if (token !== frameworkConstructionToken) {
    throw new TypeError(message);
  }
}

function createContextSpec(specSnapshot: ContextSpecSnapshot): ContextSpec {
  if (constructContextSpec === undefined) {
    throw new TypeError("ContextSpec factory is unavailable.");
  }

  return constructContextSpec(specSnapshot, frameworkConstructionToken);
}

function createBoundedContextBuilder(specSnapshot: ContextSpecSnapshot): BoundedContextBuilder {
  if (constructBoundedContextBuilder === undefined) {
    throw new TypeError("BoundedContextBuilder factory is unavailable.");
  }

  return constructBoundedContextBuilder(specSnapshot, frameworkConstructionToken);
}

function createBoundedContext(
  specSnapshot: ContextSpecSnapshot,
  commandBus: CommandBus,
  eventBus: EventBus,
  stand: Stand,
  storageFactory: StorageFactory,
  repositories: readonly RepositoryView[],
): BoundedContext {
  if (constructBoundedContext === undefined) {
    throw new TypeError("BoundedContext factory is unavailable.");
  }

  return constructBoundedContext(
    {
      name: specSnapshot.name,
      tenantMode: toTenantMode(specSnapshot.multitenant),
      spec: specSnapshot,
    },
    commandBus,
    eventBus,
    stand,
    storageFactory,
    repositories,
    frameworkConstructionToken,
  );
}

function createStorageContext(specSnapshot: ContextSpecSnapshot): StorageContext {
  return Object.freeze({
    name: specSnapshot.name.value,
    multitenant: specSnapshot.multitenant,
  });
}

function createBoundedContextName(value: string): BoundedContextName {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BoundedContextNameError(value);
  }
  return Object.freeze({ value });
}

function createSpecSnapshot(name: string, multitenant: boolean): ContextSpecSnapshot {
  return Object.freeze({
    name: createBoundedContextName(name),
    multitenant,
    storesEvents: true,
  });
}

function cloneName(name: BoundedContextName): BoundedContextName {
  return createBoundedContextName(name.value);
}

function cloneSpecSnapshot(spec: ContextSpecSnapshot): ContextSpecSnapshot {
  return Object.freeze({
    name: cloneName(spec.name),
    multitenant: spec.multitenant,
    storesEvents: spec.storesEvents,
  });
}

function cloneContextSnapshot(snapshot: BoundedContextSnapshot): BoundedContextSnapshot {
  return Object.freeze({
    name: cloneName(snapshot.name),
    tenantMode: snapshot.tenantMode,
    spec: cloneSpecSnapshot(snapshot.spec),
  });
}

function toTenantMode(multitenant: boolean): TenantMode {
  return multitenant ? "multitenant" : "single-tenant";
}

function requireRepositoryInstance(repository: unknown, operation: string): void {
  if (!repositoryAccess.hasInstance(repository)) {
    throw new TypeError(`${operation} requires a Repository instance.`);
  }
}

function preflightRepositories(repositories: readonly RepositoryView[]): void {
  const entityTypes = new Set<RepositoryEntityType>();
  const stateTypeNames = new Set<string>();

  for (const repository of repositories) {
    requireRepositoryInstance(repository, "BoundedContextBuilder.add(repository)");
    const snapshot = repositorySnapshot(repository);
    const registration = registeredRepositories.get(repository);
    if (registration !== undefined) {
      throw new Error(
        `Repository for "${snapshot.stateFullTypeName}" is already registered with Bounded Context ` +
          `"${registration.name.value}".`,
      );
    }

    if (entityTypes.has(snapshot.entityType)) {
      throw new Error(
        `Repository entity type "${snapshot.entityType.name}" is already registered.`,
      );
    }
    entityTypes.add(snapshot.entityType);

    if (stateTypeNames.has(snapshot.stateFullTypeName)) {
      throw new Error(
        `Repository state type "${snapshot.stateFullTypeName}" is already registered.`,
      );
    }
    stateTypeNames.add(snapshot.stateFullTypeName);
  }
}

function repositoryCommandDispatchers(
  repositories: readonly RepositoryView[],
): readonly CommandDispatcher[] {
  return repositories.flatMap((repository) => {
    const dispatcher = repositoryAccess.commandDispatcher(repository);
    return dispatcher === undefined ? [] : [dispatcher];
  });
}

function repositoryEventDispatchers(
  repositories: readonly RepositoryView[],
): readonly EventDispatcher[] {
  return repositories.flatMap((repository) => {
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    return dispatcher === undefined ? [] : [dispatcher];
  });
}

function closeEventStore(eventStore: EventStore, buildError: unknown): void {
  try {
    eventStore.close();
  } catch (closeError) {
    throw new AggregateError(
      [buildError, closeError],
      "Bounded Context build failed, and event store cleanup also failed.",
    );
  }
}

function closePreparedRepositories(
  preparedRepositories: readonly PreparedRepository[],
): readonly unknown[] {
  const errors: unknown[] = [];
  for (const preparedRepository of preparedRepositories) {
    try {
      preparedRepository.close();
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}

function prepareRepositoryForContext(
  repository: RepositoryView,
  registration: RepositoryRegistration,
): PreparedRepository {
  requireRepositoryInstance(repository, "BoundedContext repository registration");
  const snapshot = repositorySnapshot(repository);
  const storage = registration.storageFactory.createRecordStorage(
    registration.storageContext,
    createRepositoryRecordSpec(snapshot),
  );
  try {
    rejectRegisteredRepository(repository);
  } catch (error) {
    storage.close();
    throw error;
  }
  repositoryAccess.bindRuntime(repository, {
    context: registration.storageContext,
    storageFactory: registration.storageFactory,
    stand: registration.stand,
    dispatchStored: registration.dispatchStored,
    recordStoredDispatchFailure: registration.recordStoredEventDispatchFailure,
  });

  return {
    repository,
    snapshot,
    storage,
    commit: () => {
      registeredRepositories.set(repository, { name: registration.name });
    },
    close: () => {
      repositoryAccess.clearRuntime(repository);
      storage.close();
    },
  };
}

interface PreparedRepository {
  readonly repository: RepositoryView;
  readonly snapshot: RegistrationSnapshot;
  readonly storage: RecordStorage<unknown, Message>;
  commit(): void;
  close(): void;
}

const registeredRepositories = new WeakMap<RepositoryView, RepositoryOwner>();

function repositorySnapshot(repository: RepositoryView): RegistrationSnapshot {
  const snapshot = repositoryAccess.snapshot(repository);

  return Object.freeze({
    entityType: snapshot.entityType,
    entityFamily: snapshot.entityFamily,
    stateSchema: snapshot.stateSchema,
    metadata: snapshot.metadata,
    stateFullTypeName: snapshot.stateFullTypeName,
    idField: snapshot.idField,
    snapshot,
  });
}

function rejectRegisteredRepository(repository: RepositoryView): void {
  const snapshot = repositorySnapshot(repository);
  const registration = registeredRepositories.get(repository);

  if (registration !== undefined) {
    throw new Error(
      `Repository for "${snapshot.stateFullTypeName}" is already registered with Bounded Context ` +
        `"${registration.name.value}".`,
    );
  }
}

function createRepositoryRecordSpec(snapshot: RegistrationSnapshot): RecordSpec<unknown, Message> {
  return new RecordSpec<unknown, Message>({
    schema: snapshot.stateSchema,
    extractId: (record) => readRecordId(record, snapshot),
    columns: snapshot.metadata.columns.map(
      (field) => new RecordColumn(field.name, (record) => readRecordField(record, field.localName)),
    ),
  });
}

function createRepositoryView(snapshot: RegistrationSnapshot): RepositoryView {
  return Object.freeze({
    entityType: snapshot.entityType,
    entityFamily: snapshot.entityFamily,
    stateSchema: snapshot.stateSchema,
    metadata: snapshot.metadata,
    stateFullTypeName: snapshot.stateFullTypeName,
    idField: snapshot.idField,
    snapshot: snapshot.snapshot,
  });
}

function cloneDispatchFailure(failure: StoredEventDispatchFailure): StoredEventDispatchFailure {
  return Object.freeze({
    event: clone(EventSchema, failure.event),
    error: failure.error,
  });
}

function readRecordId(record: Message, snapshot: RegistrationSnapshot): unknown {
  const value = readRecordField(record, snapshot.idField.localName);

  if (value === undefined || value === null) {
    throw new Error(
      `Repository state "${snapshot.stateFullTypeName}" requires ID field "${snapshot.idField.name}".`,
    );
  }

  return value;
}

function readRecordField(
  record: Message,
  localName: DescriptorFieldMetadata["localName"],
): unknown {
  return (record as Record<string, unknown>)[localName];
}
