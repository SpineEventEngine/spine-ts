import { fromBinary, toBinary, type MessageShape } from "@bufbuild/protobuf";

import {
  describeEntityMetadata,
  type DescriptorMessageSchema,
  type EntityMetadata,
} from "./entity-metadata.js";

/** Lifecycle flags carried by a common entity shell. */
export interface EntityLifecycleFlags {
  /** Whether the entity is archived. */
  readonly archived: boolean;
  /** Whether the entity is deleted. */
  readonly deleted: boolean;
}

/** Initial values for constructing an {@link Entity}. */
export interface EntityOptions<Id, Schema extends DescriptorMessageSchema, Version = unknown> {
  /** Stable entity identifier owned by the caller/domain type. */
  readonly id: Id;
  /** Generated Protobuf-ES schema describing the entity state. */
  readonly schema: Schema;
  /** Initial entity state snapshot. */
  readonly state: MessageShape<Schema>;
  /** Caller-owned version metadata snapshot. */
  readonly version: Version;
  /** Initial lifecycle flags. Defaults to active, not deleted. */
  readonly lifecycle?: Partial<EntityLifecycleFlags>;
}

/**
 * Common in-memory OOP shell for one server-side entity state.
 *
 * The shell exposes identity, descriptor-derived metadata, cloned state
 * snapshots, caller-owned version metadata snapshots, and lifecycle flags. It does not
 * invoke handlers, create transactions, write repositories or storage, dispatch
 * messages, increment versions, route IDs, query read models, start buses, or
 * mutate process-wide runtime state.
 */
export abstract class Entity<Id, Schema extends DescriptorMessageSchema, Version = unknown> {
  readonly #id: Id;
  readonly #schema: Schema;
  readonly #metadata: EntityMetadata<Schema>;
  #state: MessageShape<Schema>;
  #version: Version;
  #lifecycle: EntityLifecycleFlags;
  #lifecycleFlagsChanged = false;

  /** Create an entity shell from caller-provided state and metadata inputs. */
  constructor(options: EntityOptions<Id, Schema, Version>) {
    this.#id = options.id;
    this.#schema = options.schema;
    this.#metadata = describeEntityMetadata(options.schema);
    this.#state = cloneState(options.schema, options.state);
    this.#version = cloneVersionMetadata(options.version);
    this.#lifecycle = {
      archived: options.lifecycle?.archived ?? false,
      deleted: options.lifecycle?.deleted ?? false,
    };
  }

  /** Stable entity identifier. */
  get id(): Id {
    return this.#id;
  }

  /** Generated Protobuf-ES schema describing this entity's state. */
  get schema(): Schema {
    return this.#schema;
  }

  /** Descriptor-derived metadata for this entity's state schema. */
  get metadata(): EntityMetadata<Schema> {
    return this.#metadata;
  }

  /** Current entity state snapshot. */
  get state(): MessageShape<Schema> {
    return cloneState(this.#schema, this.#state);
  }

  /** Caller-owned version metadata snapshot. */
  get version(): Version {
    return cloneVersionMetadata(this.#version);
  }

  /** Current lifecycle flag snapshot. */
  get lifecycle(): EntityLifecycleFlags {
    return {
      archived: this.#lifecycle.archived,
      deleted: this.#lifecycle.deleted,
    };
  }

  /** Whether the entity is archived. */
  get isArchived(): boolean {
    return this.#lifecycle.archived;
  }

  /** Whether the entity is deleted. */
  get isDeleted(): boolean {
    return this.#lifecycle.deleted;
  }

  /** Whether neither lifecycle flag marks the entity inactive. */
  get isActive(): boolean {
    return !this.isArchived && !this.isDeleted;
  }

  /** Whether lifecycle flags changed after construction. */
  get lifecycleFlagsChanged(): boolean {
    return this.#lifecycleFlagsChanged;
  }

  /** Replace stored state from future subclass/runtime code. */
  protected replaceState(state: MessageShape<Schema>): void {
    this.#state = cloneState(this.#schema, state);
  }

  /** Replace caller-owned version metadata from future subclass/runtime code. */
  protected replaceVersionMetadata(version: Version): void {
    this.#version = cloneVersionMetadata(version);
  }

  /** Replace lifecycle flags from future subclass/runtime code. */
  protected replaceLifecycleFlags(lifecycle: Partial<EntityLifecycleFlags>): void {
    const next = {
      archived: lifecycle.archived ?? this.#lifecycle.archived,
      deleted: lifecycle.deleted ?? this.#lifecycle.deleted,
    };

    if (next.archived !== this.#lifecycle.archived || next.deleted !== this.#lifecycle.deleted) {
      this.#lifecycle = next;
      this.#lifecycleFlagsChanged = true;
    }
  }
}

function cloneState<Schema extends DescriptorMessageSchema>(
  schema: Schema,
  state: MessageShape<Schema>,
): MessageShape<Schema> {
  return fromBinary(schema, toBinary(schema, state, { writeUnknownFields: false }));
}

function cloneVersionMetadata<Version>(version: Version): Version {
  return isObjectLike(version) ? structuredClone(version) : version;
}

function isObjectLike(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

declare function structuredClone<T>(value: T): T;
