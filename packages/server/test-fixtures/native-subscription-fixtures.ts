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
