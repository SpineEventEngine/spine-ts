import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescField, Message } from "@bufbuild/protobuf";
import type { GenExtension, GenFile, GenMessage } from "@bufbuild/protobuf/codegenv2";
import type { FileOptions } from "@bufbuild/protobuf/wkt";
import {
  ConstraintViolationSchema,
  FieldPathSchema,
  TemplateStringSchema,
  ValidationErrorSchema,
  type_url_prefix,
} from "@spine-ts/proto";

/** Standard Protobuf `Any` prefix used when a file has no Spine type URL option. */
export const DEFAULT_TYPE_URL_PREFIX = "type.googleapis.com";

/** Protobuf-ES schema shape accepted by the Spine TS type registry. */
export type MessageSchema = GenMessage<Message>;

/** Options for registering a schema in a {@link TypeRegistry}. */
export interface RegisterTypeOptions {
  /**
   * Explicit type URL for precomputed/generated metadata.
   *
   * Most callers should omit this and let the registry derive the URL from the
   * schema file's Spine `type_url_prefix` option.
   */
  readonly typeUrl?: string;
  /** Semantic marker tags from Spine `(is)` or `(every_is)` metadata. */
  readonly semanticTags?: readonly string[];
}

/** Descriptor-backed metadata for a registered Protobuf message schema. */
export interface TypeMetadata<Schema extends MessageSchema = MessageSchema> {
  /** Fully qualified Protobuf message name, without a leading dot. */
  readonly fullTypeName: Schema["typeName"];
  /** Canonical type URL used in `google.protobuf.Any` and Spine routing. */
  readonly typeUrl: string;
  /** Generated Protobuf-ES schema for this message. */
  readonly schema: Schema;
  /** Alias for the schema as the Protobuf-ES message descriptor. */
  readonly descriptor: Schema;
  /** File descriptor that declared the message. */
  readonly fileDescriptor: GenFile;
  /** Protobuf file name with the `.proto` suffix restored. */
  readonly fileName: string;
  /** Prefix that produced {@link TypeMetadata.typeUrl}. */
  readonly typeUrlPrefix: string;
  /** First declared field, preserving Protobuf source declaration order. */
  readonly firstField: DescField | undefined;
  /** First declared field name, when the descriptor exposes one. */
  readonly firstFieldName: string | undefined;
  /** Semantic tags explicitly registered for this schema. */
  readonly semanticTags: readonly string[];
  /** Check whether a file option is set on this schema's file descriptor. */
  hasFileOption<Value>(option: FileOptionExtension<Value>): boolean;
  /** Read a file option from this schema's file descriptor. */
  getFileOption<Value>(option: FileOptionExtension<Value>): Value;
}

/** Protobuf extension descriptor whose extendee is `google.protobuf.FileOptions`. */
export type FileOptionExtension<Value = unknown> = GenExtension<FileOptions, Value>;

/** Options for deriving a schema type URL. */
export interface DeriveTypeUrlOptions {
  /** Prefix used when the schema file has no Spine `type_url_prefix` option. */
  readonly fallbackPrefix?: string;
}

/** Derive the deterministic type URL for a Protobuf-ES message schema. */
export function deriveTypeUrl(schema: MessageSchema, options: DeriveTypeUrlOptions = {}): string {
  const typeUrlPrefix = getTypeUrlPrefix(schema, options.fallbackPrefix);

  return `${typeUrlPrefix.replace(/\/+$/u, "")}/${schema.typeName}`;
}

/** Return the type URL prefix that applies to the given schema. */
export function getTypeUrlPrefix(
  schema: MessageSchema,
  fallbackPrefix: string = DEFAULT_TYPE_URL_PREFIX,
): string {
  if (hasOption(schema.file, type_url_prefix)) {
    return getOption(schema.file, type_url_prefix);
  }

  return fallbackPrefix;
}

/** Registry for Protobuf schemas, Spine type URLs, and descriptor metadata. */
export class TypeRegistry {
  readonly #byFullName = new Map<string, TypeMetadata>();
  readonly #byTypeUrl = new Map<string, TypeMetadata>();
  readonly #bySemanticTag = new Map<string, TypeMetadata[]>();
  readonly #bySchema = new WeakMap<object, TypeMetadata>();
  readonly #bySchemaDescriptor = new WeakMap<object, TypeMetadata>();

  /** Create a registry and optionally register schemas immediately. */
  constructor(schemas: Iterable<MessageSchema> = []) {
    for (const schema of schemas) {
      this.register(schema);
    }
  }

  /** Register one schema and return its immutable metadata. */
  register<Schema extends MessageSchema>(
    schema: Schema,
    options: RegisterTypeOptions = {},
  ): TypeMetadata<Schema> {
    const fullTypeName = schema.typeName;
    const typeUrl = options.typeUrl ?? deriveTypeUrl(schema);
    const duplicateFullName = this.#byFullName.get(fullTypeName);
    const duplicateTypeUrl = this.#byTypeUrl.get(typeUrl);
    const schemaIdentityConflict = this.#bySchemaDescriptor.get(schema.proto);

    if (duplicateFullName !== undefined) {
      throw new Error(
        `Duplicate Protobuf type name "${fullTypeName}" already registered with type URL ` +
          `"${duplicateFullName.typeUrl}".`,
      );
    }

    if (duplicateTypeUrl !== undefined) {
      throw new Error(
        `Duplicate type URL "${typeUrl}" already registered for Protobuf type ` +
          `"${duplicateTypeUrl.fullTypeName}".`,
      );
    }

    if (schemaIdentityConflict !== undefined) {
      throw new Error(
        `Schema identity conflict for "${schemaIdentityConflict.fullTypeName}": ` +
          `the same descriptor identity was registered as "${fullTypeName}".`,
      );
    }

    const metadata = createTypeMetadata(schema, typeUrl, options.semanticTags);

    this.#byFullName.set(metadata.fullTypeName, metadata);
    this.#byTypeUrl.set(metadata.typeUrl, metadata);
    this.#bySchema.set(schema, metadata);
    this.#bySchemaDescriptor.set(schema.proto, metadata);

    for (const tag of metadata.semanticTags) {
      const entries = this.#bySemanticTag.get(tag) ?? [];
      entries.push(metadata);
      this.#bySemanticTag.set(tag, entries);
    }

    return metadata;
  }

  /** Find metadata by fully qualified Protobuf type name. */
  findByFullName(fullTypeName: string): TypeMetadata | undefined {
    return this.#byFullName.get(fullTypeName);
  }

  /** Find metadata by canonical type URL. */
  findByTypeUrl(typeUrl: string): TypeMetadata | undefined {
    return this.#byTypeUrl.get(typeUrl);
  }

  /** Find metadata by generated schema identity. */
  findBySchema(schema: MessageSchema): TypeMetadata | undefined {
    return this.#bySchema.get(schema);
  }

  /** Find all metadata entries tagged with a semantic marker. */
  findBySemanticTag(semanticTag: string): readonly TypeMetadata[] {
    return [...(this.#bySemanticTag.get(semanticTag) ?? [])];
  }

  /** Get metadata by fully qualified Protobuf type name or throw a descriptive error. */
  getByFullName(fullTypeName: string): TypeMetadata {
    const metadata = this.findByFullName(fullTypeName);

    if (metadata === undefined) {
      throw new Error(`No schema registered for Protobuf type name "${fullTypeName}".`);
    }

    return metadata;
  }

  /** Get metadata by canonical type URL or throw a descriptive error. */
  getByTypeUrl(typeUrl: string): TypeMetadata {
    const metadata = this.findByTypeUrl(typeUrl);

    if (metadata === undefined) {
      throw new Error(`No schema registered for type URL "${typeUrl}".`);
    }

    return metadata;
  }

  /** Get metadata by generated schema identity or throw a descriptive error. */
  getBySchema(schema: MessageSchema): TypeMetadata {
    const metadata = this.findBySchema(schema);

    if (metadata === undefined) {
      throw new Error(`No metadata registered for schema "${schema.typeName}".`);
    }

    return metadata;
  }

  /** Return all registered metadata in registration order. */
  list(): readonly TypeMetadata[] {
    return [...this.#byFullName.values()];
  }
}

/** Build a registry containing the currently curated Spine schemas. */
export function createSpineCoreRegistry(): TypeRegistry {
  return new TypeRegistry([
    FieldPathSchema,
    TemplateStringSchema,
    ValidationErrorSchema,
    ConstraintViolationSchema,
  ]);
}

/** Shared registry for the first curated Spine schema set. */
export const spineCoreRegistry: TypeRegistry = createSpineCoreRegistry();

function createTypeMetadata<Schema extends MessageSchema>(
  schema: Schema,
  typeUrl: string,
  semanticTags: readonly string[] = [],
): TypeMetadata<Schema> {
  const firstField = schema.fields[0];
  const tags = [...new Set(semanticTags)].sort();
  const metadata: TypeMetadata<Schema> = {
    fullTypeName: schema.typeName,
    typeUrl,
    schema,
    descriptor: schema,
    fileDescriptor: schema.file,
    fileName: `${schema.file.name}.proto`,
    typeUrlPrefix: typeUrl.slice(0, typeUrl.length - schema.typeName.length - 1),
    firstField,
    firstFieldName: firstField?.name,
    semanticTags: Object.freeze(tags),
    hasFileOption<Value>(option: FileOptionExtension<Value>): boolean {
      return hasOption(schema.file, option);
    },
    getFileOption<Value>(option: FileOptionExtension<Value>): Value {
      return getOption(schema.file, option);
    },
  };

  return Object.freeze(metadata);
}
