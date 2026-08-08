import { create } from "@bufbuild/protobuf";
import { AnySchema, StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, VersionSchema } from "@spine-event-engine/proto";
import { EntityRecordSchema } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import { eventHistorySpec, stateHistorySpec } from "../../src/entity/entity-history-record-spec.js";
import { StorageGroup } from "../../src/record/storage-group.js";

describe("StorageGroup", () => {
  it("rejects blank provider-visible group names", () => {
    expect(() => new StorageGroup(" ")).toThrow(/blank/);
  });
});

describe("stateHistorySpec", () => {
  it("uses generated state keys and records under the state-type storage group", () => {
    const history = stateHistorySpec(StringValueSchema);
    const entityId = create(AnySchema, {
      typeUrl: "type.spine.io/tasks.TaskId",
      value: new Uint8Array([1]),
    });
    const created = create(TimestampSchema, { seconds: 42n });
    const record = create(EntityRecordSchema, {
      entityId,
      version: create(VersionSchema, { number: 7, timestamp: created }),
    });

    expect(history.group.name).toBe(StringValueSchema.typeName);
    expect(history.spec.sourceType).toBe(StringValueSchema);
    expect(history.spec.recordType).toBe(EntityRecordSchema);
    expect(history.spec.idType.typeName).toBe("spine.server.entity.EntityStateKey");
    expect(history.spec.materialize(record).id).toMatchObject({ entityId, version: 7 });
    expect(history.spec.columns.map((column) => column.name)).toEqual([
      "entity_id",
      "created",
      "version",
    ]);
  });

  it("rejects a state row without an Entity ID and materializes missing version fields safely", () => {
    const history = stateHistorySpec(StringValueSchema);
    expect(() => history.spec.materialize(create(EntityRecordSchema))).toThrow(/entityId/);
    const entityId = create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskId" });
    const materialized = history.spec.materialize(create(EntityRecordSchema, { entityId }));
    expect([...materialized.columns.values()]).toEqual([entityId, create(TimestampSchema), 0]);
  });
});

describe("eventHistorySpec", () => {
  it("uses Event IDs and rows under the served state-type storage group", () => {
    const history = eventHistorySpec(StringValueSchema);

    expect(history.group.name).toBe(StringValueSchema.typeName);
    expect(history.spec.sourceType).toBe(EventSchema);
    expect(history.spec.recordType).toBe(EventSchema);
    expect(history.spec.idType).toBe(EventIdSchema);
    expect(history.spec.columns.map((column) => column.name)).toEqual([
      "entity_id",
      "created",
      "version",
    ]);
  });

  it("rejects an Event without an ID and materializes missing context fields safely", () => {
    const history = eventHistorySpec(StringValueSchema);
    expect(() => history.spec.materialize(create(EventSchema))).toThrow(/Event.id/);
    const materialized = history.spec.materialize(
      create(EventSchema, { id: create(EventIdSchema, { value: "event" }) }),
    );
    expect([...materialized.columns.values()]).toEqual([undefined, create(TimestampSchema), 0]);
  });
});
