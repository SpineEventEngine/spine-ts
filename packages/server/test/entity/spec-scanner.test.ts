import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { VersionSchema, file_spine_options } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import { Aggregate, Projection, Repository, SpecScanner } from "../../src/index.js";
import {
  EntityRecords,
  entityStorageDescriptor,
} from "../../src/entity/entity-storage-descriptor.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & { id: string; name: string; priority: number };
type AggregateState = Message<"AggregateState"> & { id: string; name: string };

const fixtureDescriptorSet = fromBinary(
  FileDescriptorSetSchema,
  Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
);
const fixtureDescriptor = fixtureDescriptorSet.file[0];
if (fixtureDescriptor === undefined)
  throw new Error("Server entity fixture descriptor set is empty.");
const fixtureFile = fileDesc(
  Buffer.from(toBinary(FileDescriptorProtoSchema, fixtureDescriptor)).toString("base64"),
  [file_spine_options],
);

function fixtureSchemaAt<Shape extends Message>(index: number): GenMessage<Shape> {
  return messageDesc(fixtureFile, index) as GenMessage<Shape>;
}

const ProjectionStateSchema = fixtureSchemaAt<ProjectionState>(0);
const AggregateStateSchema = fixtureSchemaAt<AggregateState>(1);
const ProjectionIdSchema = fixtureSchemaAt<Message>(8);
const MessageIdStateSchema = fixtureSchemaAt<Message>(9);

class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
class AlternateAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class MessageIdProjection extends Projection<Message, typeof MessageIdStateSchema, number> {}
class DerivedTaskProjection extends TaskProjection {}

describe("SpecScanner", () => {
  it("derives its current EntityRecord specification from the Entity class alone", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(TaskProjection);

    expect(spec.sourceType).toBe(ProjectionStateSchema);
    expect(spec.recordType.typeName).toBe("spine.server.entity.EntityRecord");
    expect(spec.idType).toBe("string");
    expect(spec.columns.map((column) => column.name)).toEqual([
      "archived",
      "deleted",
      "version",
      "name",
      "priority",
    ]);
    expect(spec.columns.find((column) => column.name === "version")?.valueType).toBe("protobuf");
    expect(
      spec.columns
        .find((column) => column.name === "version")
        ?.valueIn(create(EntityRecordSchema, { version: create(VersionSchema, { number: 3 }) })),
    ).toEqual(create(VersionSchema, { number: 3 }));
  });

  it("materializes default lifecycle and Version columns from an incomplete persisted record", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(TaskProjection);
    const record = create(EntityRecordSchema);

    expect(spec.columns.find((column) => column.name === "archived")?.valueIn(record)).toBe(false);
    expect(spec.columns.find((column) => column.name === "deleted")?.valueIn(record)).toBe(false);
    expect(spec.columns.find((column) => column.name === "version")?.valueIn(record)).toEqual(
      create(VersionSchema),
    );
  });

  it("reads its current-record ID from the packed EntityRecord envelope", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(TaskProjection);
    const record = create(EntityRecordSchema, {
      entityId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: "task-1" })),
      state: AnyMessages.pack(
        ProjectionStateSchema,
        create(ProjectionStateSchema, { id: "different-state-id", name: "First" }),
      ),
    });

    expect(spec.idValueIn(record)).toBe("task-1");
  });

  it("uses the generated schema for a message-shaped Entity ID", () => {
    new Repository({ entityType: MessageIdProjection, schema: MessageIdStateSchema });
    const spec = SpecScanner.scan(MessageIdProjection);
    const id = create(ProjectionIdSchema, { value: "task-2" });
    const record = create(EntityRecordSchema, {
      entityId: AnyMessages.pack(ProjectionIdSchema, id),
    });

    expect(spec.idType).toBe(ProjectionIdSchema);
    expect(spec.idValueIn(record)).toEqual(id);
  });

  it("keeps EntityRecord shared while isolating Entity source types", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    new Repository({ entityType: AlternateAggregate, schema: AggregateStateSchema });

    const projection = SpecScanner.scan(TaskProjection);
    const alternate = SpecScanner.scan(AlternateAggregate);

    expect(projection.recordType).toBe(alternate.recordType);
    expect(projection.recordType).toBe(EntityRecordSchema);
    expect(projection.sourceType).not.toBe(alternate.sourceType);
    expect(projection.sourceType).toBe(ProjectionStateSchema);
    expect(alternate.sourceType).toBe(AggregateStateSchema);
  });

  it("unpacks a record state once when two state columns are materialized", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(TaskProjection);
    const packedState = AnyMessages.pack(
      ProjectionStateSchema,
      create(ProjectionStateSchema, { id: "task-1", name: "First", priority: 1 }),
    );
    let stateReads = 0;
    const record = new Proxy(Object.freeze(create(EntityRecordSchema, { state: packedState })), {
      get(target, property, receiver) {
        if (property === "state") stateReads += 1;
        return Reflect.get(target, property, receiver);
      },
    }) as EntityRecord;

    expect(spec.columns.find((column) => column.name === "name")?.valueIn(record)).toBe("First");
    expect(spec.columns.find((column) => column.name === "priority")?.valueIn(record)).toBe(1);
    expect(stateReads).toBe(1);
  });

  it("does not inherit generated schema metadata from an Entity superclass", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });

    expect(() => SpecScanner.scan(DerivedTaskProjection)).toThrow(
      /no generated state schema metadata/,
    );
  });

  it("keeps unpack caches separate for the same envelope under different state schemas", () => {
    const record = create(EntityRecordSchema, {
      state: AnyMessages.pack(
        ProjectionStateSchema,
        create(ProjectionStateSchema, { id: "task-1", name: "First", priority: 1 }),
      ),
    });

    expect(EntityRecords.unpack(ProjectionStateSchema, record).state).toMatchObject({
      name: "First",
    });
    expect(() => EntityRecords.unpack(AggregateStateSchema, record)).toThrow(/state schema/);
  });

  it("rejects missing or mismatched EntityRecord envelopes", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(TaskProjection);

    expect(() => spec.idValueIn(create(EntityRecordSchema))).toThrow(/ID does not match/);
    expect(() =>
      spec.idValueIn(
        create(EntityRecordSchema, {
          entityId: AnyMessages.pack(
            ProjectionStateSchema,
            create(ProjectionStateSchema, { id: "wrong-id-envelope" }),
          ),
        }),
      ),
    ).toThrow(/ID does not match/);
    expect(() =>
      EntityRecords.unpack(
        ProjectionStateSchema,
        create(EntityRecordSchema, {
          state: AnyMessages.pack(StringValueSchema, create(StringValueSchema)),
        }),
      ),
    ).toThrow(/state schema/);
    expect(() =>
      EntityRecords.unpack(
        ProjectionStateSchema,
        create(EntityRecordSchema, {
          state: AnyMessages.pack(ProjectionStateSchema, create(ProjectionStateSchema)),
          version: create(VersionSchema, { number: -1 }),
        }),
      ),
    ).toThrow(/non-negative/);
  });

  it("packs authoritative scalar and message IDs while rejecting invalid versions", () => {
    const scalarState = create(ProjectionStateSchema, { id: "state-id", name: "First" });
    const scalar = EntityRecords.pack(ProjectionStateSchema, "authoritative-id", scalarState, 1n, {
      archived: true,
      deleted: false,
    });
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    expect(SpecScanner.scan(TaskProjection).idValueIn(scalar)).toBe("authoritative-id");

    const messageId = create(ProjectionIdSchema, { value: "message-id" });
    const message = EntityRecords.pack(
      MessageIdStateSchema,
      messageId,
      create(MessageIdStateSchema, { id: create(ProjectionIdSchema, { value: "state-id" }) }),
      1n,
      { archived: false, deleted: true },
    );
    new Repository({ entityType: MessageIdProjection, schema: MessageIdStateSchema });
    expect(SpecScanner.scan(MessageIdProjection).idValueIn(message)).toEqual(messageId);
    expect(() =>
      EntityRecords.pack(ProjectionStateSchema, "id", scalarState, -1n, {
        archived: false,
        deleted: false,
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      EntityRecords.pack(ProjectionStateSchema, "id", scalarState, 2_147_483_648n, {
        archived: false,
        deleted: false,
      }),
    ).toThrow(/int32/);
  });

  it("preserves the complete Version message through the current-record envelope", () => {
    const version = create(VersionSchema, {
      number: 7,
      timestamp: create(TimestampSchema, { seconds: 42n, nanos: 9 }),
    });
    const record = EntityRecords.pack(
      ProjectionStateSchema,
      "task-1",
      create(ProjectionStateSchema, { id: "state-id", name: "First" }),
      version,
      { archived: false, deleted: false },
    );

    expect(EntityRecords.unpack(ProjectionStateSchema, record).versionMessage).toEqual(version);
  });

  it("keeps descriptor ID decoding fail-closed and canonicalizes structured IDs", () => {
    new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema });
    const descriptor = entityStorageDescriptor(
      { name: "Tasks", multitenant: false },
      SpecScanner.scan(TaskProjection),
    );

    expect(
      descriptor.id.unpack(
        AnyMessages.pack(ProjectionStateSchema, create(ProjectionStateSchema, { id: "wrong" })),
      ),
    ).toBeUndefined();
    expect(descriptor.id.key(null as never)).toBe("null");
    expect(descriptor.id.key({ value: "task-1" } as never)).toBe('json:{"value":"task-1"}');
  });

  it("rejects missing state and message-shaped ID envelopes", () => {
    expect(() => EntityRecords.unpack(ProjectionStateSchema, {} as EntityRecord)).toThrow(
      /state schema/,
    );
    new Repository({ entityType: MessageIdProjection, schema: MessageIdStateSchema });
    const spec = SpecScanner.scan(MessageIdProjection);
    expect(() => spec.idValueIn({} as EntityRecord)).toThrow(/packed entity ID/);
    expect(() =>
      spec.idValueIn(
        create(EntityRecordSchema, {
          entityId: AnyMessages.pack(
            ProjectionStateSchema,
            create(ProjectionStateSchema, { id: "wrong-message-id" }),
          ),
        }),
      ),
    ).toThrow(/ID does not match/);
  });

  if (false) {
    // @ts-expect-error SpecScanner accepts only Entity-family constructors.
    SpecScanner.scan({ name: "not-an-entity" });
  }
});
