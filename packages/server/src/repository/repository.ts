import {
  Aggregate,
  type Entity,
  ProcessManager,
  Projection,
  type EntityFamily,
} from "../entity/entity.js";
import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
  type FirstFieldRoutingHint,
} from "../entity/entity-metadata.js";

type RepositoryEntityInstance<Schema extends DescriptorMessageSchema = DescriptorMessageSchema> =
  | Aggregate<unknown, Schema, unknown>
  | Projection<unknown, Schema, unknown>
  | ProcessManager<unknown, Schema, unknown>;

/** Generated Protobuf-ES state schema carried by a repository entity constructor. */
export type RepositoryStateSchema<EntityType extends RepositoryEntityType> =
  EntityType["prototype"] extends Aggregate<infer Id, infer Schema, infer Version>
    ? [Id, Version] extends [unknown, unknown]
      ? Schema
      : never
    : EntityType["prototype"] extends Projection<infer Id, infer Schema, infer Version>
      ? [Id, Version] extends [unknown, unknown]
        ? Schema
        : never
      : EntityType["prototype"] extends ProcessManager<infer Id, infer Schema, infer Version>
        ? [Id, Version] extends [unknown, unknown]
          ? Schema
          : never
        : never;

type IsUnion<Type, Union = Type> = Type extends unknown
  ? [Union] extends [Type]
    ? false
    : true
  : false;

/**
 * Single concrete entity constructor accepted by repository identity metadata.
 *
 * Concrete aggregate, projection, and process-manager classes satisfy this type naturally. Broad
 * constructor aliases, constructor unions, broad state schemas, and state-schema unions are
 * rejected so repository identities cannot erase which state schema the entity owns.
 */
export type ConcreteRepositoryEntityType<EntityType extends RepositoryEntityType> =
  IsUnion<EntityType> extends true
    ? never
    : RepositoryEntityType extends EntityType
      ? never
      : [ConstructorParameters<EntityType>] extends [never[]]
        ? never
        : IsUnion<RepositoryStateSchema<EntityType>> extends true
          ? never
          : DescriptorMessageSchema extends RepositoryStateSchema<EntityType>
            ? never
            : unknown;

interface RuntimeRepositoryEntityType {
  readonly prototype: object;
  readonly name: string;
}

/** Entity constructor value accepted by repository identity metadata. */
export type RepositoryEntityType<
  Instance extends RepositoryEntityInstance = RepositoryEntityInstance,
> = (abstract new (...args: never[]) => Instance) &
  // `any` erases the Entity constructor parameters while preserving its protected static origin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  typeof Entity<any, DescriptorMessageSchema, any> & {
    /** Prototype inspected for built-in entity family marker inheritance. */
    readonly prototype: Instance;
    /** Constructor name used in structured diagnostics. */
    readonly name: string;
  };

/**
 * Options for constructing repository identity and context-owned registration.
 *
 * @typeParam EntityType - A single concrete aggregate, projection, or process-manager constructor.
 * The constructor's prototype must carry one concrete generated state schema; broad constructor,
 * constructor-union, broad-schema, and schema-union bindings are rejected at compile time.
 */
export interface RepositoryOptions<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> {
  /** Entity constructor owned by this repository identity. */
  readonly entityType: EntityType;
  /** Generated Protobuf-ES schema for the entity state owned by this repository identity. */
  readonly schema: RepositoryStateSchema<EntityType>;
}

/**
 * Immutable copy-safe repository identity snapshot.
 *
 * @typeParam EntityType - The concrete entity constructor owned by the repository. The snapshot's
 * state schema and metadata are derived from this constructor so callers cannot spell an impossible
 * entity/schema snapshot pair.
 */
export interface RepositoryIdentitySnapshot<
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> {
  /** Entity constructor owned by the repository. */
  readonly entityType: EntityType;
  /** Entity family inferred from the constructor's built-in family marker base class. */
  readonly entityFamily: EntityFamily;
  /** Generated Protobuf-ES schema for the owned entity state. */
  readonly stateSchema: RepositoryStateSchema<EntityType>;
  /** Descriptor-derived metadata for the owned entity state. */
  readonly metadata: EntityMetadata<RepositoryStateSchema<EntityType>>;
  /** Fully qualified Protobuf type name of the owned entity state. */
  readonly stateFullTypeName: RepositoryStateSchema<EntityType>["typeName"];
  /** Canonical entity ID field copied from descriptor-derived metadata. */
  readonly idField: DescriptorFieldMetadata;
}

/** Public read view of a repository registered with a bounded context. */
export interface RepositoryView {
  /** Entity constructor owned by the repository. */
  readonly entityType: RepositoryEntityType;
  /** Entity family inferred from the constructor's built-in family marker base class. */
  readonly entityFamily: EntityFamily;
  /** Generated Protobuf-ES schema for the owned entity state. */
  readonly stateSchema: DescriptorMessageSchema;
  /** Descriptor-derived metadata for the owned entity state. */
  readonly metadata: EntityMetadata;
  /** Fully qualified Protobuf type name of the owned entity state. */
  readonly stateFullTypeName: string;
  /** Canonical entity ID field copied from descriptor-derived metadata. */
  readonly idField: DescriptorFieldMetadata;
  /** Copy-safe immutable identity snapshot for duplicate/conflict checks. */
  readonly snapshot: RepositoryIdentitySnapshot;
}

/** Machine-readable codes for repository identity failures. */
export type RepositoryIdentityErrorCode = "ENTITY_SCHEMA_KIND_MISMATCH" | "UNSUPPORTED_ENTITY_TYPE";

/** Error thrown when repository identity metadata cannot be constructed. */
export class RepositoryIdentityError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: RepositoryIdentityErrorCode;

  constructor(code: RepositoryIdentityErrorCode, message: string) {
    super(message);
    this.name = "RepositoryIdentityError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Repository identity and context-owned storage registration over one entity constructor and state schema.
 *
 * The class records the ownership facts bounded-context registration needs for
 * duplicate and conflict checks. Context assembly uses this metadata to attach
 * a repository to one built context and open state record storage. The
 * repository itself does not create entities, find or store records, route
 * messages, invoke handlers, manage caches, emit lifecycle events, or start
 * buses/transports.
 *
 * @typeParam EntityType - A single concrete aggregate, projection, or process-manager constructor
 * with one concrete generated state schema. Broad constructor, constructor-union, broad-schema, and
 * schema-union bindings intentionally fail the public type constraint.
 */
export class Repository<
  EntityType extends RepositoryEntityType & ConcreteRepositoryEntityType<EntityType>,
> implements RepositoryView {
  readonly #entityType: EntityType;
  readonly #entityFamily: EntityFamily;
  readonly #metadata: EntityMetadata<RepositoryStateSchema<EntityType>>;

  /** Create repository identity for exactly one entity family/state schema pair. */
  constructor(options: RepositoryOptions<EntityType>) {
    if (!isRepositoryOptionsObject(options)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        "Repository options must be a non-null object with an entity type class constructor " +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityType = readEntityTypeOption(options);
    const entityTypeDisplayName = entityTypeName(entityType);

    if (typeof entityType !== "function" || !isClassConstructor(entityType)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must be a class constructor ` +
          "extending Aggregate, Projection, or ProcessManager.",
      );
    }

    const entityFamily = resolveRepositoryEntityFamily(entityType);

    if (entityFamily === undefined) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeDisplayName}" must extend Aggregate, Projection, or ProcessManager.`,
      );
    }

    const schema = readRepositorySchemaOption(
      options,
      entityTypeDisplayName,
      entityFamily,
    ) as RepositoryStateSchema<EntityType>;

    const metadata = describeRepositoryEntityMetadata(entityTypeDisplayName, entityFamily, schema);

    if (metadata.kind !== entityFamily) {
      throw new RepositoryIdentityError(
        "ENTITY_SCHEMA_KIND_MISMATCH",
        `Repository entity type "${entityTypeDisplayName}" does not match ` +
          "the supplied state schema.",
      );
    }

    this.#entityType = entityType as EntityType;
    this.#entityFamily = entityFamily;
    this.#metadata = metadata;
    repositorySnapshots.set(
      this,
      createRepositorySnapshot(this.#entityType, this.#entityFamily, this.#metadata),
    );
  }

  /** Entity constructor owned by this repository identity. */
  get entityType(): EntityType {
    return this.#entityType;
  }

  /** Entity family inferred from the constructor's built-in family marker base class. */
  get entityFamily(): EntityFamily {
    return this.#entityFamily;
  }

  /** Generated Protobuf-ES schema for this repository's owned entity state. */
  get stateSchema(): RepositoryStateSchema<EntityType> {
    return this.#metadata.schema;
  }

  /** Descriptor-derived metadata for this repository's owned entity state. */
  get metadata(): EntityMetadata<RepositoryStateSchema<EntityType>> {
    return this.#metadata;
  }

  /** Fully qualified Protobuf type name of the owned entity state. */
  get stateFullTypeName(): RepositoryStateSchema<EntityType>["typeName"] {
    return this.#metadata.fullTypeName;
  }

  /** Canonical entity ID field copied from descriptor-derived metadata. */
  get idField(): DescriptorFieldMetadata {
    return cloneFieldMetadata(this.#metadata.idField);
  }

  /** Copy-safe immutable identity snapshot for later builder duplicate/conflict checks. */
  get snapshot(): RepositoryIdentitySnapshot<EntityType> {
    return cloneRepositorySnapshot(
      createRepositorySnapshot(this.#entityType, this.#entityFamily, this.#metadata),
    );
  }
}

const repositorySnapshots = new WeakMap<RepositoryView, RepositoryIdentitySnapshot>();
Object.freeze(Repository);

/** @internal Framework-only repository authority contract. */
export interface RepositoryAccess {
  hasInstance(repository: unknown): repository is RepositoryView;
  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot;
}

/** @internal Framework-only repository authority used by bounded-context assembly. */
export const repositoryAccess: RepositoryAccess = Object.freeze({
  hasInstance(repository: unknown): repository is RepositoryView {
    return repositorySnapshots.has(repository as RepositoryView);
  },

  snapshot(repository: RepositoryView): RepositoryIdentitySnapshot {
    const snapshot = repositorySnapshots.get(repository);

    if (snapshot === undefined) {
      throw new TypeError("Repository snapshot requires a Repository instance.");
    }

    return cloneRepositorySnapshot(snapshot);
  },
});

function createRepositorySnapshot<EntityType extends RepositoryEntityType>(
  entityType: EntityType,
  entityFamily: EntityFamily,
  metadata: EntityMetadata<RepositoryStateSchema<EntityType>>,
): RepositoryIdentitySnapshot<EntityType> {
  const metadataCopy = cloneEntityMetadata(metadata);

  return Object.freeze({
    entityType,
    entityFamily,
    stateSchema: metadataCopy.schema,
    metadata: metadataCopy,
    stateFullTypeName: metadataCopy.fullTypeName,
    idField: cloneFieldMetadata(metadataCopy.idField),
  });
}

function cloneRepositorySnapshot<EntityType extends RepositoryEntityType>(
  snapshot: RepositoryIdentitySnapshot<EntityType>,
): RepositoryIdentitySnapshot<EntityType> {
  const metadata = cloneEntityMetadata(snapshot.metadata);

  return Object.freeze({
    entityType: snapshot.entityType,
    entityFamily: snapshot.entityFamily,
    stateSchema: metadata.schema,
    metadata,
    stateFullTypeName: metadata.fullTypeName,
    idField: cloneFieldMetadata(metadata.idField),
  });
}

function isRepositoryOptionsObject(options: unknown): options is object {
  return typeof options === "object" && options !== null;
}

function readEntityTypeOption(options: object): unknown {
  try {
    return (options as { readonly entityType: unknown }).entityType;
  } catch {
    throw new RepositoryIdentityError(
      "UNSUPPORTED_ENTITY_TYPE",
      "Repository options entityType must be readable and resolve to a class constructor " +
        "extending Aggregate, Projection, or ProcessManager.",
    );
  }
}

function readRepositorySchemaOption(
  options: object,
  entityTypeDisplayName: string,
  entityFamily: EntityFamily,
): unknown {
  try {
    return (options as { readonly schema: unknown }).schema;
  } catch {
    throw new RepositoryIdentityError(
      "ENTITY_SCHEMA_KIND_MISMATCH",
      `Repository entity type "${entityTypeDisplayName}" is a ${entityFamily}, but ` +
        "the supplied state schema could not be read.",
    );
  }
}

function isClassConstructor(entityType: unknown): boolean {
  if (typeof entityType !== "function") {
    return false;
  }

  try {
    const source = Function.prototype.toString.call(entityType);
    return source.startsWith("class ");
  } catch {
    return false;
  }
}

/** @internal Shared runtime family check for repository-owned entity constructors. */
export function resolveRepositoryEntityFamily(entityType: unknown): EntityFamily | undefined {
  if (typeof entityType !== "function" || !isClassConstructor(entityType)) {
    return undefined;
  }

  const runtimeEntityType = entityType as RuntimeRepositoryEntityType;

  if (hasEntityFamilyInheritance(runtimeEntityType, Aggregate, Aggregate.prototype)) {
    return "aggregate";
  }
  if (hasEntityFamilyInheritance(runtimeEntityType, Projection, Projection.prototype)) {
    return "projection";
  }
  if (hasEntityFamilyInheritance(runtimeEntityType, ProcessManager, ProcessManager.prototype)) {
    return "process-manager";
  }

  return undefined;
}

function hasEntityFamilyInheritance(
  entityType: RuntimeRepositoryEntityType,
  familyConstructor: object,
  familyPrototype: object,
): boolean {
  try {
    return (
      Object.prototype.isPrototypeOf.call(familyConstructor, entityType) &&
      Object.prototype.isPrototypeOf.call(familyPrototype, entityType.prototype)
    );
  } catch {
    return false;
  }
}

function entityTypeName(entityType: unknown): string {
  if ((typeof entityType !== "object" && typeof entityType !== "function") || entityType === null) {
    return "(anonymous)";
  }

  const name = safeStringProperty(entityType, "name");
  return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
}

function safeStringProperty(value: object, propertyName: "name" | "typeName"): string | undefined {
  try {
    const property = (value as Record<typeof propertyName, unknown>)[propertyName];
    return typeof property === "string" ? property : undefined;
  } catch {
    return undefined;
  }
}

function describeRepositoryEntityMetadata<Schema extends DescriptorMessageSchema>(
  entityTypeDisplayName: string,
  entityFamily: EntityFamily,
  schema: Schema,
): EntityMetadata<Schema> {
  try {
    return describeEntityMetadata(schema);
  } catch {
    throw new RepositoryIdentityError(
      "ENTITY_SCHEMA_KIND_MISMATCH",
      `Repository entity type "${entityTypeDisplayName}" is a ${entityFamily}, but ` +
        "the supplied state schema does not expose supported entity metadata.",
    );
  }
}

function cloneEntityMetadata<Schema extends DescriptorMessageSchema>(
  metadata: EntityMetadata<Schema>,
): EntityMetadata<Schema> {
  const idField = cloneFieldMetadata(metadata.idField);
  const firstFieldRoutingHint: FirstFieldRoutingHint = Object.freeze({
    strategy: metadata.firstFieldRoutingHint.strategy,
    field: cloneFieldMetadata(metadata.firstFieldRoutingHint.field),
  });

  return Object.freeze({
    schema: metadata.schema,
    descriptor: metadata.descriptor,
    fullTypeName: metadata.fullTypeName,
    fileDescriptor: metadata.fileDescriptor,
    fileName: metadata.fileName,
    kind: metadata.kind,
    declaredVisibility: metadata.declaredVisibility,
    visibility: metadata.visibility,
    visibilitySource: metadata.visibilitySource,
    idField,
    firstFieldRoutingHint,
    columns: Object.freeze(metadata.columns.map(cloneFieldMetadata)),
    setOnceFields: Object.freeze(metadata.setOnceFields.map(cloneFieldMetadata)),
    semanticTags: Object.freeze([...metadata.semanticTags]),
  });
}

function cloneFieldMetadata(field: DescriptorFieldMetadata): DescriptorFieldMetadata {
  return Object.freeze({
    descriptor: field.descriptor,
    name: field.name,
    localName: field.localName,
    jsonName: field.jsonName,
    number: field.number,
  });
}
