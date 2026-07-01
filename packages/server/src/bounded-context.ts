import {
  Repository,
  type ConcreteRepositoryEntityType,
  type RepositoryEntityType,
  type RepositoryIdentitySnapshot,
  resolveRepositoryEntityFamily,
} from "./repository.js";
import { describeEntityMetadata } from "./entity-metadata.js";
import {
  SingleProcessServerRuntime,
  type ServerRuntimeLifecycle,
  type ServerRuntimeState,
} from "./runtime.js";

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

/**
 * Public alias for the immutable snapshot closed by {@link BoundedContextBuilder.build}.
 *
 * The alias names the built-context contract explicitly while preserving the
 * same metadata-only shape as {@link BoundedContextSnapshot}. It does not imply
 * a running server, registered repository runtime, storage, dispatch, delivery,
 * stand, tenant-index, or lifecycle capability.
 */
export type BuiltBoundedContextSnapshot = BoundedContextSnapshot;

/**
 * Runtime lifecycle boundary used by {@link BoundedContextRuntime}.
 *
 * When omitted, the handle creates and owns a private
 * {@link SingleProcessServerRuntime}. When supplied, the caller owns any
 * sharing policy for that lifecycle object; the handle delegates `start()`,
 * `close()`, and `state` without exposing queue intake.
 */
export interface BoundedContextRuntimeOptions {
  /** Runtime lifecycle to delegate to instead of creating a default runtime. */
  readonly runtime?: ServerRuntimeLifecycle;
}

/** Machine-readable bounded-context repository registration failure codes. */
export type BoundedContextRepositoryRegistrationErrorCode =
  "ENTITY_TYPE_CONFLICT" | "STATE_TYPE_CONFLICT" | "INVALID_REPOSITORY_SNAPSHOT";

/** Builder operation that rejected repository registration metadata. */
export type BoundedContextRepositoryRegistrationOperation = "add" | "remove";

/** Stable repository ownership conflict details included in registration errors. */
export interface BoundedContextRepositoryRegistrationConflictErrorDetails {
  /** Name of the bounded context receiving the repository. */
  readonly contextName: string;
  /** Already registered repository ownership facts. */
  readonly existing: RepositoryRegistrationConflictDetails;
  /** Incoming repository ownership facts. */
  readonly incoming: RepositoryRegistrationConflictDetails;
}

/** Stable unreadable or malformed repository snapshot details included in registration errors. */
export interface BoundedContextRepositorySnapshotErrorDetails {
  /** Name of the bounded context receiving the repository. */
  readonly contextName: string;
  /** Builder operation that attempted to read the repository snapshot. */
  readonly operation: BoundedContextRepositoryRegistrationOperation;
}

/** Stable details included in repository registration errors. */
export type BoundedContextRepositoryRegistrationErrorDetails =
  | BoundedContextRepositoryRegistrationConflictErrorDetails
  | BoundedContextRepositorySnapshotErrorDetails;

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
    this.details = freezeRepositoryRegistrationErrorDetails(details);
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
      "ContextSpec instances are framework-owned. Use BoundedContext.singleTenant(name) " +
        "or BoundedContext.multitenant(name).",
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
      "BoundedContextBuilder instances are framework-owned. Use BoundedContext.singleTenant(name) " +
        "or BoundedContext.multitenant(name).",
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
    const incoming = readRepositorySnapshot(repository, "add", this.#specSnapshot.name.value);
    registerRepositorySnapshot(this.#repositorySnapshots, incoming, this.#specSnapshot.name.value);
    return this;
  }

  /** Removes an explicit metadata-only repository identity from the context to build. */
  remove<EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>>(
    repository: Repository<EntityType>,
  ): this {
    const incoming = readRepositorySnapshot(repository, "remove", this.#specSnapshot.name.value);
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
      "BoundedContext instances are framework-owned. Use BoundedContext.singleTenant(name) " +
        "or BoundedContext.multitenant(name), then call builder.build().",
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

  /** Copy-safe immutable built-context snapshot of this context shell. */
  get snapshot(): BuiltBoundedContextSnapshot {
    return cloneContextSnapshot(this.#snapshot);
  }
}

/**
 * Runtime-facing handle scoped to one built {@link BoundedContext} snapshot.
 *
 * The handle binds copy-safe bounded-context metadata to a server runtime
 * lifecycle. It is not a JVM `Server` equivalent and does not expose command,
 * event, import, query, subscription, stand, storage, tenant-index, transport,
 * repository-dispatch, or handler-invocation behavior.
 */
export class BoundedContextRuntime implements ServerRuntimeLifecycle {
  readonly #contextSnapshot: BuiltBoundedContextSnapshot;
  readonly #runtime: ServerRuntimeLifecycle;

  /**
   * Creates a runtime handle for an already built bounded context.
   *
   * Without `options.runtime`, the handle owns a private
   * {@link SingleProcessServerRuntime}. With an injected runtime lifecycle, the
   * caller owns that runtime's sharing and queue-intake policy.
   */
  constructor(context: BoundedContext, options: BoundedContextRuntimeOptions = {}) {
    if (!(context instanceof BoundedContext)) {
      throw new TypeError("BoundedContextRuntime requires a built BoundedContext.");
    }

    const runtime = Object.hasOwn(options, "runtime")
      ? options.runtime
      : new SingleProcessServerRuntime();
    validateRuntimeLifecycle(runtime);

    this.#contextSnapshot = context.snapshot;
    this.#runtime = runtime;
    Object.freeze(this);
  }

  /** Bounded context name as a fresh immutable value object. */
  get name(): BoundedContextName {
    return cloneName(this.#contextSnapshot.name);
  }

  /** Tenant mode declared by the built context. */
  get tenantMode(): TenantMode {
    return this.#contextSnapshot.tenantMode;
  }

  /** Whether the built context is multitenant. */
  get isMultitenant(): boolean {
    return this.#contextSnapshot.tenantMode === "multitenant";
  }

  /** Context spec copied from the built context. */
  get spec(): ContextSpec {
    return createContextSpec(this.#contextSnapshot.spec);
  }

  /** Repository identity snapshots copied from the built context. */
  get repositories(): readonly RepositoryIdentitySnapshot[] {
    return cloneRepositorySnapshots(this.#contextSnapshot.repositories);
  }

  /** Copy-safe immutable snapshot of the built context metadata. */
  get contextSnapshot(): BuiltBoundedContextSnapshot {
    return cloneContextSnapshot(this.#contextSnapshot);
  }

  /** Current state of the delegated runtime lifecycle. */
  get state(): ServerRuntimeState {
    return this.#runtime.state;
  }

  /** Starts the delegated runtime lifecycle. */
  start(): Promise<void> {
    return this.#runtime.start();
  }

  /** Closes the delegated runtime lifecycle. */
  close(): Promise<void> {
    return this.#runtime.close();
  }
}

function requireFrameworkConstructionToken(token: unknown, message: string): void {
  if (token !== frameworkConstructionToken) {
    throw new TypeError(message);
  }
}

function validateRuntimeLifecycle(runtime: unknown): asserts runtime is ServerRuntimeLifecycle {
  if (
    !isRecord(runtime) ||
    !isRuntimeState(runtime.state) ||
    typeof runtime.start !== "function" ||
    typeof runtime.close !== "function"
  ) {
    throw new TypeError(
      "BoundedContextRuntime options.runtime must implement ServerRuntimeLifecycle.",
    );
  }
}

function isRuntimeState(value: unknown): value is ServerRuntimeState {
  return value === "created" || value === "running" || value === "closing" || value === "closed";
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
      repositories: repositorySnapshots,
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
  return Object.freeze(
    mapArray(snapshots, cloneRepositorySnapshot),
  ) as RepositoryIdentitySnapshot[];
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
    columns: cloneRepositoryFieldMetadataList(
      snapshot.metadata.columns,
      "Repository snapshot metadata.columns",
    ),
    setOnceFields: cloneRepositoryFieldMetadataList(
      snapshot.metadata.setOnceFields,
      "Repository snapshot metadata.setOnceFields",
    ),
    semanticTags: Object.freeze(
      readCanonicalRepositorySemanticTags(
        snapshot.metadata.semanticTags,
        "Repository snapshot metadata.semanticTags",
      ),
    ),
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

function cloneRepositoryFieldMetadataList(
  fields: unknown,
  owner: string,
): readonly RepositoryIdentitySnapshot["idField"][] {
  if (!Array.isArray(fields)) {
    throw new TypeError(`${owner} must be an array.`);
  }

  const fieldValues = fields as readonly unknown[];
  const clonedFields: RepositoryIdentitySnapshot["idField"][] = [];

  for (let index = 0; index < fieldValues.length; index += 1) {
    if (!Object.hasOwn(fieldValues, index)) {
      throw new TypeError(`${owner}[${String(index)}] must be present.`);
    }

    clonedFields.push(
      cloneRepositoryFieldMetadata(fieldValues[index] as RepositoryIdentitySnapshot["idField"]),
    );
  }

  return Object.freeze(clonedFields);
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

function mapArray<Value, Result>(
  values: readonly Value[],
  mapper: (value: Value, index: number) => Result,
): Result[] {
  return Array.prototype.map.call(values, mapper) as Result[];
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

  return Object.freeze(
    mapArray(snapshots, (snapshot, index) => {
      if (!isRecord(snapshot)) {
        throw new TypeError(`${owner}[${String(index)}] must be a repository identity snapshot.`);
      }

      return cloneRepositorySnapshot(snapshot as unknown as RepositoryIdentitySnapshot);
    }),
  );
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
    name: snapshot.name,
    tenantMode: snapshot.tenantMode,
    spec: snapshot.spec,
    repositories: snapshot.repositories,
  });
}

function readRepositorySnapshot<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
>(
  repository: Repository<EntityType>,
  operation: BoundedContextRepositoryRegistrationOperation,
  contextName: string,
): RepositoryIdentitySnapshot<EntityType> {
  if (!(repository instanceof Repository)) {
    throw new TypeError(
      `BoundedContextBuilder.${operation}(repository) requires a Repository identity object.`,
    );
  }

  try {
    const snapshot = cloneRepositorySnapshot(repository.snapshot);
    validateRepositorySnapshot(snapshot);
    return snapshot;
  } catch {
    throwInvalidRepositorySnapshot(operation, contextName);
  }
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
    entityTypeName: safeEntityTypeName(snapshot.entityType),
    entityFamily: snapshot.entityFamily,
    stateFullTypeName: snapshot.stateFullTypeName,
  });
}

function freezeRepositoryRegistrationErrorDetails(
  details: BoundedContextRepositoryRegistrationErrorDetails,
): BoundedContextRepositoryRegistrationErrorDetails {
  if ("operation" in details) {
    return Object.freeze({
      contextName: details.contextName,
      operation: details.operation,
    });
  }

  return Object.freeze({
    contextName: details.contextName,
    existing: freezeConflictDetails(details.existing),
    incoming: freezeConflictDetails(details.incoming),
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

function throwInvalidRepositorySnapshot(
  operation: BoundedContextRepositoryRegistrationOperation,
  contextName: string,
): never {
  throw new BoundedContextRepositoryRegistrationError(
    "INVALID_REPOSITORY_SNAPSHOT",
    `BoundedContextBuilder.${operation}(repository) requires a repository snapshot with ` +
      "supported repository identity metadata.",
    {
      contextName,
      operation,
    },
  );
}

function validateRepositorySnapshot(snapshot: RepositoryIdentitySnapshot): void {
  const entityFamily = resolveRepositoryEntityFamily(snapshot.entityType);
  if (entityFamily === undefined) {
    throw new TypeError(
      "Repository snapshot entityType must be a supported entity class constructor.",
    );
  }
  if (!isEntityFamily(snapshot.entityFamily)) {
    throw new TypeError("Repository snapshot entityFamily must be supported.");
  }
  if (entityFamily !== snapshot.entityFamily) {
    throw new TypeError("Repository snapshot entityType must match entityFamily.");
  }
  const stateSchema = snapshot.stateSchema as unknown;
  if (!isRecord(stateSchema)) {
    throw new TypeError("Repository snapshot stateSchema must be an object.");
  }
  const stateFullTypeName = snapshot.stateFullTypeName as unknown;
  if (typeof stateFullTypeName !== "string" || stateFullTypeName.length === 0) {
    throw new TypeError("Repository snapshot stateFullTypeName must be a non-empty string.");
  }
  if (stateSchema.typeName !== stateFullTypeName) {
    throw new TypeError("Repository snapshot stateSchema.typeName must match stateFullTypeName.");
  }
  const trustedMetadata = describeEntityMetadata(snapshot.stateSchema);
  if (trustedMetadata.kind !== snapshot.entityFamily) {
    throw new TypeError("Repository snapshot stateSchema entity kind must match entityFamily.");
  }
  if (!isRecord(snapshot.metadata)) {
    throw new TypeError("Repository snapshot metadata must be an object.");
  }
  if (snapshot.metadata.schema !== snapshot.stateSchema) {
    throw new TypeError("Repository snapshot metadata.schema must match stateSchema.");
  }
  if (snapshot.metadata.fullTypeName !== snapshot.stateFullTypeName) {
    throw new TypeError("Repository snapshot metadata.fullTypeName must match stateFullTypeName.");
  }
  if (snapshot.metadata.kind !== snapshot.entityFamily) {
    throw new TypeError("Repository snapshot metadata.kind must match entityFamily.");
  }
  validateRepositoryFieldMetadata(snapshot.idField, "Repository snapshot idField");
  validateRepositoryFieldMetadata(
    snapshot.metadata.idField,
    "Repository snapshot metadata.idField",
  );
  validateRepositoryFieldMetadata(
    snapshot.metadata.firstFieldRoutingHint.field,
    "Repository snapshot metadata.firstFieldRoutingHint.field",
  );
  validateRepositoryFieldMetadataList(
    snapshot.metadata.columns,
    "Repository snapshot metadata.columns",
  );
  validateRepositoryFieldMetadataList(
    snapshot.metadata.setOnceFields,
    "Repository snapshot metadata.setOnceFields",
  );
  readCanonicalRepositorySemanticTags(
    snapshot.metadata.semanticTags,
    "Repository snapshot metadata.semanticTags",
  );
}

function isEntityFamily(value: unknown): value is RepositoryIdentitySnapshot["entityFamily"] {
  return value === "aggregate" || value === "projection" || value === "process-manager";
}

function validateRepositoryFieldMetadata(field: unknown, owner: string): void {
  if (
    !isRecord(field) ||
    typeof field.name !== "string" ||
    typeof field.localName !== "string" ||
    typeof field.jsonName !== "string" ||
    typeof field.number !== "number"
  ) {
    throw new TypeError(`${owner} must be supported field metadata.`);
  }
}

function validateRepositoryFieldMetadataList(fields: unknown, owner: string): void {
  if (!Array.isArray(fields)) {
    throw new TypeError(`${owner} must be an array.`);
  }

  for (let index = 0; index < fields.length; index += 1) {
    if (!Object.hasOwn(fields, index)) {
      throw new TypeError(`${owner}[${String(index)}] must be present.`);
    }

    validateRepositoryFieldMetadata(fields[index], `${owner}[${String(index)}]`);
  }
}

function readCanonicalRepositorySemanticTags(tags: unknown, owner: string): string[] {
  if (!Array.isArray(tags)) {
    throw new TypeError(`${owner} must be an array.`);
  }

  const tagValues = tags as readonly unknown[];
  const canonicalTags: string[] = [];

  for (let index = 0; index < tagValues.length; index += 1) {
    if (!Object.hasOwn(tagValues, index)) {
      throw new TypeError(`${owner}[${String(index)}] must be present.`);
    }

    const tag = tagValues[index];
    if (typeof tag !== "string") {
      throw new TypeError(`${owner}[${String(index)}] must be a string.`);
    }
    canonicalTags.push(canonicalRepositorySemanticTag(tag, `${owner}[${String(index)}]`));
  }

  validateCanonicalRepositorySemanticTagList(canonicalTags, owner);
  return canonicalTags;
}

function canonicalRepositorySemanticTag(tag: string, owner: string): string {
  const canonicalTag = tag.trim();

  if (canonicalTag.length === 0) {
    throw new TypeError(`${owner} must be a non-empty string.`);
  }
  if (tag !== canonicalTag) {
    throw new TypeError(`${owner} must not require trimming.`);
  }
  return canonicalTag;
}

function validateCanonicalRepositorySemanticTagList(tags: readonly string[], owner: string): void {
  for (let index = 1; index < tags.length; index += 1) {
    const previousTag = tags[index - 1];
    const tag = tags[index];

    if (previousTag === undefined || tag === undefined) {
      throw new TypeError(`${owner} must be a dense array.`);
    }
    if (previousTag === tag) {
      throw new TypeError(`${owner} must not contain duplicate tags.`);
    }
    if (previousTag > tag) {
      throw new TypeError(`${owner} must be sorted.`);
    }
  }
}

function safeEntityTypeName(entityType: RepositoryIdentitySnapshot["entityType"]): string {
  try {
    const name = (entityType as { readonly name?: unknown }).name;
    return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
  } catch {
    return "(anonymous)";
  }
}

function copyRepositorySnapshots(
  snapshots: readonly RepositoryIdentitySnapshot[],
): RepositoryIdentitySnapshot[] {
  return mapArray(snapshots, cloneRepositorySnapshot);
}
