import { clone } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import { RecordColumn } from "./record-column.js";

/** Declarative specification for one identified Protobuf record type. */
export class RecordSpec<I, R extends Message> {
  readonly columns: readonly RecordColumn<R>[];
  readonly extractId: (record: R) => I;
  readonly idSchema: RecordIdSchema<I> | undefined;
  readonly record: GenMessage<R>;

  constructor(input: RecordSpecInput<I, R>) {
    this.columns = input.columns ?? [];
    this.extractId = input.extractId;
    this.idSchema = input.idSchema;
    this.record = input.schema;
  }

  /** Clone an ID value according to this spec. */
  cloneId(id: I): I {
    const idSchema = this.idSchema;

    return idSchema === undefined ? RecordCloner.value(id) : RecordCloner.message(idSchema, id);
  }

  /** Clone one record value according to this spec. */
  cloneRecord(record: R): R {
    return RecordCloner.message(this.record, record);
  }

  /** Extract the identifier from one stored record. */
  idValueIn(record: R): I {
    return this.extractId(record);
  }

  /** Clone and materialize one record with its identifier and columns. */
  materialize(record: R): RecordEntry<I, R> {
    const storedRecord = this.cloneRecord(record);
    const id = this.cloneId(this.idValueIn(storedRecord));

    return {
      id,
      record: storedRecord,
      columns: new Map(
        this.columns.map((column) => [
          column.name,
          RecordCloner.value(column.valueIn(storedRecord)),
        ]),
      ),
    };
  }
}

/** Input used to define one stored-record specification. */
export interface RecordSpecInput<I, R extends Message> {
  /** Generated schema for the stored record type. */
  readonly schema: GenMessage<R>;
  /** Generated schema for the record ID when the ID is also a Protobuf message. */
  readonly idSchema?: RecordIdSchema<I>;
  /** Extract the identifier from one stored record. */
  readonly extractId: (record: R) => I;
  /** Queryable stored columns derived from the record. */
  readonly columns?: readonly RecordColumn<R>[];
}

/** Fully prepared stored record data, safe to persist atomically. */
export interface RecordEntry<I, R extends Message> {
  readonly columns: ReadonlyMap<string, unknown>;
  readonly id: I;
  readonly record: R;
}

type CloneMethod = (this: object) => unknown;
type RecordIdSchema<I> = I extends Message ? GenMessage<I> : undefined;

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
