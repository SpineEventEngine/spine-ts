import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { RecordColumn, RecordSpec } from "../../src/index.js";

describe("RecordSpec", () => {
  it("requires a non-blank portable storage key", () => {
    expect(
      () =>
        new RecordSpec({
          schema: EventSchema,
          storageKey: " events ",
          idKind: "string",
          extractId: (event) => event.id,
        }),
    ).toThrow(/storage key/i);
  });

  it("rejects empty and control-character storage keys", () => {
    for (const storageKey of ["", "events\u0000current", "events\u007fcurrent"]) {
      expect(
        () =>
          new RecordSpec({
            schema: EventSchema,
            storageKey,
            idKind: "string",
            extractId: (event) => event.id,
          }),
      ).toThrow(/storage key/i);
    }
  });

  it("rejects blank record-column descriptors", () => {
    expect(() => new RecordColumn<Event>("kind", () => "event", " \t ")).toThrow(/value type/i);
  });

  it("rejects a schema ID combined with a primitive ID descriptor", () => {
    expect(
      () =>
        new RecordSpec({
          schema: EventSchema,
          storageKey: "spine.core.Event:invalid-id",
          idSchema: EventIdSchema,
          idKind: "string",
          extractId: (event) => event.id ?? create(EventIdSchema),
        }),
    ).toThrow(/both an ID schema and primitive ID kind/i);
  });

  it("makes compatibility fingerprints deterministic for schemas, IDs, and columns", () => {
    const first = new RecordSpec({
      schema: EventSchema,
      storageKey: "spine.core.Event:first",
      idSchema: EventIdSchema,
      extractId: (event) => event.id ?? create(EventIdSchema),
      columns: [new RecordColumn("kind", () => "event", "string")],
    });
    const equivalent = new RecordSpec({
      schema: EventSchema,
      storageKey: "spine.core.Event:second",
      idSchema: EventIdSchema,
      extractId: (event) => event.id ?? create(EventIdSchema),
      columns: [new RecordColumn("kind", () => "event", "string")],
    });

    expect(first.compatibilityFingerprint).toBe(equivalent.compatibilityFingerprint);
    expect(first.compatibilityFingerprint).toContain(EventSchema.typeName);
    expect(first.compatibilityFingerprint).toContain(EventIdSchema.typeName);
  });

  it("distinguishes same-key layouts by declared column and primitive ID descriptors", () => {
    const stringColumn = new RecordSpec<string, Event>({
      schema: EventSchema,
      storageKey: "spine.core.Event:descriptor",
      idKind: "string",
      extractId: () => "event",
      columns: [new RecordColumn("value", () => "one", "string")],
    });
    const numberColumn = new RecordSpec<string, Event>({
      schema: EventSchema,
      storageKey: "spine.core.Event:descriptor",
      idKind: "string",
      extractId: () => "event",
      columns: [new RecordColumn("value", () => 1, "number")],
    });
    const numberId = new RecordSpec<number, Event>({
      schema: EventSchema,
      storageKey: "spine.core.Event:descriptor",
      idKind: "number",
      extractId: () => 1,
      columns: [new RecordColumn("value", () => "one", "string")],
    });

    expect(stringColumn.compatibilityFingerprint).not.toBe(numberColumn.compatibilityFingerprint);
    expect(stringColumn.compatibilityFingerprint).not.toBe(numberId.compatibilityFingerprint);
  });

  it("exposes its read-only protobuf schema to storage adapters", () => {
    const spec = new RecordSpec({
      schema: EventSchema,
      storageKey: "spine.core.Event:record-spec",
      idSchema: EventIdSchema,
      extractId: (event) => event.id ?? create(EventIdSchema),
    });

    expect(spec.schema).toBe(EventSchema);
  });

  it("uses clone methods for ids, records, and column values when they exist", () => {
    const recordClone = {
      id: "record-1",
      clone: () =>
        Object.freeze({
          id: "record-1-copy",
          cloned: true,
        }),
    } as unknown as Message;
    const id = {
      value: "id-1",
      clone: () =>
        Object.freeze({
          value: "id-1-copy",
          cloned: true,
        }),
    };
    const columnValue = {
      value: "column-1",
      clone: () =>
        Object.freeze({
          value: "column-1-copy",
          cloned: true,
        }),
    };
    const spec = new RecordSpec<typeof id, Message>({
      schema: {} as GenMessage<Message>,
      storageKey: "test.Record:clone",
      idKind: "object",
      extractId: () => id,
      columns: [new RecordColumn<Message>("copy", () => columnValue, "object")],
    });

    const materialized = spec.materialize(recordClone);

    expect(materialized.record).toMatchObject({
      id: "record-1-copy",
      cloned: true,
    });
    expect(materialized.id).toMatchObject({
      value: "id-1-copy",
      cloned: true,
    });
    expect(materialized.columns.get("copy")).toMatchObject({
      value: "column-1-copy",
      cloned: true,
    });
  });

  it("raises a stable error when plain values cannot be cloned", () => {
    const spec = new RecordSpec<() => void, Event>({
      schema: EventSchema,
      storageKey: "spine.core.Event:unclonable",
      idKind: "function",
      extractId: () => unclonableId,
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-1" }),
      message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
    });

    expect(() => spec.materialize(event)).toThrow("Storage value could not be cloned.");
  });

  it("rejects duplicate declared record-column names", () => {
    expect(
      () =>
        new RecordSpec({
          schema: EventSchema,
          storageKey: "spine.core.Event:columns",
          idKind: "string",
          extractId: (event) => event.id,
          columns: [
            new RecordColumn("kind", () => "one", "string"),
            new RecordColumn("kind", () => "two", "string"),
          ],
        }),
    ).toThrow('duplicate record column "kind"');
  });

  it("raises a stable error when record cloning falls back to an invalid schema", () => {
    const spec = new RecordSpec<string, Message>({
      schema: {} as GenMessage<Message>,
      storageKey: "test.Record:invalid",
      idKind: "string",
      extractId: () => "record-1",
    });

    expect(() => spec.cloneRecord({} as Message)).toThrow("Storage record could not be cloned.");
  });
});

function unclonableId() {
  return undefined;
}
