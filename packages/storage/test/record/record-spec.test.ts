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

import { create, ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Event, EventId } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";

import { RecordColumn } from "../../src/record/record-column.js";
import { ColumnTypes } from "../../src/record/column-type.js";
import { RecordSpec } from "../../src/record/record-spec.js";

describe("RecordSpec", () => {
  it("exposes the JVM-style types and defaults source type to the record type", () => {
    const columns = [
      new RecordColumn<Event>("kind", ColumnTypes.scalar(ScalarType.STRING), () => "event"),
    ];
    const spec = new RecordSpec({
      recordType: EventSchema,
      idSchema: EventIdSchema,
      extractId: (event) => event.id ?? create(EventIdSchema),
      columns,
    });

    expect(spec.sourceType).toBe(EventSchema);
    expect(spec.idType).toBe(EventIdSchema);
    expect(spec.recordType).toBe(EventSchema);
    expect(spec.columns).toBe(columns);
  });

  it("retains an explicit source type distinct from the stored record type", () => {
    const spec = new RecordSpec<string, Event>({
      sourceType: AnySchema,
      recordType: EventSchema,
      idKind: "string",
      extractId: () => "event-1",
    });

    expect(spec.sourceType).toBe(AnySchema);
    expect(spec.recordType).toBe(EventSchema);
    expect(spec.idType).toBe("string");
  });

  it("requires exactly one ID type", () => {
    expect(
      () =>
        new RecordSpec({
          recordType: EventSchema,
          extractId: (event: Event) => event.id,
        } as never),
    ).toThrow(/non-blank primitive ID kind/i);
    expect(
      () =>
        new RecordSpec({
          recordType: EventSchema,
          idSchema: EventIdSchema,
          idKind: "string",
          extractId: (event: Event) => event.id ?? create(EventIdSchema),
        } as never),
    ).toThrow(/both an ID schema and primitive ID kind/i);
  });

  it("materializes cloned IDs, records, and columns", () => {
    const spec = new RecordSpec({
      recordType: EventSchema,
      idSchema: EventIdSchema,
      extractId: (event) => event.id ?? create(EventIdSchema),
      columns: [
        new RecordColumn<Event>(
          "typeUrl",
          ColumnTypes.scalar(ScalarType.STRING),
          (event) => event.message?.typeUrl,
        ),
      ],
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-1" }),
      message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
    });

    const materialized = spec.materialize(event);
    if (event.id === undefined || event.message === undefined) {
      throw new Error("Expected materialized test event fields.");
    }
    event.id.value = "changed";
    event.message.typeUrl = "type.spine.io/tasks.Mutated";

    expect(materialized.id.value).toBe("event-1");
    expect(materialized.record.message?.typeUrl).toBe("type.spine.io/tasks.TaskCreated");
    expect(materialized.columns.get("typeUrl")).toBe("type.spine.io/tasks.TaskCreated");
  });

  it("uses clone methods for IDs, records, and column values when they exist", () => {
    const recordClone = {
      id: "record-1",
      clone: () => Object.freeze({ id: "record-1-copy", cloned: true }),
    } as unknown as Message;
    const id = {
      value: "id-1",
      clone: () => Object.freeze({ value: "id-1-copy", cloned: true }),
    };
    const columnValue = {
      value: "column-1",
      clone: () => Object.freeze({ value: "column-1-copy", cloned: true }),
    };
    const spec = new RecordSpec<typeof id, Message>({
      recordType: {} as GenMessage<Message>,
      idKind: "object",
      extractId: () => id,
      columns: [
        new RecordColumn<Message>("copy", ColumnTypes.message(AnySchema), () => columnValue),
      ],
    });

    const materialized = spec.materialize(recordClone);

    expect(materialized.record).toMatchObject({ id: "record-1-copy", cloned: true });
    expect(materialized.id).toMatchObject({ value: "id-1-copy", cloned: true });
    expect(materialized.columns.get("copy")).toMatchObject({
      value: "column-1-copy",
      cloned: true,
    });
  });

  it("raises stable errors for unclonable IDs and records", () => {
    const unclonableSpec = new RecordSpec<() => void, Event>({
      recordType: EventSchema,
      idKind: "function",
      extractId: () => unclonableId,
    });
    const invalidRecordSpec = new RecordSpec<string, Message>({
      recordType: {} as GenMessage<Message>,
      idKind: "string",
      extractId: () => "record-1",
    });

    expect(() => unclonableSpec.materialize(create(EventSchema))).toThrow(
      "Storage value could not be cloned.",
    );
    expect(() => invalidRecordSpec.cloneRecord({} as Message)).toThrow(
      "Storage record could not be cloned.",
    );
  });

  it("rejects duplicate declared record-column names", () => {
    expect(
      () =>
        new RecordSpec({
          recordType: EventSchema,
          idKind: "string",
          extractId: (event) => event.id,
          columns: [
            new RecordColumn("kind", ColumnTypes.scalar(ScalarType.STRING), () => "one"),
            new RecordColumn("kind", ColumnTypes.scalar(ScalarType.STRING), () => "two"),
          ],
        }),
    ).toThrow('duplicate record column "kind"');
  });

  it("does not admit legacy schema, storage key, or fingerprint members", () => {
    type Input = ConstructorParameters<typeof RecordSpec<string, Event>>[0];
    type Surface = RecordSpec<string, Event>;

    expectTypeOf<Input>().not.toHaveProperty("schema");
    expectTypeOf<Input>().not.toHaveProperty("storageKey");
    expectTypeOf<Surface>().not.toHaveProperty("schema");
    expectTypeOf<Surface>().not.toHaveProperty("storageKey");
    expectTypeOf<Surface>().not.toHaveProperty("compatibilityFingerprint");

    const sourceType: GenMessage<Event> = EventSchema;
    expect(sourceType).toBe(EventSchema);
  });

  it("requires exactly one ID descriptor at compile time", () => {
    type Input = ConstructorParameters<typeof RecordSpec<EventId, Event>>[0];

    // @ts-expect-error RecordSpec needs an ID schema or primitive ID kind.
    const withoutId: Input = { recordType: EventSchema, extractId: (event) => event.id };
    const withBoth: Input = {
      recordType: EventSchema,
      idSchema: EventIdSchema,
      // @ts-expect-error RecordSpec cannot combine a message ID schema and primitive ID kind.
      idKind: "string",
      extractId: (event) => event.id ?? create(EventIdSchema),
    };
    const messageWithKind: Input = {
      recordType: EventSchema,
      // @ts-expect-error Message IDs require an ID schema instead of a primitive ID kind.
      idKind: "string",
      extractId: (event) => event.id ?? create(EventIdSchema),
    };

    void withoutId;
    void withBoth;
    void messageWithKind;
  });
});

function unclonableId() {
  return undefined;
}
