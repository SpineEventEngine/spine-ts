/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { clone } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";

import { RecordColumn } from "./record-column.js";

const storageHost = globalThis as typeof globalThis & {
  structuredClone<Value>(value: Value): Value;
};

/**
 * Configures one direct Protobuf record family and its identity.
 */
// prettier-ignore
export type RecordSpecOptions<I, R extends Message> = {

  /**
   * Original message type represented by the stored records.
   */
  readonly sourceType?: GenMessage<Message>;

  /**
   * Protobuf record type stored by the family.
   */
  readonly recordType: GenMessage<R>;

  /**
   * Returns the authoritative identity extracted from a direct record.
   *
   * @param record Supplies the direct record.
   * @returns The authoritative record identity.
   */
  readonly extractId: (record: R) => I;

  /**
   * Declared query columns materialized from each record.
   */
  readonly columns?: readonly RecordColumn<R>[];
} & ([I] extends [Message]
  ? {

      /**
       * Generated schema for a message-valued identity.
       */
      readonly idSchema: GenMessage<I & Message>;
      readonly idKind?: never;
    }
  : {
      readonly idSchema?: never;

      /**
       * Stable kind name for a primitive identity.
       */
      readonly idKind: string;
    });

interface RuntimeRecordSpecInput {
  readonly idSchema?: GenMessage<Message>;
  readonly idKind?: string;
}

/**
 * Declarative specification for one identified Protobuf record type.
 */
export class RecordSpec<I, R extends Message> {
  readonly #columns: readonly RecordColumn<R>[];
  readonly #extractId: (record: R) => I;
  readonly #idSchema: (I extends Message ? GenMessage<I> : undefined) | undefined;
  readonly #idKind: string;
  readonly #recordType: GenMessage<R>;
  readonly #sourceType: GenMessage<Message>;

  /**
   * Creates a record specification.
   *
   * @throws Error if the ID type is invalid or two declared columns have the same name.
   * @param input The source, record, identity, and column definitions.
   */
  constructor(input: RecordSpecOptions<I, R>) {
    const runtimeInput = input as RuntimeRecordSpecInput;
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
      runtimeInput.idSchema === undefined &&
      (runtimeInput.idKind === undefined || runtimeInput.idKind.trim().length === 0)
    ) {
      throw new Error("Storage record specification requires a non-blank primitive ID kind.");
    }
    if (runtimeInput.idSchema !== undefined && runtimeInput.idKind !== undefined) {
      throw new Error(
        "Storage record specification must not declare both an ID schema and primitive ID kind.",
      );
    }
    this.#idSchema = input.idSchema as I extends Message ? GenMessage<I> : undefined;
    this.#idKind = input.idKind ?? "";
    this.#recordType = input.recordType;
    this.#sourceType = input.sourceType ?? input.recordType;
  }

  /**
   * Returns the original message type represented by these records.
   * @returns The source message type.
   */
  get sourceType(): GenMessage<Message> {
    return this.#sourceType;
  }

  /**
   * Returns the type used to identify stored records.
   * @returns The message ID type or primitive ID kind.
   */
  get idType(): I extends Message ? GenMessage<I> : string {
    return (this.#idSchema ?? this.#idKind) as I extends Message ? GenMessage<I> : string;
  }

  /**
   * Returns the Protobuf record type stored by this specification.
   * @returns The managed record type.
   */
  get recordType(): GenMessage<R> {
    return this.#recordType;
  }

  /**
   * Returns the columns materialized from stored records.
   * @returns The declared record columns.
   */
  get columns(): readonly RecordColumn<R>[] {
    return this.#columns;
  }

  /**
   * Copies an ID value according to this specification.
   * @param id The ID to clone.
   * @returns The cloned ID.
   */
  cloneId(id: I): I {
    const idSchema = this.#idSchema;

    return idSchema === undefined ? RecordCloner.value(id) : RecordCloner.message(idSchema, id);
  }

  /**
   * Copies one record value according to this specification.
   * @param record The record to clone.
   * @returns The cloned record.
   */
  cloneRecord(record: R): R {
    return RecordCloner.message(this.#recordType, record);
  }

  /**
   * Gets the identifier from one stored record.
   * @param record The stored record.
   * @returns The logical record identifier.
   */
  idValueIn(record: R): I {
    return this.#extractId(record);
  }

  /**
   * Creates materialized record values with cloned identifiers and columns.
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
