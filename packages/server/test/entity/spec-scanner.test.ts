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

import { create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { messageDesc } from "@bufbuild/protobuf/codegenv2";
import { StringValueSchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AnyMessages } from "@spine-event-engine/core";
import { VersionSchema } from "@spine-event-engine/proto";
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
import * as FixtureSchemas from "../../test-fixtures/schemas.js";

type ProjectOverviewState = Message<"ProjectOverviewState"> & {
  id: string;
  name: string;
  priority: number;
};
type ProjectState = Message<"ProjectState"> & { id: string; name: string };
type ProjectOverviewId = Message<"ProjectOverviewId"> & { value: string };
type MessageIdState = Message<"MessageIdState"> & { id?: ProjectOverviewId };

const fixtureFile = FixtureSchemas.entityMetadataMainFile;

function fixtureSchemaAt<Shape extends Message>(index: number): GenMessage<Shape> {
  return messageDesc(fixtureFile, index);
}

const ProjectOverviewStateSchema = fixtureSchemaAt<ProjectOverviewState>(0);
const ProjectStateSchema = fixtureSchemaAt<ProjectState>(1);
const ProjectOverviewIdSchema = fixtureSchemaAt<ProjectOverviewId>(8);
const MessageIdStateSchema = fixtureSchemaAt<MessageIdState>(9);

class TaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {}
class AlternateAggregate extends Aggregate<string, typeof ProjectStateSchema, number> {}
class MessageIdProjection extends Projection<
  ProjectOverviewId,
  typeof MessageIdStateSchema,
  number
> {}
class DerivedTaskProjection extends TaskProjection {}

function register(entityType: unknown, schema: GenMessage<Message>): void {
  new Repository({ entityType: entityType as never, schema });
}

function scan(entityType: unknown) {
  return SpecScanner.scan(entityType as never);
}

describe("SpecScanner", () => {
  it("derives its current EntityRecord specification from the Entity class alone", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const spec = scan(TaskProjection);

    expect(spec.sourceType).toBe(ProjectOverviewStateSchema);
    expect(spec.recordType.typeName).toBe("spine.server.entity.EntityRecord");
    expect(spec.idType).toBe("string");
    expect(spec.columns.map((column) => column.name)).toEqual([
      "archived",
      "deleted",
      "version",
      "name",
      "priority",
    ]);
    expect(spec.columns.find((column) => column.name === "version")?.type.kind).toBe("message");
    expect(
      spec.columns
        .find((column) => column.name === "version")
        ?.valueIn(create(EntityRecordSchema, { version: create(VersionSchema, { number: 3 }) })),
    ).toEqual(create(VersionSchema, { number: 3 }));
  });

  it("materializes default lifecycle and Version columns from an incomplete persisted record", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const spec = scan(TaskProjection);
    const record = create(EntityRecordSchema);

    expect(spec.columns.find((column) => column.name === "archived")?.valueIn(record)).toBe(false);
    expect(spec.columns.find((column) => column.name === "deleted")?.valueIn(record)).toBe(false);
    expect(spec.columns.find((column) => column.name === "version")?.valueIn(record)).toEqual(
      create(VersionSchema),
    );
  });

  it("reads its current-record ID from the packed EntityRecord envelope", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const spec = scan(TaskProjection);
    const record = create(EntityRecordSchema, {
      entityId: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: "task-1" })),
      state: AnyMessages.pack(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "different-state-id", name: "First" }),
      ),
    });

    expect(spec.idValueIn(record)).toBe("task-1");
  });

  it("uses the generated schema for a message-shaped Entity ID", () => {
    register(MessageIdProjection, MessageIdStateSchema);
    const spec = scan(MessageIdProjection);
    const id = create(ProjectOverviewIdSchema, { value: "task-2" });
    const record = create(EntityRecordSchema, {
      entityId: AnyMessages.pack(ProjectOverviewIdSchema, id),
    });

    expect(spec.idType).toBe(ProjectOverviewIdSchema);
    expect(spec.idValueIn(record)).toEqual(id);
  });

  it("keeps EntityRecord shared while isolating Entity source types", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    register(AlternateAggregate, ProjectStateSchema);

    const projection = scan(TaskProjection);
    const alternate = scan(AlternateAggregate);

    expect(projection.recordType).toBe(alternate.recordType);
    expect(projection.recordType).toBe(EntityRecordSchema);
    expect(projection.sourceType).not.toBe(alternate.sourceType);
    expect(projection.sourceType).toBe(ProjectOverviewStateSchema);
    expect(alternate.sourceType).toBe(ProjectStateSchema);
  });

  it("unpacks a record state once when two state columns are materialized", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const spec = scan(TaskProjection);
    const packedState = AnyMessages.pack(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, { id: "task-1", name: "First", priority: 1 }),
    );
    let stateReads = 0;
    const record = new Proxy(Object.freeze(create(EntityRecordSchema, { state: packedState })), {
      get(target, property, receiver) {
        if (property === "state") stateReads += 1;
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as EntityRecord;

    expect(spec.columns.find((column) => column.name === "name")?.valueIn(record)).toBe("First");
    expect(spec.columns.find((column) => column.name === "priority")?.valueIn(record)).toBe(1);
    expect(stateReads).toBe(1);
  });

  it("does not inherit generated schema metadata from an Entity superclass", () => {
    register(TaskProjection, ProjectOverviewStateSchema);

    expect(() => scan(DerivedTaskProjection)).toThrow(/no generated state schema metadata/);
  });

  it("keeps unpack caches separate for the same envelope under different state schemas", () => {
    const record = create(EntityRecordSchema, {
      state: AnyMessages.pack(
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, { id: "task-1", name: "First", priority: 1 }),
      ),
    });

    expect(EntityRecords.unpack(ProjectOverviewStateSchema, record).state).toMatchObject({
      name: "First",
    });
    expect(() => EntityRecords.unpack(ProjectStateSchema, record)).toThrow(/state schema/);
  });

  it("rejects missing or mismatched EntityRecord envelopes", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const spec = scan(TaskProjection);

    expect(() => spec.idValueIn(create(EntityRecordSchema))).toThrow(/ID does not match/);
    expect(() =>
      spec.idValueIn(
        create(EntityRecordSchema, {
          entityId: AnyMessages.pack(
            ProjectOverviewStateSchema,
            create(ProjectOverviewStateSchema, { id: "wrong-id-envelope" }),
          ),
        }),
      ),
    ).toThrow(/ID does not match/);
    expect(() =>
      EntityRecords.unpack(
        ProjectOverviewStateSchema,
        create(EntityRecordSchema, {
          state: AnyMessages.pack(StringValueSchema, create(StringValueSchema)),
        }),
      ),
    ).toThrow(/state schema/);
    expect(() =>
      EntityRecords.unpack(
        ProjectOverviewStateSchema,
        create(EntityRecordSchema, {
          state: AnyMessages.pack(ProjectOverviewStateSchema, create(ProjectOverviewStateSchema)),
          version: create(VersionSchema, { number: -1 }),
        }),
      ),
    ).toThrow(/non-negative/);
  });

  it("packs authoritative scalar and message IDs while rejecting invalid versions", () => {
    const scalarState = create(ProjectOverviewStateSchema, { id: "state-id", name: "First" });
    const scalar = EntityRecords.pack(
      ProjectOverviewStateSchema,
      "authoritative-id",
      scalarState,
      1n,
      {
        archived: true,
        deleted: false,
      },
    );
    register(TaskProjection, ProjectOverviewStateSchema);
    expect(scan(TaskProjection).idValueIn(scalar)).toBe("authoritative-id");

    const messageId = create(ProjectOverviewIdSchema, { value: "message-id" });
    const message = EntityRecords.pack(
      MessageIdStateSchema,
      messageId,
      create(MessageIdStateSchema, { id: create(ProjectOverviewIdSchema, { value: "state-id" }) }),
      1n,
      { archived: false, deleted: true },
    );
    register(MessageIdProjection, MessageIdStateSchema);
    expect(scan(MessageIdProjection).idValueIn(message)).toEqual(messageId);
    expect(() =>
      EntityRecords.pack(ProjectOverviewStateSchema, "id", scalarState, -1n, {
        archived: false,
        deleted: false,
      }),
    ).toThrow(/non-negative/);
    expect(() =>
      EntityRecords.pack(ProjectOverviewStateSchema, "id", scalarState, 2_147_483_648n, {
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
      ProjectOverviewStateSchema,
      "task-1",
      create(ProjectOverviewStateSchema, { id: "state-id", name: "First" }),
      version,
      { archived: false, deleted: false },
    );

    expect(EntityRecords.unpack(ProjectOverviewStateSchema, record).versionMessage).toEqual(
      version,
    );
  });

  it("keeps descriptor ID decoding and keying fail-closed", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const descriptor = entityStorageDescriptor(
      { name: "Tasks", multitenant: false },
      scan(TaskProjection),
    );

    expect(
      descriptor.id.unpack(
        AnyMessages.pack(
          ProjectOverviewStateSchema,
          create(ProjectOverviewStateSchema, { id: "wrong" }),
        ),
      ),
    ).toBeUndefined();
    expect(() => descriptor.id.key(null as never)).toThrow(/string/i);
    expect(() => descriptor.id.key({ value: "task-1" } as never)).toThrow(/string/i);
  });

  it("round-trips scalar Entity IDs through the storage codec packer", () => {
    register(TaskProjection, ProjectOverviewStateSchema);
    const descriptor = entityStorageDescriptor(
      { name: "Tasks", multitenant: false },
      scan(TaskProjection),
    );

    expect(descriptor.id.unpack(descriptor.id.pack("task-1"))).toBe("task-1");
  });

  it("round-trips generated message Entity IDs through the storage codec packer", () => {
    register(MessageIdProjection, MessageIdStateSchema);
    const descriptor = entityStorageDescriptor(
      { name: "Tasks", multitenant: false },
      scan(MessageIdProjection),
    );
    const id = create(ProjectOverviewIdSchema, { value: "task-1" });

    expect(descriptor.id.unpack(descriptor.id.pack(id))).toEqual(id);
  });

  it("rejects missing state and message-shaped ID envelopes", () => {
    expect(() => EntityRecords.unpack(ProjectOverviewStateSchema, {} as EntityRecord)).toThrow(
      /state schema/,
    );
    register(MessageIdProjection, MessageIdStateSchema);
    const spec = scan(MessageIdProjection);
    expect(() => spec.idValueIn({} as EntityRecord)).toThrow(/packed entity ID/);
    expect(() =>
      spec.idValueIn(
        create(EntityRecordSchema, {
          entityId: AnyMessages.pack(
            ProjectOverviewStateSchema,
            create(ProjectOverviewStateSchema, { id: "wrong-message-id" }),
          ),
        }),
      ),
    ).toThrow(/ID does not match/);
  });
});
