import { clone } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import { RecordColumn } from "./record-column.js";

/** Declarative specification for one identified Protobuf record type. */
export class RecordSpec<I, R extends Message> {
  readonly #columns: readonly RecordColumn<R>[];
  readonly #extractId: (record: R) => I;
  readonly #idSchema: (I extends Message ? GenMessage<I> : undefined) | undefined;
  readonly #idKind: string;
  readonly #record: GenMessage<R>;
  readonly #storageKey: string;

  /**
   * Creates a record specification.
   *
   * @throws Error if two declared columns have the same name.
   */
  constructor(input: {
    readonly schema: GenMessage<R>;
    /** Stable provider-visible identity for this physical record layout. */
    readonly storageKey: string;
    readonly idSchema?: I extends Message ? GenMessage<I> : undefined;
    /** Stable primitive-ID kind when `idSchema` is not supplied. */
    readonly idKind?: string;
    readonly extractId: (record: R) => I;
    readonly columns?: readonly RecordColumn<R>[];
  }) {
    validateStorageKey(input.storageKey);
    this.#columns = input.columns ?? [];
    const names = new Set<string>();
    for (const column of this.#columns) {
      if (names.has(column.name)) {
        throw new Error(
          `Storage record specification has duplicate record column "${column.name}".`,
        );
      }
      names.add(column.name);
    }
    this.#extractId = input.extractId;
    if (
      input.idSchema === undefined &&
      (input.idKind === undefined || input.idKind.trim().length === 0)
    ) {
      throw new Error("Storage record specification requires a non-blank primitive ID kind.");
    }
    if (input.idSchema !== undefined && input.idKind !== undefined) {
      throw new Error(
        "Storage record specification must not declare both an ID schema and primitive ID kind.",
      );
    }
    this.#idSchema = input.idSchema;
    this.#idKind = input.idKind ?? "";
    this.#record = input.schema;
    this.#storageKey = input.storageKey;
  }

  /** Protobuf schema used to clone, encode, and decode this record type. */
  get schema(): GenMessage<R> {
    return this.#record;
  }

  /** Stable provider-visible identity for this physical record layout. */
  get storageKey(): string {
    return this.#storageKey;
  }

  /** Deterministic compatibility descriptor for provider metadata bindings. */
  get compatibilityFingerprint(): string {
    return JSON.stringify({
      columns: this.#columns.map((column) => ({ name: column.name, type: column.valueType })),
      id: this.#idSchema?.typeName ?? `primitive:${this.#idKind}`,
      record: this.#record.typeName,
    });
  }

  /** Clone an ID value according to this spec. */
  cloneId(id: I): I {
    const idSchema = this.#idSchema;

    return idSchema === undefined ? RecordCloner.value(id) : RecordCloner.message(idSchema, id);
  }

  /** Clone one record value according to this spec. */
  cloneRecord(record: R): R {
    return RecordCloner.message(this.#record, record);
  }

  /** Extract the identifier from one stored record. */
  idValueIn(record: R): I {
    return this.#extractId(record);
  }

  /** Clone and materialize one record with its identifier and columns. */
  materialize(record: R): {
    readonly columns: ReadonlyMap<string, unknown>;
    readonly id: I;
    readonly record: R;
  } {
    const storedRecord = this.cloneRecord(record);
    const id = this.cloneId(this.idValueIn(storedRecord));

    return {
      id,
      record: storedRecord,
      columns: new Map(
        this.#columns.map((column) => [
          column.name,
          RecordCloner.value(column.valueIn(storedRecord)),
        ]),
      ),
    };
  }
}

function validateStorageKey(storageKey: string): void {
  if (
    storageKey.length === 0 ||
    storageKey.trim() !== storageKey ||
    hasControlCharacter(storageKey)
  ) {
    throw new Error("Storage record specification requires a non-blank storage key.");
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.codePointAt(index);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
    if (codePoint !== undefined && codePoint > 0xffff) index++;
  }
  return false;
}

type CloneMethod = (this: object) => unknown;

const RecordCloner = Object.freeze({
  message<R extends Message>(schema: GenMessage<R>, record: R): R {
    const cloneMethod = findCloneMethod(record);

    if (cloneMethod !== undefined) {
      return Reflect.apply(cloneMethod, record, []) as R;
    }

    try {
      return clone(schema, record);
    } catch {
      throw new Error("Storage record could not be cloned.");
    }
  },

  value<T>(value: T): T {
    const cloneMethod = findCloneMethod(value);

    if (cloneMethod !== undefined) {
      return Reflect.apply(cloneMethod, value, []) as T;
    }

    try {
      return structuredClone(value);
    } catch {
      throw new Error("Storage value could not be cloned.");
    }
  },
});

function findCloneMethod(value: unknown): CloneMethod | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const candidate: unknown = Reflect.get(value, "clone");

  return typeof candidate === "function" ? (candidate as CloneMethod) : undefined;
}

declare function structuredClone<T>(value: T): T;
