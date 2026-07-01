import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import { cloneMessage, cloneValue } from "./record-clone.js";
import { RecordColumn } from "./record-column.js";

/** Input used to define one stored-record specification. */
export interface RecordSpecInput<I, R extends Message> {
  /** Generated schema for the stored record type. */
  readonly schema: GenMessage<R>;
  /** Generated schema for the record ID when the ID is also a Protobuf message. */
  readonly idSchema?: GenMessage<Message>;
  /** Extract the identifier from one stored record. */
  readonly extractId: (record: R) => I;
  /** Queryable stored columns derived from the record. */
  readonly columns?: readonly RecordColumn<R>[];
}

/** Declarative specification for one identified Protobuf record type. */
export class RecordSpec<I, R extends Message> {
  readonly columns: readonly RecordColumn<R>[];
  readonly extractId: (record: R) => I;
  readonly idSchema: GenMessage<Message> | undefined;
  readonly record: GenMessage<R>;

  constructor(input: RecordSpecInput<I, R>) {
    this.columns = input.columns ?? [];
    this.extractId = input.extractId;
    this.idSchema = input.idSchema;
    this.record = input.schema;
  }

  /** Clone an ID value according to this spec. */
  cloneId(id: I): I {
    return cloneValue(id, this.idSchema);
  }

  /** Clone one record value according to this spec. */
  cloneRecord(record: R): R {
    return cloneMessage(this.record, record);
  }

  /** Extract the identifier from one stored record. */
  idValueIn(record: R): I {
    return this.extractId(record);
  }

  /** Read the values of every configured column from the record. */
  valuesIn(record: R): ReadonlyMap<string, unknown> {
    return new Map(this.columns.map((column) => [column.name, cloneValue(column.valueIn(record))]));
  }
}
