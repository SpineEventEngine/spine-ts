import { clone } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import { RecordColumn } from "./record-column.js";

const storageHost = globalThis as typeof globalThis & {
  structuredClone<Value>(value: Value): Value;
};

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
   * @param input The schema, identity, and column definitions.
   * @returns The created record specification.
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
    RecordSpecSupport.validateStorageKey(input.storageKey);
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

  /** Returns the Protobuf schema used to clone, encode, and decode records.
   * @returns The managed record schema.
   */
  get schema(): GenMessage<R> {
    return this.#record;
  }

  /** Returns the stable provider-visible physical layout identity.
   * @returns The record storage key.
   */
  get storageKey(): string {
    return this.#storageKey;
  }

  /** Returns the deterministic provider metadata compatibility descriptor.
   * @returns The compatibility fingerprint.
   */
  get compatibilityFingerprint(): string {
    return JSON.stringify({
      columns: this.#columns.map((column) => ({ name: column.name, type: column.valueType })),
      id: this.#idSchema?.typeName ?? `primitive:${this.#idKind}`,
      record: this.#record.typeName,
    });
  }

  /** Copies an ID value according to this specification.
   * @param id The ID to clone.
   * @returns The cloned ID.
   */
  cloneId(id: I): I {
    const idSchema = this.#idSchema;

    return idSchema === undefined ? RecordCloner.value(id) : RecordCloner.message(idSchema, id);
  }

  /** Copies one record value according to this specification.
   * @param record The record to clone.
   * @returns The cloned record.
   */
  cloneRecord(record: R): R {
    return RecordCloner.message(this.#record, record);
  }

  /** Gets the identifier from one stored record.
   * @param record The stored record.
   * @returns The logical record identifier.
   */
  idValueIn(record: R): I {
    return this.#extractId(record);
  }

  /** Creates materialized record values with cloned identifiers and columns.
   * @param record The record to materialize.
   * @returns The materialized record values.
   */
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

const RecordSpecSupport = Object.freeze({
  validateStorageKey(storageKey: string): void {
    if (
      storageKey.length === 0 ||
      storageKey.trim() !== storageKey ||
      this.hasControlCharacter(storageKey)
    ) {
      throw new Error("Storage record specification requires a non-blank storage key.");
    }
  },

  hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
      const codePoint = value.codePointAt(index);
      if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true;
      if (codePoint !== undefined && codePoint > 0xffff) index++;
    }
    return false;
  },
});

type CloneMethod = (this: object) => unknown;

const RecordCloner = Object.freeze({
  message<R extends Message>(schema: GenMessage<R>, record: R): R {
    const cloneMethod = this.findCloneMethod(record);

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
    const cloneMethod = this.findCloneMethod(value);

    if (cloneMethod !== undefined) {
      return Reflect.apply(cloneMethod, value, []) as T;
    }

    try {
      return storageHost.structuredClone(value);
    } catch {
      throw new Error("Storage value could not be cloned.");
    }
  },

  findCloneMethod(value: unknown): CloneMethod | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const candidate: unknown = Reflect.get(value, "clone");
    return typeof candidate === "function" ? (candidate as CloneMethod) : undefined;
  },
});
