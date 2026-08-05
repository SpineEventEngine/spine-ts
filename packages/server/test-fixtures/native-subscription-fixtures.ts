import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { file_spine_options } from "@spine-event-engine/proto";

import { serverEntityMetadataTestFixtures } from "./entity-metadata-fixtures.js";

export type NativeProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

export type NativeAggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

export type NativeProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
};

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Native subscription fixture descriptor set is empty.");
  }

  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
}

const mainFile = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const visibilityFile = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);

export const NativeProjectionStateSchema = messageDesc(
  mainFile,
  0,
) as GenMessage<NativeProjectionState>;
export const NativeAggregateStateSchema = messageDesc(
  mainFile,
  1,
) as GenMessage<NativeAggregateState>;
export const NativeProcessManagerStateSchema = messageDesc(
  visibilityFile,
  0,
) as GenMessage<NativeProcessManagerState>;
