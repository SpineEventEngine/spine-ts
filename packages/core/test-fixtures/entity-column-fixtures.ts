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

import { create, setExtension, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FieldOptionsSchema,
  FileDescriptorProtoSchema,
  MessageOptionsSchema,
  type Timestamp,
  file_google_protobuf_timestamp,
} from "@bufbuild/protobuf/wkt";
import {
  EntityOptionSchema,
  EntityOption_Kind,
  column,
  entity,
  file_spine_options,
} from "@spine-event-engine/proto";

export enum FixtureStatus {
  UNSPECIFIED = 0,
  OPEN = 1,
  CLOSED = 2,
}

export type Owner = Message<"spine_ts.client.test.Owner"> & { value: string };

export type ProjectionState = Message<"spine_ts.client.test.ProjectionState"> & {
  id: string;
  title: string;
  priority: number;
  status: FixtureStatus;
  dueAt?: Timestamp;
  owner?: Owner;
  fingerprint: Uint8Array;
  active: boolean;
  sequence: bigint;
  note: string;
};

type InvalidRepeatedState = Message<"spine_ts.client.test.InvalidRepeatedState"> & {
  id: string;
  tags: string[];
};

type InvalidMapState = Message<"spine_ts.client.test.InvalidMapState"> & {
  id: string;
  labels: Record<string, string>;
};

type InvalidOneofState = Message<"spine_ts.client.test.InvalidOneofState"> & {
  id: string;
  choice: { case: "label"; value: string } | { case: undefined; value?: undefined };
};

type AggregateState = Message<"spine_ts.client.test.AggregateState"> & {
  id: string;
  title: string;
};

type ProcessManagerState = Message<"spine_ts.client.test.ProcessManagerState"> & {
  id: string;
  title: string;
};

type ScalarProjectionState = Message<"spine_ts.client.test.ScalarProjectionState"> & {
  id: string;
  doubleValue: number;
  floatValue: number;
  uint64Value: bigint;
  fixed64Value: bigint;
  uint32Value: number;
  fixed32Value: number;
  sfixed64Value: bigint;
  sint64Value: bigint;
};

const descriptor = create(FileDescriptorProtoSchema, {
  name: "spine_ts/client/test/projection_columns.proto",
  package: "spine_ts.client.test",
  syntax: "proto3",
  dependency: ["spine/options.proto", "google/protobuf/timestamp.proto"],
  enumType: [
    {
      name: "FixtureStatus",
      value: [
        { name: "FIXTURE_STATUS_UNSPECIFIED", number: FixtureStatus.UNSPECIFIED },
        { name: "FIXTURE_STATUS_OPEN", number: FixtureStatus.OPEN },
        { name: "FIXTURE_STATUS_CLOSED", number: FixtureStatus.CLOSED },
      ],
    },
  ],
  messageType: [
    {
      name: "Owner",
      field: [field("value", 1, FieldDescriptorProto_Type.STRING)],
    },
    {
      name: "ProjectionState",
      options: entityOptions(EntityOption_Kind.PROJECTION),
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("title", 2, FieldDescriptorProto_Type.STRING, { column: true }),
        field("priority", 3, FieldDescriptorProto_Type.INT32, { column: true }),
        field("status", 4, FieldDescriptorProto_Type.ENUM, {
          column: true,
          typeName: ".spine_ts.client.test.FixtureStatus",
        }),
        field("due_at", 5, FieldDescriptorProto_Type.MESSAGE, {
          column: true,
          jsonName: "dueAt",
          typeName: ".google.protobuf.Timestamp",
        }),
        field("owner", 6, FieldDescriptorProto_Type.MESSAGE, {
          column: true,
          typeName: ".spine_ts.client.test.Owner",
        }),
        field("fingerprint", 7, FieldDescriptorProto_Type.BYTES, { column: true }),
        field("active", 8, FieldDescriptorProto_Type.BOOL, { column: true }),
        field("sequence", 9, FieldDescriptorProto_Type.INT64, { column: true }),
        field("note", 10, FieldDescriptorProto_Type.STRING),
      ],
    },
    {
      name: "InvalidRepeatedState",
      options: entityOptions(EntityOption_Kind.PROJECTION),
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("tags", 2, FieldDescriptorProto_Type.STRING, {
          column: true,
          label: FieldDescriptorProto_Label.REPEATED,
        }),
      ],
    },
    {
      name: "InvalidMapState",
      options: entityOptions(EntityOption_Kind.PROJECTION),
      nestedType: [
        {
          name: "LabelsEntry",
          options: create(MessageOptionsSchema, { mapEntry: true }),
          field: [
            field("key", 1, FieldDescriptorProto_Type.STRING),
            field("value", 2, FieldDescriptorProto_Type.STRING),
          ],
        },
      ],
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("labels", 2, FieldDescriptorProto_Type.MESSAGE, {
          column: true,
          label: FieldDescriptorProto_Label.REPEATED,
          typeName: ".spine_ts.client.test.InvalidMapState.LabelsEntry",
        }),
      ],
    },
    {
      name: "InvalidOneofState",
      options: entityOptions(EntityOption_Kind.PROJECTION),
      oneofDecl: [{ name: "choice" }],
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("label", 2, FieldDescriptorProto_Type.STRING, { column: true, oneofIndex: 0 }),
      ],
    },
    {
      name: "AggregateState",
      options: entityOptions(EntityOption_Kind.AGGREGATE),
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("title", 2, FieldDescriptorProto_Type.STRING, { column: true }),
      ],
    },
    {
      name: "ProcessManagerState",
      options: entityOptions(EntityOption_Kind.PROCESS_MANAGER),
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("title", 2, FieldDescriptorProto_Type.STRING, { column: true }),
      ],
    },
    {
      name: "ScalarProjectionState",
      options: entityOptions(EntityOption_Kind.PROJECTION),
      field: [
        field("id", 1, FieldDescriptorProto_Type.STRING),
        field("double_value", 2, FieldDescriptorProto_Type.DOUBLE, { column: true }),
        field("float_value", 3, FieldDescriptorProto_Type.FLOAT, { column: true }),
        field("uint64_value", 4, FieldDescriptorProto_Type.UINT64, { column: true }),
        field("fixed64_value", 5, FieldDescriptorProto_Type.FIXED64, { column: true }),
        field("uint32_value", 6, FieldDescriptorProto_Type.UINT32, { column: true }),
        field("fixed32_value", 7, FieldDescriptorProto_Type.FIXED32, { column: true }),
        field("sfixed64_value", 8, FieldDescriptorProto_Type.SFIXED64, { column: true }),
        field("sint64_value", 9, FieldDescriptorProto_Type.SINT64, { column: true }),
      ],
    },
  ],
});

const fixtureFile = fileDesc(
  Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
  [file_spine_options, file_google_protobuf_timestamp],
);

export const ProjectionStateSchema = messageDesc(fixtureFile, 1) as GenMessage<ProjectionState>;
export const InvalidRepeatedStateSchema = messageDesc(
  fixtureFile,
  2,
) as GenMessage<InvalidRepeatedState>;
export const InvalidMapStateSchema = messageDesc(fixtureFile, 3) as GenMessage<InvalidMapState>;
export const InvalidOneofStateSchema = messageDesc(fixtureFile, 4) as GenMessage<InvalidOneofState>;
export const AggregateStateSchema = messageDesc(fixtureFile, 5) as GenMessage<AggregateState>;
export const ProcessManagerStateSchema = messageDesc(
  fixtureFile,
  6,
) as GenMessage<ProcessManagerState>;
export const ScalarProjectionStateSchema = messageDesc(
  fixtureFile,
  7,
) as GenMessage<ScalarProjectionState>;

export function projectionSchemaWithRawEntityOption(data: Uint8Array): GenMessage<ProjectionState> {
  const options = create(MessageOptionsSchema);
  options.$unknown = [{ no: entity.number, wireType: 2, data }];
  return {
    ...ProjectionStateSchema,
    proto: { ...ProjectionStateSchema.proto, options },
  };
}

export function projectionFieldWithRawColumnOption(data: Uint8Array) {
  const options = create(FieldOptionsSchema);
  options.$unknown = [{ no: column.number, wireType: 0, data }];
  return {
    ...ProjectionStateSchema.field.title,
    proto: { ...ProjectionStateSchema.field.title.proto, options },
  };
}

function entityOptions(kind: (typeof EntityOption_Kind)[keyof typeof EntityOption_Kind]) {
  const options = create(MessageOptionsSchema);
  setExtension(options, entity, create(EntityOptionSchema, { kind }));
  return options;
}

function field(
  name: string,
  number: number,
  type: FieldDescriptorProto_Type,
  input: {
    readonly column?: boolean;
    readonly jsonName?: string;
    readonly label?: FieldDescriptorProto_Label;
    readonly oneofIndex?: number;
    readonly typeName?: string;
  } = {},
) {
  const options = create(FieldOptionsSchema);
  if (input.column === true) setExtension(options, column, true);
  return {
    name,
    number,
    label: input.label ?? FieldDescriptorProto_Label.OPTIONAL,
    type,
    options,
    ...(input.jsonName === undefined ? {} : { jsonName: input.jsonName }),
    ...(input.oneofIndex === undefined ? {} : { oneofIndex: input.oneofIndex }),
    ...(input.typeName === undefined ? {} : { typeName: input.typeName }),
  };
}
