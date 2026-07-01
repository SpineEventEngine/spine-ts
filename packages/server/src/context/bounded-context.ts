import { EventStore, InMemoryStorageFactory, type StorageFactory } from "@spine-ts/storage";

import { CommandBus } from "../bus/command-bus.js";
import type { CommandDispatcher } from "../bus/command-dispatcher.js";
import { EventBus } from "../bus/event-bus.js";
import type { EventDispatcher } from "../bus/event-dispatcher.js";
import {
  Repository,
  type ConcreteRepositoryEntityType,
  type RepositoryEntityType,
} from "../repository/repository.js";

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
let constructContextSpec:
  ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => ContextSpec) | undefined;
let constructBoundedContextBuilder:
  | ((snapshot: ContextSpecSnapshot, token: FrameworkConstructionToken) => BoundedContextBuilder)
  | undefined;
let constructBoundedContext:
  | ((
      snapshot: BoundedContextSnapshot,
      commandBus: CommandBus,
      eventBus: EventBus,
      token: FrameworkConstructionToken,
    ) => BoundedContext)
  | undefined;

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

/** Builder for assembling a JVM-familiar {@link BoundedContext}. */
export class BoundedContextBuilder {
  readonly #specSnapshot: ContextSpecSnapshot;
  readonly #repositories = new Set<object>();
  readonly #commandDispatchers = new Set<CommandDispatcher>();
  readonly #eventDispatchers = new Set<EventDispatcher>();
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

  /** Adds a pending repository identity for a later repository-runtime slice. */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    this.#repositories.add(repository);
    return this;
  }

  /** Removes a pending repository identity from this builder. */
  remove<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
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

  /** Uses the passed storage factory for the context's event store. */
  withStorageFactory(storageFactory: StorageFactory): this {
    this.#storageFactory = storageFactory;
    return this;
  }

  /** Builds a bounded context that owns configured command and event buses. */
  build(): BoundedContext {
    const commandBus = new CommandBus([...this.#commandDispatchers]);
    const eventStore = this.createEventStore();
    const eventBus = new EventBus(eventStore, [...this.#eventDispatchers]);

    return createBoundedContext(this.#specSnapshot, commandBus, eventBus);
  }

  private createEventStore(): EventStore {
    return new EventStore(
      {
        name: this.#specSnapshot.name.value,
        multitenant: this.#specSnapshot.multitenant,
      },
      this.#storageFactory ?? new InMemoryStorageFactory(),
    );
  }
}

/** Built bounded context that owns the write-side and event-side buses. */
export class BoundedContext {
  readonly #snapshot: BoundedContextSnapshot;
  readonly #commandBus: CommandBus;
  readonly #eventBus: EventBus;

  static {
    constructBoundedContext = (snapshot, commandBus, eventBus, token): BoundedContext =>
      new BoundedContext(snapshot, commandBus, eventBus, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(
    snapshot: BoundedContextSnapshot,
    commandBus: CommandBus,
    eventBus: EventBus,
    token: FrameworkConstructionToken,
  ) {
    requireFrameworkConstructionToken(token, "BoundedContext instances are framework-owned.");
    this.#snapshot = cloneContextSnapshot(snapshot);
    this.#commandBus = commandBus;
    this.#eventBus = eventBus;
    Object.freeze(this);
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

  /** The command bus owned by this context. */
  commandBus(): CommandBus {
    return this.#commandBus;
  }

  /** The event bus owned by this context. */
  eventBus(): EventBus {
    return this.#eventBus;
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
    frameworkConstructionToken,
  );
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
