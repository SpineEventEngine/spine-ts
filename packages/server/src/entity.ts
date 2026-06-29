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

type EntityVersionMetadataPrimitive =
  string | number | boolean | bigint | symbol | null | undefined;

/** Plain snapshot data accepted as caller-owned entity version metadata. */
export type EntityVersionMetadata =
  EntityVersionMetadataPrimitive | readonly EntityVersionMetadata[] | object;

type NonPlainEntityVersionMetadata =
  | Date
  | RegExp
  | Error
  | Promise<unknown>
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | ArrayBuffer
  | SharedArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/** Recursive type-level validator for caller-owned plain entity version metadata. */
export type PlainEntityVersionMetadata<Version> = PlainEntityVersionMetadataAtDepth<Version, []>;

type PlainEntityVersionMetadataAtDepth<
  Version,
  Depth extends readonly unknown[],
> = Depth["length"] extends 20
  ? EntityVersionMetadata
  : Version extends EntityVersionMetadataPrimitive
    ? Version
    : Version extends (...args: never[]) => unknown
      ? never
      : Version extends NonPlainEntityVersionMetadata
        ? never
        : Version extends readonly (infer Element)[]
          ? readonly PlainEntityVersionMetadataAtDepth<Element, readonly [unknown, ...Depth]>[]
          : Version extends object
            ? {
                readonly [Key in keyof Version]: PlainEntityVersionMetadataAtDepth<
                  Version[Key],
                  readonly [unknown, ...Depth]
                >;
              }
            : never;

type EntityVersionMetadataInput<Version> = [Version] extends [EntityVersionMetadata]
  ? [EntityVersionMetadata] extends [Version]
    ? Version
    : PlainEntityVersionMetadata<Version>
  : PlainEntityVersionMetadata<Version>;

declare const process: {
  readonly getBuiltinModule: (specifier: "node:util") => {
    readonly types: {
      readonly isProxy: (value: object) => boolean;
    };
  };
};

const isProxy = process.getBuiltinModule("node:util").types.isProxy;

/** Initial values for constructing an {@link Entity}. */
export interface EntityOptions<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> {
  /** Stable entity identifier owned by the caller/domain type. */
  readonly id: Id;
  /** Generated Protobuf-ES schema describing the entity state. */
  readonly schema: Schema;
  /** Initial entity state snapshot. */
  readonly state: MessageShape<Schema>;
  /** Caller-owned plain version metadata snapshot. */
  readonly version: EntityVersionMetadataInput<Version>;
  /** Initial lifecycle flags. Defaults to active, not deleted. */
  readonly lifecycle?: Partial<EntityLifecycleFlags>;
}

/**
 * Common in-memory OOP shell for one server-side entity state.
 *
 * The shell exposes identity, descriptor-derived metadata, cloned state
 * snapshots, caller-owned plain version metadata snapshots, and lifecycle flags. It does not
 * invoke handlers, create transactions, write repositories or storage, dispatch
 * messages, increment versions, route IDs, query read models, start buses, or
 * mutate process-wide runtime state.
 */
export abstract class Entity<
  Id,
  Schema extends DescriptorMessageSchema,
  Version = EntityVersionMetadata,
> {
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
    this.#version = cloneVersionMetadata(options.version) as Version;
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

  /** Caller-owned plain version metadata snapshot. */
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

  /** Replace caller-owned plain version metadata from future subclass/runtime code. */
  protected replaceVersionMetadata(version: EntityVersionMetadataInput<Version>): void {
    this.#version = cloneVersionMetadata(version) as Version;
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

const maxVersionMetadataDepth = 1_000;

function cloneVersionMetadata<Version>(version: Version): Version {
  return clonePlainVersionMetadata(version, "$", new WeakSet(), 0) as Version;
}

function clonePlainVersionMetadata(
  value: unknown,
  path: string,
  stack: WeakSet<object>,
  depth: number,
): EntityVersionMetadata {
  if (depth > maxVersionMetadataDepth) {
    throw nonPlainVersionMetadataError(path, "excessive nesting depth");
  }

  if (value === null) {
    return value;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return value;
    case "function":
      throw nonPlainVersionMetadataError(path, "function");
    case "object":
      return clonePlainVersionObject(value, path, stack, depth);
  }
}

function clonePlainVersionObject(
  value: object,
  path: string,
  stack: WeakSet<object>,
  depth: number,
): EntityVersionMetadata {
  if (isProxy(value)) {
    throw nonPlainVersionMetadataError(path, "Proxy");
  }
  if (ArrayBuffer.isView(value)) {
    throw nonPlainVersionMetadataError(path, getObjectKind(value));
  }
  if (value instanceof ArrayBuffer || isSharedArrayBuffer(value)) {
    throw nonPlainVersionMetadataError(path, getObjectKind(value));
  }
  if (stack.has(value)) {
    throw nonPlainVersionMetadataError(path, "cyclic object");
  }

  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return clonePlainVersionArray(value, path, stack, depth);
    }

    if (!isPlainObject(value)) {
      throw nonPlainVersionMetadataError(path, getObjectKind(value));
    }

    const clone = Object.create(getObjectPrototype(value)) as Record<string, EntityVersionMetadata>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
    if (symbolKey !== undefined) {
      throw nonPlainVersionMetadataError(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      const childPath = `${path}.${key}`;
      if (!descriptor.enumerable) {
        throw nonPlainVersionMetadataError(childPath, "non-enumerable property");
      }
      if (!("value" in descriptor)) {
        throw nonPlainVersionMetadataError(childPath, "accessor property");
      }
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: clonePlainVersionMetadata(descriptor.value, childPath, stack, depth + 1),
        writable: true,
      });
    }

    return clone;
  } finally {
    stack.delete(value);
  }
}

function clonePlainVersionArray(
  value: readonly unknown[],
  path: string,
  stack: WeakSet<object>,
  depth: number,
): readonly EntityVersionMetadata[] {
  if (getObjectPrototype(value) !== Array.prototype) {
    throw nonPlainVersionMetadataError(path, "Array");
  }

  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value);
  const [symbolKey] = Object.getOwnPropertySymbols(descriptors);
  if (symbolKey !== undefined) {
    throw nonPlainVersionMetadataError(`${path}[${String(symbolKey)}]`, "symbol-keyed property");
  }

  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)) {
    throw nonPlainVersionMetadataError(path, "array without data length");
  }

  const length = lengthDescriptor.value as number;
  const clone = new Array<EntityVersionMetadata>(length);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "length") {
      continue;
    }

    if (!isArrayElementKey(key, length)) {
      throw nonPlainVersionMetadataError(`${path}.${key}`, "custom array property");
    }
    if (!descriptor.enumerable) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "non-enumerable property");
    }
    if (!("value" in descriptor)) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "accessor property");
    }
  }

  for (let index = 0; index < length; index += 1) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw nonPlainVersionMetadataError(`${path}[${key}]`, "sparse array element");
    }

    Object.defineProperty(clone, index, {
      configurable: true,
      enumerable: true,
      value: clonePlainVersionMetadata(descriptor.value, `${path}[${key}]`, stack, depth + 1),
      writable: true,
    });
  }

  return clone;
}

function isArrayElementKey(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function isPlainObject(value: object): boolean {
  const prototype = getObjectPrototype(value);
  return prototype === Object.prototype || prototype === null;
}

function getObjectPrototype(value: object): object | null {
  return Object.getPrototypeOf(value) as object | null;
}

function getObjectKind(value: object): string {
  if (value instanceof Date) {
    return "Date";
  }
  if (value instanceof Map) {
    return "Map";
  }
  if (value instanceof Set) {
    return "Set";
  }
  if (ArrayBuffer.isView(value)) {
    return "typed array";
  }
  if (value instanceof ArrayBuffer) {
    return "ArrayBuffer";
  }
  if (isSharedArrayBuffer(value)) {
    return "SharedArrayBuffer";
  }
  return "object";
}

function isSharedArrayBuffer(value: object): boolean {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function nonPlainVersionMetadataError(path: string, kind: string): TypeError {
  return new TypeError(
    `Entity version metadata must be plain snapshot data; ${path} contains ${kind}.`,
  );
}
