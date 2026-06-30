import {
  Repository,
  type ConcreteRepositoryEntityType,
  type RepositoryEntityType,
  type RepositoryIdentitySnapshot,
} from "./repository.js";

/** Tenant isolation mode declared by a bounded context specification. */
export type TenantMode = "single-tenant" | "multitenant";

/** Immutable bounded context name value. */
export interface BoundedContextName {
  /** Non-empty, non-blank bounded context name. */
  readonly value: string;
}

/** Immutable bounded context specification snapshot. */
export interface ContextSpecSnapshot {
  /** Bounded context name value. */
  readonly name: BoundedContextName;
  /** Whether the context requires tenant isolation. */
  readonly multitenant: boolean;
  /** Whether the context stores its domain event log. */
  readonly storesEvents: boolean;
}

/** Immutable built bounded context snapshot. */
export interface BoundedContextSnapshot {
  /** Bounded context name value. */
  readonly name: BoundedContextName;
  /** Tenant isolation mode for future runtime parts. */
  readonly tenantMode: TenantMode;
  /** Context specification used to build the context. */
  readonly spec: ContextSpecSnapshot;
  /** Repository identities registered with the builder before this context was built. */
  readonly repositories: readonly RepositoryIdentitySnapshot[];
}

/** Machine-readable bounded-context repository registration failure codes. */
export type BoundedContextRepositoryRegistrationErrorCode =
  "ENTITY_TYPE_CONFLICT" | "STATE_TYPE_CONFLICT";

/** Stable repository ownership details included in registration errors. */
export interface BoundedContextRepositoryRegistrationErrorDetails {
  /** Name of the bounded context receiving the repository. */
  readonly contextName: string;
  /** Already registered repository ownership facts. */
  readonly existing: RepositoryRegistrationConflictDetails;
  /** Incoming repository ownership facts. */
  readonly incoming: RepositoryRegistrationConflictDetails;
}

/** Stable repository identity fields used in registration diagnostics. */
export interface RepositoryRegistrationConflictDetails {
  /** Name of the entity constructor owned by the repository. */
  readonly entityTypeName: string;
  /** Entity family owned by the repository. */
  readonly entityFamily: RepositoryIdentitySnapshot["entityFamily"];
  /** Fully qualified Protobuf state type owned by the repository. */
  readonly stateFullTypeName: string;
}

/** Error thrown when a bounded context builder rejects repository ownership metadata. */
export class BoundedContextRepositoryRegistrationError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: BoundedContextRepositoryRegistrationErrorCode;

  /** Structured details describing the rejected registration. */
  readonly details: BoundedContextRepositoryRegistrationErrorDetails;

  constructor(
    code: BoundedContextRepositoryRegistrationErrorCode,
    message: string,
    details: BoundedContextRepositoryRegistrationErrorDetails,
  ) {
    super(message);
    this.name = "BoundedContextRepositoryRegistrationError";
    this.code = code;
    this.details = Object.freeze({
      contextName: details.contextName,
      existing: freezeConflictDetails(details.existing),
      incoming: freezeConflictDetails(details.incoming),
    });
    Object.setPrototypeOf(this, new.target.prototype);
  }
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
  | ((snapshot: BoundedContextSnapshot, token: FrameworkConstructionToken) => BoundedContext)
  | undefined;

/** Immutable context spec used by the bounded-context builder shell. */
export class ContextSpec {
  readonly #snapshot: ContextSpecSnapshot;

  static {
    constructContextSpec = (
      snapshot: ContextSpecSnapshot,
      token: FrameworkConstructionToken,
    ): ContextSpec => new ContextSpec(snapshot, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(snapshot: ContextSpecSnapshot, token: typeof frameworkConstructionToken) {
    const validatedSnapshot = validateSpecSnapshot(snapshot, "ContextSpec");
    requireFrameworkConstructionToken(
      token,
      "ContextSpec instances are framework-owned. Use BoundedContext.singleTenant(name) or BoundedContext.multitenant(name).",
    );
    this.#snapshot = validatedSnapshot;
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
    return this.#snapshot.multitenant ? "multitenant" : "single-tenant";
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

/** Metadata-only builder shell for a future {@link BoundedContext}. */
export class BoundedContextBuilder {
  readonly #specSnapshot: ContextSpecSnapshot;
  readonly #repositorySnapshots: RepositoryIdentitySnapshot[];

  static {
    constructBoundedContextBuilder = (
      snapshot: ContextSpecSnapshot,
      token: FrameworkConstructionToken,
    ): BoundedContextBuilder => new BoundedContextBuilder(snapshot, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(
    specSnapshot: ContextSpecSnapshot,
    token: typeof frameworkConstructionToken,
    repositorySnapshots: readonly RepositoryIdentitySnapshot[] = [],
  ) {
    const validatedSnapshot = validateSpecSnapshot(specSnapshot, "BoundedContextBuilder");
    requireFrameworkConstructionToken(
      token,
      "BoundedContextBuilder instances are framework-owned. Use BoundedContext.singleTenant(name) or BoundedContext.multitenant(name).",
    );
    this.#specSnapshot = validatedSnapshot;
    this.#repositorySnapshots = copyRepositorySnapshots(repositorySnapshots);
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

  /** Repository identities registered with this builder as immutable fresh-copy snapshots. */
  get repositories(): readonly RepositoryIdentitySnapshot[] {
    return cloneRepositorySnapshots(this.#repositorySnapshots);
  }

  /** Adds an explicit metadata-only repository identity for the context to build. */
  add<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    const incoming = readRepositorySnapshot(repository, "add");
    registerRepositorySnapshot(this.#repositorySnapshots, incoming, this.#specSnapshot.name.value);
    return this;
  }

  /** Removes an explicit metadata-only repository identity from the context to build. */
  remove<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    const incoming = readRepositorySnapshot(repository, "remove");
    const matchIndex = this.#repositorySnapshots.findIndex((existing) =>
      isSameRepositoryIdentity(existing, incoming),
    );

    if (matchIndex >= 0) {
      this.#repositorySnapshots.splice(matchIndex, 1);
    }

    return this;
  }

  /** Builds an immutable metadata-only bounded context snapshot. */
  build(): BoundedContext {
    return createBoundedContext(this.#specSnapshot, this.#repositorySnapshots);
  }
}

/** Metadata-only bounded context shell built from a {@link BoundedContextBuilder}. */
export class BoundedContext {
  readonly #snapshot: BoundedContextSnapshot;

  static {
    constructBoundedContext = (
      snapshot: BoundedContextSnapshot,
      token: FrameworkConstructionToken,
    ): BoundedContext => new BoundedContext(snapshot, token);
  }

  /** Framework-owned constructor. Use `BoundedContext.singleTenant(name)` or `.multitenant(name)`. */
  protected constructor(
    snapshot: BoundedContextSnapshot,
    token: typeof frameworkConstructionToken,
  ) {
    const validatedSnapshot = validateContextSnapshot(snapshot);
    requireFrameworkConstructionToken(
      token,
      "BoundedContext instances are framework-owned. Use BoundedContext.singleTenant(name) or BoundedContext.multitenant(name), then call builder.build().",
    );
    this.#snapshot = validatedSnapshot;
    Object.freeze(this);
  }

  /** Creates a builder for a single-tenant bounded context. */
  static singleTenant(name: string): BoundedContextBuilder {
    return createBoundedContextBuilder(createSpecSnapshot(name, false, true));
  }

  /** Creates a builder for a multitenant bounded context. */
  static multitenant(name: string): BoundedContextBuilder {
    return createBoundedContextBuilder(createSpecSnapshot(name, true, true));
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

  /** Context spec used to build this metadata-only context. */
  get spec(): ContextSpec {
    return createContextSpec(this.#snapshot.spec);
  }

  /** Repository identities registered when this metadata-only context was built. */
  get repositories(): readonly RepositoryIdentitySnapshot[] {
    return cloneRepositorySnapshots(this.#snapshot.repositories);
  }

  /** Copy-safe immutable snapshot of this context shell. */
  get snapshot(): BoundedContextSnapshot {
    return cloneContextSnapshot(this.#snapshot);
  }
}

function requireFrameworkConstructionToken(token: unknown, message: string): void {
  if (token !== frameworkConstructionToken) {
    throw new TypeError(message);
  }
}

function createContextSpec(specSnapshot: ContextSpecSnapshot): ContextSpec {
  /* c8 ignore next 3 -- static class initialization installs the factory at module load. */
  if (constructContextSpec === undefined) {
    throw new TypeError("ContextSpec factory is unavailable.");
  }

  return constructContextSpec(specSnapshot, frameworkConstructionToken);
}

function createBoundedContextBuilder(specSnapshot: ContextSpecSnapshot): BoundedContextBuilder {
  /* c8 ignore next 3 -- static class initialization installs the factory at module load. */
  if (constructBoundedContextBuilder === undefined) {
    throw new TypeError("BoundedContextBuilder factory is unavailable.");
  }

  return constructBoundedContextBuilder(specSnapshot, frameworkConstructionToken);
}

function createBoundedContext(
  specSnapshot: ContextSpecSnapshot,
  repositorySnapshots: readonly RepositoryIdentitySnapshot[],
): BoundedContext {
  /* c8 ignore next 3 -- static class initialization installs the factory at module load. */
  if (constructBoundedContext === undefined) {
    throw new TypeError("BoundedContext factory is unavailable.");
  }

  return constructBoundedContext(
    {
      name: specSnapshot.name,
      tenantMode: toTenantMode(specSnapshot.multitenant),
      spec: specSnapshot,
      repositories: cloneRepositorySnapshots(repositorySnapshots),
    },
    frameworkConstructionToken,
  );
}

function createBoundedContextName(value: string): BoundedContextName {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BoundedContextNameError(value);
  }
  return freezeName({ value });
}

function createSpecSnapshot(
  name: string,
  multitenant: boolean,
  storesEvents: boolean,
): ContextSpecSnapshot {
  return validateSpecSnapshot(
    {
      name: createBoundedContextName(name),
      multitenant,
      storesEvents,
    },
    "ContextSpec",
  );
}

function toTenantMode(multitenant: boolean): TenantMode {
  return multitenant ? "multitenant" : "single-tenant";
}

function cloneName(name: BoundedContextName): BoundedContextName {
  return freezeName({ value: name.value });
}

function cloneSpecSnapshot(spec: ContextSpecSnapshot): ContextSpecSnapshot {
  return freezeSpecSnapshot({
    name: cloneName(spec.name),
    multitenant: spec.multitenant,
    storesEvents: spec.storesEvents,
  });
}

function cloneContextSnapshot(snapshot: BoundedContextSnapshot): BoundedContextSnapshot {
  return freezeContextSnapshot({
    name: cloneName(snapshot.name),
    tenantMode: snapshot.tenantMode,
    spec: cloneSpecSnapshot(snapshot.spec),
    repositories: cloneRepositorySnapshots(snapshot.repositories),
  });
}

function cloneRepositorySnapshots(
  snapshots: readonly RepositoryIdentitySnapshot[],
): RepositoryIdentitySnapshot[] {
  return Object.freeze(snapshots.map(cloneRepositorySnapshot)) as RepositoryIdentitySnapshot[];
}

function cloneRepositorySnapshot<EntityType extends RepositoryEntityType>(
  snapshot: RepositoryIdentitySnapshot<EntityType>,
): RepositoryIdentitySnapshot<EntityType> {
  const metadata = Object.freeze({
    schema: snapshot.metadata.schema,
    descriptor: snapshot.metadata.descriptor,
    fullTypeName: snapshot.metadata.fullTypeName,
    fileDescriptor: snapshot.metadata.fileDescriptor,
    fileName: snapshot.metadata.fileName,
    kind: snapshot.metadata.kind,
    declaredVisibility: snapshot.metadata.declaredVisibility,
    visibility: snapshot.metadata.visibility,
    visibilitySource: snapshot.metadata.visibilitySource,
    idField: cloneRepositoryFieldMetadata(snapshot.metadata.idField),
    firstFieldRoutingHint: Object.freeze({
      strategy: snapshot.metadata.firstFieldRoutingHint.strategy,
      field: cloneRepositoryFieldMetadata(snapshot.metadata.firstFieldRoutingHint.field),
    }),
    columns: Object.freeze(snapshot.metadata.columns.map(cloneRepositoryFieldMetadata)),
    setOnceFields: Object.freeze(snapshot.metadata.setOnceFields.map(cloneRepositoryFieldMetadata)),
    semanticTags: Object.freeze([...snapshot.metadata.semanticTags]),
  });

  return Object.freeze({
    entityType: snapshot.entityType,
    entityFamily: snapshot.entityFamily,
    stateSchema: snapshot.stateSchema,
    metadata,
    stateFullTypeName: snapshot.stateFullTypeName,
    idField: cloneRepositoryFieldMetadata(snapshot.idField),
  });
}

function cloneRepositoryFieldMetadata(
  field: RepositoryIdentitySnapshot["idField"],
): RepositoryIdentitySnapshot["idField"] {
  return Object.freeze({
    descriptor: field.descriptor,
    name: field.name,
    localName: field.localName,
    jsonName: field.jsonName,
    number: field.number,
  });
}

function freezeName(name: BoundedContextName): BoundedContextName {
  return Object.freeze(name);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function validateNameSnapshot(name: unknown, owner: string): BoundedContextName {
  if (!isRecord(name) || typeof name.value !== "string") {
    throw new TypeError(`${owner}.name must be a bounded-context name object.`);
  }

  return createBoundedContextName(name.value);
}

function validateSpecSnapshot(snapshot: unknown, owner: string): ContextSpecSnapshot {
  if (!isRecord(snapshot)) {
    throw new TypeError(`${owner} snapshot must be an object.`);
  }

  const name = validateNameSnapshot(snapshot.name, owner);
  const { multitenant, storesEvents } = snapshot;

  if (typeof multitenant !== "boolean") {
    throw new TypeError("ContextSpec.multitenant must be a boolean.");
  }
  if (typeof storesEvents !== "boolean") {
    throw new TypeError("ContextSpec.storesEvents must be a boolean.");
  }

  return freezeSpecSnapshot({
    name,
    multitenant,
    storesEvents,
  });
}

function validateTenantMode(tenantMode: unknown): TenantMode {
  if (tenantMode !== "single-tenant" && tenantMode !== "multitenant") {
    throw new TypeError("BoundedContext.tenantMode must be a supported tenant mode.");
  }

  return tenantMode;
}

function validateContextSnapshot(snapshot: unknown): BoundedContextSnapshot {
  if (!isRecord(snapshot)) {
    throw new TypeError("BoundedContext snapshot must be an object.");
  }

  const name = validateNameSnapshot(snapshot.name, "BoundedContext");
  const tenantMode = validateTenantMode(snapshot.tenantMode);
  const spec = validateSpecSnapshot(snapshot.spec, "BoundedContext.spec");
  const repositories =
    snapshot.repositories === undefined
      ? []
      : validateRepositorySnapshots(snapshot.repositories, "BoundedContext.repositories");

  if (name.value !== spec.name.value) {
    throw new TypeError("BoundedContext.name must match BoundedContext.spec.name.");
  }
  if (tenantMode !== toTenantMode(spec.multitenant)) {
    throw new TypeError("BoundedContext.tenantMode must match BoundedContext.spec.multitenant.");
  }

  return freezeContextSnapshot({
    name,
    tenantMode,
    spec,
    repositories,
  });
}

function validateRepositorySnapshots(
  snapshots: unknown,
  owner: string,
): readonly RepositoryIdentitySnapshot[] {
  if (!Array.isArray(snapshots)) {
    throw new TypeError(`${owner} must be an array.`);
  }

  return snapshots.map((snapshot, index) => {
    if (!isRecord(snapshot)) {
      throw new TypeError(`${owner}[${String(index)}] must be a repository identity snapshot.`);
    }

    return cloneRepositorySnapshot(snapshot as unknown as RepositoryIdentitySnapshot);
  });
}

function freezeSpecSnapshot(snapshot: ContextSpecSnapshot): ContextSpecSnapshot {
  return Object.freeze({
    name: cloneName(snapshot.name),
    multitenant: snapshot.multitenant,
    storesEvents: snapshot.storesEvents,
  });
}

function freezeContextSnapshot(snapshot: BoundedContextSnapshot): BoundedContextSnapshot {
  return Object.freeze({
    name: cloneName(snapshot.name),
    tenantMode: snapshot.tenantMode,
    spec: cloneSpecSnapshot(snapshot.spec),
    repositories: cloneRepositorySnapshots(snapshot.repositories),
  });
}

function readRepositorySnapshot<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
>(
  repository: Repository<EntityType>,
  operation: "add" | "remove",
): RepositoryIdentitySnapshot<EntityType> {
  if (!(repository instanceof Repository)) {
    throw new TypeError(
      `BoundedContextBuilder.${operation}(repository) requires a Repository identity object.`,
    );
  }

  return cloneRepositorySnapshot(repository.snapshot);
}

function registerRepositorySnapshot(
  existingRepositories: RepositoryIdentitySnapshot[],
  incoming: RepositoryIdentitySnapshot,
  contextName: string,
): void {
  for (const existing of existingRepositories) {
    if (isSameRepositoryIdentity(existing, incoming)) {
      return;
    }

    if (existing.entityType === incoming.entityType) {
      throwRepositoryRegistrationConflict("ENTITY_TYPE_CONFLICT", contextName, existing, incoming);
    }

    if (existing.stateFullTypeName === incoming.stateFullTypeName) {
      throwRepositoryRegistrationConflict("STATE_TYPE_CONFLICT", contextName, existing, incoming);
    }
  }

  existingRepositories.push(incoming);
}

function throwRepositoryRegistrationConflict(
  code: BoundedContextRepositoryRegistrationErrorCode,
  contextName: string,
  existing: RepositoryIdentitySnapshot,
  incoming: RepositoryIdentitySnapshot,
): never {
  const existingDetails = repositoryConflictDetails(existing);
  const incomingDetails = repositoryConflictDetails(incoming);
  const ownership =
    code === "ENTITY_TYPE_CONFLICT"
      ? `entity constructor "${incomingDetails.entityTypeName}"`
      : `state type "${incomingDetails.stateFullTypeName}"`;

  throw new BoundedContextRepositoryRegistrationError(
    code,
    `Bounded context "${contextName}" already has repository ownership for ${ownership}.`,
    {
      contextName,
      existing: existingDetails,
      incoming: incomingDetails,
    },
  );
}

function isSameRepositoryIdentity(
  left: RepositoryIdentitySnapshot,
  right: RepositoryIdentitySnapshot,
): boolean {
  return (
    left.entityType === right.entityType &&
    left.entityFamily === right.entityFamily &&
    left.stateSchema === right.stateSchema &&
    left.stateFullTypeName === right.stateFullTypeName
  );
}

function repositoryConflictDetails(
  snapshot: RepositoryIdentitySnapshot,
): RepositoryRegistrationConflictDetails {
  return freezeConflictDetails({
    entityTypeName: snapshot.entityType.name,
    entityFamily: snapshot.entityFamily,
    stateFullTypeName: snapshot.stateFullTypeName,
  });
}

function freezeConflictDetails(
  details: RepositoryRegistrationConflictDetails,
): RepositoryRegistrationConflictDetails {
  return Object.freeze({
    entityTypeName: details.entityTypeName,
    entityFamily: details.entityFamily,
    stateFullTypeName: details.stateFullTypeName,
  });
}

function copyRepositorySnapshots(
  snapshots: readonly RepositoryIdentitySnapshot[],
): RepositoryIdentitySnapshot[] {
  return snapshots.map(cloneRepositorySnapshot);
}
