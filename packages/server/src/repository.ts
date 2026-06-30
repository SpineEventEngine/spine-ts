import { Aggregate, ProcessManager, Projection, type EntityFamily } from "./entity.js";
import {
  describeEntityMetadata,
  type DescriptorFieldMetadata,
  type DescriptorMessageSchema,
  type EntityKind,
  type EntityMetadata,
  type FirstFieldRoutingHint,
} from "./entity-metadata.js";

type RepositoryEntityInstance<Schema extends DescriptorMessageSchema = DescriptorMessageSchema> =
  | Aggregate<unknown, Schema, unknown>
  | Projection<unknown, Schema, unknown>
  | ProcessManager<unknown, Schema, unknown>;

type RepositoryEntitySchema<EntityType extends RepositoryEntityType> = RepositorySchemaForInstance<
  EntityType["prototype"]
>;

type RepositorySchemaForInstance<Instance> =
  Instance extends Aggregate<infer Id, infer Schema, infer Version>
    ? RepositorySchemaFromEntityParts<Id, Schema, Version>
    : Instance extends Projection<infer Id, infer Schema, infer Version>
      ? RepositorySchemaFromEntityParts<Id, Schema, Version>
      : Instance extends ProcessManager<infer Id, infer Schema, infer Version>
        ? RepositorySchemaFromEntityParts<Id, Schema, Version>
        : never;

type RepositorySchemaFromEntityParts<Id, Schema, Version> = [Id, Version] extends [unknown, unknown]
  ? Schema
  : never;

interface RuntimeRepositoryEntityType {
  readonly prototype: object;
  readonly name: string;
}

/** Entity constructor value accepted by repository identity metadata. */
export type RepositoryEntityType<
  Instance extends RepositoryEntityInstance = RepositoryEntityInstance,
> = (abstract new (...args: never[]) => Instance) & {
  /** Prototype inspected for built-in entity family marker inheritance. */
  readonly prototype: Instance;
  /** Constructor name used in structured diagnostics. */
  readonly name: string;
};

/** Options for constructing metadata-only repository identity. */
export interface RepositoryOptions<EntityType extends RepositoryEntityType> {
  /** Entity constructor owned by this repository identity. */
  readonly entityType: EntityType;
  /** Generated Protobuf-ES schema for the entity state owned by this repository identity. */
  readonly schema: RepositoryEntitySchema<EntityType>;
}

/** Immutable copy-safe repository identity snapshot. */
export interface RepositoryIdentitySnapshot<
  Schema extends DescriptorMessageSchema = DescriptorMessageSchema,
  EntityType extends RepositoryEntityType = RepositoryEntityType,
> {
  /** Entity constructor owned by the repository. */
  readonly entityType: EntityType;
  /** Entity family inferred from the constructor's built-in family marker base class. */
  readonly entityFamily: EntityFamily;
  /** Generated Protobuf-ES schema for the owned entity state. */
  readonly stateSchema: Schema;
  /** Descriptor-derived metadata for the owned entity state. */
  readonly metadata: EntityMetadata<Schema>;
  /** Fully qualified Protobuf type name of the owned entity state. */
  readonly stateFullTypeName: Schema["typeName"];
  /** Canonical entity ID field copied from descriptor-derived metadata. */
  readonly idField: DescriptorFieldMetadata;
}

/** Machine-readable codes for repository identity failures. */
export type RepositoryIdentityErrorCode = "ENTITY_SCHEMA_KIND_MISMATCH" | "UNSUPPORTED_ENTITY_TYPE";

/** Structured repository identity failure details. */
export interface RepositoryIdentityErrorDetails {
  /** Name of the rejected entity constructor. */
  readonly entityTypeName: string;
  /** Entity family inferred from the constructor, when one is known. */
  readonly entityFamily?: EntityFamily;
  /** Fully qualified Protobuf type name of the rejected state schema, when known. */
  readonly stateFullTypeName?: string;
  /** Entity kind declared by the rejected state schema, when known. */
  readonly stateKind?: EntityKind;
}

/** Error thrown when repository identity metadata cannot be constructed. */
export class RepositoryIdentityError extends Error {
  /** Stable code for callers/tests that need structured failure handling. */
  readonly code: RepositoryIdentityErrorCode;

  /** Structured details describing the rejected identity inputs. */
  readonly details: RepositoryIdentityErrorDetails;

  constructor(
    code: RepositoryIdentityErrorCode,
    message: string,
    details: RepositoryIdentityErrorDetails,
  ) {
    super(message);
    this.name = "RepositoryIdentityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Metadata-only repository identity over one entity constructor and state schema.
 *
 * The class records the ownership facts later bounded-context registration will
 * need for duplicate and conflict checks. It does not create entities, find or
 * store records, open storage, register with a context, route messages, invoke
 * handlers, manage caches, emit lifecycle events, or start buses/transports.
 */
export class Repository<EntityType extends RepositoryEntityType> {
  readonly #entityType: EntityType;
  readonly #entityFamily: EntityFamily;
  readonly #metadata: EntityMetadata<RepositoryEntitySchema<EntityType>>;

  /** Create repository identity metadata for exactly one entity family/state schema pair. */
  constructor(options: RepositoryOptions<EntityType>) {
    if (!isRepositoryOptionsObject(options)) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository options must be a non-null object with an entity type class constructor extending Aggregate, Projection, or ProcessManager.`,
        {
          entityTypeName: "(anonymous)",
        },
      );
    }

    const entityType = options.entityType;
    const schema = options.schema;

    if (typeof entityType !== "function") {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeName(entityType)}" must be a class constructor extending Aggregate, Projection, or ProcessManager.`,
        {
          entityTypeName: entityTypeName(entityType),
        },
      );
    }

    const metadata = describeEntityMetadata(schema);
    const entityFamily = resolveEntityFamily(entityType);

    if (entityFamily === undefined) {
      throw new RepositoryIdentityError(
        "UNSUPPORTED_ENTITY_TYPE",
        `Repository entity type "${entityTypeName(entityType)}" must extend Aggregate, Projection, or ProcessManager.`,
        {
          entityTypeName: entityTypeName(entityType),
          stateFullTypeName: metadata.fullTypeName,
          stateKind: metadata.kind,
        },
      );
    }

    if (metadata.kind !== entityFamily) {
      throw new RepositoryIdentityError(
        "ENTITY_SCHEMA_KIND_MISMATCH",
        `Repository entity type "${entityTypeName(entityType)}" is a ${entityFamily}, but state schema "${metadata.fullTypeName}" declares entity kind "${metadata.kind}".`,
        {
          entityTypeName: entityTypeName(entityType),
          entityFamily,
          stateFullTypeName: metadata.fullTypeName,
          stateKind: metadata.kind,
        },
      );
    }

    this.#entityType = entityType;
    this.#entityFamily = entityFamily;
    this.#metadata = metadata;
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
  get stateSchema(): RepositoryEntitySchema<EntityType> {
    return this.#metadata.schema;
  }

  /** Descriptor-derived metadata for this repository's owned entity state. */
  get metadata(): EntityMetadata<RepositoryEntitySchema<EntityType>> {
    return this.#metadata;
  }

  /** Fully qualified Protobuf type name of the owned entity state. */
  get stateFullTypeName(): RepositoryEntitySchema<EntityType>["typeName"] {
    return this.#metadata.fullTypeName;
  }

  /** Canonical entity ID field copied from descriptor-derived metadata. */
  get idField(): DescriptorFieldMetadata {
    return cloneFieldMetadata(this.#metadata.idField);
  }

  /** Copy-safe immutable identity snapshot for later builder duplicate/conflict checks. */
  get snapshot(): RepositoryIdentitySnapshot<RepositoryEntitySchema<EntityType>, EntityType> {
    const metadata = cloneEntityMetadata(this.#metadata);

    return Object.freeze({
      entityType: this.#entityType,
      entityFamily: this.#entityFamily,
      stateSchema: metadata.schema,
      metadata,
      stateFullTypeName: metadata.fullTypeName,
      idField: cloneFieldMetadata(metadata.idField),
    });
  }
}

function isRepositoryOptionsObject(options: unknown): options is object {
  return typeof options === "object" && options !== null;
}

function resolveEntityFamily(entityType: RuntimeRepositoryEntityType): EntityFamily | undefined {
  const prototype = entityType.prototype;

  if (Object.prototype.isPrototypeOf.call(Aggregate.prototype, prototype)) {
    return "aggregate";
  }
  if (Object.prototype.isPrototypeOf.call(Projection.prototype, prototype)) {
    return "projection";
  }
  if (Object.prototype.isPrototypeOf.call(ProcessManager.prototype, prototype)) {
    return "process-manager";
  }

  return undefined;
}

function entityTypeName(entityType: unknown): string {
  if ((typeof entityType !== "object" && typeof entityType !== "function") || entityType === null) {
    return "(anonymous)";
  }

  const name = (entityType as { readonly name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : "(anonymous)";
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
