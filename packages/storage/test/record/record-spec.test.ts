import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-ts/proto";
import { EventIdSchema, EventSchema } from "@spine-ts/proto";
import { describe, expect, it } from "vitest";

import { RecordColumn, RecordSpec } from "../../src/index.js";

describe("RecordSpec", () => {
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
      extractId: () => id,
      columns: [new RecordColumn<Message>("copy", () => columnValue)],
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
      extractId: () => unclonableId,
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-1" }),
      message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
    });

    expect(() => spec.materialize(event)).toThrow("Storage value could not be cloned.");
  });

  it("raises a stable error when record cloning falls back to an invalid schema", () => {
    const spec = new RecordSpec<string, Message>({
      schema: {} as GenMessage<Message>,
      extractId: () => "record-1",
    });

    expect(() => spec.cloneRecord({} as Message)).toThrow("Storage record could not be cloned.");
  });
});

function unclonableId() {
  return undefined;
}
